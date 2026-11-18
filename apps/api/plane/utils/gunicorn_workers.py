# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""How many gunicorn workers the API starts (``GUNICORN_WORKERS``).

``GUNICORN_WORKERS=<n>`` pins the count. ``auto`` (the default) sizes it from the
container: the API runs async uvicorn workers, so one per core is the ceiling
(gunicorn's "2 x cores + 1" is for blocking workers). The whole stack (Postgres,
Celery, the live server) usually shares the host, so the API takes half the
cores, at least ``MIN_WORKERS`` and at most ``MAX_WORKERS``, and never more than
half the memory at ``WORKER_MEMORY_MB`` each.

Measured on a 16-core host (docs/chat/phase-2/DEPLOYMENT.md § 4): 2 workers put
chat delivery at 2.5 s p95 under load; 8 workers (what ``auto`` picks there)
met every budget at about 140 MB per worker.

Runs before Django starts (docker-entrypoint-api.sh), so it imports nothing
from Django.
"""

import os
import sys

MIN_WORKERS = 2
MAX_WORKERS = 16
WORKER_MEMORY_MB = 200


def _read(path):
    try:
        with open(path) as handle:
            return handle.read().strip()
    except OSError:
        return None


def available_cpus():
    """CPUs this process may use: the cgroup quota if set, else its CPU affinity."""
    count = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else (os.cpu_count() or 1)
    quota = None
    cpu_max = _read("/sys/fs/cgroup/cpu.max")  # cgroup v2: "<quota> <period>" or "max <period>"
    if cpu_max and not cpu_max.startswith("max"):
        limit, period = cpu_max.split()[:2]
        quota = int(limit) / int(period)
    else:
        limit, period = _read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"), _read("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
        if limit and period and int(limit) > 0:
            quota = int(limit) / int(period)
    if quota:
        count = min(count, max(1, int(quota)))
    return max(1, count)


def available_memory_mb():
    """Memory this process may use: the cgroup limit if set, else the host's total. None if unknown."""
    for path in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        value = _read(path)
        if value and value.isdigit() and int(value) < 1 << 60:  # cgroup v1 reports "no limit" as a huge number
            return int(value) // (1024 * 1024)
    meminfo = _read("/proc/meminfo")
    if meminfo:
        for line in meminfo.splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) // 1024
    return None


def auto_workers(cpus, memory_mb):
    """Half the cores, within [MIN_WORKERS, MAX_WORKERS], capped by half the memory."""
    workers = min(max(cpus // 2, MIN_WORKERS), MAX_WORKERS)
    if memory_mb:
        workers = min(workers, max(MIN_WORKERS, (memory_mb // 2) // WORKER_MEMORY_MB))
    return workers


def worker_count(value=None):
    """Resolve ``GUNICORN_WORKERS``: a positive number is used as-is; empty or "auto" sizes automatically."""
    value = (os.environ.get("GUNICORN_WORKERS", "") if value is None else value).strip().lower()
    if value.isdigit() and int(value) > 0:
        return int(value)
    if value not in ("", "auto"):
        print(f"GUNICORN_WORKERS={value!r} is not a number or 'auto'; sizing automatically.", file=sys.stderr)
    return auto_workers(available_cpus(), available_memory_mb())


if __name__ == "__main__":
    print(worker_count())

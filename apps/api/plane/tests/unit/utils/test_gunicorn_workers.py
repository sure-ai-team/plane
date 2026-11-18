# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""GUNICORN_WORKERS sizing (plane/utils/gunicorn_workers.py)."""

import pytest

from plane.utils import gunicorn_workers as gw


@pytest.mark.unit
@pytest.mark.parametrize(
    "cpus,memory_mb,expected",
    [
        (1, 4096, 2),  # never below the minimum
        (2, 4096, 2),
        (4, 8192, 2),
        (8, 16384, 4),
        (16, 32768, 8),  # the load-tested host: 8 met every budget
        (64, 262144, 16),  # never above the maximum
        (16, 1024, 2),  # little memory: half of 1 GB at 200 MB each, floored to the minimum
        (16, 2048, 5),  # memory caps before CPUs do
        (16, None, 8),  # memory unknown: CPUs decide
    ],
)
def test_auto_workers(cpus, memory_mb, expected):
    assert gw.auto_workers(cpus, memory_mb) == expected


@pytest.mark.unit
def test_explicit_number_wins(monkeypatch):
    monkeypatch.setattr(gw, "available_cpus", lambda: 16)
    monkeypatch.setattr(gw, "available_memory_mb", lambda: 32768)
    assert gw.worker_count("3") == 3
    assert gw.worker_count(" 12 ") == 12


@pytest.mark.unit
@pytest.mark.parametrize("value", ["", "auto", "AUTO", "0", "-1", "lots"])
def test_auto_and_invalid_values_size_automatically(monkeypatch, value):
    monkeypatch.setattr(gw, "available_cpus", lambda: 16)
    monkeypatch.setattr(gw, "available_memory_mb", lambda: 32768)
    assert gw.worker_count(value) == 8


@pytest.mark.unit
def test_reads_environment(monkeypatch):
    monkeypatch.setattr(gw, "available_cpus", lambda: 8)
    monkeypatch.setattr(gw, "available_memory_mb", lambda: None)
    monkeypatch.setenv("GUNICORN_WORKERS", "auto")
    assert gw.worker_count() == 4
    monkeypatch.setenv("GUNICORN_WORKERS", "6")
    assert gw.worker_count() == 6


@pytest.mark.unit
def test_cgroup_cpu_quota_limits_cpus(monkeypatch):
    files = {"/sys/fs/cgroup/cpu.max": "400000 100000"}  # docker --cpus=4
    monkeypatch.setattr(gw, "_read", files.get)
    assert gw.available_cpus() <= 4


@pytest.mark.unit
def test_cgroup_memory_limit(monkeypatch):
    files = {"/sys/fs/cgroup/memory.max": str(3 * 1024 * 1024 * 1024)}
    monkeypatch.setattr(gw, "_read", files.get)
    assert gw.available_memory_mb() == 3072
    files = {"/sys/fs/cgroup/memory.max": "max", "/proc/meminfo": "MemTotal:       16384000 kB\n"}
    monkeypatch.setattr(gw, "_read", files.get)
    assert gw.available_memory_mb() == 16000

#!/usr/bin/env bash
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Load a release copy's Docker images on a (new) server, so the platform can start without
# building or pulling anything.
#
#   deployments/backup/import-release-images.sh sgtpm-1.4.2-images.tar.gz [sha256]
#
# Then unpack the matching compose files (sgtpm-<version>-compose-files.tar.gz) next to your
# .env files and start the platform with `docker compose up -d` (without --build).

set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: $0 <images.tar.gz>" >&2
  exit 1
fi
if [ -n "${2:-}" ]; then
  echo "Checking the file against the expected checksum..."
  echo "$2  $FILE" | sha256sum -c -
fi

echo "Loading images from $FILE (this can take a few minutes)..."
gunzip -c "$FILE" | docker load
echo "Done. Start the platform with: docker compose up -d"

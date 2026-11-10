#!/usr/bin/env bash
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Save the platform's Docker images and compose files as a "release copy", once per version.
#
# Run it on the server, from the folder that holds the compose files, after every upgrade:
#
#   deployments/backup/export-release-images.sh                      # docker-compose.yml (+ override)
#   deployments/backup/export-release-images.sh -f docker-compose.yml -f docker-compose.override.yml
#   deployments/backup/export-release-images.sh -v 1.4.2             # set the version yourself
#
# The copy lands in the "backups" volume under .releases/<version>/, where the admin panel
# (Backup & restore > Server recovery) lists it, offers it for download and can copy it to
# the backup destinations. Load it on a new server with import-release-images.sh.
#
# Needs: docker with the compose plugin. Pulls a small alpine image to write into the volume.

set -euo pipefail

FILES=()
VERSION=""
HELPER_IMAGE="alpine:3.20"

usage() {
  sed -n '6,19p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while getopts "f:v:h" opt; do
  case "$opt" in
    f) FILES+=("$OPTARG") ;;
    v) VERSION="$OPTARG" ;;
    h) usage 0 ;;
    *) usage 1 ;;
  esac
done

if [ ${#FILES[@]} -eq 0 ]; then
  FILES=("docker-compose.yml")
  [ -f docker-compose.override.yml ] && FILES+=("docker-compose.override.yml")
fi
for file in "${FILES[@]}"; do
  [ -f "$file" ] || { echo "Compose file not found: $file" >&2; exit 1; }
done
COMPOSE=(docker compose)
for file in "${FILES[@]}"; do COMPOSE+=(-f "$file"); done

if [ -z "$VERSION" ] && [ -f package.json ]; then
  VERSION=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' package.json | head -1)
fi
if ! [[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  echo "Couldn't tell the platform version. Pass it with -v, for example -v 1.4.2" >&2
  exit 1
fi

PROJECT=$("${COMPOSE[@]}" config | sed -n 's/^name: //p' | head -1)
VOLUME="${PROJECT}_backups"
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  echo "The backups volume ($VOLUME) doesn't exist. Start the platform once with these compose files." >&2
  exit 1
fi

mapfile -t IMAGES < <("${COMPOSE[@]}" config --images | sort -u)
MISSING=()
for image in "${IMAGES[@]}"; do
  docker image inspect "$image" >/dev/null 2>&1 || MISSING+=("$image")
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "These images aren't on this machine yet (build or pull them first): ${MISSING[*]}" >&2
  exit 1
fi

TARGET="/backups/.releases/$VERSION"
in_volume() {
  docker run --rm -i -v "$VOLUME:/backups" "$HELPER_IMAGE" sh -c "$1"
}

echo "Saving ${#IMAGES[@]} images for version $VERSION into the $VOLUME volume..."
in_volume "mkdir -p '$TARGET'"
docker save "${IMAGES[@]}" | in_volume "gzip -6 > '$TARGET/images.tar.gz.part' && mv '$TARGET/images.tar.gz.part' '$TARGET/images.tar.gz'"
SHA=$(in_volume "sha256sum '$TARGET/images.tar.gz' | cut -d' ' -f1")

echo "Saving the compose files..."
tar -czf - "${FILES[@]}" | in_volume "cat > '$TARGET/compose-files.tar.gz'"

IMAGE_JSON=""
for image in "${IMAGES[@]}"; do
  id=$(docker image inspect --format '{{.Id}}' "$image")
  IMAGE_JSON+="${IMAGE_JSON:+,}{\"name\": \"$image\", \"id\": \"$id\"}"
done
MANIFEST="{\"format\": \"sgtpm-release\", \"version\": \"$VERSION\", \"created_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"host\": \"$(hostname)\", \"images_sha256\": \"$SHA\", \"images\": [$IMAGE_JSON]}"
printf '%s\n' "$MANIFEST" | in_volume "cat > '$TARGET/manifest.json'"

SIZE=$(in_volume "du -h '$TARGET/images.tar.gz' | cut -f1")
echo "Done: release copy $VERSION ($SIZE). It now shows in Backup & restore > Server recovery."

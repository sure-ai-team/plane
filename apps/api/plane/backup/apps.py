# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.apps import AppConfig


class BackupConfig(AppConfig):
    name = "plane.backup"
    label = "backup"
    default_auto_field = "django.db.models.BigAutoField"

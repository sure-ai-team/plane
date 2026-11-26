# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers

from plane.db.models import FileAsset


class ProjectSpreadsheetSerializer(serializers.ModelSerializer):
    """A spreadsheet uploaded to a project's Overview page."""

    id = serializers.CharField(read_only=True)
    name = serializers.SerializerMethodField()
    size = serializers.SerializerMethodField()
    type = serializers.SerializerMethodField()
    project = serializers.CharField(source="project_id", read_only=True)
    created_by = serializers.CharField(source="created_by_id", read_only=True, allow_null=True)
    updated_by = serializers.CharField(source="updated_by_id", read_only=True, allow_null=True)

    class Meta:
        model = FileAsset
        fields = ["id", "name", "size", "type", "project", "created_by", "created_at", "updated_by", "updated_at"]
        read_only_fields = fields

    def get_name(self, obj):
        return (obj.attributes or {}).get("name") or ""

    def get_size(self, obj):
        return int(obj.size or 0)

    def get_type(self, obj):
        return (obj.attributes or {}).get("type") or ""

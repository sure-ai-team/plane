# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers

from .base import BaseSerializer
from plane.db.models import FileAsset


class FileAssetSerializer(BaseSerializer):
    class Meta:
        model = FileAsset
        fields = "__all__"
        read_only_fields = [
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            # Chat links are set only by the chat attachment endpoints.
            "chat_conversation",
            "chat_message",
        ]

    def validate_entity_type(self, value):
        if value in FileAsset.PRIVATE_ENTITY_TYPES:
            raise serializers.ValidationError("This entity type can't be created here.")
        return value

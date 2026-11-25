# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import serializers

# Module imports
from .workspace import StickySerializer
from plane.app.permissions.base import ROLE
from plane.db.models import ProjectMember, Sticky, StickyAccess, StickyPermission, StickyShare


class StickyShareLiteSerializer(serializers.ModelSerializer):
    member_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = StickyShare
        fields = ["member_id", "permission"]
        read_only_fields = fields


class ProjectStickySerializer(StickySerializer):
    """Needs ``sticky_access`` (ProjectStickyAccess) in its context.

    Sharing and pinning are read-only here; they have endpoints of their own.
    """

    my_permission = serializers.SerializerMethodField()
    shares = serializers.SerializerMethodField()

    class Meta:
        model = Sticky
        fields = [
            "id",
            "name",
            "description",
            "description_html",
            "logo_props",
            "color",
            "background_color",
            "sort_order",
            "workspace",
            "project",
            "owner",
            "access",
            "project_permission",
            "shares",
            "my_permission",
            "pinned_at",
            "pinned_by",
            "content_version",
            "created_at",
            "created_by",
            "updated_at",
            "updated_by",
        ]
        read_only_fields = [
            "workspace",
            "project",
            "owner",
            "access",
            "project_permission",
            "pinned_at",
            "pinned_by",
            "content_version",
            "created_at",
            "created_by",
            "updated_at",
            "updated_by",
        ]
        extra_kwargs = {"name": {"required": False}}

    def get_my_permission(self, sticky):
        return self.context["sticky_access"].permission_for(sticky)

    def get_shares(self, sticky):
        return StickyShareLiteSerializer(getattr(sticky, "active_shares", []), many=True).data


class StickyShareInputSerializer(serializers.Serializer):
    member_id = serializers.UUIDField()
    permission = serializers.ChoiceField(choices=StickyPermission.choices)


class StickySharingSerializer(serializers.Serializer):
    """Validates the complete sharing state of a sticky, which replaces the current one.

    ``members`` applies to both MEMBERS and PROJECT access: with PROJECT it gives
    named people more than the project-wide permission.
    """

    access = serializers.ChoiceField(choices=StickyAccess.choices)
    project_permission = serializers.ChoiceField(choices=StickyPermission.choices, default=StickyPermission.VIEW)
    members = StickyShareInputSerializer(many=True, default=list)

    def validate_members(self, members):
        sticky = self.context["sticky"]
        member_ids = [member["member_id"] for member in members]
        if len(set(member_ids)) != len(member_ids):
            raise serializers.ValidationError("A member can only be listed once.")
        if sticky.owner_id in member_ids:
            raise serializers.ValidationError("The owner always has access and cannot be listed.")

        roles = dict(
            ProjectMember.objects.filter(
                project_id=sticky.project_id, member_id__in=member_ids, member__is_bot=False, is_active=True
            ).values_list("member_id", "role")
        )
        if len(roles) != len(member_ids):
            raise serializers.ValidationError("Every member must belong to the project.")
        if any(
            roles[member["member_id"]] == ROLE.GUEST.value and member["permission"] == StickyPermission.EDIT
            for member in members
        ):
            raise serializers.ValidationError("Guests can only be given view permission.")
        return members

    def validate(self, data):
        if data["access"] == StickyAccess.MEMBERS and not data["members"]:
            raise serializers.ValidationError({"members": "Choose at least one member to share with."})
        if data["access"] == StickyAccess.PRIVATE and data["members"]:
            raise serializers.ValidationError({"members": "A private sticky cannot have members."})
        return data

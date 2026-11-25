# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Inbox rows for project stickies.

People are told when a sticky is shared with them by name; sharing with the
whole project notifies nobody. Rows never contain the sticky's text, so nothing
has to be withdrawn from them when the sticky changes, and they are deleted once
their receiver can no longer open the sticky.
"""

# Module imports
from plane.db.models import Notification

# Must be listed by NotificationViewSet
ENTITY_NAME = "sticky"
SENDER = "in_app:sticky:shared"


def notify_shared(sticky, actor, permissions, could_see_ids):
    """Notify the people in ``permissions`` ({member_id: permission}) who could not see the sticky before."""
    receiver_ids = set(permissions) - set(could_see_ids) - {actor.id}
    name = actor.display_name or actor.first_name or actor.email
    Notification.objects.bulk_create(
        [
            Notification(
                workspace_id=sticky.workspace_id,
                project_id=sticky.project_id,
                entity_identifier=sticky.id,
                entity_name=ENTITY_NAME,
                title=f"{name} shared a sticky with you",
                sender=SENDER,
                triggered_by=actor,
                receiver_id=receiver_id,
                created_by=actor,
                data={"type": "shared", "sticky_id": str(sticky.id), "permission": permissions[receiver_id]},
            )
            for receiver_id in receiver_ids
        ],
        batch_size=100,
    )


def withdraw(sticky, except_for=()):
    """Delete the rows of everyone who can no longer open the sticky."""
    Notification.objects.filter(entity_name=ENTITY_NAME, entity_identifier=sticky.id).exclude(
        receiver_id__in=list(except_for)
    ).delete()

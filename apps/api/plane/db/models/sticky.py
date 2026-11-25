# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models
from django.db.models import Q

# Module imports
from .base import BaseModel

# Third party imports
from plane.utils.html_processor import strip_tags


class StickyAccess(models.IntegerChoices):
    """Who, besides its owner, a project sticky is shared with."""

    PRIVATE = 0, "Private"
    MEMBERS = 1, "Specific members"
    PROJECT = 2, "Whole project"


class StickyPermission(models.TextChoices):
    VIEW = "view", "View"
    EDIT = "edit", "Edit"


class Sticky(BaseModel):
    """A note. Without a project it is personal to its owner; with one it can be
    shared with that project's members (see plane.app.permissions.sticky)."""

    name = models.TextField(null=True, blank=True)

    description = models.JSONField(blank=True, default=dict)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_stripped = models.TextField(blank=True, null=True)
    description_binary = models.BinaryField(null=True)

    logo_props = models.JSONField(default=dict)
    color = models.CharField(max_length=255, blank=True, null=True)
    background_color = models.CharField(max_length=255, blank=True, null=True)

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="stickies")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="stickies")
    sort_order = models.FloatField(default=65535)

    # Project stickies
    project = models.ForeignKey(
        "db.Project", on_delete=models.CASCADE, null=True, blank=True, related_name="project_stickies"
    )
    access = models.PositiveSmallIntegerField(choices=StickyAccess.choices, default=StickyAccess.PRIVATE)
    # What the whole project may do; only used when access is PROJECT
    project_permission = models.CharField(
        max_length=10, choices=StickyPermission.choices, default=StickyPermission.VIEW
    )
    # Pinned to the project overview, for everyone in the project
    pinned_at = models.DateTimeField(null=True, blank=True)
    pinned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pinned_stickies",
    )
    # Incremented on every content change, so a stale save can be refused
    content_version = models.PositiveIntegerField(default=1)

    class Meta:
        verbose_name = "Sticky"
        verbose_name_plural = "Stickies"
        db_table = "stickies"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["project", "access"], name="sticky_project_access_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(access__in=StickyAccess.values),
                name="sticky_access_valid",
            ),
            models.CheckConstraint(
                condition=Q(project__isnull=False) | Q(access=StickyAccess.PRIVATE),
                name="sticky_personal_is_private",
            ),
            models.CheckConstraint(
                condition=Q(pinned_at__isnull=True) | Q(access=StickyAccess.PROJECT),
                name="sticky_pinned_is_project_wide",
            ),
        ]

    def save(self, *args, **kwargs):
        # Strip the html tags using html parser
        self.description_stripped = (
            None
            if (self.description_html == "" or self.description_html is None)
            else strip_tags(self.description_html)
        )
        if self._state.adding:
            # Get the maximum sequence value from the database, within the same
            # project (or among personal stickies when there is no project)
            last_id = Sticky.objects.filter(workspace=self.workspace, project=self.project).aggregate(
                largest=models.Max("sort_order")
            )["largest"]
            # if last_id is not None
            if last_id is not None:
                self.sort_order = last_id + 10000

        super(Sticky, self).save(*args, **kwargs)

    def __str__(self):
        return str(self.name)


class StickyShare(BaseModel):
    """Grants one project member view or edit permission on a project sticky."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="sticky_shares")
    sticky = models.ForeignKey(Sticky, on_delete=models.CASCADE, related_name="shares")
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sticky_shares")
    permission = models.CharField(max_length=10, choices=StickyPermission.choices, default=StickyPermission.VIEW)

    class Meta:
        verbose_name = "Sticky Share"
        verbose_name_plural = "Sticky Shares"
        db_table = "sticky_shares"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["sticky", "member"],
                condition=Q(deleted_at__isnull=True),
                name="sticky_share_unique_sticky_member_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.sticky_id} {self.member_id} <{self.permission}>"

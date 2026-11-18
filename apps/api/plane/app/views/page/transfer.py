# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Bulk import and export of a project's pages.

The web app turns JSON, Markdown, HTML and Excel/CSV files into the canonical
payload described in plane.utils.page_transfer, so these endpoints only deal
with that one shape.
"""

# Python imports
from typing import Dict, List, Optional

# Django imports
from django.db import transaction
from django.db.models import Prefetch, Q
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ProjectPagePermission, ROLE
from plane.bgtasks.page_transaction_task import page_transaction
from plane.db.models import (
    Label,
    Page,
    PageLabel,
    PageVersion,
    Project,
    ProjectMember,
    ProjectPage,
)
from plane.utils.page_transfer import (
    CONFLICT_DUPLICATE,
    CONFLICT_MODES,
    CONFLICT_SKIP,
    CONFLICT_UPDATE,
    EXTERNAL_SOURCE,
    FORMAT_VERSION,
    INT_TO_ACCESS,
    ImportedPage,
    as_uuid,
    parse_conflict_mode,
    parse_import_payload,
)

from ..base import BaseAPIView

ACTION_CREATE = "create"
ACTION_UPDATE = "update"
ACTION_SKIP = "skip"

EXPORT_TYPES = ("public", "private", "archived", "all")


def _visible_project_pages(request, slug, project_id):
    """Top-level pages of the project that the requesting user may see.

    Mirrors PageViewSet: public pages plus the user's own private pages, and
    guests only see their own pages unless the project lets guests view
    everything.
    """
    queryset = Page.objects.filter(
        workspace__slug=slug,
        project_pages__project_id=project_id,
        project_pages__deleted_at__isnull=True,
        parent__isnull=True,
    ).filter(Q(owned_by=request.user) | Q(access=Page.PUBLIC_ACCESS))

    is_guest = ProjectMember.objects.filter(
        workspace__slug=slug,
        project_id=project_id,
        member=request.user,
        role=ROLE.GUEST.value,
        is_active=True,
    ).exists()
    if is_guest and not Project.objects.filter(pk=project_id, guest_view_all_features=True).exists():
        queryset = queryset.filter(owned_by=request.user)

    return queryset.distinct()


class PageExportEndpoint(BaseAPIView):
    permission_classes = [ProjectPagePermission]

    def get(self, request, slug, project_id):
        export_type = request.GET.get("type", "all")
        if export_type not in EXPORT_TYPES:
            return Response(
                {"error": f"type must be one of: {', '.join(EXPORT_TYPES)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queryset = _visible_project_pages(request, slug, project_id)
        if export_type == "public":
            queryset = queryset.filter(access=Page.PUBLIC_ACCESS, archived_at__isnull=True)
        elif export_type == "private":
            queryset = queryset.filter(access=Page.PRIVATE_ACCESS, archived_at__isnull=True)
        elif export_type == "archived":
            queryset = queryset.filter(archived_at__isnull=False)
        else:
            queryset = queryset.filter(archived_at__isnull=True)

        raw_ids = request.GET.get("page_ids", "").strip()
        if raw_ids:
            page_ids = [as_uuid(value.strip()) for value in raw_ids.split(",") if value.strip()]
            if any(page_id is None for page_id in page_ids):
                return Response(
                    {"error": "page_ids must be a comma separated list of page ids."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            queryset = queryset.filter(pk__in=page_ids)

        pages = queryset.prefetch_related(
            Prefetch(
                "page_labels",
                queryset=PageLabel.objects.filter(label__deleted_at__isnull=True).select_related("label"),
            )
        ).order_by("created_at")

        project = Project.objects.only("id", "name", "identifier").get(pk=project_id)

        return Response(
            {
                "version": FORMAT_VERSION,
                "exported_at": timezone.now().isoformat(),
                "project": {"id": str(project.id), "name": project.name, "identifier": project.identifier},
                "pages": [
                    {
                        "external_id": page.external_id or str(page.id),
                        "name": page.name,
                        "access": INT_TO_ACCESS.get(page.access, "public"),
                        "labels": sorted({page_label.label.name for page_label in page.page_labels.all()}),
                        "content_html": page.description_html or "<p></p>",
                        "logo_props": page.logo_props or {},
                        "archived": page.archived_at is not None,
                        "created_at": page.created_at.isoformat() if page.created_at else None,
                        "updated_at": page.updated_at.isoformat() if page.updated_at else None,
                    }
                    for page in pages
                ],
            },
            status=status.HTTP_200_OK,
        )


class PageImportEndpoint(BaseAPIView):
    """
    POST body: {"version": 1, "pages": [...], "on_conflict": "skip" | "update" | "duplicate", "dry_run": bool}

    A page "conflicts" when its external_id matches a visible page of this
    project, either by that page's external_id or by its id (pages exported
    from Plane carry their id as external_id, so an export can be edited and
    re-imported).

    The whole import runs in one transaction: a payload with any error
    creates nothing. With dry_run the result is computed but nothing is saved,
    which is what the import preview uses.
    """

    permission_classes = [ProjectPagePermission]

    def post(self, request, slug, project_id):
        on_conflict = parse_conflict_mode(request.data.get("on_conflict"))
        if on_conflict is None:
            message = f"on_conflict must be one of: {', '.join(CONFLICT_MODES)}"
            return Response(
                {"valid": False, "errors": [{"index": None, "field": "on_conflict", "message": message}]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        dry_run = request.data.get("dry_run") in (True, "true", "1", 1)

        pages, errors = parse_import_payload(request.data)
        if errors:
            if dry_run:
                return Response({"valid": False, "errors": errors, "results": [], "labels_to_create": []})
            return Response({"valid": False, "errors": errors}, status=status.HTTP_400_BAD_REQUEST)

        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        matches = self._find_matches(request, slug, project_id, pages)
        plan = self._plan(pages, matches, on_conflict, request.user.id)

        existing_labels = {
            label.name.lower(): label
            for label in Label.objects.filter(project_id=project_id, workspace__slug=slug)
        }
        labels_to_create: List[str] = []
        pending = set()
        for page in pages:
            for name in page.labels:
                key = name.lower()
                if key not in existing_labels and key not in pending:
                    pending.add(key)
                    labels_to_create.append(name)

        if dry_run:
            return Response(
                {
                    "valid": True,
                    "errors": [],
                    "results": [self._result(entry) for entry in plan],
                    "labels_to_create": labels_to_create,
                }
            )

        transaction_jobs = []
        with transaction.atomic():
            for name in labels_to_create:
                label = Label.objects.create(name=name, project_id=project_id, workspace_id=project.workspace_id)
                existing_labels[name.lower()] = label

            for entry in plan:
                page: ImportedPage = entry["page"]
                label_objs = [existing_labels[name.lower()] for name in page.labels]
                if entry["action"] == ACTION_CREATE:
                    created = self._create_page(request, project, page, label_objs, entry["keep_external_id"])
                    entry["page_id"] = created.id
                    transaction_jobs.append((created.id, page.content_html, None))
                elif entry["action"] == ACTION_UPDATE:
                    old_html = self._update_page(request, entry["existing"], page, label_objs)
                    transaction_jobs.append((entry["existing"].id, page.content_html, old_html))

            def run_page_transactions():
                for page_id, new_html, old_html in transaction_jobs:
                    page_transaction.delay(
                        new_description_html=new_html,
                        old_description_html=old_html,
                        page_id=str(page_id),
                    )

            transaction.on_commit(run_page_transactions)

        results = [self._result(entry) for entry in plan]
        return Response(
            {
                "valid": True,
                "errors": [],
                "created": sum(1 for r in results if r["action"] == ACTION_CREATE),
                "updated": sum(1 for r in results if r["action"] == ACTION_UPDATE),
                "skipped": sum(1 for r in results if r["action"] == ACTION_SKIP),
                "labels_created": labels_to_create,
                "results": results,
            },
            status=status.HTTP_200_OK,
        )

    # -- helpers -------------------------------------------------------

    def _find_matches(self, request, slug, project_id, pages: List[ImportedPage]) -> Dict[str, Page]:
        external_ids = [page.external_id for page in pages if page.external_id]
        if not external_ids:
            return {}
        uuid_ids = [value for value in (as_uuid(external_id) for external_id in external_ids) if value]

        candidates = (
            _visible_project_pages(request, slug, project_id)
            .filter(Q(external_id__in=external_ids) | Q(pk__in=uuid_ids))
            .order_by("-updated_at")
        )
        matches: Dict[str, Page] = {}
        for candidate in candidates:
            # Most recently updated page wins when several share an external_id
            if candidate.external_id and candidate.external_id not in matches:
                matches[candidate.external_id] = candidate
            matches.setdefault(str(candidate.id), candidate)
        return matches

    def _plan(self, pages: List[ImportedPage], matches: Dict[str, Page], on_conflict: str, user_id) -> List[dict]:
        plan = []
        claimed = set()
        for page in pages:
            entry = {
                "page": page,
                "action": ACTION_CREATE,
                "existing": None,
                "reason": None,
                "page_id": None,
                "keep_external_id": True,
            }
            existing = matches.get(page.external_id) if page.external_id else None
            if existing is None and page.external_id:
                parsed = as_uuid(page.external_id)
                existing = matches.get(str(parsed)) if parsed else None

            if existing is not None:
                entry["existing"] = existing
                entry["page_id"] = existing.id
                if existing.id in claimed:
                    entry.update(action=ACTION_SKIP, reason="matches_page_already_in_this_import")
                elif on_conflict == CONFLICT_SKIP:
                    entry.update(action=ACTION_SKIP, reason="already_exists")
                elif on_conflict == CONFLICT_DUPLICATE:
                    # A copy must not carry the same external_id, or future
                    # re-imports could not tell the two pages apart.
                    entry.update(action=ACTION_CREATE, page_id=None, keep_external_id=False)
                elif on_conflict == CONFLICT_UPDATE:
                    if existing.is_locked:
                        entry.update(action=ACTION_SKIP, reason="locked")
                    elif existing.archived_at is not None:
                        entry.update(action=ACTION_SKIP, reason="archived")
                    else:
                        entry["action"] = ACTION_UPDATE
                        if page.access != existing.access and existing.owned_by_id != user_id:
                            entry["reason"] = "access_unchanged_not_owner"
                claimed.add(existing.id)
            plan.append(entry)
        return plan

    def _result(self, entry: dict) -> dict:
        return {
            "index": entry["page"].index,
            "name": entry["page"].name,
            "action": entry["action"],
            "reason": entry["reason"],
            "page_id": str(entry["page_id"]) if entry["page_id"] else None,
        }

    def _create_page(self, request, project, page: ImportedPage, labels, keep_external_id: bool) -> Page:
        created = Page(
            name=page.name,
            access=page.access,
            description_html=page.content_html,
            # The live server builds the collaborative document from the HTML
            # the first time the page is opened.
            description_binary=None,
            owned_by_id=request.user.id,
            workspace_id=project.workspace_id,
            logo_props=page.logo_props or {},
            external_id=page.external_id if keep_external_id else None,
            external_source=EXTERNAL_SOURCE if keep_external_id and page.external_id else None,
        )
        created.save()
        ProjectPage.objects.create(
            workspace_id=project.workspace_id,
            project_id=project.id,
            page_id=created.id,
        )
        self._set_labels(created, labels)
        return created

    def _update_page(self, request, existing: Page, page: ImportedPage, labels) -> Optional[str]:
        old_html = existing.description_html

        # Keep the pre-import content in version history so it can be restored.
        if old_html and old_html != page.content_html:
            PageVersion.objects.create(
                workspace_id=existing.workspace_id,
                page_id=existing.id,
                owned_by_id=request.user.id,
                last_saved_at=timezone.now(),
                description_html=old_html,
                description_binary=existing.description_binary,
                description_json=existing.description_json or {},
                description_stripped=existing.description_stripped,
            )

        existing.name = page.name
        existing.description_html = page.content_html
        existing.description_binary = None
        existing.description_json = {}
        if page.logo_props is not None:
            existing.logo_props = page.logo_props
        if existing.owned_by_id == request.user.id:
            existing.access = page.access
        existing.save()

        PageLabel.objects.filter(page=existing).delete()
        self._set_labels(existing, labels)
        return old_html

    def _set_labels(self, page: Page, labels) -> None:
        if not labels:
            return
        PageLabel.objects.bulk_create(
            [PageLabel(label=label, page=page, workspace_id=page.workspace_id) for label in labels],
            batch_size=100,
        )

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project README helpers.

A project's README is an ordinary project page referenced by ``Project.readme_page``.
It is edited in the normal page editor, but it lives on the project's Overview page,
so it is hidden from the Pages list and search, and cannot be archived or deleted.
"""

from html import escape

from plane.db.models import Project

README_PAGE_NAME = "README"

BLANK_TEMPLATE = "blank"


def _section(heading, text):
    return f"<h2>{escape(heading)}</h2><p>{escape(text)}</p>"


# Each template is a list of (heading, placeholder paragraph) sections.
_TEMPLATE_SECTIONS = {
    BLANK_TEMPLATE: [],
    "product": [
        ("Overview", "Describe what this project delivers and who it is for."),
        ("Goals", "List the outcomes this project is working towards."),
        ("Guidelines", "Note the conventions and decisions everyone on the project should follow."),
        ("Key links", "Add links to designs, specs, dashboards and other important resources."),
    ],
    "architecture": [
        ("System overview", "Summarize how the system fits together at a high level."),
        ("Components", "List the main components and what each one is responsible for."),
        ("Data flow", "Explain how data moves between the components."),
        ("Decisions", "Record important technical decisions and why they were made."),
    ],
    "onboarding": [
        ("Welcome", "Introduce the project and what new members will work on."),
        ("Setup", "Describe the steps to get access and set up a working environment."),
        ("Workflow", "Explain how work is planned, tracked and reviewed."),
        ("Who to ask", "List the people to contact for each area of the project."),
    ],
}

README_TEMPLATES = frozenset(_TEMPLATE_SECTIONS)


def readme_template_html(template):
    """The starting HTML for a README created from ``template``."""
    sections = _TEMPLATE_SECTIONS.get(template) or []
    if not sections:
        return "<p></p>"
    return "".join(_section(heading, text) for heading, text in sections)


def readme_page_ids():
    """Ids of every page used as a project README (a subquery-friendly values queryset)."""
    return Project.all_objects.filter(readme_page__isnull=False).values("readme_page_id")


def exclude_readme_pages(queryset):
    """Drop README pages from a Page queryset."""
    return queryset.exclude(id__in=readme_page_ids())


def is_readme_page(page_id):
    return Project.all_objects.filter(readme_page_id=page_id).exists()

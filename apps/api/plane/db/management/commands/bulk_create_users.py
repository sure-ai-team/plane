# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import csv
import os
import sys
from collections import Counter
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from plane.utils.bulk_user_import import (
    COLUMNS,
    STATUS_CREATED,
    STATUS_ERROR,
    STATUS_EXISTING,
    BulkUserImporter,
    BulkUserImportError,
    RowError,
    parse_role,
    read_rows,
    read_upload,
    write_results,
)

EXAMPLE_ROWS = [
    ["ahmed@example.com", "Ahmed", "Ali", "+966551234567", "", "", "sgt", "member", "WEB;API", ""],
    ["sara@example.com", "Sara", "Hassan", "+966501234567", "sara.h", "", "sgt", "admin", "WEB", "admin"],
]


class Command(BaseCommand):
    help = (
        "Create user accounts in bulk from a CSV or Excel file, without email. New accounts get a temporary "
        "password, written to a results CSV for you to hand out. Run with --template for the columns. "
        "The same feature is available in the admin console under Users."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "csv_file", nargs="?", help="Path to the users .csv or .xlsx file, or - to read CSV from stdin."
        )
        parser.add_argument("--workspace", help="Workspace slug for rows whose workspace column is empty.")
        parser.add_argument(
            "--role", default="member", help="Workspace role for rows whose role column is empty (default: member)."
        )
        parser.add_argument(
            "--output",
            help="Where to write the results CSV with passwords, or - for stdout. "
            "Default: <csv_file>_credentials.csv next to the input.",
        )
        parser.add_argument("--dry-run", action="store_true", help="Check every row and report, but change nothing.")
        parser.add_argument("--template", action="store_true", help="Print an example CSV and exit.")

    def handle(self, *args, **options):
        if options["template"]:
            writer = csv.writer(self.stdout)
            writer.writerow(COLUMNS)
            writer.writerows(EXAMPLE_ROWS)
            return

        source = options["csv_file"]
        if not source:
            raise CommandError("Give the path to a users CSV, or run with --template to see the format.")

        output = options["output"] or ("-" if source == "-" else str(self._default_output(source)))
        # Keep the progress log out of the results when the results go to stdout.
        log = self.stderr if output == "-" else self.stdout
        dry_run = options["dry_run"]

        if output != "-" and not dry_run and Path(output).exists():
            raise CommandError(f"{output} already exists. Move it away or pass a different --output.")

        try:
            default_role = parse_role(options["role"] or "member", None)
        except RowError as exc:
            raise CommandError(str(exc))

        try:
            rows = self._read_source(source)
        except BulkUserImportError as exc:
            raise CommandError(str(exc))

        importer = BulkUserImporter(default_workspace=options["workspace"], default_role=default_role)
        results = importer.run(rows, dry_run=dry_run)

        for result in results:
            style = {
                STATUS_CREATED: self.style.SUCCESS,
                STATUS_EXISTING: self.style.WARNING,
                STATUS_ERROR: self.style.ERROR,
            }[result.status]
            details = " ".join(result.messages)
            log.write(
                style(
                    f"line {result.line}: {result.email or '(no email)'}: {result.status}"
                    + (f" - {details}" if details else "")
                )
            )

        counts = Counter(result.status for result in results)
        summary = (
            f"{counts[STATUS_CREATED]} created, {counts[STATUS_EXISTING]} already existed, "
            f"{counts[STATUS_ERROR]} failed"
        )

        if dry_run:
            log.write(self.style.WARNING(f"Dry run, nothing was saved: {summary}."))
        else:
            self._write_output(results, output)
            log.write(self.style.SUCCESS(f"Done: {summary}."))
            if output != "-" and counts[STATUS_CREATED]:
                log.write(
                    self.style.WARNING(
                        f"Temporary passwords are in {output}. Hand them out, then delete the file. "
                        "Users can change their password under Profile settings."
                    )
                )

        if counts[STATUS_ERROR]:
            raise CommandError(f"{counts[STATUS_ERROR]} row(s) failed; see the lines marked error above.")

    @staticmethod
    def _default_output(source):
        path = Path(source)
        return path.with_name(f"{path.stem}_credentials.csv")

    @staticmethod
    def _read_source(source):
        if source == "-":
            return read_rows(sys.stdin.read())
        try:
            with open(source, "rb") as handle:
                return read_upload(source, handle.read())
        except FileNotFoundError:
            raise CommandError(f"File not found: {source}")

    def _write_output(self, results, output):
        if output == "-":
            write_results(results, self.stdout)
            return
        # The file holds plain-text passwords, so only the owner may read it.
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            write_results(results, handle)

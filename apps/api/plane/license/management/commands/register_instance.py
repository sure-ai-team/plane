# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json
import secrets
import os

# Django imports
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone


# Module imports
from plane.license.models import Instance, InstanceEdition
from plane.license.bgtasks.telemetry_metrics import push_instance_metrics


class Command(BaseCommand):
    help = "Check if instance in registered else register"

    def add_arguments(self, parser):
        # Positional argument
        parser.add_argument("machine_signature", type=str, help="Machine signature")

    def check_for_current_version(self):
        if os.environ.get("APP_VERSION", False):
            return os.environ.get("APP_VERSION")

        try:
            with open("package.json", "r") as file:
                data = json.load(file)
                return data.get("version", "v0.1.0")
        except Exception:
            self.stdout.write("Error checking for current version")
            return "v0.1.0"

    def check_for_latest_version(self, fallback_version):
        # Upstream release checks are disabled; this build is versioned independently.
        return fallback_version

    def handle(self, *args, **options):
        # Check if the instance is registered
        instance = Instance.objects.first()

        current_version = self.check_for_current_version()
        latest_version = self.check_for_latest_version(current_version)

        # If instance is None then register this instance
        if instance is None:
            machine_signature = options.get("machine_signature", "machine-signature")

            if not machine_signature:
                raise CommandError("Machine signature is required")

            instance = Instance.objects.create(
                instance_name="SURE Project Management Platform",
                instance_id=secrets.token_hex(12),
                current_version=current_version,
                latest_version=latest_version,
                last_checked_at=timezone.now(),
                is_test=os.environ.get("IS_TEST", "0") == "1",
                is_telemetry_enabled=False,
                edition=InstanceEdition.PLANE_COMMUNITY.value,
            )

            self.stdout.write(self.style.SUCCESS("Instance registered"))
        else:
            self.stdout.write(self.style.SUCCESS("Instance already registered"))

            # Update the instance details
            instance.last_checked_at = timezone.now()
            instance.current_version = current_version
            instance.latest_version = latest_version
            instance.is_test = os.environ.get("IS_TEST", "0") == "1"
            instance.edition = InstanceEdition.PLANE_COMMUNITY.value
            instance.save()

        # Push instance metrics on registration
        push_instance_metrics.delay()

        return

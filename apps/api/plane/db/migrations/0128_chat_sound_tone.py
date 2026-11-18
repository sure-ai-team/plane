# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Chat notification sound: which tone and how loud (docs/chat/phase-3/README.md)."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0127_chat_search_index"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatpreference",
            name="sound_tone",
            field=models.CharField(
                choices=[
                    ("chime", "Chime"),
                    ("ding", "Ding"),
                    ("pop", "Pop"),
                    ("marimba", "Marimba"),
                    ("ringtone", "Ringtone"),
                ],
                default="chime",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="chatpreference",
            name="sound_volume",
            field=models.PositiveSmallIntegerField(default=60),
        ),
    ]

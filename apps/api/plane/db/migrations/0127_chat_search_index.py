# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Full-text search index for chat messages (docs/chat/phase-2/06-search.md).

Built concurrently so a large messages table isn't locked, which requires a
non-atomic migration. Kept separate from 0126 so a failure here can't leave
the rest of the phase 2 schema half-applied.
"""

import django.contrib.postgres.indexes
import django.contrib.postgres.search
from django.contrib.postgres.operations import AddIndexConcurrently
from django.db import migrations


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("db", "0126_chat_phase2"),
    ]

    operations = [
        AddIndexConcurrently(
            model_name="message",
            index=django.contrib.postgres.indexes.GinIndex(
                django.contrib.postgres.search.SearchVector("body_stripped", config="simple"),
                name="chat_msg_search_idx",
            ),
        ),
    ]

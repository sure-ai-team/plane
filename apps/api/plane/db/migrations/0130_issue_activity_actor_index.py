from django.contrib.postgres.operations import AddIndexConcurrently
from django.db import migrations, models


class Migration(migrations.Migration):
    # Built concurrently, so writing work item activity is never blocked on large tables.
    atomic = False

    dependencies = [
        ("db", "0129_project_stickies"),
    ]

    operations = [
        AddIndexConcurrently(
            model_name="issueactivity",
            index=models.Index(fields=["actor", "workspace", "-created_at"], name="issue_activity_actor_idx"),
        ),
    ]

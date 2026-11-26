import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    # FileAsset.entity_type is a plain CharField (no choices), so the new
    # PROJECT_SPREADSHEET entity type needs no schema change.

    dependencies = [
        ("db", "0130_issue_activity_actor_index"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="readme_page",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="readme_projects",
                to="db.page",
            ),
        ),
    ]

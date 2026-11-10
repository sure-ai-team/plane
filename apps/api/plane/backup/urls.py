# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.backup.views import (
    BackupDestinationDetailEndpoint,
    BackupDestinationListEndpoint,
    BackupDestinationTestEndpoint,
    BackupOverviewEndpoint,
    BackupScheduleEndpoint,
    BackupSnapshotDetailEndpoint,
    BackupSnapshotListEndpoint,
)
from plane.backup.views_restore import (
    BackupExportDetailEndpoint,
    BackupExportDownloadEndpoint,
    BackupExportListEndpoint,
    BackupRestoreCancelEndpoint,
    BackupRestoreConfirmEndpoint,
    BackupRestoreDetailEndpoint,
    BackupRestoreListEndpoint,
    BackupRestoreStatusEndpoint,
    BackupRestoreUndoEndpoint,
    BackupUploadChunkEndpoint,
    BackupUploadDetailEndpoint,
    BackupUploadListEndpoint,
    BackupUploadRestoreEndpoint,
)

urlpatterns = [
    path("overview/", BackupOverviewEndpoint.as_view(), name="backup-overview"),
    path("schedule/", BackupScheduleEndpoint.as_view(), name="backup-schedule"),
    path("destinations/", BackupDestinationListEndpoint.as_view(), name="backup-destinations"),
    path("destinations/test/", BackupDestinationTestEndpoint.as_view(), name="backup-destination-test"),
    path("destinations/<uuid:pk>/", BackupDestinationDetailEndpoint.as_view(), name="backup-destination"),
    path(
        "destinations/<uuid:pk>/test/",
        BackupDestinationTestEndpoint.as_view(),
        name="backup-destination-test-saved",
    ),
    path("snapshots/", BackupSnapshotListEndpoint.as_view(), name="backup-snapshots"),
    path("snapshots/<uuid:pk>/", BackupSnapshotDetailEndpoint.as_view(), name="backup-snapshot"),
    path("snapshots/<uuid:pk>/exports/", BackupExportListEndpoint.as_view(), name="backup-snapshot-exports"),
    path("exports/<uuid:pk>/", BackupExportDetailEndpoint.as_view(), name="backup-export"),
    path("exports/<uuid:pk>/download/", BackupExportDownloadEndpoint.as_view(), name="backup-export-download"),
    path("restores/", BackupRestoreListEndpoint.as_view(), name="backup-restores"),
    path("restores/<uuid:pk>/", BackupRestoreDetailEndpoint.as_view(), name="backup-restore"),
    path("restores/<uuid:pk>/status/", BackupRestoreStatusEndpoint.as_view(), name="backup-restore-status"),
    path("restores/<uuid:pk>/confirm/", BackupRestoreConfirmEndpoint.as_view(), name="backup-restore-confirm"),
    path("restores/<uuid:pk>/cancel/", BackupRestoreCancelEndpoint.as_view(), name="backup-restore-cancel"),
    path("restores/<uuid:pk>/undo/", BackupRestoreUndoEndpoint.as_view(), name="backup-restore-undo"),
    path("uploads/", BackupUploadListEndpoint.as_view(), name="backup-uploads"),
    path("uploads/<uuid:pk>/", BackupUploadDetailEndpoint.as_view(), name="backup-upload"),
    path("uploads/<uuid:pk>/chunk/", BackupUploadChunkEndpoint.as_view(), name="backup-upload-chunk"),
    path("uploads/<uuid:pk>/restore/", BackupUploadRestoreEndpoint.as_view(), name="backup-upload-restore"),
]

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import FileAsset, Message

from .conftest import (
    EXE_HEADER,
    MP4_HEADER,
    WEBM_HEADER,
    attachment_url,
    attachments_url,
    client_for,
    message_url,
    send,
    thumbnail_url,
    upload,
)

MB = 1024 * 1024
WAVEFORM = [0.5] * 64


@pytest.mark.contract
@pytest.mark.django_db
class TestUploadRequest:
    def test_image_upload_flow(self, owner_client, workspace, group, storage):
        asset_id, key, confirm = upload(owner_client, storage, workspace.slug, group["id"], width=800, height=600)
        assert key.startswith(f"{workspace.id}/chat/{group['id']}/")
        assert confirm.status_code == 200
        assert confirm.data["kind"] == "image"
        assert confirm.data["is_uploaded"] is True
        assert confirm.data["width"] == 800

        asset = FileAsset.objects.get(id=asset_id)
        assert asset.entity_type == "CHAT_ATTACHMENT"
        assert str(asset.chat_conversation_id) == group["id"]
        assert asset.project_id is None

    def test_blocked_types(self, owner_client, workspace, group):
        url = attachments_url(workspace.slug, group["id"])
        for name, content_type in (
            ("run.exe", "application/octet-stream"),
            ("logo.svg", "image/svg+xml"),
            ("page.html", "text/html"),
            ("script.js", "text/javascript"),
        ):
            response = owner_client.post(url, {"name": name, "type": content_type, "size": 100}, format="json")
            assert response.status_code == 400, name
            assert response.data["code"] == "TYPE_NOT_ALLOWED"

    def test_size_limit_per_kind(self, owner_client, workspace, group):
        url = attachments_url(workspace.slug, group["id"])
        too_big_image = owner_client.post(url, {"name": "a.png", "type": "image/png", "size": 11 * MB}, format="json")
        assert too_big_image.status_code == 413
        assert too_big_image.data["limit_bytes"] == 10 * MB
        video_ok = owner_client.post(url, {"name": "a.mp4", "type": "video/mp4", "size": 150 * MB}, format="json")
        assert video_ok.status_code == 200

    def test_voice_note_rules(self, owner_client, workspace, group):
        url = attachments_url(workspace.slug, group["id"])
        long_note = owner_client.post(
            url,
            {"name": "v.webm", "type": "audio/webm;codecs=opus", "size": 1000, "is_voice": True, "duration": 301},
            format="json",
        )
        assert long_note.status_code == 400
        assert long_note.data["code"] == "DURATION_TOO_LONG"
        not_audio = owner_client.post(
            url, {"name": "v.png", "type": "image/png", "size": 10, "is_voice": True, "duration": 3}, format="json"
        )
        assert not_audio.data["code"] == "TYPE_NOT_ALLOWED"

    def test_non_member_cannot_request_upload(self, workspace, group, make_member):
        carol = client_for(make_member("carol", 15))
        response = carol.post(
            attachments_url(workspace.slug, group["id"]),
            {"name": "a.png", "type": "image/png", "size": 10},
            format="json",
        )
        assert response.status_code == 404


@pytest.mark.contract
@pytest.mark.django_db
class TestConfirm:
    def test_missing_object(self, owner_client, workspace, group):
        response = owner_client.post(
            attachments_url(workspace.slug, group["id"]),
            {"name": "a.png", "type": "image/png", "size": 10},
            format="json",
        )
        confirm = owner_client.patch(attachment_url(workspace.slug, response.data["asset_id"]), {}, format="json")
        assert confirm.status_code == 400
        assert confirm.data["code"] == "UPLOAD_MISSING"

    def test_real_size_over_limit_discards(
        self, owner_client, workspace, group, storage, deletion_task, django_capture_on_commit_callbacks
    ):
        response = owner_client.post(
            attachments_url(workspace.slug, group["id"]),
            {"name": "a.png", "type": "image/png", "size": 10},
            format="json",
        )
        key = response.data["upload_data"]["fields"]["key"]
        storage.objects[key] = 11 * MB
        with django_capture_on_commit_callbacks(execute=True):
            confirm = owner_client.patch(attachment_url(workspace.slug, response.data["asset_id"]), {}, format="json")
        assert confirm.status_code == 413
        assert not FileAsset.all_objects.filter(id=response.data["asset_id"]).exists()
        assert key in deletion_task.call_args.args[0]

    def test_disguised_executable_rejected(self, owner_client, workspace, group, storage):
        asset_id, key, confirm = upload(
            owner_client, storage, workspace.slug, group["id"], name="shot.png", sample=EXE_HEADER
        )
        assert confirm.status_code == 400
        assert confirm.data["code"] in ("TYPE_MISMATCH", "TYPE_NOT_ALLOWED")
        assert not FileAsset.all_objects.filter(id=asset_id).exists()

    def test_image_that_is_really_video_rejected(self, owner_client, workspace, group, storage):
        _, _, confirm = upload(owner_client, storage, workspace.slug, group["id"], sample=MP4_HEADER)
        assert confirm.status_code == 400
        assert confirm.data["code"] == "TYPE_MISMATCH"

    def test_voice_note_in_webm_container_accepted(self, owner_client, workspace, group, storage):
        _, _, confirm = upload(
            owner_client,
            storage,
            workspace.slug,
            group["id"],
            name="voice.webm",
            type="audio/webm",
            sample=WEBM_HEADER,
            is_voice=True,
            duration=12.5,
            waveform=WAVEFORM,
        )
        assert confirm.status_code == 200
        assert confirm.data["kind"] == "audio"
        assert confirm.data["duration"] == 12.5
        assert confirm.data["waveform"] == WAVEFORM

    def test_thumbnail_kept_only_when_uploaded(self, owner_client, workspace, group, storage):
        response = owner_client.post(
            attachments_url(workspace.slug, group["id"]),
            {"name": "a.png", "type": "image/png", "size": 1000},
            format="json",
        )
        asset_id = response.data["asset_id"]
        key = response.data["upload_data"]["fields"]["key"]
        thumb = owner_client.post(
            thumbnail_url(workspace.slug, group["id"], asset_id), {"type": "image/webp", "size": 500}, format="json"
        )
        assert thumb.status_code == 200
        thumb_key = thumb.data["upload_data"]["fields"]["key"]
        storage.objects[key] = 1000
        storage.objects[thumb_key] = 500
        confirm = owner_client.patch(attachment_url(workspace.slug, asset_id), {}, format="json")
        assert confirm.data["thumb_url"].endswith("?thumb=1")

    def test_confirm_reads_storage_through_internal_endpoint(self, owner_client, workspace, group, storage):
        """Confirm reads the file server-side, so it must not use the browser-facing (request-host) endpoint."""
        from plane.app.views.chat import attachment as attachment_views

        response = owner_client.post(
            attachments_url(workspace.slug, group["id"]),
            {"name": "a.png", "type": "image/png", "size": 1000},
            format="json",
        )
        storage.objects[response.data["upload_data"]["fields"]["key"]] = 1000
        attachment_views.S3Storage.reset_mock()
        confirm = owner_client.patch(attachment_url(workspace.slug, response.data["asset_id"]), {}, format="json")
        assert confirm.status_code == 200
        assert attachment_views.S3Storage.call_args_list
        for call in attachment_views.S3Storage.call_args_list:
            assert call.kwargs.get("request") is None and not call.args

    def test_only_uploader_can_confirm_or_cancel(self, owner_client, alice_client, workspace, group, storage):
        response = owner_client.post(
            attachments_url(workspace.slug, group["id"]),
            {"name": "a.png", "type": "image/png", "size": 10},
            format="json",
        )
        asset_id = response.data["asset_id"]
        assert alice_client.patch(attachment_url(workspace.slug, asset_id), {}, format="json").status_code == 404
        assert alice_client.delete(attachment_url(workspace.slug, asset_id)).status_code == 404
        assert owner_client.delete(attachment_url(workspace.slug, asset_id)).status_code == 204


@pytest.mark.contract
@pytest.mark.django_db
class TestSendWithAttachments:
    def test_send_with_attachment(self, owner_client, alice_client, workspace, group, storage):
        asset_id, _, _ = upload(owner_client, storage, workspace.slug, group["id"])
        response = send(owner_client, workspace.slug, group["id"], "look", attachment_ids=[asset_id])
        assert response.status_code == 201
        assert response.data["kind"] == "attachment"
        assert response.data["attachments"][0]["id"] == asset_id

        page = alice_client.get(f"/api/workspaces/{workspace.slug}/chat/conversations/{group['id']}/messages/")
        assert page.data["results"][-1]["attachments"][0]["kind"] == "image"

    def test_attachment_only_message_allowed(self, owner_client, workspace, group, storage):
        asset_id, _, _ = upload(owner_client, storage, workspace.slug, group["id"])
        response = owner_client.post(
            f"/api/workspaces/{workspace.slug}/chat/conversations/{group['id']}/messages/",
            {"body_html": "", "attachment_ids": [asset_id]},
            format="json",
        )
        assert response.status_code == 201

    def test_voice_message_kind(self, owner_client, workspace, group, storage):
        asset_id, _, _ = upload(
            owner_client, storage, workspace.slug, group["id"], name="v.webm", type="audio/webm",
            sample=WEBM_HEADER, is_voice=True, duration=4, waveform=WAVEFORM,
        )  # fmt: skip
        response = owner_client.post(
            f"/api/workspaces/{workspace.slug}/chat/conversations/{group['id']}/messages/",
            {"body_html": "", "attachment_ids": [asset_id]},
            format="json",
        )
        assert response.data["kind"] == "voice"

    def test_cannot_attach_someone_elses_or_unconfirmed_or_other_conversation(
        self, owner_client, alice_client, workspace, group, direct, storage
    ):
        alices, _, _ = upload(alice_client, storage, workspace.slug, group["id"])
        unconfirmed = owner_client.post(
            attachments_url(workspace.slug, group["id"]),
            {"name": "a.png", "type": "image/png", "size": 10},
            format="json",
        ).data["asset_id"]
        other_conversation, _, _ = upload(owner_client, storage, workspace.slug, direct["id"])
        for asset_id in (alices, unconfirmed, other_conversation):
            response = send(owner_client, workspace.slug, group["id"], "x", attachment_ids=[asset_id])
            assert response.status_code == 400
            assert response.data["code"] == "INVALID_ATTACHMENT"

    def test_attachment_cannot_be_sent_twice(self, owner_client, workspace, group, storage):
        asset_id, _, _ = upload(owner_client, storage, workspace.slug, group["id"])
        assert send(owner_client, workspace.slug, group["id"], "one", attachment_ids=[asset_id]).status_code == 201
        again = send(owner_client, workspace.slug, group["id"], "two", attachment_ids=[asset_id])
        assert again.data["code"] == "INVALID_ATTACHMENT"

    def test_too_many_files(self, owner_client, workspace, group, storage, chat_enabled, mocker):
        from dataclasses import replace

        mocker.patch(
            "plane.app.views.chat.message.get_chat_config", return_value=replace(chat_enabled, max_files_per_message=1)
        )
        first, _, _ = upload(owner_client, storage, workspace.slug, group["id"])
        second, _, _ = upload(owner_client, storage, workspace.slug, group["id"])
        response = send(owner_client, workspace.slug, group["id"], "x", attachment_ids=[first, second])
        assert response.status_code == 400
        assert response.data["code"] == "TOO_MANY_FILES"

    def test_delete_message_removes_files(
        self, owner_client, workspace, group, storage, deletion_task, django_capture_on_commit_callbacks
    ):
        asset_id, key, _ = upload(owner_client, storage, workspace.slug, group["id"])
        message = send(owner_client, workspace.slug, group["id"], "bye", attachment_ids=[asset_id])
        with django_capture_on_commit_callbacks(execute=True):
            owner_client.delete(message_url(workspace.slug, message.data["id"]))
        assert not Message.objects.filter(id=message.data["id"]).exists()
        assert not FileAsset.all_objects.filter(id=asset_id).exists()
        assert key in deletion_task.call_args.args[0]


@pytest.mark.contract
@pytest.mark.django_db
class TestDownload:
    def test_member_gets_redirect_with_disposition(self, owner_client, alice_client, workspace, group, storage):
        asset_id, key, _ = upload(owner_client, storage, workspace.slug, group["id"])
        send(owner_client, workspace.slug, group["id"], "pic", attachment_ids=[asset_id])
        response = alice_client.get(attachment_url(workspace.slug, asset_id))
        assert response.status_code == 302
        assert response["Location"].endswith(key)
        assert storage.generate_presigned_url.call_args.kwargs["disposition"] == "inline"

    def test_plain_files_download_as_attachment(self, owner_client, workspace, group, storage):
        asset_id, _, confirm = upload(
            owner_client, storage, workspace.slug, group["id"], name="notes.pdf", type="application/pdf",
            sample=b"%PDF-1.7\n" + b"\x00" * 64,
        )  # fmt: skip
        assert confirm.status_code == 200
        send(owner_client, workspace.slug, group["id"], "doc", attachment_ids=[asset_id])
        owner_client.get(attachment_url(workspace.slug, asset_id))
        assert storage.generate_presigned_url.call_args.kwargs["disposition"] == "attachment"

    def test_non_member_cannot_download(self, owner_client, workspace, group, storage, make_member):
        asset_id, _, _ = upload(owner_client, storage, workspace.slug, group["id"])
        send(owner_client, workspace.slug, group["id"], "pic", attachment_ids=[asset_id])
        carol = client_for(make_member("carol", 15))
        assert carol.get(attachment_url(workspace.slug, asset_id)).status_code == 404

    def test_unsent_upload_visible_only_to_uploader(self, owner_client, alice_client, workspace, group, storage):
        asset_id, _, _ = upload(owner_client, storage, workspace.slug, group["id"])
        assert owner_client.get(attachment_url(workspace.slug, asset_id)).status_code == 302
        assert alice_client.get(attachment_url(workspace.slug, asset_id)).status_code == 404


@pytest.mark.contract
@pytest.mark.django_db
class TestGenericAssetEndpointsRefuseChatFiles:
    """docs/chat/07-security.md S1: chat files must not leak through the generic asset routes."""

    @pytest.fixture
    def chat_asset(self, owner_client, workspace, group, storage):
        asset_id, _, _ = upload(owner_client, storage, workspace.slug, group["id"])
        send(owner_client, workspace.slug, group["id"], "secret", attachment_ids=[asset_id])
        return asset_id

    def test_workspace_asset_get_404(self, workspace, chat_asset, make_member):
        carol = client_for(make_member("carol", 15))
        response = carol.get(f"/api/assets/v2/workspaces/{workspace.slug}/{chat_asset}/")
        assert response.status_code == 404

    def test_workspace_download_404(self, workspace, chat_asset, make_member, owner, mocker):
        carol = client_for(make_member("carol", 15))
        mocker.patch("plane.app.views.asset.v2.S3Storage.generate_presigned_url", return_value="https://storage.test/x")
        # Control: an ordinary workspace file is served by this same route...
        logo = FileAsset.objects.create(
            attributes={"name": "logo.png", "type": "image/png"},
            asset=f"{workspace.id}/logo.png",
            workspace=workspace,
            entity_type="WORKSPACE_LOGO",
            is_uploaded=True,
            created_by=owner,
        )
        assert carol.get(f"/api/assets/v2/workspaces/{workspace.slug}/download/{logo.id}/").status_code == 302
        # ...but a chat file is not.
        response = carol.get(f"/api/assets/v2/workspaces/{workspace.slug}/download/{chat_asset}/")
        assert response.status_code == 404

    def test_static_endpoint_refuses(self, api_client, chat_asset):
        response = api_client.get(f"/api/assets/v2/static/{chat_asset}/")
        assert response.status_code == 400

    def test_duplicate_refuses_chat_source(self, workspace, chat_asset, make_member):
        carol = client_for(make_member("carol", 15))
        response = carol.post(
            f"/api/assets/v2/workspaces/{workspace.slug}/duplicate-assets/{chat_asset}/",
            {"entity_type": "ISSUE_DESCRIPTION", "entity_id": None},
            format="json",
        )
        assert response.status_code == 404
        assert not FileAsset.objects.filter(entity_type="ISSUE_DESCRIPTION").exists()

    def test_duplicate_refuses_chat_destination(self, owner, workspace, make_member):
        carol = client_for(make_member("carol", 15))
        source = FileAsset.objects.create(
            attributes={"name": "a.png"}, asset=f"{workspace.id}/a.png", workspace=workspace,
            entity_type="ISSUE_DESCRIPTION", is_uploaded=True, created_by=owner,
        )  # fmt: skip
        response = carol.post(
            f"/api/assets/v2/workspaces/{workspace.slug}/duplicate-assets/{source.id}/",
            {"entity_type": "CHAT_ATTACHMENT"},
            format="json",
        )
        assert response.status_code == 400

    def test_generic_create_refuses_chat_entity_type(self, owner_client, workspace):
        response = owner_client.post(
            f"/api/assets/v2/workspaces/{workspace.slug}/",
            {"name": "a.png", "type": "image/png", "size": 10, "entity_type": "CHAT_ATTACHMENT"},
            format="json",
        )
        assert response.status_code == 400

    def test_asset_check_reports_missing(self, workspace, chat_asset, make_member):
        carol = client_for(make_member("carol", 15))
        response = carol.get(f"/api/assets/v2/workspaces/{workspace.slug}/check/{chat_asset}/")
        assert response.status_code == 200
        assert response.data["exists"] is False

    def test_issue_attachment_serializer_cannot_set_chat_links(self, group):
        from plane.app.serializers.issue import IssueAttachmentSerializer

        serializer = IssueAttachmentSerializer()
        assert serializer.fields["chat_message"].read_only
        assert serializer.fields["chat_conversation"].read_only

    def test_legacy_serializer_refuses_chat_entity_type(self):
        from plane.app.serializers.asset import FileAssetSerializer

        serializer = FileAssetSerializer(data={"asset": "x", "entity_type": "CHAT_ATTACHMENT", "attributes": {}})
        assert not serializer.is_valid()
        assert "entity_type" in serializer.errors

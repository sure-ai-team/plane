# 04 — Attachments and media

## Kinds and allow-lists

| `kind`  | MIME allow-list                                                   | Extensions            | Default limit (config key)                              |
| ------- | ----------------------------------------------------------------- | --------------------- | ------------------------------------------------------- |
| `image` | `image/png`, `image/jpeg`, `image/webp`, `image/gif`              | png jpg jpeg webp gif | 10 MB (`CHAT_MAX_IMAGE_MB`)                             |
| `video` | `video/mp4`, `video/webm`, `video/quicktime`                      | mp4 webm mov          | 200 MB (`CHAT_MAX_VIDEO_MB`)                            |
| `audio` | `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`, `audio/wav` | webm ogg m4a mp3 wav  | 25 MB (`CHAT_MAX_AUDIO_MB`), ≤ `CHAT_MAX_VOICE_SECONDS` |
| `file`  | everything else **except** the blocklist                          | —                     | 50 MB (`CHAT_MAX_FILE_MB`)                              |

Blocklist (always rejected regardless of kind): `.exe .msi .bat .cmd .com .scr .ps1 .sh .js .jar .vbs .dll .apk .svg`, and any MIME starting `application/x-msdownload`, `application/x-sh`, `text/html`, `image/svg+xml`. (SVG and HTML are rejected because they execute scripts when opened inline.)

`kind` is **server-derived** from the declared MIME at upload-request time; the client's `kind` is a hint only. Per message: ≤ `CHAT_MAX_FILES_PER_MESSAGE` (default 10).

## Storage keys

```
<workspace_id>/chat/<conversation_id>/<asset_uuid>-<slug(name)>
<workspace_id>/chat/<conversation_id>/<asset_uuid>-thumb.webp
```

Generated server-side via the existing `get_upload_path` pattern; the client never chooses keys.

## `FileAsset.attributes` for `CHAT_ATTACHMENT`

```jsonc
{
  "name": "crash-repro.mp4", "type": "video/mp4", "size": 38123456, "kind": "video",
  "width": 1080, "height": 1920,          // image/video
  "duration": 78.4,                       // audio/video
  "thumb_key": "…/…-thumb.webp",          // image/video once uploaded
  "waveform": [0.12, 0.44, …]             // audio: exactly 64 floats in [0,1]
}
```

## Upload flow (client → `upload.store.ts`)

```
1. POST   conversations/<id>/attachments/            → asset_id + presigned POST
2. (image/video) POST …/attachments/<id>/thumbnail/  → presigned POST for thumb
3. XHR multipart POST to storage (progress events)    → cancelable via AbortController
4. PATCH  attachments/<id>/                           → server verifies, marks uploaded
5. POST   conversations/<id>/messages/ { attachment_ids }
```

- Reuse `core/services/file-upload.service.ts` for step 3 (it already does presigned POST with progress).
- Steps 1–4 run per file, max 3 in parallel. Send is enabled only when every queued file is `ready`; failed files must be removed or retried first.
- Cancel at any step: `DELETE attachments/<id>/` (ignore 404).
- Paste (`image/*` in clipboard) and drop (`react-dropzone` on the thread + composer) both feed the same queue.
- Before step 1 the client validates size against limits fetched from `GET /api/instances/` config (fail fast, no round trip), but the server is authoritative.

### Browser-side processing (`core/components/chat/composer/media/`)

| File              | Does                                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image-thumb.ts`  | `createImageBitmap` → canvas, longest side 400 px, `toBlob("image/webp", 0.8)`; also reads natural `width/height`. GIF: thumb = first frame, original kept animated                                                         |
| `video-poster.ts` | `<video preload="metadata">`, seek to `min(1s, duration/2)`, draw to canvas → webp; reads `duration`, `videoWidth/Height`. HEVC `.mov` that Chrome can't decode → no poster, `kind` stays video, thread shows the file card |
| `waveform.ts`     | From a `Blob`: `AudioContext.decodeAudioData` → 64 buckets of RMS, normalised to the max → `number[64]`                                                                                                                     |

## Voice notes (`VoiceRecorder`)

- `wavesurfer.js` v7 + `@wavesurfer/record` plugin wraps `MediaRecorder`.
- Preferred MIME in order: `audio/webm;codecs=opus`, `audio/mp4` (Safari), `audio/ogg;codecs=opus`. Pick the first `MediaRecorder.isTypeSupported`. Extension follows the MIME.
- Hard stop at `CHAT_MAX_VOICE_SECONDS` (300). UI shows `up to 5:00`.
- States: idle → recording → review → sending. Discard at any point revokes the blob URL.
- Mic permission denied → toast `chat.voice.permission_denied`, button stays enabled for retry.
- After stop: compute waveform, then upload like any audio file with `duration` and `waveform`.

## Playback

- **Images:** `<img src=thumb_url loading="lazy">` in the grid; lightbox loads `url`.
- **Video:** `<video preload="none" poster=thumb_url controls>` with `src=url`. Lightbox video plugin for full-screen.
- **Audio:** `VoiceNotePlayer` renders `wavesurfer` with `peaks: [waveform]` and `duration` so nothing downloads until play; on play it sets `url`. Speeds 1 / 1.5 / 2 via `setPlaybackRate`. Only one voice note plays at a time (store-level `playingId`).
- Presigned GET links expire in 5 minutes; media elements that error with 403 re-request the URL once.
- Range requests: MinIO/S3 honour `Range`. Caddy `reverse_proxy` passes them through by default — verify in PR 8 with `curl -r 0-1023`.

## Server verification on `PATCH attachments/<id>/`

```python
head = storage.head_object(key)                     # real size
if head.size > limit_for(kind): delete; 413
sample = storage.get_object_range(key, 0, 8191)
guess = filetype.guess(sample)                      # None for plain text/zip variants → allow only if kind == "file"
if guess and guess.mime.split("/")[0] != kind_family(kind): delete; 400 TYPE_MISMATCH
if guess and guess.extension in BLOCKLIST_EXT: delete; 400 TYPE_NOT_ALLOWED
asset.is_uploaded = True; asset.attributes["size"] = head.size
```

`filetype` is added to `requirements/base.txt`.

## Deletion

- `DELETE messages/<id>/` and `DELETE conversations/<id>/`: collect `asset.name` + `attributes.thumb_key` for all affected assets **before** the DB delete, hard-delete rows, then `delete_chat_objects.delay(keys)`.
- `bgtasks/chat_cleanup_task.py`:
  - `delete_chat_objects(keys)`: `delete_objects` in batches of 1000; log failures; retry 3× with backoff.
  - `purge_orphan_chat_uploads()` (Celery Beat, daily 03:00): assets with `entity_type=CHAT_ATTACHMENT`, `chat_message IS NULL`, `created_at < now-24h` → delete objects + rows.
- Register the beat schedule in `settings/common.py` `CELERY_BEAT_SCHEDULE`.

## Error copy (see 10-i18n-keys.md)

| Code                | Key                                    |
| ------------------- | -------------------------------------- |
| `FILE_TOO_LARGE`    | `chat.upload.too_large` with `{limit}` |
| `TYPE_NOT_ALLOWED`  | `chat.upload.type_not_allowed`         |
| `TYPE_MISMATCH`     | `chat.upload.type_mismatch`            |
| `TOO_MANY_FILES`    | `chat.upload.too_many` with `{max}`    |
| `DURATION_TOO_LONG` | `chat.voice.too_long` with `{max}`     |
| network             | `chat.upload.failed` + retry           |

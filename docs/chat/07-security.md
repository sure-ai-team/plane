# 07 — Security

## Threats and controls

| #   | Threat                                                    | Control                                                                                                                                                                                                                  | Where   |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| S1  | Non-member reads a private chat's file                    | Chat files served **only** via `GET chat/attachments/<id>/` after membership check. `WorkspaceFileAssetEndpoint.get` and `StaticFileAssetEndpoint` must return 404 for `CHAT_ATTACHMENT`. Presigned GET expires in 5 min | PR 1    |
| S2  | Guest or non-member uses chat                             | `allow_permission([ADMIN, MEMBER], "WORKSPACE")` + `get_membership_or_403` on every view; live server verifies workspace membership on connect                                                                           | PR 1, 3 |
| S3  | Removed/deactivated workspace member keeps access         | Every conversation query joins `WorkspaceMember(is_active=True)`; `deactivate_chat_memberships` task on removal; live server re-checks membership every 10 min per socket and on `member.removed`                        | PR 1, 3 |
| S4  | Stored XSS via message body                               | `body_html` passes through the same sanitizer as issue comments; `body_stripped` is rendered as text; previews never use HTML                                                                                            | PR 1, 5 |
| S5  | Malicious upload (exe renamed png, SVG/HTML with scripts) | Server-derived `kind` from declared MIME; blocklist; `filetype` sniff on confirm; SVG and HTML rejected; non-media served `Content-Disposition: attachment`                                                              | PR 1    |
| S6  | Oversize upload bypassing the presigned limit             | Presigned POST includes size condition; `head_object` on confirm; orphan purge                                                                                                                                           | PR 1    |
| S7  | Attaching someone else's or another conversation's asset  | Send validates `created_by == me` and `chat_conversation_id == id` and `chat_message IS NULL`                                                                                                                            | PR 1    |
| S8  | Spam / abuse                                              | Throttles `chat_send`, `chat_upload`, `chat_read`; typing dropped above 1/s on the live server                                                                                                                           | PR 1, 3 |
| S9  | Socket hijack from another origin                         | `Origin` must be in `CORS_ALLOWED_ORIGINS`; cookie auth with existing `SameSite` settings                                                                                                                                | PR 3    |
| S10 | Live server calls the API with elevated rights            | Only `member-ids/` accepts `X-Live-Secret`; it returns ids only, never content                                                                                                                                           | PR 1, 3 |
| S11 | Mention spam to non-members                               | Mentions resolved only against active conversation members                                                                                                                                                               | PR 1    |
| S12 | Information leak via `direct_key` or ids                  | `direct_key` never serialised; all ids are UUIDv4                                                                                                                                                                        | PR 1    |
| S13 | Deleted content lingering in storage                      | Deletion task + nightly purge + logging; verified in tests                                                                                                                                                               | PR 1, 8 |
| S14 | Enumeration of conversations                              | Every conversation-scoped route 404s (not 403) for conversations the user isn't in                                                                                                                                       | PR 1    |
| S15 | Redis channel injection                                   | Channel names built from validated UUIDs only; subscriber connection is read-only                                                                                                                                        | PR 3    |
| S16 | Presigned POST key tampering                              | Keys generated server-side; policy pins the exact key                                                                                                                                                                    | PR 1    |

## Per-PR checklist

Every PR touching chat must tick, in its description:

- [ ] No new endpoint without `allow_permission` + membership check (or `X-Live-Secret` for live-only).
- [ ] No HTML rendered from untrusted input without the sanitizer.
- [ ] No new file-serving path other than `chat/attachments/<id>/`.
- [ ] Tests added for the negative cases (non-member, guest, removed member, wrong conversation).
- [ ] `pnpm check` and `pytest` pass.

## Release gate (PR 8)

- Manual: log in as a guest → rail item absent, direct API call → 403, socket → 4403.
- Manual: member A uploads in conv X; member B (not in X) requests the asset URL → 404; B requests via `/api/assets/v2/workspaces/<slug>/<id>/` → 404.
- Manual: delete a message with attachments → objects gone from MinIO within 1 min.
- Dependency audit: `pnpm audit --prod` and `pip-audit` clean for new packages.

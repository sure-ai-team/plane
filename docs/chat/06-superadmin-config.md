# 06 — Superadmin configuration

Chat settings live in `InstanceConfiguration` (`plane/license/models`), seeded by `license/management/commands/configure_instance.py`, exposed through the existing instance-config API and edited on a new page in `apps/admin`.

## Keys

| Key                          | Type           | Default | Category | Used by                                                     |
| ---------------------------- | -------------- | ------- | -------- | ----------------------------------------------------------- |
| `CHAT_ENABLED`               | bool ("1"/"0") | `1`     | `CHAT`   | API gate (404), web rail item, live server (refuse connect) |
| `CHAT_MAX_IMAGE_MB`          | int            | `10`    | `CHAT`   | upload request + verify                                     |
| `CHAT_MAX_VIDEO_MB`          | int            | `200`   | `CHAT`   | upload request + verify                                     |
| `CHAT_MAX_AUDIO_MB`          | int            | `25`    | `CHAT`   | upload request + verify                                     |
| `CHAT_MAX_FILE_MB`           | int            | `50`    | `CHAT`   | upload request + verify                                     |
| `CHAT_MAX_FILES_PER_MESSAGE` | int            | `10`    | `CHAT`   | send                                                        |
| `CHAT_MAX_VOICE_SECONDS`     | int            | `300`   | `CHAT`   | upload request (audio `duration`), recorder hard stop       |

None are secrets (`is_encrypted = False`). Hard caps enforced server-side regardless of config: 50 files, 2 GB, 1 hour (prevents a typo from disabling limits).

## Backend

- Seed in `configure_instance.py` with `category: "CHAT"`.
- Helper `plane/utils/chat_config.py`: `get_chat_config() -> ChatConfig` dataclass, cached 60 s via Django cache (`django-redis`), invalidated on instance-config save (signal in `license/`).
- `ChatEnabledMixin` on chat views: `if not get_chat_config().enabled: return 404`.
- Expose non-secret chat keys in the public instance payload consumed by the web app (`/api/instances/` → `config.chat`) so the client can validate sizes before uploading.

## Admin page (`apps/admin`)

- Route: `/superadmin/chat/`; sidebar entry **Chat** after Users.
- Form: toggle **Enable chat**; number inputs for the five limits (MB) and voice seconds; Save button; toast on success.
- Validation: integers ≥ 1, within the hard caps above.
- Copy is English, like every other Superadmin page (the admin app has no i18n). Files: `apps/admin/app/(all)/(dashboard)/chat/{page,form}.tsx`; sidebar item in `hooks/use-sidebar-menu`; header label in `components/common/header/core.ts`.
- Saving goes through the existing `PATCH /api/instances/configurations/`, which now rejects out-of-range `CHAT_*` values (400 with `fields`) and clears the chat config cache, so changes apply immediately.

## Behaviour when disabled

- Web: rail item hidden; `/chat` routes redirect to `/:workspaceSlug/`.
- API: all `workspaces/<slug>/chat/*` → `404 {"error": "Chat is disabled", "code": "CHAT_DISABLED"}`.
- Live: `/live/chat/` closes with `4404` after auth.
- Data is retained; re-enabling restores everything.

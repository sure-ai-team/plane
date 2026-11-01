# SGT Project Management Platform

Self-hosted project and work tracking for Sure Global Tech teams. It runs entirely on our own infrastructure and needs
no outside services: no telemetry, no billing, and no email server.

It is built on the open-source [Plane](https://github.com/makeplane/plane) project (v1.4.2), rebranded and extended with
features we need in-house.

- [Features](#features)
- [Architecture](#architecture)
- [Run it locally](#run-it-locally)
- [First-time setup](#first-time-setup)
- [Managing users](#managing-users)
- [Importing from Jira](#importing-from-jira)
- [Deploying to a server](#deploying-to-a-server)
- [Operations](#operations)
- [Development](#development)
- [Branding](#branding)
- [Repository layout](#repository-layout)
- [License](#license)

## Features

**Project work**

- Work items with states, priorities, labels, estimates, assignees, sub-items and relations
- Cycles (sprints) and modules, with list, board, calendar, spreadsheet and timeline layouts
- Pages for documents, with realtime collaborative editing
- Public project pages for sharing a read-only view

**Added in this platform**

| Feature              | Where                             | What it does                                                                                                    |
| -------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Workspace dashboards | Workspace sidebar > Dashboards    | Grids of number, bar, line, area, pie, donut and table widgets. Private or shared with the workspace.           |
| Custom reports       | Workspace sidebar > Reports       | Report builder with grouping, splits, measures, date ranges and filters. Saves, permalinks and CSV/XLSX export. |
| Cycle reports        | Cycle quick actions > View report | Summary, burndown, breakdowns by assignee, label, state and priority, scope changes and carried-over items.     |
| Jira CSV import      | Workspace settings > Imports      | Imports a Jira CSV export into a project. See [Importing from Jira](#importing-from-jira).                      |
| User management      | Admin console > Users             | Creates accounts one at a time or from a spreadsheet, without email. See [Managing users](#managing-users).     |

Every report and dashboard only shows work items from projects the viewer is a member of.

## Architecture

All services run with Docker Compose. The stack's project name is `sgtpm`, so containers are named `sgtpm-<service>`.

| Service                 | Role                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `proxy`                 | Caddy reverse proxy. The only service with published ports (80/443). Routes to everything below. |
| `web`                   | Main web app (`/`)                                                                               |
| `admin`                 | Instance admin console (`/god-mode`)                                                             |
| `space`                 | Public project pages (`/spaces`)                                                                 |
| `live`                  | Realtime collaboration server for pages (`/live`)                                                |
| `api`                   | Django REST API (`/api`)                                                                         |
| `worker`, `beat-worker` | Celery workers for background jobs (imports, exports, notifications) and scheduled tasks         |
| `migrator`              | Applies database migrations on startup, then exits                                               |
| `db`                    | PostgreSQL 15                                                                                    |
| `redis`                 | Valkey cache                                                                                     |
| `mq`                    | RabbitMQ message broker for Celery                                                               |
| `minio`                 | S3-compatible storage for attachments and avatars                                                |

`docker-compose.override.yml` holds local adjustments that Compose applies automatically. It uses the Chainguard MinIO
image, because MinIO no longer publishes community images on Docker Hub.

## Run it locally

You need Docker with Compose v2.

1. Create the env files from the examples and add secrets.

   ```bash
   cp .env.example .env
   cp apps/api/.env.example apps/api/.env
   cp apps/live/.env.example apps/live/.env
   echo "SECRET_KEY=\"$(tr -dc 'a-z0-9' < /dev/urandom | head -c50)\"" >> apps/api/.env
   ```

   In `apps/api/.env`, for a single-host setup behind the bundled proxy, set:
   - `USE_MINIO=1` and `AWS_S3_ENDPOINT_URL="http://minio:9000"`
   - `CORS_ALLOWED_ORIGINS="http://localhost"`
   - `http://localhost` for `WEB_URL` and every `*_BASE_URL`
   - `LIVE_SERVER_SECRET_KEY` to a new random value

   In `apps/live/.env`, use the same secret:

   ```bash
   PORT=3000
   API_BASE_URL="http://api:8000"
   WEB_BASE_URL="http://localhost"
   LIVE_BASE_URL="http://localhost"
   LIVE_BASE_PATH="/live"
   LIVE_SERVER_SECRET_KEY="<same value as in apps/api/.env>"
   REDIS_URL="redis://redis:6379/"
   ```

2. Build and start the stack. The first build takes 10 to 20 minutes.

   ```bash
   docker compose build
   docker compose up -d
   ```

3. Open http://localhost. The admin console is at http://localhost/god-mode.

To load demo users, a workspace, projects and work items into a fresh instance:

```bash
docker compose exec -T api python manage.py shell < deployments/demo/seed_demo_data.py
```

## First-time setup

1. Open `/god-mode` and create the **instance admin** account. The first sign-up on a new instance becomes the admin.
2. Under **Authentication**, choose how people sign in:
   - Keep **password login** on. The platform runs without email, so turn **unique-code (magic link) login** off.
   - Turn **sign-up** off if accounts should only be created by an admin from the **Users** page. With sign-up off,
     people can still sign up if they have a pending workspace invitation.
   - Optionally enable sign-in with Google, GitHub, GitLab or Gitea. Accounts are then created on first sign-in.
3. Under **Workspaces**, create the first workspace, or let users create their own.
4. Under **Users**, add your team. See below.

Email is optional. If you configure SMTP under **Email**, the platform also sends invitations and notifications by
email; without it, everything still works through the in-app inbox.

## Managing users

### Admin console

Open **Users** in the admin console (`/god-mode/users`). New accounts get a generated 16-character temporary password,
which the admin sends to the user, for example on WhatsApp. No email is sent.

- **Add a user:** enter the email (required), name, phone, workspace and workspace role, then click **Add user**.
- **Import from file:** download the Excel template, fill in one row per user (up to 1,000), upload it and click
  **Check file**. Nothing is saved until you review the rows and click **Create accounts**.

For each new account the page shows the temporary password, a **Copy message** button that copies a ready-to-send
sign-in message, and a **Download list (.csv)** button. **Passwords are not stored anywhere**, so copy or download them
before leaving the page. Users can change their password from their profile settings after signing in.

Rules that apply to both methods:

- If an email already has an account, its password is left unchanged. The user is only added to the chosen workspace
  and projects, so running the same file twice is safe.
- Phone numbers need a country code, for example `+966551234567`. `00966…` and `966…` are also accepted.
- Users added to a workspace skip onboarding and land in that workspace on their first sign-in.
- A row with a problem (invalid email, unknown workspace or project, phone without country code) is reported and
  skipped; the other rows are still created.

Template columns:

| Column                    | Meaning                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `email`                   | Required. The address the user signs in with.                                                    |
| `first_name`, `last_name` | Optional.                                                                                        |
| `phone`                   | Optional. International format with country code.                                                |
| `workspace`               | Optional. Workspace slug. Empty uses the default chosen on upload.                               |
| `role`                    | Optional. Workspace role: `admin`, `member` or `guest`. Empty uses the default chosen on upload. |
| `projects`                | Optional. Project identifiers separated by `;`, for example `WEB;API`. Needs a workspace.        |
| `project_role`            | Optional. Role in those projects. Defaults to the workspace role.                                |

### Command line

The same import runs as a management command. It reads `.xlsx` or `.csv` files and also accepts `display_name` and
`password` columns.

```bash
# Print an example CSV
docker compose exec -T api python manage.py bulk_create_users --template > users.csv
# Check the file without saving anything
docker compose exec -T api python manage.py bulk_create_users - --dry-run < users.csv
# Create the accounts and save the temporary passwords
docker compose exec -T api python manage.py bulk_create_users - --output - < users.csv > credentials.csv
```

Delete `credentials.csv` once everyone has their password. The command exits with an error code if any row failed.

### Other account tasks

| Task                                    | Command                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| Reset a user's password                 | `docker compose exec api python manage.py reset_password user@example.com`        |
| Reactivate a deactivated user           | `docker compose exec api python manage.py activate_user user@example.com`         |
| Make an existing user an instance admin | `docker compose exec api python manage.py create_instance_admin user@example.com` |

## Importing from Jira

Workspace admins and project admins can import a Jira **Export CSV (all fields)** file from
**Workspace settings > Imports**. A wizard analyses the file, then asks for the target project and how to map statuses,
priorities and people before a background job writes the work items.

- Jira keys are kept when importing into a new or empty project; otherwise items are renumbered.
- Sprints become cycles and epics become modules.
- Comments, watchers, labels, story points, parents, issue links and attachment links are carried over.
- Imports send no notifications, can be re-run without creating duplicates, and can be undone.

## Deploying to a server

A single Linux server with Docker runs the whole stack.

| Size        | Example                                                     | Use                             |
| ----------- | ----------------------------------------------------------- | ------------------------------- |
| Minimum     | 2 vCPU, 4 GB RAM (AWS `t3.medium`, or `t4g.medium` for ARM) | A small team                    |
| Recommended | 2 vCPU, 8 GB RAM (AWS `t3.large`)                           | 50 or more users, large imports |

Plan for about 30 GB of disk for images, the database and uploads.

- **Build the images somewhere else.** Building the frontends needs 6 to 8 GB of RAM, more than a 4 GB server has.
  Build on a workstation or in CI, push the images to a registry, and only pull and run them on the server. On an ARM
  server, build for `linux/arm64`.
- **Add 2 to 4 GB of swap** on small servers.
- **HTTPS:** in the root `.env`, set `SITE_ADDRESS` to your domain and `CERT_EMAIL` to an address for Let's Encrypt.
  Caddy then obtains and renews the certificate. Set `WEB_URL`, `CORS_ALLOWED_ORIGINS` and every `*_BASE_URL` in the
  app env files to `https://<your domain>`.
- Only ports 80 and 443 need to be open.

## Operations

```bash
docker compose ps                     # Service status
docker compose logs -f api worker     # Follow logs
docker compose restart api            # Restart one service
```

**Update to new code:**

```bash
git pull
docker compose build
docker compose up -d                  # The migrator applies new migrations on startup
```

**Back up** the database and uploaded files:

```bash
docker exec sgtpm-db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > sgtpm-db.dump
docker run --rm -v sgtpm_uploads:/data:ro -v "$PWD:/backup" alpine tar czf /backup/sgtpm-uploads.tgz -C /data .
```

**Restore** into a running stack (this replaces all current data):

```bash
docker exec -i sgtpm-db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < sgtpm-db.dump
docker run --rm -v sgtpm_uploads:/data -v "$PWD:/backup" alpine tar xzf /backup/sgtpm-uploads.tgz -C /data
```

**Reset to an empty instance.** This permanently deletes all workspaces, users, work items and uploads:

```bash
docker compose down -v --remove-orphans
docker compose build --no-cache
docker compose up -d
```

## Development

The repository is a pnpm and Turborepo monorepo. It needs Node.js 22.18 or later; pnpm is pinned in `package.json`
and can be run through `corepack pnpm`.

```bash
pnpm install
pnpm dev               # Web on :3000, admin on :3001
pnpm check             # Format, lint and type checks
pnpm fix               # Auto-fix formatting and lint issues
pnpm turbo run <task> --filter=<package>
```

Frontend code is linted with OxLint and formatted with oxfmt (see [docs/linting.md](docs/linting.md)). Backend code
uses Ruff, configured in `apps/api/pyproject.toml`.

**Backend tests** run in an isolated Docker stack defined in `docker-compose-test.yml`:

```bash
./setup.sh             # Once: creates apps/api/.env from the example
docker compose -f docker-compose-test.yml up --build --abort-on-container-exit --exit-code-from api-tests
docker compose -f docker-compose-test.yml down -v
```

The test stack still uses the `minio/minio` image, which Docker Hub no longer serves. Until that is changed, run tests
that do not need file storage without MinIO:

```bash
docker compose -f docker-compose-test.yml up -d --wait test-db test-redis test-mq
docker compose -f docker-compose-test.yml run --rm --no-deps api-tests pytest plane/tests/unit
```

See `apps/api/tests/RUNNING_TESTS.md` and `apps/api/plane/tests/TESTING_GUIDE.md` for details. Translations live in
`packages/i18n`; change both `src/locales` and `locales` when editing strings.

## Branding

The product name, links, colors and logo come from `branding/brand.json`. The logo source is the official vector in
`branding/sgt/sure-logo.svg`.

| File                          | Purpose                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `branding/brand.json`         | Name, short name, slug, URLs, support email, colors                             |
| `branding/rebrand.py`         | Applies the brand to the source: text, links, logo components, Docker names     |
| `branding/patches.py`         | Code changes: telemetry off, billing and upgrade prompts removed, support links |
| `branding/logo.py`            | Logo variants built from the vector logo: full, wordmark, lockup, app icon      |
| `branding/generate_assets.py` | Renders favicons, app icons, spinners and illustrations (needs Google Chrome)   |
| `branding/applied.json`       | The brand last applied, used to map old values on a rename                      |

To change the brand, edit `brand.json` and run:

```bash
python branding/rebrand.py
python branding/generate_assets.py
docker compose build && docker compose up -d
```

To move to a new upstream release, import its source, then run the same two scripts. A patch that no longer matches the
upstream code is reported as `PATCH FAILED` so it can be updated.

## Repository layout

| Path                | Contents                                                     |
| ------------------- | ------------------------------------------------------------ |
| `apps/api`          | Django REST API, Celery tasks, management commands and tests |
| `apps/web`          | Main web app                                                 |
| `apps/admin`        | Instance admin console                                       |
| `apps/space`        | Public project pages                                         |
| `apps/live`         | Realtime collaboration server                                |
| `apps/proxy`        | Caddy reverse proxy configuration                            |
| `packages/*`        | Shared UI, editor, i18n, types, services and utilities       |
| `branding/`         | Brand configuration and rebrand tooling                      |
| `deployments/demo/` | Demo data seed script                                        |
| `docs/`             | Developer documentation                                      |

## License

Licensed under the GNU Affero General Public License v3.0. See [LICENSE.txt](LICENSE.txt) and [NOTICE.md](NOTICE.md).

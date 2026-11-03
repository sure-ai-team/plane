# Chat test scripts

Run against a deployed stack (staging, or an isolated local copy). Never against production data.

## End-to-end smoke test (`chat_smoke.py`)

43 checks through the proxy, the way a browser talks to the stack: sign-in, sockets, live delivery, typing, presence, read receipts, a 12 MB upload through the proxy, range requests, access control, voice notes, delete, groups.

```bash
# 1. Seed four users (alice/bob/carol = admin/member/member, guest) and the workspace "chat-smoke".
docker cp apps/live/loadtest/chat_smoke_seed.py <api-container>:/tmp/seed.py
docker exec <api-container> sh -c "python manage.py shell < /tmp/seed.py"

# 2. Run the checks from a throwaway container on the stack's network.
docker run --rm --network <project>_default -e BASE=http://proxy -e ORIGIN=http://localhost:<port> \
  -v "$PWD/apps/live/loadtest:/smoke:ro" python:3.12-slim \
  sh -c "pip install -q requests websocket-client && python -I /smoke/chat_smoke.py"
```

The seed script marks the instance as set up and sets known passwords. Use it only on a throwaway stack.

## Load test (`chat.js`)

k6, 500 sockets. See the header of the file and `docs/chat/DEPLOYMENT.md` § 5.

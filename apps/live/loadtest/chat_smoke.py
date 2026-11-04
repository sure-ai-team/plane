"""End-to-end smoke test for workspace chat against the isolated "surechat" stack.

Runs inside a container on the stack's network and talks to the proxy, exactly
like a browser would: REST over /api, sockets over /live/chat/, uploads straight
to the storage bucket through the proxy.
"""

import json
import os
import queue
import sys
import threading
import time
import uuid

import requests
import websocket

BASE = os.environ.get("BASE", "http://proxy")
ORIGIN = os.environ.get("ORIGIN", "http://localhost:8090")
SLUG = "chat-smoke"
PASSWORD = "ChatSmoke#2026-x"
API = f"{BASE}/api/workspaces/{SLUG}/chat"

results = []


def check(name, condition, detail=""):
    results.append((name, bool(condition), detail))
    print(
        ("PASS " if condition else "FAIL ")
        + name
        + (f"  [{detail}]" if detail else ""),
        flush=True,
    )
    return condition


def sign_in(name):
    session = requests.Session()
    token = session.get(f"{BASE}/auth/get-csrf-token/").json()["csrf_token"]
    response = session.post(
        f"{BASE}/auth/sign-in/",
        data={
            "email": f"{name}@chat.test",
            "password": PASSWORD,
            "csrfmiddlewaretoken": token,
        },
        allow_redirects=False,
    )
    me = session.get(f"{BASE}/api/users/me/")
    check(
        f"sign in {name}",
        me.status_code == 200,
        f"sign-in {response.status_code}, me {me.status_code}",
    )
    session.user_id = me.json().get("id") if me.ok else None
    return session


class Socket:
    def __init__(self, session, workspace=SLUG):
        self.frames = queue.Queue()
        self.closed = None
        cookie = "; ".join(
            f"{key}={value}" for key, value in session.cookies.get_dict().items()
        )
        url = BASE.replace("http", "ws") + f"/live/chat/?workspace={workspace}"
        self.app = websocket.WebSocketApp(
            url,
            header=[f"Cookie: {cookie}", f"Origin: {ORIGIN}"],
            on_message=lambda _ws, data: self.frames.put(json.loads(data)),
            on_close=lambda _ws, code, reason: setattr(self, "closed", code),
        )
        self.thread = threading.Thread(target=self.app.run_forever, daemon=True)
        self.thread.start()

    def wait_for(self, kind, predicate=lambda frame: True, timeout=5.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                frame = self.frames.get(timeout=max(0.05, deadline - time.time()))
            except queue.Empty:
                break
            if frame.get("t") == kind and predicate(frame):
                return frame
        return None

    def wait_closed(self, timeout=5.0):
        deadline = time.time() + timeout
        while time.time() < deadline and self.closed is None:
            time.sleep(0.05)
        return self.closed

    def send(self, frame):
        self.app.send(json.dumps(frame))

    def close(self):
        self.app.close()


def upload(session, conversation_id, name, content_type, payload, **extra):
    request = session.post(
        f"{API}/conversations/{conversation_id}/attachments/",
        json={"name": name, "type": content_type, "size": len(payload), **extra},
    )
    if not check(
        f"upload request {name}",
        request.status_code == 200,
        f"{request.status_code} {request.text[:200]}",
    ):
        return None, None
    data = request.json()
    post = data["upload_data"]
    stored = requests.post(
        post["url"], data=post["fields"], files={"file": (name, payload, content_type)}
    )
    check(
        f"storage accepted {name} ({len(payload) // (1024 * 1024)} MB) via {post['url']}",
        stored.status_code in (200, 201, 204),
        f"{stored.status_code} {stored.text[:200]}",
    )
    confirm = session.patch(f"{API}/attachments/{data['asset_id']}/", json={})
    check(
        f"upload confirmed {name}",
        confirm.status_code == 200,
        f"{confirm.status_code} {confirm.text[:200]}",
    )
    return data["asset_id"], post


def main():
    # 1. Live server health
    health = requests.get(f"{BASE}/live/health/").json()
    check(
        "live health reports chat",
        "chat" in health and health["chat"].get("redis") == "ok",
        json.dumps(health.get("chat")),
    )

    alice, bob, carol, guest = (
        sign_in(name) for name in ("alice", "bob", "carol", "guest")
    )

    # 2. Sockets: members connect, guests are refused
    alice_ws, bob_ws = Socket(alice), Socket(bob)
    check("alice socket ready", alice_ws.wait_for("ready") is not None)
    check("bob socket ready", bob_ws.wait_for("ready") is not None)
    guest_ws = Socket(guest)
    check(
        "guest socket refused (4403)",
        guest_ws.wait_closed() == 4403,
        str(guest_ws.closed),
    )
    check("guest REST refused", guest.get(f"{API}/conversations/").status_code == 403)

    # 3. Direct conversation and live delivery
    direct = alice.post(
        f"{API}/conversations/", json={"type": "direct", "user_id": bob.user_id}
    )
    check("create direct", direct.status_code == 201, direct.text[:200])
    direct_id = direct.json()["id"]
    check(
        "bob notified of new conversation",
        bob_ws.wait_for("conversation.created") is not None,
    )

    started = time.time()
    sent = alice.post(
        f"{API}/conversations/{direct_id}/messages/",
        json={"body_html": "<p>hello bob</p>", "client_id": str(uuid.uuid4())},
    )
    check("alice sends", sent.status_code == 201, sent.text[:200])
    frame = bob_ws.wait_for(
        "message.created", lambda f: f["d"]["message"]["body_stripped"] == "hello bob"
    )
    latency_ms = (time.time() - started) * 1000
    check(
        "bob receives message live",
        frame is not None,
        f"{latency_ms:.0f} ms incl. HTTP round trip",
    )
    check(
        "delivery under 1 s",
        frame is not None and latency_ms < 1000,
        f"{latency_ms:.0f} ms",
    )

    # 4. Typing, presence, read receipts
    bob_ws.send({"t": "typing", "d": {"conversation_id": direct_id}})
    check(
        "alice sees bob typing",
        alice_ws.wait_for("typing", lambda f: f["d"]["user_id"] == bob.user_id)
        is not None,
    )
    online = alice.get(f"{API}/presence/").json()["online_user_ids"]
    check(
        "presence lists alice and bob",
        {alice.user_id, bob.user_id} <= set(online),
        str(online),
    )
    unread = bob.get(f"{API}/unread-count/").json()
    check(
        "bob has 1 unread",
        unread["by_conversation"].get(direct_id) == 1,
        json.dumps(unread),
    )
    seq = sent.json()["seq"]
    bob.post(f"{API}/conversations/{direct_id}/read/", json={"seq": seq})
    check(
        "alice gets read receipt",
        alice_ws.wait_for("read.updated", lambda f: f["d"]["seq"] == seq) is not None,
    )

    # 5. Large upload through the proxy (was capped at 5 MB) + range requests
    video = b"\x00\x00\x00\x18ftypmp42" + os.urandom(12 * 1024 * 1024)
    asset_id, _ = upload(
        alice,
        direct_id,
        "demo.mp4",
        "video/mp4",
        video,
        duration=12.0,
        width=640,
        height=360,
    )
    with_file = alice.post(
        f"{API}/conversations/{direct_id}/messages/",
        json={
            "body_html": "<p>video</p>",
            "client_id": str(uuid.uuid4()),
            "attachment_ids": [asset_id],
        },
    )
    check("send with 12 MB video", with_file.status_code == 201, with_file.text[:200])
    message_id = with_file.json().get("id")
    frame = bob_ws.wait_for(
        "message.created", lambda f: f["d"]["message"]["id"] == message_id
    )
    check(
        "bob receives attachment",
        frame is not None
        and frame["d"]["message"]["attachments"][0]["kind"] == "video",
    )

    redirect = bob.get(f"{API}/attachments/{asset_id}/", allow_redirects=False)
    check(
        "download redirects to storage",
        redirect.status_code == 302,
        str(redirect.status_code),
    )
    location = redirect.headers.get("Location", "").replace(
        "http://localhost:8090", BASE
    )
    ranged = requests.get(location, headers={"Range": "bytes=0-1023"})
    check(
        "video seek (Range) returns 206",
        ranged.status_code == 206 and len(ranged.content) == 1024,
        str(ranged.status_code),
    )

    # 6. Access control: outsiders can't read the file through any route
    check(
        "outsider chat download 404",
        carol.get(f"{API}/attachments/{asset_id}/", allow_redirects=False).status_code
        == 404,
    )
    check(
        "outsider generic download 404",
        carol.get(
            f"{BASE}/api/assets/v2/workspaces/{SLUG}/download/{asset_id}/",
            allow_redirects=False,
        ).status_code
        == 404,
    )
    check(
        "outsider can't read conversation",
        carol.get(f"{API}/conversations/{direct_id}/").status_code == 404,
    )

    # 7. Voice note
    webm = (
        b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08"
        b"\x42\x82\x84webm\x42\x87\x81\x04\x42\x85\x81\x02" + os.urandom(64 * 1024)
    )
    voice_id, _ = upload(
        alice,
        direct_id,
        "voice.webm",
        "audio/webm",
        webm,
        is_voice=True,
        duration=3.2,
        waveform=[0.5] * 64,
    )
    voice = alice.post(
        f"{API}/conversations/{direct_id}/messages/",
        json={
            "body_html": "",
            "client_id": str(uuid.uuid4()),
            "attachment_ids": [voice_id],
        },
    )
    check(
        "voice note message kind",
        voice.status_code == 201 and voice.json()["kind"] == "voice",
        voice.text[:200],
    )

    # 8. Blocked type and oversize are refused before upload
    exe = alice.post(
        f"{API}/conversations/{direct_id}/attachments/",
        json={"name": "x.exe", "type": "application/octet-stream", "size": 10},
    )
    check(
        "executable refused",
        exe.status_code == 400 and exe.json().get("code") == "TYPE_NOT_ALLOWED",
    )
    huge = alice.post(
        f"{API}/conversations/{direct_id}/attachments/",
        json={"name": "big.png", "type": "image/png", "size": 50 * 1024 * 1024},
    )
    check("oversized image refused", huge.status_code == 413)

    # 9. Delete removes the message and its stored file
    deleted = alice.delete(f"{API}/messages/{message_id}/")
    check("delete message", deleted.status_code == 204)
    check(
        "bob sees delete",
        bob_ws.wait_for("message.deleted", lambda f: f["d"]["id"] == message_id)
        is not None,
    )
    gone = False
    for _ in range(20):
        time.sleep(0.5)
        if requests.get(location, headers={"Range": "bytes=0-10"}).status_code in (
            403,
            404,
        ):
            gone = True
            break
    check("stored file removed after delete", gone)

    # 10. Groups: create, add, rename, system lines, leave
    carol_ws = Socket(carol)
    carol_ws.wait_for("ready")
    group = alice.post(
        f"{API}/conversations/",
        json={"type": "group", "name": "Smoke", "member_ids": [bob.user_id]},
    )
    check("create group", group.status_code == 201)
    group_id = group.json()["id"]
    added = alice.post(
        f"{API}/conversations/{group_id}/members/", json={"member_ids": [carol.user_id]}
    )
    check("add carol", added.status_code == 201)
    check(
        "carol gets the new group",
        carol_ws.wait_for(
            "conversation.created", lambda f: f["d"]["conversation_id"] == group_id
        )
        is not None,
    )
    alice.patch(f"{API}/conversations/{group_id}/", json={"name": "Smoke renamed"})
    check(
        "rename broadcast as system line",
        carol_ws.wait_for(
            "message.created",
            lambda f: f["d"]["message"]["meta"].get("event") == "renamed",
        )
        is not None,
    )
    left = carol.delete(f"{API}/conversations/{group_id}/members/{carol.user_id}/")
    check("carol leaves", left.status_code == 204)
    check(
        "carol can no longer read the group",
        carol.get(f"{API}/conversations/{group_id}/").status_code == 404,
    )

    # 11. Phase 2: reactions, pins, jump, search, forward, settings, Inbox (docs/chat/phase-2/08-testing.md)
    hello = sent.json()
    reacted = bob.post(f"{API}/messages/{hello['id']}/reactions/", json={"emoji": "🎉"})
    check("bob reacts", reacted.status_code == 201, reacted.text[:200])
    check(
        "alice sees the reaction live",
        alice_ws.wait_for(
            "reaction.updated",
            lambda f: f["d"]["message_id"] == hello["id"] and f["d"]["added"],
        )
        is not None,
    )
    pinned = alice.post(f"{API}/messages/{hello['id']}/pin/")
    check("alice pins", pinned.status_code == 201, pinned.text[:200])
    check(
        "bob sees the pin live",
        bob_ws.wait_for("pin.added", lambda f: f["d"]["message_id"] == hello["id"])
        is not None,
    )
    window = alice.get(
        f"{API}/conversations/{direct_id}/messages/?around_seq={hello['seq']}&limit=5"
    ).json()
    check(
        "jump loads the page around a message",
        any(m["id"] == hello["id"] for m in window.get("results", [])),
    )
    hits = (
        alice.get(f"{API}/search/", params={"q": "hello bo"}).json().get("results", [])
    )
    check(
        "search finds the message",
        any(hit["message"]["id"] == hello["id"] for hit in hits),
        str(len(hits)),
    )
    check(
        "outsider search finds nothing",
        carol.get(f"{API}/search/", params={"q": "hello bo"}).json()["results"] == [],
    )

    photo = b"\x89PNG\r\n\x1a\n" + os.urandom(2048)
    photo_id, _ = upload(
        alice, direct_id, "photo.png", "image/png", photo, width=10, height=10
    )
    with_photo = alice.post(
        f"{API}/conversations/{direct_id}/messages/",
        json={
            "body_html": "<p>photo</p>",
            "client_id": str(uuid.uuid4()),
            "attachment_ids": [photo_id],
        },
    ).json()
    forwarded = alice.post(
        f"{API}/messages/{with_photo['id']}/forward/",
        json={"conversation_ids": [group_id]},
    )
    check("forward with a file", forwarded.status_code == 201, forwarded.text[:200])
    copy_id = forwarded.json()["messages"][0]["id"] if forwarded.ok else None
    copy = bob.get(f"{API}/messages/{copy_id}/").json() if copy_id else {}
    check(
        "forwarded copy has its own file",
        bool(copy.get("attachments")) and copy["attachments"][0]["id"] != photo_id,
        json.dumps(copy.get("forwarded_from")),
    )

    level = alice.patch(
        f"{API}/conversations/{group_id}/me/",
        json={"notify_level": "off", "is_starred": True},
    )
    check(
        "notify level saved",
        level.status_code == 200 and level.json()["notify_level"] == "off",
    )
    check(
        "settings sync to my other tabs",
        alice_ws.wait_for("membership.updated") is not None,
    )
    check("preferences load", alice.get(f"{API}/preferences/").status_code == 200)

    mention = (
        f'<p><mention-component entity_name="user_mention" entity_identifier="{bob.user_id}">'
        "</mention-component> please check</p>"
    )
    alice.post(
        f"{API}/conversations/{group_id}/messages/",
        json={"body_html": mention, "client_id": str(uuid.uuid4())},
    )
    inbox = []
    for _ in range(20):  # created by the worker after commit
        inbox = bob.get(
            f"{BASE}/api/workspaces/{SLUG}/users/notifications/",
            params={"mentioned": "true"},
        ).json()
        if any(row.get("entity_name") == "chat_message" for row in inbox):
            break
        time.sleep(0.5)
    check(
        "mention lands in the Inbox",
        any(row.get("entity_name") == "chat_message" for row in inbox),
    )

    for socket in (alice_ws, bob_ws, carol_ws):
        socket.close()

    failed = [name for name, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        print("FAILED:", ", ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()

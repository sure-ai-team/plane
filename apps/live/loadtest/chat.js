/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/*
 * Chat load test (docs/chat/08-testing.md § Load test). Not run in CI.
 *
 *   k6 run apps/live/loadtest/chat.js \
 *     -e BASE_URL=https://pm.example.com \
 *     -e WORKSPACE=acme \
 *     -e CONVERSATION_ID=<a group every test user belongs to> \
 *     -e SESSIONS="session-id=aaa;session-id=bbb;..." \
 *     -e SOCKETS=500 -e SENDERS=20 -e DURATION=10m
 *
 * SESSIONS holds one session cookie per test user (separated by ";" between
 * cookies, i.e. "name=value;name=value"). Sockets reuse them round-robin.
 * Pass criteria: p95 chat_delivery_ms < 200, no socket errors, live RSS < 512 MB.
 *
 * Sending is limited to 60 messages/min per user (CHAT_SEND_RATE). Use at least
 * SENDERS test users, or raise CHAT_SEND_RATE on the API for the test run.
 * Session-authenticated API calls don't need a CSRF token.
 */

import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE_URL = __ENV.BASE_URL;
const WORKSPACE = __ENV.WORKSPACE;
const CONVERSATION_ID = __ENV.CONVERSATION_ID;
const SOCKETS = Number(__ENV.SOCKETS || 500);
const SENDERS = Number(__ENV.SENDERS || 20);
const DURATION = __ENV.DURATION || "10m";
const COOKIES = (__ENV.SESSIONS || "").split(";").filter(Boolean);

const deliveryMs = new Trend("chat_delivery_ms", true);
const received = new Counter("chat_messages_received");
const socketErrors = new Counter("chat_socket_errors");

export const options = {
  scenarios: {
    listeners: { executor: "constant-vus", vus: SOCKETS, duration: DURATION, exec: "listen" },
    senders: {
      executor: "constant-arrival-rate",
      rate: SENDERS,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: SENDERS,
      exec: "send",
    },
  },
  thresholds: {
    chat_delivery_ms: ["p(95)<200"],
    chat_socket_errors: ["count==0"],
  },
};

const cookieFor = (index) => COOKIES[index % COOKIES.length];
const wsUrl = () => `${BASE_URL.replace(/^http/, "ws")}/live/chat/?workspace=${encodeURIComponent(WORKSPACE)}`;

export function listen() {
  const cookie = cookieFor(__VU);
  const response = ws.connect(wsUrl(), { headers: { Cookie: cookie, Origin: BASE_URL } }, (socket) => {
    socket.on("message", (data) => {
      const frame = JSON.parse(data);
      if (frame.t === "message.created") {
        received.add(1);
        const sentAt = Number((frame.d.message.body_stripped || "").split("t=")[1]);
        if (sentAt) deliveryMs.add(Date.now() - sentAt);
      }
    });
    socket.setInterval(() => socket.send(JSON.stringify({ t: "ping", d: {} })), 30_000);
    socket.on("error", () => socketErrors.add(1));
    socket.on("close", () => undefined);
    socket.setTimeout(() => socket.close(), 60_000 * 60);
  });
  check(response, { "socket upgraded": (r) => r && r.status === 101 });
  sleep(1);
}

export function send() {
  const cookie = cookieFor(__ITER);
  const body = `load t=${Date.now()}`;
  const response = http.post(
    `${BASE_URL}/api/workspaces/${WORKSPACE}/chat/conversations/${CONVERSATION_ID}/messages/`,
    JSON.stringify({ body_html: `<p>${body}</p>`, client_id: uuidv4() }),
    { headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE_URL, Referer: `${BASE_URL}/` } }
  );
  check(response, { "message accepted": (r) => r.status === 201 || r.status === 200 });
}

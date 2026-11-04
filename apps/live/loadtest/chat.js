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
 *     -e SOCKETS=500 -e SENDERS=20 -e DURATION=10m  *     -e ORIGIN=https://pm.example.com   # optional; defaults to BASE_URL
 *
 * SESSIONS holds one session cookie per test user (separated by ";" between
 * cookies, i.e. "name=value;name=value"). Sockets reuse them round-robin.
 * Pass criteria: p95 chat_delivery_ms < 200, no socket errors, live RSS < 512 MB.
 *
 * Sending is limited to 60 messages/min per user (CHAT_SEND_RATE). Use at least
 * SENDERS test users, or raise CHAT_SEND_RATE on the API for the test run.
 * Session-authenticated API calls don't need a CSRF token.
 *
 * Phase 2 mix (docs/chat/phase-2/08-testing.md § Load): every 10th message also
 * gets a reaction, and each test user searches once a minute. Pass criteria add
 * p95 search < 300 ms. The live server allows 10 sockets per user, so 500
 * sockets need at least 50 sessions.
 *
 * ORIGIN lets the test reach the stack through an internal hostname (e.g.
 * BASE_URL=http://proxy from a container) while sending the Origin the stack
 * expects.
 */

import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE_URL = __ENV.BASE_URL;
const WORKSPACE = __ENV.WORKSPACE;
const CONVERSATION_ID = __ENV.CONVERSATION_ID;
const SOCKETS = Number(__ENV.SOCKETS || 500);
const SENDERS = Number(__ENV.SENDERS || 20);
const DURATION = __ENV.DURATION || "10m";
const COOKIES = (__ENV.SESSIONS || "").split(";").filter(Boolean);
const ORIGIN = __ENV.ORIGIN || BASE_URL;
const SEARCH_TERMS = ["load", "release", "hello", "MOB", "review"];

const deliveryMs = new Trend("chat_delivery_ms", true);
const received = new Counter("chat_messages_received");
const socketErrors = new Counter("chat_socket_errors");
const searchMs = new Trend("chat_search_ms", true);
const requestErrors = new Counter("chat_request_errors");

export const options = {
  scenarios: {
    listeners: { executor: "constant-vus", vus: SOCKETS, duration: DURATION, exec: "listen" },
    senders: {
      executor: "constant-arrival-rate",
      rate: SENDERS,
      timeUnit: "1s",
      duration: DURATION,
      // A slow response holds a VU, so keep spares to hold the arrival rate.
      preAllocatedVUs: SENDERS * 4,
      exec: "send",
    },
    searchers: {
      executor: "constant-arrival-rate",
      // One search per test user per minute.
      rate: Math.max(COOKIES.length, 1),
      timeUnit: "1m",
      duration: DURATION,
      preAllocatedVUs: 5,
      exec: "search",
    },
  },
  thresholds: {
    chat_delivery_ms: ["p(95)<200"],
    chat_socket_errors: ["count==0"],
    chat_search_ms: ["p(95)<300"],
    chat_request_errors: ["count==0"],
  },
};

// Spread users evenly with test-wide counters: __VU is numbered across all scenarios and
// __ITER restarts in every VU, so either would pile sockets or sends onto a few users.
const cookieFor = (index) => COOKIES[index % COOKIES.length];
const nextIndex = () => exec.scenario.iterationInTest;
const headersFor = (cookie) => ({
  "Content-Type": "application/json",
  Cookie: cookie,
  Origin: ORIGIN,
  Referer: `${ORIGIN}/`,
});
const wsUrl = () => `${BASE_URL.replace(/^http/, "ws")}/live/chat/?workspace=${encodeURIComponent(WORKSPACE)}`;

export function listen() {
  // The first SOCKETS iterations are the initial connections: exactly SOCKETS / users each.
  const cookie = cookieFor(nextIndex());
  const response = ws.connect(wsUrl(), { headers: { Cookie: cookie, Origin: ORIGIN } }, (socket) => {
    socket.on("message", (data) => {
      const frame = JSON.parse(data);
      if (frame.t === "message.created") {
        received.add(1);
        const sentAt = Number((frame.d.message.body_stripped || "").split("t=")[1]);
        if (sentAt) deliveryMs.add(Date.now() - sentAt);
      }
    });
    socket.setInterval(() => socket.send(JSON.stringify({ t: "ping", d: {} })), 30_000);
    socket.on("error", (event) => {
      socketErrors.add(1);
      if (__ENV.DEBUG) console.error(`socket error: ${event && event.error ? event.error() : event}`);
    });
    socket.on("close", () => undefined);
    socket.setTimeout(() => socket.close(), 60_000 * 60);
  });
  check(response, { "socket upgraded": (r) => r && r.status === 101 });
  sleep(1);
}

export function send() {
  const index = nextIndex();
  const cookie = cookieFor(index);
  const body = `load t=${Date.now()}`;
  const response = http.post(
    `${BASE_URL}/api/workspaces/${WORKSPACE}/chat/conversations/${CONVERSATION_ID}/messages/`,
    JSON.stringify({ body_html: `<p>${body}</p>`, client_id: uuidv4() }),
    { headers: headersFor(cookie) }
  );
  const accepted = check(response, { "message accepted": (r) => r.status === 201 || r.status === 200 });
  if (!accepted) {
    if (__ENV.DEBUG) console.error(`send failed: ${response.status} ${response.body}`);
    requestErrors.add(1);
    return;
  }
  // Every 10th message gets a reaction from the next user.
  if (index % 10 === 0) {
    const reaction = http.post(
      `${BASE_URL}/api/workspaces/${WORKSPACE}/chat/messages/${response.json("id")}/reactions/`,
      JSON.stringify({ emoji: "👍" }),
      { headers: headersFor(cookieFor(index + 1)) }
    );
    if (!check(reaction, { "reaction added": (r) => r.status === 201 || r.status === 200 })) requestErrors.add(1);
  }
}

export function search() {
  const index = nextIndex();
  const term = SEARCH_TERMS[index % SEARCH_TERMS.length];
  const response = http.get(`${BASE_URL}/api/workspaces/${WORKSPACE}/chat/search/?q=${encodeURIComponent(term)}`, {
    headers: headersFor(cookieFor(index)),
  });
  if (check(response, { "search ok": (r) => r.status === 200 })) searchMs.add(response.timings.duration);
  else requestErrors.add(1);
}

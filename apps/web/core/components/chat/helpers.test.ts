/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { makeConversation, makeMessage, ME, OTHER } from "@/store/chat/test-utils";
import { chatPath, dayLabel, previewText, startsGroup } from "./common/helpers";
import { VOICE_MIME_TYPES, extensionForMime, pickVoiceMimeType } from "./voice/use-voice-recorder";

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

describe("chat helpers", () => {
  it("builds chat paths", () => {
    expect(chatPath("acme")).toBe("/acme/chat");
    expect(chatPath("acme", "c1")).toBe("/acme/chat/c1");
  });

  it("previews text, attachments, voice and system lines in the viewer's words", () => {
    const group = makeConversation({
      members: [
        { id: "m", member: OTHER, role: 15, is_muted: false, is_active: true, last_read_seq: 0, joined_at: "" },
      ],
    });
    expect(previewText({ kind: "text", text: "hi", sender_id: ME.id }, group, ME.id, t)).toBe("chat.preview.you: hi");
    expect(previewText({ kind: "text", text: "hi", sender_id: OTHER.id }, group, ME.id, t)).toBe(
      `${OTHER.display_name}: hi`
    );
    expect(
      previewText({ kind: "voice", text: "", sender_id: OTHER.id }, makeConversation({ type: "direct" }), ME.id, t)
    ).toBe("chat.preview.voice");
    expect(
      previewText({ kind: "attachment", attachment_kinds: ["image", "file"], sender_id: null }, group, ME.id, t)
    ).toBe('chat.preview.attachments:{"count":2}');
    expect(previewText({ kind: "system", event: "renamed" }, group, ME.id, t)).toBe("chat.preview.system");
    expect(previewText({}, group, ME.id, t)).toBe("chat.preview.empty");
  });

  it("groups consecutive messages from the same person within five minutes", () => {
    const first = makeMessage(1, { created_at: "2026-11-03T10:00:00Z" });
    const soon = makeMessage(2, { created_at: "2026-11-03T10:04:00Z" });
    const late = makeMessage(3, { created_at: "2026-11-03T10:10:00Z" });
    const other = makeMessage(4, { sender: ME, created_at: "2026-11-03T10:10:30Z" });
    expect(startsGroup(first, undefined)).toBe(true);
    expect(startsGroup(soon, first)).toBe(false);
    expect(startsGroup(late, soon)).toBe(true);
    expect(startsGroup(other, late)).toBe(true);
    expect(startsGroup(makeMessage(5, { kind: "system" }), other)).toBe(true);
  });

  it("labels today and yesterday", () => {
    const now = new Date("2026-11-03T12:00:00");
    expect(dayLabel("2026-11-03T08:00:00", t, now)).toBe("chat.thread.today");
    expect(dayLabel("2026-11-02T08:00:00", t, now)).toBe("chat.thread.yesterday");
  });
});

describe("voice recorder helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps recording types to file extensions", () => {
    expect(extensionForMime("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForMime("audio/mp4")).toBe("m4a");
    expect(extensionForMime("audio/ogg;codecs=opus")).toBe("ogg");
  });

  it("prefers WebM/Opus and falls back to MP4 for Safari", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (type: string) => type === "audio/mp4" });
    expect(pickVoiceMimeType()).toBe("audio/mp4");
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => true });
    expect(pickVoiceMimeType()).toBe(VOICE_MIME_TYPES[0]);
  });

  it("reports no support when MediaRecorder is missing", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickVoiceMimeType()).toBeNull();
  });
});

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { vi } from "vitest";
import type { Mock } from "vitest";
import type { TChatAttachment, TChatConversation, TChatMessage, TChatUser } from "@plane/types";
import type { IChatServiceLike } from "./types";

export const ME: TChatUser = {
  id: "user-me",
  display_name: "me",
  first_name: "Me",
  last_name: "",
  avatar: null,
  avatar_url: null,
  is_bot: false,
  is_active: true,
};

export const OTHER: TChatUser = { ...ME, id: "user-other", display_name: "other", first_name: "Other" };

export const makeConversation = (overrides: Partial<TChatConversation> = {}): TChatConversation => ({
  id: "conv-1",
  type: "group",
  name: "Release",
  logo_props: {},
  project: null,
  direct_user: null,
  member_count: 2,
  my_role: 20,
  is_muted: false,
  last_message_seq: 1,
  last_read_seq: 1,
  unread_count: 0,
  last_message_at: "2026-11-03T10:00:00.000Z",
  last_message_preview: {},
  created_at: "2026-11-03T09:00:00.000Z",
  created_by: ME.id,
  ...overrides,
});

export const makeMessage = (seq: number, overrides: Partial<TChatMessage> = {}): TChatMessage => ({
  id: `msg-${seq}`,
  conversation_id: "conv-1",
  seq,
  kind: "text",
  sender: OTHER,
  body_html: `<p>m${seq}</p>`,
  body_json: {},
  body_stripped: `m${seq}`,
  reply_to: null,
  attachments: [],
  mentions: [],
  meta: {},
  client_id: null,
  edited_at: null,
  created_at: new Date(Date.UTC(2026, 10, 3, 10, 0, seq)).toISOString(),
  seen_by_count: 0,
  ...overrides,
});

export const makeAttachment = (id: string): TChatAttachment => ({
  id,
  kind: "image",
  name: `${id}.png`,
  type: "image/png",
  size: 100,
  url: `/api/x/${id}/`,
  thumb_url: null,
  width: null,
  height: null,
  duration: null,
  waveform: null,
  is_voice: false,
  is_uploaded: true,
  created_at: "2026-11-03T10:00:00.000Z",
});

/** Every service method as a typed mock with the real signature. */
export type TFakeService = { [K in keyof IChatServiceLike]: Mock<IChatServiceLike[K]> };

const mock = <K extends keyof IChatServiceLike>(implementation?: IChatServiceLike[K]): Mock<IChatServiceLike[K]> =>
  (implementation ? vi.fn(implementation) : vi.fn()) as unknown as Mock<IChatServiceLike[K]>;

/** Tests set the behaviour they need with mockResolvedValueOnce / mockImplementation. */
export const makeService = (): TFakeService => ({
  listConversations: mock<"listConversations">(async () => []),
  getConversation: mock<"getConversation">(),
  createConversation: mock<"createConversation">(),
  updateConversation: mock<"updateConversation">(),
  deleteConversation: mock<"deleteConversation">(async () => undefined),
  listMembers: mock<"listMembers">(async () => []),
  addMembers: mock<"addMembers">(async () => []),
  updateMember: mock<"updateMember">(),
  removeMember: mock<"removeMember">(async () => undefined),
  listMessages: mock<"listMessages">(async () => ({
    results: [],
    has_more: false,
    oldest_seq: null,
    newest_seq: null,
  })),
  sendMessage: mock<"sendMessage">(),
  editMessage: mock<"editMessage">(),
  deleteMessage: mock<"deleteMessage">(async () => undefined),
  getMessage: mock<"getMessage">(),
  addReaction: mock<"addReaction">(async () => []),
  removeReaction: mock<"removeReaction">(async () => undefined),
  listPins: mock<"listPins">(async () => []),
  pinMessage: mock<"pinMessage">(async (_slug, id) => ({ message_id: id, is_pinned: true })),
  unpinMessage: mock<"unpinMessage">(async () => undefined),
  forwardMessage: mock<"forwardMessage">(async () => ({ messages: [] })),
  markRead: mock<"markRead">(async (_slug, _id, seq) => ({ last_read_seq: seq, unread_count: 0 })),
  unreadCount: mock<"unreadCount">(),
  presence: mock<"presence">(async () => ({ online_user_ids: [] })),
  config: mock<"config">(async () => ({
    enabled: true,
    max_image_mb: 10,
    max_video_mb: 200,
    max_audio_mb: 25,
    max_file_mb: 50,
    max_files_per_message: 10,
    max_voice_seconds: 300,
  })),
  requestUpload: mock<"requestUpload">(),
  requestThumbnailUpload: mock<"requestThumbnailUpload">(),
  confirmUpload: mock<"confirmUpload">(),
  cancelUpload: mock<"cancelUpload">(async () => undefined),
  uploadToStorage: mock<"uploadToStorage">(async () => undefined),
});

export const flush = async (times = 3) => {
  for (let index = 0; index < times; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- let queued promise chains settle
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

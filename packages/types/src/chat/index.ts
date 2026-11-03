/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace chat shapes. These mirror the API exactly (docs/chat/02-api-contracts.md);
 * socket events carry the same objects (docs/chat/03-realtime-protocol.md).
 */

export type TChatUser = {
  id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  avatar: string | null;
  avatar_url: string | null;
  is_bot: boolean;
  is_active: boolean;
};

export type TChatAttachmentKind = "image" | "video" | "audio" | "file";

export type TChatAttachment = {
  id: string;
  kind: TChatAttachmentKind;
  name: string;
  type: string;
  size: number;
  url: string;
  thumb_url: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  waveform: number[] | null;
  is_voice: boolean;
  is_uploaded: boolean;
  created_at: string;
};

export type TChatMessageKind = "text" | "system" | "attachment" | "voice";

export type TChatSystemEvent =
  | "created"
  | "member_added"
  | "member_removed"
  | "member_left"
  | "renamed"
  | "icon_changed"
  | "project_linked";

export type TChatReplyPreview = {
  id: string;
  seq: number;
  sender: TChatUser | null;
  kind: TChatMessageKind;
  body_stripped: string;
};

export type TChatMessage = {
  id: string;
  conversation_id: string;
  seq: number;
  kind: TChatMessageKind;
  sender: TChatUser | null;
  body_html: string;
  body_json: Record<string, unknown>;
  body_stripped: string;
  reply_to: TChatReplyPreview | null;
  attachments: TChatAttachment[];
  mentions: string[];
  meta: { event?: TChatSystemEvent; actor_id?: string | null; user_id?: string; [key: string]: unknown };
  client_id: string | null;
  edited_at: string | null;
  created_at: string;
  seen_by_count: number;
};

export type TChatMessagePage = {
  results: TChatMessage[];
  has_more: boolean;
  oldest_seq: number | null;
  newest_seq: number | null;
};

export type TChatConversationType = "direct" | "group";

/** 20 = admin, 15 = member (same numbers as workspace roles). */
export type TChatRole = 20 | 15;

export type TChatPreview = {
  sender_id?: string | null;
  kind?: TChatMessageKind;
  event?: TChatSystemEvent;
  text?: string;
  attachment_kinds?: TChatAttachmentKind[];
};

export type TChatProjectLite = {
  id: string;
  identifier: string;
  name: string;
  logo_props: Record<string, unknown>;
};

export type TChatMember = {
  id: string;
  member: TChatUser;
  role: TChatRole;
  is_muted: boolean;
  is_active: boolean;
  last_read_seq: number;
  joined_at: string;
};

export type TChatConversation = {
  id: string;
  type: TChatConversationType;
  name: string;
  logo_props: Record<string, unknown>;
  project: TChatProjectLite | null;
  direct_user: TChatUser | null;
  member_count: number;
  my_role: TChatRole;
  is_muted: boolean;
  last_message_seq: number;
  last_read_seq: number;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: TChatPreview;
  created_at: string;
  created_by: string | null;
  /** Present on GET conversations/<id>/ (first 50 active members). */
  members?: TChatMember[];
};

export type TChatUnreadCount = {
  total: number;
  by_conversation: Record<string, number>;
};

export type TChatConfig = {
  enabled: boolean;
  max_image_mb: number;
  max_video_mb: number;
  max_audio_mb: number;
  max_file_mb: number;
  max_files_per_message: number;
  max_voice_seconds: number;
};

// --------------------------------------------------------------------------
// Request payloads
// --------------------------------------------------------------------------

export type TChatCreateConversationPayload =
  | { type: "direct"; user_id: string }
  | {
      type: "group";
      name: string;
      member_ids: string[];
      logo_props?: Record<string, unknown>;
      project_id?: string | null;
    };

export type TChatUpdateConversationPayload = Partial<{
  name: string;
  logo_props: Record<string, unknown>;
  project_id: string | null;
}>;

export type TChatSendMessagePayload = {
  body_html: string;
  body_json?: Record<string, unknown>;
  reply_to_id?: string | null;
  client_id: string;
  attachment_ids?: string[];
};

export type TChatMessagePageQuery = {
  before_seq?: number;
  after_seq?: number;
  limit?: number;
};

export type TChatUploadRequest = {
  name: string;
  type: string;
  size: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  waveform?: number[] | null;
  is_voice?: boolean;
};

export type TChatPresignedPost = {
  url: string;
  fields: Record<string, string>;
};

export type TChatUploadResponse = {
  asset_id: string;
  upload_data: TChatPresignedPost;
  asset_url: string;
  attachment: TChatAttachment;
};

export type TChatApiError = {
  error: string;
  code: string;
  [key: string]: unknown;
};

// --------------------------------------------------------------------------
// Socket events (server -> client)
// --------------------------------------------------------------------------

export type TChatServerEvent =
  | { t: "ready"; d: { user_id: string } }
  | { t: "pong"; d: Record<string, never> }
  | { t: "message.created"; d: { message: TChatMessage } }
  | { t: "message.updated"; d: { message: TChatMessage } }
  | { t: "message.deleted"; d: { conversation_id: string; id: string; seq: number } }
  | { t: "conversation.created"; d: { conversation_id: string } }
  | {
      t: "conversation.updated";
      d: {
        conversation_id: string;
        name: string;
        logo_props: Record<string, unknown>;
        project: TChatProjectLite | null;
      };
    }
  | { t: "conversation.deleted"; d: { conversation_id: string } }
  | { t: "member.added"; d: { conversation_id: string; member: TChatMember } }
  | { t: "member.updated"; d: { conversation_id: string; member: TChatMember } }
  | { t: "member.removed"; d: { conversation_id: string; user_id: string } }
  | { t: "read.updated"; d: { conversation_id: string; user_id: string; seq: number } }
  | { t: "typing"; d: { conversation_id: string; user_id: string } }
  | { t: "presence"; d: { user_id: string; online: boolean } };

export type TChatServerFrame = TChatServerEvent & { ts: number };

export type TChatClientFrame =
  | { t: "ping"; d: Record<string, never> }
  | { t: "typing"; d: { conversation_id: string } }
  | { t: "subscribe"; d: { conversation_id: string | null } };

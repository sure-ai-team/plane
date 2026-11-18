/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TInstanceChatConfigurationKeys =
  | "CHAT_ENABLED"
  | "CHAT_MAX_IMAGE_MB"
  | "CHAT_MAX_VIDEO_MB"
  | "CHAT_MAX_AUDIO_MB"
  | "CHAT_MAX_FILE_MB"
  | "CHAT_MAX_FILES_PER_MESSAGE"
  | "CHAT_MAX_VOICE_SECONDS";

/** Chat switch and attachment limits, exposed to clients in the instance payload. */
export interface IInstanceChatConfig {
  enabled: boolean;
  max_image_mb: number;
  max_video_mb: number;
  max_audio_mb: number;
  max_file_mb: number;
  max_files_per_message: number;
  max_voice_seconds: number;
}

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import type { TChatApiError, TChatAttachment, TChatAttachmentKind, TChatConfig } from "@plane/types";
import type { IChatServiceLike } from "./types";

export const UPLOAD_CONCURRENCY = 3;

export type TUploadStatus = "queued" | "preparing" | "uploading" | "confirming" | "ready" | "failed";

/** What the browser works out about a file before upload (filled in by PR 6/7 media helpers). */
export type TPreparedMedia = {
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  waveform?: number[] | null;
  /** Image thumbnail or video poster (WebP/JPEG/PNG, at most 2 MB). */
  thumbnail?: Blob | null;
};

export type TUploadItem = {
  localId: string;
  conversationId: string;
  file: File;
  kind: TChatAttachmentKind;
  isVoice: boolean;
  status: TUploadStatus;
  progress: number;
  assetId: string | null;
  attachment: TChatAttachment | null;
  error: TChatApiError | null;
  previewUrl: string | null;
};

export type TUploadOptions = {
  isVoice?: boolean;
  /** Known values for recordings (duration, waveform) so prepare() can be skipped. */
  media?: TPreparedMedia;
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
]);
// Mirrors plane/utils/chat_media.py; the server is the authority, this only fails fast.
const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "scr",
  "ps1",
  "psm1",
  "sh",
  "bash",
  "js",
  "mjs",
  "cjs",
  "jar",
  "vbs",
  "vbe",
  "wsf",
  "dll",
  "apk",
  "app",
  "svg",
  "svgz",
  "html",
  "htm",
  "xhtml",
  "shtml",
  "hta",
  "lnk",
  "reg",
  "cpl",
  "msc",
  "pif",
  "gadget",
]); // prettier-ignore

export const normalizeType = (type: string) => type.split(";")[0].trim().toLowerCase();

export const kindForType = (type: string): TChatAttachmentKind => {
  const normalized = normalizeType(type);
  if (IMAGE_TYPES.has(normalized)) return "image";
  if (VIDEO_TYPES.has(normalized)) return "video";
  if (AUDIO_TYPES.has(normalized)) return "audio";
  return "file";
};

export const isBlockedFile = (file: { name: string; type: string }): boolean => {
  const extension = file.name.includes(".") ? (file.name.split(".").pop() ?? "").toLowerCase() : "";
  const type = normalizeType(file.type);
  return BLOCKED_EXTENSIONS.has(extension) || type.startsWith("text/html") || type.startsWith("image/svg");
};

export const limitMbFor = (config: TChatConfig, kind: TChatAttachmentKind): number =>
  ({ image: config.max_image_mb, video: config.max_video_mb, audio: config.max_audio_mb, file: config.max_file_mb })[
    kind
  ];

const objectUrl = (file: Blob): string | null =>
  typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;

const revoke = (url: string | null) => {
  if (url && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
};

export class ChatUploadStore {
  items = new Map<string, TUploadItem>();
  private controllers = new Map<string, AbortController>();
  private options = new Map<string, TUploadOptions>();
  private active = 0;
  private sequence = 0;

  /** Optional media inspection (thumbnails, posters, dimensions). Set by the composer in PR 6. */
  prepare: ((file: File, kind: TChatAttachmentKind) => Promise<TPreparedMedia>) | null = null;

  constructor(
    private readonly service: IChatServiceLike,
    private readonly getConfig: () => TChatConfig | null,
    private readonly workspaceSlug: () => string | null
  ) {
    makeObservable(this, {
      items: observable,
      add: action,
      remove: action,
      clear: action,
      takeReady: action,
    });
  }

  // ------------------------------------------------------------------ getters

  forConversation = computedFn((conversationId: string): TUploadItem[] =>
    Array.from(this.items.values()).filter((item) => item.conversationId === conversationId)
  );

  /** True when there are attachments and every one of them is uploaded and confirmed. */
  canSend = computedFn((conversationId: string): boolean => {
    const items = this.forConversation(conversationId);
    return items.length > 0 && items.every((item) => item.status === "ready");
  });

  /** True while any attachment is still being processed (the Send button waits). */
  isBusy = computedFn((conversationId: string): boolean =>
    this.forConversation(conversationId).some((item) => item.status !== "ready" && item.status !== "failed")
  );

  hasFailures = computedFn((conversationId: string): boolean =>
    this.forConversation(conversationId).some((item) => item.status === "failed")
  );

  // ------------------------------------------------------------------ actions

  /**
   * Queue files for a conversation. Returns the rejected ones with the reason so
   * the composer can show it; accepted files start uploading right away.
   */
  add(
    conversationId: string,
    files: File[],
    options: TUploadOptions = {}
  ): { accepted: TUploadItem[]; rejected: Array<{ file: File; error: TChatApiError }> } {
    const config = this.getConfig();
    const accepted: TUploadItem[] = [];
    const rejected: Array<{ file: File; error: TChatApiError }> = [];
    const room = config ? config.max_files_per_message - this.forConversation(conversationId).length : Infinity;

    for (const file of files) {
      const kind = kindForType(file.type || "application/octet-stream");
      if (isBlockedFile(file)) {
        rejected.push({ file, error: { error: "This file type isn't allowed.", code: "TYPE_NOT_ALLOWED" } });
        continue;
      }
      if (accepted.length >= room) {
        rejected.push({
          file,
          error: {
            error: "Too many files for one message.",
            code: "TOO_MANY_FILES",
            max: config?.max_files_per_message,
          },
        });
        continue;
      }
      if (config && file.size > limitMbFor(config, kind) * 1024 * 1024) {
        rejected.push({
          file,
          error: { error: "This file is too large.", code: "FILE_TOO_LARGE", limit_mb: limitMbFor(config, kind) },
        });
        continue;
      }
      this.sequence += 1;
      // Observable before insertion so the map keeps this exact object (the pipeline mutates it).
      const item: TUploadItem = observable(
        {
          localId: `upload-${this.sequence}`,
          conversationId,
          file,
          kind,
          isVoice: !!options.isVoice,
          status: "queued",
          progress: 0,
          assetId: null,
          attachment: null,
          error: null,
          previewUrl: kind === "image" ? objectUrl(file) : null,
        } as TUploadItem,
        { file: false }
      );
      this.items.set(item.localId, item);
      this.options.set(item.localId, options);
      accepted.push(item);
    }
    this.pump();
    return { accepted, rejected };
  }

  async retry(localId: string): Promise<void> {
    const item = this.items.get(localId);
    if (!item || item.status !== "failed") return;
    if (item.assetId) await this.service.cancelUpload(this.workspaceSlug() ?? "", item.assetId).catch(() => undefined);
    runInAction(() => {
      item.status = "queued";
      item.progress = 0;
      item.error = null;
      item.assetId = null;
      item.attachment = null;
    });
    this.pump();
  }

  /** Cancel (if running) and remove one attachment from the tray. */
  remove(localId: string) {
    const item = this.items.get(localId);
    if (!item) return;
    this.controllers.get(localId)?.abort();
    this.controllers.delete(localId);
    this.options.delete(localId);
    this.items.delete(localId);
    revoke(item.previewUrl);
    // Anything still in the tray was never sent: delete it now rather than waiting for the nightly purge.
    const slug = this.workspaceSlug();
    if (item.assetId && slug) void this.service.cancelUpload(slug, item.assetId).catch(() => undefined);
  }

  /** Remove everything queued for a conversation (e.g. the user cleared the composer). */
  clear(conversationId: string) {
    for (const item of this.forConversation(conversationId)) this.remove(item.localId);
  }

  /**
   * Hand the ready attachments to a message being sent and empty the tray.
   * The server links them to the message; nothing is deleted.
   */
  takeReady(conversationId: string): TChatAttachment[] {
    const ready = this.forConversation(conversationId).filter((item) => item.status === "ready" && item.attachment);
    for (const item of ready) {
      this.items.delete(item.localId);
      this.options.delete(item.localId);
      revoke(item.previewUrl);
    }
    return ready.map((item) => item.attachment as TChatAttachment);
  }

  // ------------------------------------------------------------------ pipeline

  private pump() {
    for (const item of this.items.values()) {
      if (this.active >= UPLOAD_CONCURRENCY) return;
      if (item.status !== "queued") continue;
      this.active += 1;
      void this.run(item).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private isGone(item: TUploadItem) {
    return this.items.get(item.localId) !== item;
  }

  private fail(item: TUploadItem, error: unknown) {
    if (this.isGone(item)) return;
    runInAction(() => {
      item.status = "failed";
      item.error = (error as TChatApiError)?.code
        ? (error as TChatApiError)
        : { error: "Upload failed.", code: "UPLOAD_FAILED" };
    });
  }

  private async run(item: TUploadItem): Promise<void> {
    const slug = this.workspaceSlug();
    if (!slug) return this.fail(item, { error: "No workspace.", code: "NO_WORKSPACE" });
    const options = this.options.get(item.localId) ?? {};
    const controller = new AbortController();
    this.controllers.set(item.localId, controller);

    try {
      runInAction(() => {
        item.status = "preparing";
      });
      let media: TPreparedMedia = options.media ?? {};
      if (!options.media && this.prepare) {
        media = await this.prepare(item.file, item.kind).catch(() => ({}));
      }
      if (this.isGone(item)) return;

      const request = await this.service.requestUpload(slug, item.conversationId, {
        name: item.file.name || "file",
        type: item.file.type || "application/octet-stream",
        size: item.file.size,
        width: media.width ?? null,
        height: media.height ?? null,
        duration: media.duration ?? null,
        waveform: media.waveform ?? null,
        is_voice: item.isVoice,
      });
      if (this.isGone(item)) {
        void this.service.cancelUpload(slug, request.asset_id).catch(() => undefined);
        return;
      }
      runInAction(() => {
        item.assetId = request.asset_id;
        item.status = "uploading";
      });

      if (media.thumbnail && (item.kind === "image" || item.kind === "video")) {
        try {
          const thumb = await this.service.requestThumbnailUpload(slug, item.conversationId, request.asset_id, {
            type: media.thumbnail.type || "image/webp",
            size: media.thumbnail.size,
          });
          await this.service.uploadToStorage(thumb.upload_data, media.thumbnail, { signal: controller.signal });
        } catch {
          // A missing thumbnail is fine: the server drops the reference on confirm.
        }
      }

      await this.service.uploadToStorage(request.upload_data, item.file, {
        signal: controller.signal,
        onProgress: (fraction) => {
          if (!this.isGone(item)) runInAction(() => (item.progress = fraction));
        },
      });
      if (this.isGone(item)) return;

      runInAction(() => {
        item.status = "confirming";
        item.progress = 1;
      });
      const attachment = await this.service.confirmUpload(slug, request.asset_id);
      if (this.isGone(item)) return;
      runInAction(() => {
        item.attachment = attachment;
        item.status = "ready";
      });
    } catch (error) {
      if ((error as TChatApiError)?.code === "CANCELLED" || this.isGone(item)) return;
      this.fail(item, error);
    } finally {
      this.controllers.delete(item.localId);
    }
  }
}

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { TChatConfig } from "@plane/types";
import { ChatUploadStore, UPLOAD_CONCURRENCY, isBlockedFile, kindForType } from "./upload.store";
import { flush, makeAttachment, makeService } from "./test-utils";
import type { TFakeService } from "./test-utils";

const CONFIG: TChatConfig = {
  enabled: true,
  max_image_mb: 1,
  max_video_mb: 200,
  max_audio_mb: 25,
  max_file_mb: 50,
  max_files_per_message: 3,
  max_voice_seconds: 300,
};

const file = (name: string, type: string, size = 100) => new File([new Uint8Array(size)], name, { type });

describe("upload helpers", () => {
  it("classifies and blocks like the server", () => {
    expect(kindForType("image/png")).toBe("image");
    expect(kindForType("audio/webm;codecs=opus")).toBe("audio");
    expect(kindForType("application/pdf")).toBe("file");
    expect(isBlockedFile({ name: "run.exe", type: "application/octet-stream" })).toBe(true);
    expect(isBlockedFile({ name: "logo.png", type: "image/svg+xml" })).toBe(true);
    expect(isBlockedFile({ name: "report.pdf", type: "application/pdf" })).toBe(false);
  });
});

describe("ChatUploadStore", () => {
  let service: TFakeService;
  let store: ChatUploadStore;

  beforeEach(() => {
    service = makeService();
    let next = 0;
    service.requestUpload.mockImplementation(async () => {
      next += 1;
      return {
        asset_id: `asset-${next}`,
        upload_data: { url: "https://s3", fields: {} },
        asset_url: "",
        attachment: makeAttachment(`asset-${next}`),
      };
    });
    service.confirmUpload.mockImplementation(async (_slug: string, assetId: string) => makeAttachment(assetId));
    store = new ChatUploadStore(
      service,
      () => CONFIG,
      () => "acme"
    );
  });

  it("uploads, confirms and becomes ready to send", async () => {
    const { accepted } = store.add("conv-1", [file("a.png", "image/png")]);
    expect(accepted).toHaveLength(1);
    expect(store.canSend("conv-1")).toBe(false);
    await flush();
    const [item] = store.forConversation("conv-1");
    expect(item.status).toBe("ready");
    expect(item.progress).toBe(1);
    expect(store.canSend("conv-1")).toBe(true);
    expect(service.requestUpload).toHaveBeenCalledWith(
      "acme",
      "conv-1",
      expect.objectContaining({ name: "a.png", type: "image/png", size: 100, is_voice: false })
    );
  });

  it("rejects blocked, oversized and surplus files before uploading", () => {
    const { accepted, rejected } = store.add("conv-1", [
      file("run.exe", "application/octet-stream"),
      file("big.png", "image/png", 2 * 1024 * 1024),
      file("a.pdf", "application/pdf"),
      file("b.pdf", "application/pdf"),
      file("c.pdf", "application/pdf"),
      file("d.pdf", "application/pdf"),
    ]);
    expect(accepted.map((item) => item.file.name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(rejected.map((entry) => entry.error.code)).toEqual(["TYPE_NOT_ALLOWED", "FILE_TOO_LARGE", "TOO_MANY_FILES"]);
  });

  it("runs at most three uploads at a time", async () => {
    const releases: Array<() => void> = [];
    service.uploadToStorage.mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)));
    store = new ChatUploadStore(
      service,
      () => ({ ...CONFIG, max_files_per_message: 10 }),
      () => "acme"
    );
    store.add(
      "conv-1",
      Array.from({ length: 5 }, (_, index) => file(`${index}.pdf`, "application/pdf"))
    );
    await flush();
    expect(service.uploadToStorage).toHaveBeenCalledTimes(UPLOAD_CONCURRENCY);
    releases.splice(0).forEach((release) => release());
    await flush(6);
    expect(service.uploadToStorage).toHaveBeenCalledTimes(5);
  });

  it("marks failures and retries them", async () => {
    service.uploadToStorage.mockRejectedValueOnce({ error: "Upload failed.", code: "UPLOAD_FAILED" });
    store.add("conv-1", [file("a.pdf", "application/pdf")]);
    await flush();
    const [item] = store.forConversation("conv-1");
    expect(item.status).toBe("failed");
    expect(store.hasFailures("conv-1")).toBe(true);
    expect(store.canSend("conv-1")).toBe(false);

    await store.retry(item.localId);
    await flush();
    expect(service.cancelUpload).toHaveBeenCalledWith("acme", "asset-1");
    expect(store.forConversation("conv-1")[0].status).toBe("ready");
  });

  it("cancels an in-flight upload and deletes the server record", async () => {
    let release!: () => void;
    service.uploadToStorage.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const { accepted } = store.add("conv-1", [file("a.pdf", "application/pdf")]);
    await flush();
    store.remove(accepted[0].localId);
    release();
    await flush();
    expect(store.forConversation("conv-1")).toEqual([]);
    expect(service.cancelUpload).toHaveBeenCalledWith("acme", "asset-1");
    expect(service.confirmUpload).not.toHaveBeenCalled();
  });

  it("hands ready attachments to the message and empties the tray", async () => {
    store.add("conv-1", [file("a.pdf", "application/pdf"), file("b.pdf", "application/pdf")]);
    await flush();
    const attachments = store.takeReady("conv-1");
    expect(attachments.map((attachment) => attachment.id)).toEqual(["asset-1", "asset-2"]);
    expect(store.forConversation("conv-1")).toEqual([]);
    expect(service.cancelUpload).not.toHaveBeenCalled();
  });

  it("uses prepared media and uploads a thumbnail first", async () => {
    service.requestThumbnailUpload.mockResolvedValue({ upload_data: { url: "https://s3", fields: {} } });
    store.prepare = async () => ({ width: 800, height: 600, thumbnail: new Blob(["x"], { type: "image/webp" }) });
    store.add("conv-1", [file("a.png", "image/png")]);
    await flush();
    expect(service.requestUpload.mock.calls[0][2]).toMatchObject({ width: 800, height: 600 });
    expect(service.requestThumbnailUpload).toHaveBeenCalledWith("acme", "conv-1", "asset-1", {
      type: "image/webp",
      size: 1,
    });
    expect(service.uploadToStorage).toHaveBeenCalledTimes(2);
  });

  it("sends voice-note details without running prepare", async () => {
    store.prepare = async () => {
      throw new Error("should not run");
    };
    store.add("conv-1", [file("voice.webm", "audio/webm")], {
      isVoice: true,
      media: { duration: 4.2, waveform: [0.5] },
    });
    await flush();
    expect(service.requestUpload.mock.calls[0][2]).toMatchObject({ is_voice: true, duration: 4.2, waveform: [0.5] });
    expect(store.forConversation("conv-1")[0].status).toBe("ready");
  });
});

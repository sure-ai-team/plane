/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TChatAttachmentKind } from "@plane/types";
import type { TPreparedMedia } from "@/store/chat/upload.store";

/** Longest side of image thumbnails and video posters (docs/chat/04-attachments-and-media.md). */
export const THUMB_MAX_SIDE = 400;
export const WAVEFORM_POINTS = 64;
const MEDIA_TIMEOUT_MS = 8_000;

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (blob && blob.type === "image/webp") return resolve(blob);
        // Safari can't encode WebP: fall back to JPEG.
        canvas.toBlob((jpeg) => resolve(jpeg), "image/jpeg", 0.8);
      },
      "image/webp",
      0.8
    );
  });

const scaledCanvas = (source: CanvasImageSource, width: number, height: number) => {
  const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const withTimeout = <T>(promise: Promise<T>, fallback: T): Promise<T> =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), MEDIA_TIMEOUT_MS))]);

async function prepareImage(file: File): Promise<TPreparedMedia> {
  try {
    const bitmap = await createImageBitmap(file);
    const result: TPreparedMedia = { width: bitmap.width, height: bitmap.height };
    if (Math.max(bitmap.width, bitmap.height) > THUMB_MAX_SIDE || file.size > 300 * 1024) {
      result.thumbnail = await canvasToBlob(scaledCanvas(bitmap, bitmap.width, bitmap.height));
    }
    bitmap.close();
    return result;
  } catch {
    // Formats the browser can't decode (e.g. HEIC) upload without a preview.
    return {};
  }
}

const loadMediaElement = <T extends HTMLMediaElement>(element: T, url: string): Promise<T | null> =>
  new Promise((resolve) => {
    element.preload = "metadata";
    element.muted = true;
    element.addEventListener("loadedmetadata", () => resolve(element), { once: true });
    element.addEventListener("error", () => resolve(null), { once: true });
    element.src = url;
  });

async function prepareVideo(file: File): Promise<TPreparedMedia> {
  const url = URL.createObjectURL(file);
  try {
    const video = await withTimeout(loadMediaElement(document.createElement("video"), url), null);
    // HEVC .mov in Chrome, for example: no poster, the thread shows a file-style tile.
    if (!video || !video.videoWidth) return {};
    const result: TPreparedMedia = {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: Number.isFinite(video.duration) ? video.duration : null,
    };
    const seekTo = Math.min(1, (video.duration || 2) / 2);
    const seeked = await withTimeout(
      new Promise<boolean>((resolve) => {
        video.addEventListener("seeked", () => resolve(true), { once: true });
        video.currentTime = seekTo;
      }),
      false
    );
    if (seeked) result.thumbnail = await canvasToBlob(scaledCanvas(video, video.videoWidth, video.videoHeight));
    return result;
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 64 RMS buckets normalised to [0, 1] (the format the API stores, docs/chat/04). */
export async function computeWaveform(blob: Blob, points = WAVEFORM_POINTS): Promise<number[] | null> {
  const AudioContextClass =
    typeof window !== "undefined"
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!AudioContextClass) return null;
  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const data = buffer.getChannelData(0);
    const bucketSize = Math.max(1, Math.floor(data.length / points));
    const peaks: number[] = [];
    for (let bucket = 0; bucket < points; bucket += 1) {
      let sum = 0;
      const start = bucket * bucketSize;
      const end = Math.min(data.length, start + bucketSize);
      for (let index = start; index < end; index += 1) sum += data[index] * data[index];
      peaks.push(Math.sqrt(sum / Math.max(1, end - start)));
    }
    const max = Math.max(...peaks, 0.0001);
    return peaks.map((peak) => Math.round((peak / max) * 1000) / 1000);
  } catch {
    return null;
  } finally {
    void context.close();
  }
}

async function prepareAudio(file: File): Promise<TPreparedMedia> {
  const url = URL.createObjectURL(file);
  try {
    const audio = await withTimeout(loadMediaElement(document.createElement("audio"), url), null);
    const duration = audio && Number.isFinite(audio.duration) ? audio.duration : null;
    const waveform = file.size <= 25 * 1024 * 1024 ? await withTimeout(computeWaveform(file), null) : null;
    return { duration, waveform };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Upload-store `prepare` hook: dimensions, duration, thumbnail/poster and waveform. */
export async function prepareChatMedia(file: File, kind: TChatAttachmentKind): Promise<TPreparedMedia> {
  if (typeof window === "undefined") return {};
  if (kind === "image") return prepareImage(file);
  if (kind === "video") return prepareVideo(file);
  if (kind === "audio") return prepareAudio(file);
  return {};
}

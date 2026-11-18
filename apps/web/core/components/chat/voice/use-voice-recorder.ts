/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** In order of preference; Safari only records audio/mp4 (docs/chat/04-attachments-and-media.md). */
export const VOICE_MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

/** Bars kept for the live meter while recording. */
export const LIVE_BARS = 48;

export type TRecorderState = "idle" | "requesting" | "recording" | "review" | "error";
export type TRecorderError = "permission" | "unsupported" | "failed";

export type TRecording = {
  blob: Blob;
  mimeType: string;
  duration: number;
  url: string;
};

export const pickVoiceMimeType = (): string | null => {
  if (typeof MediaRecorder === "undefined") return null;
  return VOICE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
};

export const extensionForMime = (mimeType: string) => {
  const base = mimeType.split(";")[0];
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/ogg") return "ogg";
  return "webm";
};

/**
 * MediaRecorder with a live level meter (Web Audio analyser), a hard time
 * limit and a review step. Everything is released on discard/unmount.
 */
export const useVoiceRecorder = (maxSeconds: number) => {
  const [state, setState] = useState<TRecorderState>("idle");
  const [error, setError] = useState<TRecorderError | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [recording, setRecording] = useState<TRecording | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const discardedRef = useRef(false);

  const releaseDevices = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    frameRef.current = null;
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    const mimeType = pickVoiceMimeType();
    if (mimeType === null || !navigator.mediaDevices?.getUserMedia) {
      setError("unsupported");
      setState("error");
      return;
    }
    setError(null);
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("permission");
      setState("error");
      return;
    }
    streamRef.current = stream;
    discardedRef.current = false;
    chunksRef.current = [];

    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      const duration = (performance.now() - startedAtRef.current) / 1000;
      releaseDevices();
      if (discardedRef.current) return;
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      if (blob.size === 0) {
        setError("failed");
        setState("error");
        return;
      }
      setRecording({ blob, mimeType: type, duration: Math.min(duration, maxSeconds), url: URL.createObjectURL(blob) });
      setState("review");
    });

    // Live meter from an analyser on the microphone stream.
    try {
      const context = new AudioContext();
      contextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      let lastPush = 0;
      const draw = (now: number) => {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const value of buffer) sum += ((value - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / buffer.length) * 4);
        if (now - lastPush > 90) {
          lastPush = now;
          setLevels((current) => [...current.slice(-(LIVE_BARS - 1)), level]);
        }
        frameRef.current = requestAnimationFrame(draw);
      };
      frameRef.current = requestAnimationFrame(draw);
    } catch {
      // The meter is cosmetic; recording works without it.
    }

    startedAtRef.current = performance.now();
    setElapsed(0);
    setLevels([]);
    recorder.start(250);
    setState("recording");
    tickRef.current = window.setInterval(() => {
      const seconds = (performance.now() - startedAtRef.current) / 1000;
      setElapsed(seconds);
      if (seconds >= maxSeconds) stop();
    }, 200);
  }, [maxSeconds, releaseDevices, stop]);

  const discard = useCallback(() => {
    discardedRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    releaseDevices();
    setRecording((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setElapsed(0);
    setLevels([]);
    setError(null);
    setState("idle");
  }, [releaseDevices]);

  /** Hand the recording over (the caller uploads it) and reset without revoking its URL twice. */
  const take = useCallback((): TRecording | null => {
    const current = recording;
    setRecording(null);
    setState("idle");
    setElapsed(0);
    setLevels([]);
    return current;
  }, [recording]);

  useEffect(
    () => () => {
      discardedRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseDevices();
    },
    [releaseDevices]
  );

  return { state, error, elapsed, levels, recording, start, stop, discard, take };
};

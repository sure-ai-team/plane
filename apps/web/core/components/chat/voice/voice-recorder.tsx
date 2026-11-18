/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { when } from "mobx";
import { RotateCcw, SendHorizontal, Square, Trash2 } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// hooks
import { useChat } from "@/hooks/store/use-chat";
// local
import { computeWaveform } from "../media/prepare";
import { ChatVoiceNotePlayer, formatClock } from "./voice-note-player";
import { LIVE_BARS, extensionForMime, useVoiceRecorder } from "./use-voice-recorder";

const DEFAULT_MAX_SECONDS = 300;

type Props = {
  conversationId: string;
  onClose: () => void;
};

/**
 * Record → review → send. The recording uploads like any audio file, flagged
 * as a voice note with its duration and waveform (docs/chat/DECISIONS.md D18),
 * and is sent on its own as soon as the upload is confirmed.
 */
export const ChatVoiceRecorder = observer(function ChatVoiceRecorder({ conversationId, onClose }: Props) {
  const { t } = useTranslation();
  const chat = useChat();
  const maxSeconds = chat.config?.max_voice_seconds ?? DEFAULT_MAX_SECONDS;
  const recorder = useVoiceRecorder(maxSeconds);
  const [waveform, setWaveform] = useState<number[] | null>(null);

  // Start recording as soon as the bar opens.
  useEffect(() => {
    void recorder.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  useEffect(() => {
    if (recorder.state !== "error") return;
    setToast({
      type: TOAST_TYPE.ERROR,
      title:
        recorder.error === "permission"
          ? t("chat.voice.permission_denied")
          : recorder.error === "unsupported"
            ? t("chat.voice.unsupported")
            : t("chat.errors.generic"),
    });
    onClose();
  }, [recorder.state, recorder.error, onClose, t]);

  // Waveform for the review player and for the upload.
  useEffect(() => {
    if (recorder.state !== "review" || !recorder.recording) return;
    let cancelled = false;
    void computeWaveform(recorder.recording.blob).then((points) => {
      if (!cancelled) setWaveform(points);
      return points;
    });
    return () => {
      cancelled = true;
    };
  }, [recorder.state, recorder.recording]);

  const close = () => {
    recorder.discard();
    onClose();
  };

  const send = async () => {
    const recording = recorder.take();
    if (!recording) return;
    const extension = extensionForMime(recording.mimeType);
    const file = new File([recording.blob], `voice-note-${Date.now()}.${extension}`, {
      type: recording.mimeType.split(";")[0],
    });
    const points = waveform ?? (await computeWaveform(recording.blob));
    URL.revokeObjectURL(recording.url);
    onClose();
    const { accepted, rejected } = chat.upload.add(conversationId, [file], {
      isVoice: true,
      media: { duration: recording.duration, waveform: points },
    });
    if (rejected.length > 0 || accepted.length === 0) {
      setToast({ type: TOAST_TYPE.ERROR, title: rejected[0]?.error.error ?? t("chat.errors.generic") });
      return;
    }
    const item = accepted[0];
    // Send by itself once the server has confirmed the upload. A failed upload
    // stays in the tray with Retry, and the user sends it from there.
    await when(() => item.status === "ready" || item.status === "failed" || !chat.upload.items.has(item.localId));
    if (item.status === "ready" && chat.upload.items.has(item.localId)) {
      await chat.send(conversationId, { body_html: "", body_stripped: "" });
    }
  };

  if (recorder.state === "review" && recorder.recording) {
    return (
      <div className="flex items-center gap-2 px-2 py-2">
        <IconButton icon={Trash2} variant="ghost" size="lg" aria-label={t("chat.voice.discard")} onClick={close} />
        <div className="min-w-0 flex-1">
          <ChatVoiceNotePlayer
            src={recorder.recording.url}
            waveform={waveform}
            duration={recorder.recording.duration}
            variant="preview"
          />
        </div>
        <IconButton
          icon={RotateCcw}
          variant="ghost"
          size="lg"
          aria-label={t("chat.voice.record_again")}
          onClick={() => {
            recorder.discard();
            setWaveform(null);
            void recorder.start();
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          className="flex h-7 items-center gap-1.5 rounded-md bg-accent-primary px-2.5 text-12 font-medium text-on-color hover:bg-accent-primary-hover"
        >
          {t("chat.voice.send")}
          <SendHorizontal className="size-3.5" />
        </button>
      </div>
    );
  }

  const bars = [...Array(Math.max(0, LIVE_BARS - recorder.levels.length)).fill(0), ...recorder.levels] as number[];

  return (
    <div className="flex items-center gap-2 rounded-md bg-danger-subtle px-2 py-2" role="status" aria-live="polite">
      <IconButton icon={Trash2} variant="ghost" size="lg" aria-label={t("chat.voice.discard")} onClick={close} />
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger-primary" aria-hidden />
      <span className="w-10 shrink-0 text-12 font-medium text-danger-primary tabular-nums">
        {formatClock(recorder.elapsed)}
      </span>
      <div className="flex h-7 min-w-0 flex-1 items-center gap-px overflow-hidden" aria-hidden>
        {bars.map((level, index) => (
          <span
            // Positional bars that scroll left; order never changes meaning.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            className="flex-1 rounded-full bg-danger-primary"
            style={{ height: `${Math.max(8, Math.round(level * 100))}%`, opacity: level > 0 ? 1 : 0.25 }}
          />
        ))}
      </div>
      <span className="hidden shrink-0 text-11 text-secondary sm:inline">
        {t("chat.voice.up_to", { max: formatClock(maxSeconds) })}
      </span>
      <button
        type="button"
        onClick={recorder.stop}
        disabled={recorder.state !== "recording"}
        className="flex h-7 items-center gap-1.5 rounded-md bg-danger-primary px-2.5 text-12 font-medium text-on-color hover:bg-danger-primary-hover disabled:opacity-60"
      >
        <Square className="size-3 fill-current" />
        {t("chat.voice.stop")}
      </button>
    </div>
  );
});

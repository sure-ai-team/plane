/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";

const RATES = [1, 1.5, 2] as const;
const FALLBACK_BARS = Array.from({ length: 64 }, (_, index) => 0.25 + 0.2 * Math.abs(Math.sin(index * 0.7)));

/** Only one voice note plays at a time across the app. */
let activeAudio: HTMLAudioElement | null = null;

export const formatClock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

type Props = {
  src: string;
  waveform: number[] | null | undefined;
  duration: number | null | undefined;
  /** Accent colours for messages, neutral inside the recorder. */
  variant?: "message" | "preview";
  /** "inverse": flat on my own accent-coloured bubble (no card chrome). */
  tone?: "default" | "inverse";
};

/**
 * Draws the waveform stored with the attachment, so nothing downloads until
 * play is pressed (`preload="none"`).
 */
export function ChatVoiceNotePlayer({ src, waveform, duration, variant = "message", tone = "default" }: Props) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [knownDuration, setKnownDuration] = useState(duration ?? 0);
  const bars = waveform && waveform.length > 0 ? waveform : FALLBACK_BARS;
  const progress = knownDuration > 0 ? Math.min(1, current / knownDuration) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrent(audio.currentTime);
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setKnownDuration(audio.duration);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrent(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      if (activeAudio === audio) activeAudio = null;
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (activeAudio && activeAudio !== audio) activeAudio.pause();
      activeAudio = audio;
      audio.playbackRate = rate;
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  };

  const seek = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || knownDuration <= 0) return;
    audio.currentTime = Math.max(0, Math.min(knownDuration, fraction * knownDuration));
    setCurrent(audio.currentTime);
  };

  const isMessage = variant === "message";
  const inverse = tone === "inverse";

  return (
    <div
      className={cn(
        "flex w-80 max-w-full items-center gap-2.5 rounded-md py-1.5 pr-2 pl-1.5",
        isMessage && !inverse ? "border border-subtle bg-layer-1" : "bg-transparent"
      )}
    >
      <audio ref={audioRef} src={src} preload="none">
        <track kind="captions" />
      </audio>
      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? t("chat.voice.pause") : t("chat.voice.play")}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          inverse
            ? "bg-surface-1 text-accent-primary hover:bg-surface-1/90"
            : "bg-accent-primary text-on-color hover:bg-accent-primary-hover"
        )}
      >
        {isPlaying ? (
          <Pause className="size-3 fill-current" />
        ) : (
          <Play className="size-3 translate-x-px fill-current" />
        )}
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label={t("chat.voice.position")}
        aria-valuemin={0}
        aria-valuemax={Math.round(knownDuration)}
        aria-valuenow={Math.round(current)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          seek((event.clientX - rect.left) / rect.width);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") seek(progress + 0.05);
          if (event.key === "ArrowLeft") seek(progress - 0.05);
        }}
        className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-px"
      >
        {bars.map((value, index) => (
          <span
            // Bars are positional and never reorder.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            className={cn(
              "flex-1 rounded-full",
              inverse
                ? index / bars.length < progress
                  ? "bg-surface-1"
                  : "bg-surface-1/40"
                : index / bars.length < progress
                  ? "bg-accent-primary"
                  : "bg-layer-3"
            )}
            style={{ height: `${Math.max(12, Math.round(value * 100))}%` }}
          />
        ))}
      </div>
      <span className={cn("shrink-0 text-11 tabular-nums", inverse ? "text-on-color" : "text-secondary")}>
        {isPlaying || current > 0
          ? `${formatClock(current)} / ${formatClock(knownDuration)}`
          : formatClock(knownDuration)}
      </span>
      <button
        type="button"
        onClick={() => setRate((value) => RATES[(RATES.indexOf(value) + 1) % RATES.length])}
        aria-label={t("chat.voice.speed")}
        className={cn(
          "h-5 shrink-0 rounded-sm border px-1 text-10 font-semibold",
          inverse
            ? "border-white/40 text-on-color hover:bg-white/10"
            : "border-subtle text-secondary hover:bg-layer-transparent-hover"
        )}
      >
        {rate}x
      </button>
    </div>
  );
}

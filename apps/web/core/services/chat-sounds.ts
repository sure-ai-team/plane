/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TChatPreferences } from "@plane/types";

export type TChatTone = TChatPreferences["sound_tone"];
export const CHAT_TONES: TChatTone[] = ["chime", "ding", "pop", "marimba", "ringtone"];

type TNote = {
  /** Seconds after the start. */
  at: number;
  frequency: number;
  /** Seconds the note rings. */
  length: number;
  type?: OscillatorType;
  /** Relative loudness, 0 to 1. */
  level?: number;
};

// Tones are synthesised with Web Audio, so no audio files ship with the app.
const TONES: Record<TChatTone, TNote[]> = {
  chime: [
    { at: 0, frequency: 880, length: 0.2 },
    { at: 0.12, frequency: 1320, length: 0.2 },
  ],
  ding: [{ at: 0, frequency: 1568, length: 0.7, type: "triangle" }],
  pop: [
    { at: 0, frequency: 520, length: 0.09, type: "square", level: 0.5 },
    { at: 0.07, frequency: 780, length: 0.08, type: "square", level: 0.4 },
  ],
  marimba: [
    { at: 0, frequency: 659, length: 0.3, type: "triangle" },
    { at: 0.14, frequency: 784, length: 0.3, type: "triangle" },
    { at: 0.28, frequency: 988, length: 0.45, type: "triangle" },
  ],
  // About two seconds, so it can be heard from across the room.
  ringtone: [0, 0.5, 1, 1.5].flatMap((start) => [
    { at: start, frequency: 784, length: 0.16, type: "triangle" as const },
    { at: start + 0.18, frequency: 1047, length: 0.2, type: "triangle" as const },
  ]),
};

let audioContext: AudioContext | null = null;

const getContext = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  const AudioCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null;
  audioContext = audioContext ?? new AudioCtor();
  return audioContext;
};

/**
 * Browsers keep audio locked until the page has had a click or key press. Unlock it on the first
 * one so the very first incoming message can already ring. Returns a cleanup function.
 */
export const unlockChatAudio = (): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const remove = () => events.forEach((name) => window.removeEventListener(name, unlock));
  function unlock() {
    try {
      void getContext()?.resume();
    } catch {
      // Nothing to unlock.
    }
    remove();
  }
  events.forEach((name) => window.addEventListener(name, unlock, { passive: true }));
  return remove;
};

/** Peak gain for a 0 to 100 volume: a squared curve, so the slider feels even to the ear. */
export const toneGain = (volume: number): number => {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(volume) ? volume : 60));
  return 0.35 * (clamped / 100) ** 2;
};

export const playChatTone = (tone: TChatTone, volume: number) => {
  const peak = toneGain(volume);
  if (peak <= 0) return;
  try {
    const context = getContext();
    if (!context) return;
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime;
    for (const note of TONES[tone] ?? TONES.chime) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const level = Math.max(0.0001, peak * (note.level ?? 1));
      oscillator.type = note.type ?? "sine";
      oscillator.frequency.value = note.frequency;
      gain.gain.setValueAtTime(0.0001, start + note.at);
      gain.gain.exponentialRampToValueAtTime(level, start + note.at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + note.at);
      oscillator.stop(start + note.at + note.length + 0.02);
    }
  } catch {
    // Sound is a nicety; the browser may still block audio.
  }
};

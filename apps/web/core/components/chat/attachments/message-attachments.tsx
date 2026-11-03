/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Suspense, lazy, useState } from "react";
import { Download, FileText, ImageOff, Play } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TChatAttachment } from "@plane/types";
import { cn, convertBytesToSize, getFileURL } from "@plane/utils";

const ChatLightbox = lazy(() => import("./lightbox"));

/** Images shown in the grid before collapsing the rest into "+N". */
const GRID_LIMIT = 6;

export const formatDuration = (seconds: number | null | undefined) => {
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const absolute = (url: string | null | undefined) => (url ? (getFileURL(url) ?? url) : undefined);

type TFileCardProps = { attachment: TChatAttachment };

export function ChatFileCard({ attachment }: TFileCardProps) {
  const { t } = useTranslation();
  return (
    <a
      href={`${absolute(attachment.url)}?download=1`}
      className="flex w-72 max-w-full items-center gap-2.5 rounded-md border border-subtle bg-surface-1 py-2 pr-2 pl-2.5 hover:bg-layer-transparent-hover"
      aria-label={t("chat.media.download", { name: attachment.name })}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-layer-1 text-secondary">
        <FileText className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-13 font-medium text-primary">{attachment.name}</span>
        <span className="block text-11 text-tertiary">
          {attachment.name.split(".").pop()?.toUpperCase()} · {convertBytesToSize(attachment.size)}
        </span>
      </span>
      <Download className="size-4 shrink-0 text-tertiary" aria-hidden />
    </a>
  );
}

type TVisualProps = {
  attachment: TChatAttachment;
  onOpen: () => void;
  className?: string;
  overlay?: string | null;
};

function ChatImageTile({ attachment, onOpen, className, overlay }: TVisualProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const src = absolute(attachment.thumb_url) ?? absolute(attachment.url);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("chat.media.open_image", { name: attachment.name })}
      className={cn(
        "relative overflow-hidden rounded-md border border-subtle bg-layer-1 focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:outline-none",
        className
      )}
    >
      {failed ? (
        <span className="flex h-full min-h-24 w-full items-center justify-center text-tertiary">
          <ImageOff className="size-5" />
        </span>
      ) : (
        <img
          src={src}
          alt={attachment.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
      {overlay && (
        <span className="absolute inset-0 flex items-center justify-center bg-backdrop text-18 font-medium text-on-color">
          {overlay}
        </span>
      )}
    </button>
  );
}

function ChatVideoTile({ attachment, onOpen, className }: TVisualProps) {
  const { t } = useTranslation();
  const poster = absolute(attachment.thumb_url);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("chat.media.play_video", { name: attachment.name })}
      className={cn(
        "relative flex aspect-video items-center justify-center overflow-hidden rounded-md bg-inverse focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:outline-none",
        className
      )}
    >
      {poster ? (
        <img src={poster} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute bottom-2 left-2 max-w-[80%] truncate text-11 text-on-color">{attachment.name}</span>
      )}
      <span className="relative flex size-10 items-center justify-center rounded-full bg-surface-1/90 text-primary">
        <Play className="size-4 translate-x-px fill-current" />
      </span>
      {attachment.duration ? (
        <span className="absolute right-2 bottom-2 rounded-sm bg-backdrop px-1.5 text-11 text-on-color">
          {formatDuration(attachment.duration)}
        </span>
      ) : null}
    </button>
  );
}

type Props = {
  attachments: TChatAttachment[];
  /** Renders voice notes and audio files (PR 7 swaps in the waveform player). */
  renderAudio?: (attachment: TChatAttachment) => React.ReactNode;
};

/** Attachments under a message: image grid, videos, audio, then file cards. */
export function ChatMessageAttachments({ attachments, renderAudio }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (attachments.length === 0) return null;

  const visual = attachments.filter((item) => item.kind === "image" || item.kind === "video");
  const images = visual.filter((item) => item.kind === "image");
  const videos = visual.filter((item) => item.kind === "video");
  const audio = attachments.filter((item) => item.kind === "audio");
  const files = attachments.filter((item) => item.kind === "file");
  const open = (attachment: TChatAttachment) => setOpenIndex(visual.indexOf(attachment));

  const shownImages = images.slice(0, GRID_LIMIT);
  const hiddenCount = images.length - shownImages.length;
  const columns = images.length === 1 ? 1 : images.length === 2 || images.length === 4 ? 2 : 3;

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {shownImages.length > 0 && (
        <div
          className={cn("grid max-w-md gap-1", {
            "grid-cols-1": columns === 1,
            "grid-cols-2": columns === 2,
            "grid-cols-3": columns === 3,
          })}
        >
          {shownImages.map((attachment, index) => (
            <ChatImageTile
              key={attachment.id}
              attachment={attachment}
              onOpen={() => open(attachment)}
              className={columns === 1 ? "max-h-80 w-fit max-w-full" : "aspect-square"}
              overlay={index === shownImages.length - 1 && hiddenCount > 0 ? `+${hiddenCount}` : null}
            />
          ))}
        </div>
      )}
      {videos.map((attachment) => (
        <ChatVideoTile
          key={attachment.id}
          attachment={attachment}
          onOpen={() => open(attachment)}
          className="w-80 max-w-full"
        />
      ))}
      {audio.map((attachment) =>
        renderAudio ? (
          <div key={attachment.id}>{renderAudio(attachment)}</div>
        ) : (
          <audio key={attachment.id} controls preload="none" src={absolute(attachment.url)} className="w-72 max-w-full">
            <track kind="captions" />
          </audio>
        )
      )}
      {files.map((attachment) => (
        <ChatFileCard key={attachment.id} attachment={attachment} />
      ))}

      {openIndex !== null && openIndex >= 0 && (
        <Suspense fallback={null}>
          <ChatLightbox attachments={visual} index={openIndex} onClose={() => setOpenIndex(null)} />
        </Suspense>
      )}
    </div>
  );
}

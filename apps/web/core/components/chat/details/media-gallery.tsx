/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Suspense, lazy, useState } from "react";
import { useTranslation } from "@plane/i18n";
import type { TChatAttachment } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";

import { ChatMediaThumb } from "./media-thumb";

const ChatLightbox = lazy(() => import("../attachments/lightbox"));

type TFilter = "all" | "image" | "video";

type Props = { attachments: TChatAttachment[]; isOpen: boolean; onClose: () => void };

/** Every photo and video loaded in this conversation, newest first (P2 04-frontend.md § Polish). */
export function ChatMediaGallery({ attachments, isOpen, onClose }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<TFilter>("all");
  const [index, setIndex] = useState<number | null>(null);
  const items = filter === "all" ? attachments : attachments.filter((attachment) => attachment.kind === filter);

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.XXL}>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-18 font-medium text-primary">{t("chat.details.media")}</h3>
          <div role="radiogroup" aria-label={t("chat.media.filter")} className="flex gap-1">
            {(["all", "image", "video"] as TFilter[]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={filter === option}
                onClick={() => setFilter(option)}
                className={cn(
                  "h-7 rounded-full px-3 text-12 font-medium",
                  filter === option ? "bg-layer-3 text-primary" : "text-secondary hover:bg-layer-transparent-hover"
                )}
              >
                {t(`chat.media.filter_${option}`)}
              </button>
            ))}
          </div>
        </div>
        {items.length === 0 ? (
          <p className="py-10 text-center text-13 text-tertiary">{t("chat.details.no_media")}</p>
        ) : (
          <div className="vertical-scrollbar grid scrollbar-sm max-h-[60vh] grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
            {items.map((attachment, position) => {
              return (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => setIndex(position)}
                  aria-label={
                    attachment.kind === "video"
                      ? t("chat.media.play_video", { name: attachment.name })
                      : t("chat.media.open_image", { name: attachment.name })
                  }
                  className="relative aspect-square overflow-hidden rounded-md bg-layer-1"
                >
                  <ChatMediaThumb attachment={attachment} iconClassName="size-5" />
                </button>
              );
            })}
          </div>
        )}
        <p className="text-11 text-tertiary">{t("chat.media.loaded_only")}</p>
      </div>
      {index !== null && (
        <Suspense fallback={null}>
          <ChatLightbox attachments={items} index={index} onClose={() => setIndex(null)} />
        </Suspense>
      )}
    </ModalCore>
  );
}

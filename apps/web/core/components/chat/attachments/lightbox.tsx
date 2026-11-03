/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Loaded lazily the first time someone opens an image or video.
import { Lightbox } from "yet-another-react-lightbox";
import Video from "yet-another-react-lightbox/plugins/video";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
// oxlint-disable-next-line import/no-unassigned-import -- the lightbox stylesheet, loaded with this lazy chunk only
import "yet-another-react-lightbox/styles.css";
import type { TChatAttachment } from "@plane/types";
import { getFileURL } from "@plane/utils";

type Props = {
  attachments: TChatAttachment[];
  index: number;
  onClose: () => void;
};

export default function ChatLightbox({ attachments, index, onClose }: Props) {
  const slides = attachments.map((attachment) => {
    const src = getFileURL(attachment.url) ?? attachment.url;
    const poster = attachment.thumb_url ? getFileURL(attachment.thumb_url) : undefined;
    if (attachment.kind === "video") {
      return {
        type: "video" as const,
        poster,
        width: attachment.width ?? undefined,
        height: attachment.height ?? undefined,
        sources: [{ src, type: attachment.type }],
      };
    }
    return {
      src,
      alt: attachment.name,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
    };
  });

  return (
    <Lightbox
      open
      close={onClose}
      index={index}
      slides={slides}
      plugins={[Zoom, Video]}
      video={{ controls: true, playsInline: true, preload: "metadata" }}
      carousel={{ finite: slides.length <= 1 }}
      controller={{ closeOnBackdropClick: true }}
    />
  );
}

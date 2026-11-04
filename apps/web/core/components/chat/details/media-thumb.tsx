/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { ImageOff, Play } from "lucide-react";
import type { TChatAttachment } from "@plane/types";
import { cn, getFileURL } from "@plane/utils";

type Props = { attachment: TChatAttachment; iconClassName?: string };

/** Square thumbnail for the details panel and the gallery; a broken or missing image shows an icon, not the browser's. */
export function ChatMediaThumb({ attachment, iconClassName = "size-4" }: Props) {
  const [failed, setFailed] = useState(false);
  const src = attachment.thumb_url ?? (attachment.kind === "image" ? attachment.url : null);
  return (
    <>
      {src && !failed ? (
        <img
          src={getFileURL(src)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-tertiary">
          <ImageOff className={iconClassName} />
        </span>
      )}
      {attachment.kind === "video" && (
        <span className="absolute inset-0 flex items-center justify-center text-on-color">
          <Play className={cn("fill-current drop-shadow", iconClassName)} />
        </span>
      )}
    </>
  );
}

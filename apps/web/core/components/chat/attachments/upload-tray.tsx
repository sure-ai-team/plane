/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlertTriangle, FileText, Film, Mic, RotateCw, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { cn, convertBytesToSize } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import type { TUploadItem } from "@/store/chat";

type TItemProps = { item: TUploadItem };

const ChatUploadTrayItem = observer(function ChatUploadTrayItem({ item }: TItemProps) {
  const { t } = useTranslation();
  const chat = useChat();
  const failed = item.status === "failed";
  const ready = item.status === "ready";
  const busy = !failed && !ready;

  const statusText = failed
    ? (item.error?.error ?? t("chat.upload.failed"))
    : ready
      ? `${t("chat.upload.ready")} · ${convertBytesToSize(item.file.size)}`
      : item.status === "uploading"
        ? t("chat.upload.uploading", { percent: Math.round(item.progress * 100) })
        : item.status === "confirming"
          ? t("chat.upload.confirming")
          : t("chat.upload.preparing");

  const Icon = item.kind === "video" ? Film : item.kind === "audio" ? Mic : FileText;

  return (
    <div
      className={cn("relative flex w-44 shrink-0 flex-col gap-1 rounded-md border p-1.5", {
        "border-danger-subtle bg-danger-subtle": failed,
        "border-subtle bg-surface-1": !failed,
      })}
    >
      <div className="flex h-16 items-center justify-center overflow-hidden rounded-sm bg-layer-1 text-tertiary">
        {item.previewUrl ? (
          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
        ) : failed ? (
          <AlertTriangle className="size-5 text-danger-primary" />
        ) : (
          <Icon className="size-5" />
        )}
      </div>
      <span className="truncate text-12 font-medium text-primary" title={item.file.name}>
        {item.file.name}
      </span>
      <span
        className={cn(
          "truncate text-11",
          failed ? "text-danger-primary" : ready ? "text-success-primary" : "text-tertiary"
        )}
      >
        {statusText}
      </span>
      {busy && (
        <span className="h-1 overflow-hidden rounded-full bg-layer-1" aria-hidden>
          <span
            className="block h-full bg-accent-primary transition-[width]"
            style={{ width: `${Math.max(5, Math.round(item.progress * 100))}%` }}
          />
        </span>
      )}
      <div className="absolute top-2.5 right-2.5 flex gap-1">
        {failed && (
          <button
            type="button"
            onClick={() => void chat.upload.retry(item.localId)}
            aria-label={t("chat.upload.retry")}
            className="flex size-5 items-center justify-center rounded-sm bg-backdrop text-on-color hover:opacity-90"
          >
            <RotateCw className="size-3" />
          </button>
        )}
        <button
          type="button"
          onClick={() => chat.upload.remove(item.localId)}
          aria-label={t("chat.upload.remove", { name: item.file.name })}
          className="flex size-5 items-center justify-center rounded-sm bg-backdrop text-on-color hover:opacity-90"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
});

type Props = { conversationId: string };

export const ChatUploadTray = observer(function ChatUploadTray({ conversationId }: Props) {
  const chat = useChat();
  const items = chat.upload.forConversation(conversationId);
  if (items.length === 0) return null;
  return (
    <div className="horizontal-scrollbar flex scrollbar-sm gap-2 overflow-x-auto px-2 pt-2">
      {items.map((item) => (
        <ChatUploadTrayItem key={item.localId} item={item} />
      ))}
    </div>
  );
});

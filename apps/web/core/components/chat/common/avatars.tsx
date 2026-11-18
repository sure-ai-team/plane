/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Logo } from "@plane/propel/emoji-icon-picker";
import type { TChatConversation, TChatUser, TLogoProps } from "@plane/types";
import { Avatar } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";

type TPresenceDotProps = { online: boolean; className?: string };

export function PresenceDot({ online, className }: TPresenceDotProps) {
  if (!online) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success-primary shadow-[0_0_0_2px_var(--bg-surface-1)]",
        className
      )}
    />
  );
}

type TChatUserAvatarProps = {
  user: TChatUser | null | undefined;
  size?: "sm" | "md" | "base" | number;
  showPresence?: boolean;
  showTooltip?: boolean;
  className?: string;
};

export const ChatUserAvatar = observer(function ChatUserAvatar(props: TChatUserAvatarProps) {
  const { user, size = "md", showPresence = false, showTooltip = false, className } = props;
  const { realtime } = useChat();
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Avatar
        name={user?.display_name || "?"}
        src={user?.avatar_url ? getFileURL(user.avatar_url) : undefined}
        size={size}
        showTooltip={showTooltip}
      />
      {showPresence && <PresenceDot online={realtime.isOnline(user?.id)} />}
    </span>
  );
});

type TConversationAvatarProps = {
  conversation: TChatConversation;
  size?: number;
  showPresence?: boolean;
};

/** Direct chats show the other person; groups show their icon or initial on a tile. */
export const ConversationAvatar = observer(function ConversationAvatar(props: TConversationAvatarProps) {
  const { conversation, size = 24, showPresence = false } = props;
  if (conversation.type === "direct") {
    return <ChatUserAvatar user={conversation.direct_user} size={size} showPresence={showPresence} />;
  }
  const logo = conversation.logo_props as TLogoProps | undefined;
  const hasLogo = !!logo?.in_use && (!!logo.emoji?.value || !!logo.icon?.name);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md bg-layer-1 text-11 font-semibold text-secondary"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {hasLogo ? (
        <Logo logo={logo} size={Math.round(size * 0.6)} />
      ) : (
        (conversation.name.trim()[0] ?? "#").toUpperCase()
      )}
    </span>
  );
});

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import type { TChatConversation } from "@plane/types";
// components
import { ConversationAvatar } from "@/components/chat/common/avatars";
import { PowerKMenuBuilder } from "@/components/power-k/menus/builder";
// hooks
import { useChat } from "@/hooks/store/use-chat";

type Props = {
  handleSelect: (conversation: TChatConversation) => void;
};

/** Power K "Open conversation": direct chats by the other person's name, groups by name. */
export const PowerKOpenChatConversationMenu = observer(function PowerKOpenChatConversationMenu(props: Props) {
  const { handleSelect } = props;
  const chat = useChat();
  const conversations = [...chat.conversation.sorted, ...chat.conversation.archived];

  return (
    <PowerKMenuBuilder
      items={conversations}
      getKey={(conversation) => conversation.id}
      getIconNode={(conversation) => (
        <span className="shrink-0">
          <ConversationAvatar conversation={conversation} size={16} />
        </span>
      )}
      getValue={(conversation) => chat.conversation.displayName(conversation)}
      getLabel={(conversation) => chat.conversation.displayName(conversation)}
      onSelect={handleSelect}
      emptyText="No conversations found"
    />
  );
});

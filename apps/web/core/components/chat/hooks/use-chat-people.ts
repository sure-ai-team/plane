/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IWorkspaceMember } from "@plane/types";
import { useChat } from "@/hooks/store/use-chat";
import { useMember } from "@/hooks/store/use-member";
import { useUser } from "@/hooks/store/user";

/** Admins and members can chat; guests can't (decision D2). */
const CHAT_ROLES = new Set([15, 20]);

export type TChatPerson = IWorkspaceMember;

/**
 * Workspace members you can start a chat with: everyone active except you, guests and bots.
 * `withoutDirect` also drops people you already have a direct chat with, which the sidebar lists.
 * Sorted by display name. Computed per render: the member getters keep their identity, so a memo
 * would hold a list built before members loaded.
 */
export const useChatPeople = (workspaceSlug: string, options?: { withoutDirect?: boolean }): TChatPerson[] => {
  const chat = useChat();
  const { data: currentUser } = useUser();
  const {
    workspace: { getWorkspaceMemberIds, getWorkspaceMemberDetails },
  } = useMember();

  const withDirect = new Set<string>();
  if (options?.withoutDirect) {
    for (const conversation of chat.conversation.sorted) {
      if (conversation.type === "direct" && conversation.direct_user) withDirect.add(conversation.direct_user.id);
    }
  }

  const members = getWorkspaceMemberIds(workspaceSlug)
    .map((id) => getWorkspaceMemberDetails(id))
    .filter((details): details is NonNullable<typeof details> => !!details)
    .filter(
      (details) =>
        details.member.id !== currentUser?.id &&
        details.is_active !== false &&
        CHAT_ROLES.has(Number(details.role)) &&
        !details.member.is_bot &&
        !withDirect.has(details.member.id)
    );
  // `members` is a fresh array from filter(), so sorting it in place is safe.
  // oxlint-disable-next-line unicorn/no-array-sort
  return members.sort((a, b) => a.member.display_name.localeCompare(b.member.display_name));
};

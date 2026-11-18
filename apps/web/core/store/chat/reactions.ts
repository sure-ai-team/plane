/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TChatReactionSummary } from "@plane/types";

/** The API returns up to this many reactor ids per emoji. */
export const REACTION_USER_IDS_LIMIT = 10;

/**
 * Apply one reaction change to a summary list without mutating it.
 *
 * Idempotent: adding a reaction a user already has (or removing one they don't)
 * changes nothing, so an optimistic local update followed by the matching socket
 * event is counted once. Pass `count` (from a `reaction.updated` event) to take the
 * server's total as the source of truth.
 */
export const applyReaction = (
  reactions: TChatReactionSummary[],
  change: { emoji: string; userId: string; added: boolean; isMe: boolean; count?: number }
): TChatReactionSummary[] => {
  const { emoji, userId, added, isMe, count } = change;
  const index = reactions.findIndex((entry) => entry.emoji === emoji);
  const entry = index >= 0 ? reactions[index] : undefined;
  const alreadyThere = !!entry && (entry.user_ids.includes(userId) || (isMe && entry.reacted));

  let next: TChatReactionSummary | undefined;
  if (added) {
    if (!entry) {
      next = { emoji, count: 1, reacted: isMe, user_ids: [userId] };
    } else if (alreadyThere) {
      next = { ...entry, reacted: entry.reacted || isMe };
    } else {
      next = {
        ...entry,
        count: entry.count + 1,
        reacted: entry.reacted || isMe,
        user_ids: entry.user_ids.length < REACTION_USER_IDS_LIMIT ? [...entry.user_ids, userId] : entry.user_ids,
      };
    }
  } else if (entry) {
    next = alreadyThere
      ? {
          ...entry,
          count: entry.count - 1,
          reacted: isMe ? false : entry.reacted,
          user_ids: entry.user_ids.filter((id) => id !== userId),
        }
      : entry;
  }
  if (next && count !== undefined) next = { ...next, count };

  const result = [...reactions];
  if (!next || next.count <= 0) {
    if (index >= 0) result.splice(index, 1);
    return result;
  }
  if (index >= 0) result[index] = next;
  else result.push(next);
  return result;
};

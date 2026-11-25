/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ChatHub } from "@/chat/hub";
import type { TChatHubDeps } from "@/chat/hub";

export const STICKY_USER_CHANNEL_PREFIX = "sticky:user:";

/**
 * Forwards "this sticky changed" events to the people Django addresses them to
 * (plane/utils/sticky_events.py). It shares the socket handling of chat, but
 * works for guests and with chat turned off, and has no typing or presence.
 *
 * Any signed-in user may connect: events carry ids only, each goes to one
 * person, and Django picks who that is for every event.
 */
export const createStickyHub = (
  deps: Pick<TChatHubDeps, "authenticate" | "allowedOrigins" | "now" | "maxSocketsPerUser">
): ChatHub =>
  new ChatHub({
    ...deps,
    maxSocketsPerUser: deps.maxSocketsPerUser ?? 20,
    checkAccess: async () => "allowed",
    memberSource: { memberIds: async () => [] },
    // no presence: having a project open does not make someone online in chat
    getRedis: () => null,
    channels: { user: STICKY_USER_CHANNEL_PREFIX, workspace: null },
  });

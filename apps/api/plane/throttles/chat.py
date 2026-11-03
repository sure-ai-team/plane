# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework.throttling import UserRateThrottle


class ChatSendThrottle(UserRateThrottle):
    scope = "chat_send"


class ChatUploadThrottle(UserRateThrottle):
    scope = "chat_upload"


class ChatReadThrottle(UserRateThrottle):
    scope = "chat_read"

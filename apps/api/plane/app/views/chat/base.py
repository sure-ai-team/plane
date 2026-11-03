# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.utils.chat_config import get_chat_config

from .services import ChatError


class ChatBaseEndpoint(BaseAPIView):
    """Base for every chat endpoint.

    * Returns 404 ``CHAT_DISABLED`` when chat is turned off in Superadmin.
    * Turns ``ChatError`` into ``{"error", "code", ...}`` with its status code.
    """

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not get_chat_config().enabled:
            raise ChatError(status.HTTP_404_NOT_FOUND, "CHAT_DISABLED", "Chat is disabled.")

    def handle_exception(self, exc):
        if isinstance(exc, ChatError):
            return Response(exc.as_dict(), status=exc.status_code)
        return super().handle_exception(exc)

    @staticmethod
    def int_param(value, name, *, minimum=None, maximum=None, default=None):
        if value in (None, ""):
            return default
        try:
            number = int(value)
        except (TypeError, ValueError):
            raise ChatError(status.HTTP_400_BAD_REQUEST, "INVALID_PARAM", f"'{name}' must be a number.")
        if minimum is not None and number < minimum:
            number = minimum
        if maximum is not None and number > maximum:
            number = maximum
        return number

    @staticmethod
    def validated(serializer):
        if not serializer.is_valid():
            raise ChatError(
                status.HTTP_400_BAD_REQUEST,
                "INVALID_PAYLOAD",
                "Please check the request.",
                fields=serializer.errors,
            )
        return serializer.validated_data

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Core utilities for SURE Project Management Platform database routing and request scoping.
This package contains essential components for managing read replica routing
and request-scoped context in the SURE Project Management Platform application.
"""

from .dbrouters import ReadReplicaRouter
from .mixins import ReadReplicaControlMixin
from .request_scope import (
    set_use_read_replica,
    should_use_read_replica,
    clear_read_replica_context,
)

__all__ = [
    "ReadReplicaRouter",
    "ReadReplicaControlMixin",
    "set_use_read_replica",
    "should_use_read_replica",
    "clear_read_replica_context",
]

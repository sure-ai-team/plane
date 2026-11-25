/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/propel/empty-state";

export function UsersRestricted() {
  const { t } = useTranslation();
  return (
    <EmptyStateDetailed
      assetKey="no-access"
      title={t("users_work.restricted.title")}
      description={t("users_work.restricted.description")}
    />
  );
}

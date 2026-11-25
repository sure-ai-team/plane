/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
import { Users } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs, Header } from "@plane/ui";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";

export function UsersHeader() {
  const { workspaceSlug, userId } = useParams();
  const { t } = useTranslation();

  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label={t("users_work.label")}
                href={userId ? `/${workspaceSlug?.toString()}/users` : undefined}
                icon={<Users className="size-4 text-tertiary" />}
              />
            }
          />
          {userId && <Breadcrumbs.Item component={<BreadcrumbLink label={t("users_work.user_work")} isLast />} />}
        </Breadcrumbs>
      </Header.LeftItem>
    </Header>
  );
}

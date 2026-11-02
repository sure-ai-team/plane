/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { FileSpreadsheet, UserPlus, Users } from "lucide-react";
// plane imports
import { Tabs } from "@plane/propel/tabs";
// components
import { PageWrapper } from "@/components/common/page-wrapper";
// types
import type { Route } from "./+types/page";
// local
import { AddUserForm } from "./add-user-form";
import { AllUsers } from "./all-users";
import { BulkUserImport } from "./bulk-import";
import { getLoginUrl } from "./helpers";

function UsersPage(_props: Route.ComponentProps) {
  const loginUrl = useMemo(() => getLoginUrl(), []);

  return (
    <PageWrapper
      header={{
        title: "Users",
        description:
          "Manage every account on this instance: edit details, set passwords, control workspace and project access, deactivate or delete. New accounts get a temporary password that you send to the user yourself. No email is sent.",
      }}
    >
      <Tabs defaultValue="all">
        <Tabs.List className="flex w-fit rounded-md bg-layer-3 p-1">
          <Tabs.Trigger value="all" size="md">
            <Users className="size-3.5" />
            All users
          </Tabs.Trigger>
          <Tabs.Trigger value="single" size="md">
            <UserPlus className="size-3.5" />
            Add a user
          </Tabs.Trigger>
          <Tabs.Trigger value="bulk" size="md">
            <FileSpreadsheet className="size-3.5" />
            Import from file
          </Tabs.Trigger>
          <Tabs.Indicator />
        </Tabs.List>
        <Tabs.Content value="all">
          <AllUsers loginUrl={loginUrl} />
        </Tabs.Content>
        {/* keepMounted: switching tabs must not discard passwords that have not been sent yet. */}
        <Tabs.Content value="single" keepMounted>
          <AddUserForm loginUrl={loginUrl} />
        </Tabs.Content>
        <Tabs.Content value="bulk" keepMounted>
          <BulkUserImport loginUrl={loginUrl} />
        </Tabs.Content>
      </Tabs>
    </PageWrapper>
  );
}

export const meta: Route.MetaFunction = () => [{ title: "Users - Superadmin" }];

export default UsersPage;

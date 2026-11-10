/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { CalendarClock, HardDrive, History, ShieldCheck } from "lucide-react";
// plane imports
import { Tabs } from "@plane/propel/tabs";
// components
import { PageWrapper } from "@/components/common/page-wrapper";
// types
import type { Route } from "./+types/page";
// local
import { BackupDestinations } from "./destinations";
import { BackupOverview } from "./overview";
import { BackupScheduleForm } from "./schedule-form";
import { BackupSnapshots } from "./snapshots";

export type TBackupTab = "overview" | "backups" | "schedule" | "destinations";

function BackupPage(_props: Route.ComponentProps) {
  const [tab, setTab] = useState<TBackupTab>("overview");

  return (
    <PageWrapper
      header={{
        title: "Backup & restore",
        description:
          "Keep copies of everything on this instance (work items, pages, chat, settings and uploaded files) so you can recover from mistakes or a broken server.",
      }}
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as TBackupTab)}>
        <Tabs.List className="flex w-fit flex-wrap rounded-md bg-layer-3 p-1">
          <Tabs.Trigger value="overview" size="md">
            <ShieldCheck className="size-3.5" />
            Overview
          </Tabs.Trigger>
          <Tabs.Trigger value="backups" size="md">
            <History className="size-3.5" />
            Backups
          </Tabs.Trigger>
          <Tabs.Trigger value="schedule" size="md">
            <CalendarClock className="size-3.5" />
            Schedule
          </Tabs.Trigger>
          <Tabs.Trigger value="destinations" size="md">
            <HardDrive className="size-3.5" />
            Destinations
          </Tabs.Trigger>
          <Tabs.Indicator />
        </Tabs.List>
        <Tabs.Content value="overview">
          <BackupOverview onNavigate={setTab} />
        </Tabs.Content>
        <Tabs.Content value="backups">
          <BackupSnapshots />
        </Tabs.Content>
        <Tabs.Content value="schedule">
          <BackupScheduleForm />
        </Tabs.Content>
        <Tabs.Content value="destinations">
          <BackupDestinations />
        </Tabs.Content>
      </Tabs>
    </PageWrapper>
  );
}

export const meta: Route.MetaFunction = () => [{ title: "Backup & restore - Superadmin" }];

export default BackupPage;

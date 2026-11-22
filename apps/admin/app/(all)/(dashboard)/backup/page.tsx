/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { CalendarClock, HardDrive, History, LifeBuoy, ShieldCheck } from "lucide-react";
// components
import { PageWrapper } from "@/components/common/page-wrapper";
// types
import type { Route } from "./+types/page";
// local
import { BackupTabs } from "./backup-tabs";
import type { TBackupTabItem } from "./backup-tabs";
import { BackupDestinations } from "./destinations";
import { BackupOverview } from "./overview";
import { BackupRecovery } from "./recovery";
import { BackupScheduleForm } from "./schedule-form";
import { BackupSnapshots } from "./snapshots";

export type TBackupTab = "overview" | "backups" | "schedule" | "destinations" | "recovery";

const TABS: TBackupTabItem<TBackupTab>[] = [
  { key: "overview", label: "Overview", Icon: ShieldCheck },
  { key: "backups", label: "Backups", Icon: History },
  { key: "schedule", label: "Schedule", Icon: CalendarClock },
  { key: "destinations", label: "Destinations", Icon: HardDrive },
  { key: "recovery", label: "Server recovery", Icon: LifeBuoy },
];

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
      <BackupTabs tabs={TABS} value={tab} onChange={setTab} label="Backup & restore sections">
        {tab === "overview" && <BackupOverview onNavigate={setTab} />}
        {tab === "backups" && <BackupSnapshots />}
        {tab === "schedule" && <BackupScheduleForm />}
        {tab === "destinations" && <BackupDestinations />}
        {tab === "recovery" && <BackupRecovery />}
      </BackupTabs>
    </PageWrapper>
  );
}

export const meta: Route.MetaFunction = () => [{ title: "Backup & restore - Superadmin" }];

export default BackupPage;

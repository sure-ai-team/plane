/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { Loader2, Wrench } from "lucide-react";
// plane imports
import { MAINTENANCE_EVENT } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// local
import { stillPaused } from "./status";

const POLL_MS = 5000;

/**
 * Full-screen notice while an admin restores a backup. Appears when any API call answers
 * "maintenance", checks every few seconds, and reloads the page once the platform is back,
 * so nobody keeps working on data that is about to be replaced.
 */
export function MaintenanceScreen() {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);

  useEffect(() => {
    const show = () => setActive(true);
    window.addEventListener(MAINTENANCE_EVENT, show);
    return () => window.removeEventListener(MAINTENANCE_EVENT, show);
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const check = async () => {
      if (!(await stillPaused()) && !cancelled) window.location.reload();
    };
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="maintenance-title"
      aria-describedby="maintenance-description"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-canvas px-4"
    >
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-layer-2">
          <Wrench className="size-6 text-accent-primary" />
        </div>
        <h1 id="maintenance-title" className="text-20 font-semibold text-primary">
          {t("maintenance_mode.title")}
        </h1>
        <p id="maintenance-description" className="text-14 text-secondary">
          {t("maintenance_mode.description")}
        </p>
        <p className="flex items-center gap-2 text-13 text-tertiary" aria-live="polite">
          <Loader2 className="size-4 animate-spin" />
          {t("maintenance_mode.auto_reload")}
        </p>
      </div>
    </div>
  );
}

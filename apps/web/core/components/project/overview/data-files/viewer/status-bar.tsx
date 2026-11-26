/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
// local imports
import { createNumberFormatter } from "../helpers/format";
import type { TSelectionStats } from "../helpers/stats";

type Props = {
  stats: TSelectionStats | null;
  selectedCells: number;
};

/** Count / Sum / Average of the selection, like Excel's status bar. */
export function SpreadsheetStatusBar({ stats, selectedCells }: Props) {
  const { t, currentLocale } = useTranslation();
  const format = createNumberFormatter(currentLocale, 2);
  if (!stats || selectedCells < 2) return <div className="flex-shrink-0" aria-hidden />;

  return (
    <div className="flex flex-shrink-0 items-center gap-4 px-3 text-12 text-tertiary tabular-nums" aria-live="polite">
      <span>
        {t("spreadsheet.viewer.selection.count")}:{" "}
        <span className="font-medium text-primary">{format(stats.count)}</span>
      </span>
      {stats.numericCount > 0 && (
        <>
          <span>
            {t("spreadsheet.viewer.selection.sum")}:{" "}
            <span className="font-medium text-primary">{format(stats.sum)}</span>
          </span>
          {stats.avg !== null && (
            <span>
              {t("spreadsheet.viewer.selection.avg")}:{" "}
              <span className="font-medium text-primary">{format(stats.avg)}</span>
            </span>
          )}
        </>
      )}
    </div>
  );
}

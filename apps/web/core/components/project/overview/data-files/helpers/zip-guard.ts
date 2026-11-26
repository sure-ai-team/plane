/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { unzipSync } from "fflate";
import { SPREADSHEET_MAX_COMPRESSION_RATIO } from "./constants";
import { SpreadsheetError } from "./errors";

export type TZipInspection = {
  entries: number;
  /** sum of the uncompressed sizes declared in the central directory */
  uncompressedSize: number;
  hasWorkbook: boolean;
};

/** Reads the zip central directory without inflating any entry. */
export const inspectZip = (bytes: Uint8Array): TZipInspection => {
  let entries = 0;
  let uncompressedSize = 0;
  let hasWorkbook = false;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        uncompressedSize += file.originalSize;
        if (file.name === "xl/workbook.xml") hasWorkbook = true;
        return false;
      },
    });
  } catch {
    throw new SpreadsheetError("corrupt");
  }
  return { entries, uncompressedSize, hasWorkbook };
};

/**
 * Rejects archives that are not xlsx workbooks or that would inflate past
 * `maxRatio` × the file size (zip bombs) before exceljs ever touches them.
 */
export const assertSafeXlsx = (bytes: Uint8Array, maxRatio = SPREADSHEET_MAX_COMPRESSION_RATIO): TZipInspection => {
  const inspection = inspectZip(bytes);
  if (inspection.entries === 0 || !inspection.hasWorkbook) throw new SpreadsheetError("corrupt");
  if (inspection.uncompressedSize > bytes.byteLength * maxRatio)
    throw new SpreadsheetError("zip_bomb", { ratio: maxRatio });
  return inspection;
};

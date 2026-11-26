/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { createPortal } from "react-dom";
import { AlertTriangle, Download, FileDown, MoveRight, RefreshCw, Rows2, Rows3 } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { CenterPanelIcon, FullScreenPanelIcon, SidePanelIcon } from "@plane/propel/icons";
import { Switch } from "@plane/propel/switch";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import { CustomSelect } from "@plane/ui";
import { cn } from "@plane/utils";
// local imports
import { SpreadsheetDataGrid } from "../grid/data-grid";
import { estimateColumnWidths } from "../grid/layout";
import type { TGridDensity } from "../grid/layout";
import { getSelectionBounds, readSelection } from "../grid/selection";
import type { TCellAddress, TGridSelection } from "../grid/selection";
import { cellToText, columnLetter } from "../helpers/cells";
import { SPREADSHEET_ACCEPT } from "../helpers/constants";
import { buildTsv, toExportFileName } from "../helpers/export";
import { createNumberFormatter } from "../helpers/format";
import type { TSortDirection, TSpreadsheetFilter, TSpreadsheetSort } from "../helpers/query";
import { computeSelectionStats } from "../helpers/stats";
import { getProjectSpreadsheetService, useProjectSpreadsheets } from "../hooks/use-project-spreadsheets";
import { useSpreadsheetDocument } from "../hooks/use-spreadsheet-document";
import { useSpreadsheetSearch, useSpreadsheetView } from "../hooks/use-spreadsheet-view";
import { FileTypeBadge } from "../file-type-badge";
import { getSpreadsheetWorkerClient } from "../worker/client";
import { SpreadsheetColumnHeader } from "./column-header";
import { SpreadsheetFilterBar } from "./filter-bar";
import { SpreadsheetSearchBox } from "./search-box";
import { SpreadsheetSheetTabs } from "./sheet-tabs";
import { SpreadsheetGridSkeleton } from "./skeleton";
import { SpreadsheetStatusBar } from "./status-bar";

export type TSpreadsheetPeekMode = "side-peek" | "modal" | "full-screen";

const PEEK_MODES: { key: TSpreadsheetPeekMode; icon: typeof SidePanelIcon; i18n: string }[] = [
  { key: "side-peek", icon: SidePanelIcon, i18n: "common.side_peek" },
  { key: "modal", icon: CenterPanelIcon, i18n: "common.modal" },
  { key: "full-screen", icon: FullScreenPanelIcon, i18n: "common.full_screen" },
];

const PREFERENCES_KEY = "plane:data-files:viewer";

type TPreferences = { peekMode: TSpreadsheetPeekMode; density: TGridDensity };

const readPreferences = (): TPreferences => {
  const fallback: TPreferences = { peekMode: "modal", density: "compact" };
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<TPreferences>;
    return {
      peekMode: PEEK_MODES.some((mode) => mode.key === parsed.peekMode)
        ? (parsed.peekMode as TSpreadsheetPeekMode)
        : fallback.peekMode,
      density: parsed.density === "comfortable" ? "comfortable" : "compact",
    };
  } catch {
    return fallback;
  }
};

const writePreferences = (preferences: TPreferences) => {
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // storage may be unavailable; preferences are a convenience
  }
};

const iconButtonClassName =
  "flex size-7 flex-shrink-0 items-center justify-center rounded-md text-tertiary transition-colors duration-150 outline-none hover:bg-layer-transparent-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-strong disabled:pointer-events-none disabled:opacity-40";

type Props = {
  workspaceSlug: string;
  projectId: string;
  spreadsheetId: string;
  canEdit: boolean;
  onClose: () => void;
};

let filterCounter = 0;

export const SpreadsheetViewer = observer(function SpreadsheetViewer(props: Props) {
  const { workspaceSlug, projectId, spreadsheetId, canEdit, onClose } = props;
  const { t, currentLocale } = useTranslation();
  const store = useProjectSpreadsheets();
  const spreadsheet = store.getSpreadsheetById(spreadsheetId);
  const replaceUpload = store.getUploadForSpreadsheet(spreadsheetId);
  const gridId = useId().replace(/:/g, "");
  // refs
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  // preferences
  const [preferences, setPreferences] = useState<TPreferences>(() => readPreferences());
  const updatePreferences = (next: Partial<TPreferences>) =>
    setPreferences((previous) => {
      const merged = { ...previous, ...next };
      writePreferences(merged);
      return merged;
    });
  // document
  const { state, reload } = useSpreadsheetDocument(workspaceSlug, projectId, spreadsheet, store.setPreview);
  const data = state.status === "ready" ? state.data : null;
  const documentKey = state.status === "ready" ? state.key : null;
  // sheet-scoped state
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerOverrides, setHeaderOverrides] = useState<Record<number, boolean>>({});
  const [filters, setFilters] = useState<TSpreadsheetFilter[]>([]);
  const [sort, setSort] = useState<TSpreadsheetSort>(null);
  const [columnWidthsBySheet, setColumnWidthsBySheet] = useState<Record<number, number[]>>({});
  const [selection, setSelection] = useState<TGridSelection>(null);
  const [scrollNonce, setScrollNonce] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  const sheet = data?.workbook.sheets[sheetIndex];
  const headerRow = data ? (headerOverrides[sheetIndex] ?? data.headerGuess[sheetIndex] ?? false) : false;
  const columnTypes = useMemo(() => data?.columnTypes[sheetIndex] ?? [], [data, sheetIndex]);
  const columns = sheet?.columns ?? 0;

  // new document → start from the first sheet
  useEffect(() => {
    setSheetIndex(0);
    setHeaderOverrides({});
    setColumnWidthsBySheet({});
  }, [documentKey]);

  // new sheet → reset view state
  useEffect(() => {
    setFilters([]);
    setSort(null);
    setSelection(null);
    setActiveMatch(0);
  }, [documentKey, sheetIndex]);

  const columnWidths = useMemo(() => {
    if (!sheet) return [];
    return columnWidthsBySheet[sheetIndex] ?? estimateColumnWidths(sheet.rows, sheet.columns);
  }, [sheet, sheetIndex, columnWidthsBySheet]);

  const handleColumnResize = useCallback(
    (column: number, width: number) =>
      setColumnWidthsBySheet((previous) => {
        const current = previous[sheetIndex] ?? columnWidths;
        const next = [...current];
        next[column] = width;
        return { ...previous, [sheetIndex]: next };
      }),
    [sheetIndex, columnWidths]
  );

  const {
    view,
    isComputing,
    failed: viewFailed,
    query,
  } = useSpreadsheetView(documentKey, sheetIndex, headerRow, filters, sort);
  const search = useSpreadsheetSearch(query, searchTerm);
  const matchCount = search.matches.length / 2;

  const matchKeys = useMemo(() => {
    const keys = new Set<number>();
    for (let i = 0; i < search.matches.length; i += 2) keys.add(search.matches[i] * columns + search.matches[i + 1]);
    return keys;
  }, [search.matches, columns]);

  const getMatch = useCallback(
    (index: number): TCellAddress | null =>
      matchCount === 0 ? null : { row: search.matches[index * 2], column: search.matches[index * 2 + 1] },
    [search.matches, matchCount]
  );

  const goToMatch = useCallback(
    (index: number) => {
      if (matchCount === 0) return;
      const next = ((index % matchCount) + matchCount) % matchCount;
      setActiveMatch(next);
      const address = getMatch(next);
      if (address) {
        setSelection({ anchor: address, focus: address });
        setScrollNonce((value) => value + 1);
      }
    },
    [matchCount, getMatch]
  );

  // jump to the first match whenever results change
  useEffect(() => {
    setActiveMatch(0);
    if (matchCount > 0) goToMatch(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.matches]);

  // selection resets when the view changes underneath it
  useEffect(() => {
    setSelection(null);
  }, [view]);

  const handleSelectionChange = useCallback((next: TGridSelection) => {
    setSelection(next);
    setScrollNonce((value) => value + 1);
  }, []);

  const selectionValues = useMemo(() => {
    if (!selection || !sheet || !view) return null;
    return readSelection(sheet.rows, view, getSelectionBounds(selection));
  }, [selection, sheet, view]);

  const selectionStats = useMemo(
    () => (selectionValues ? computeSelectionStats(selectionValues.flat()) : null),
    [selectionValues]
  );
  const selectedCells = selection
    ? (() => {
        const bounds = getSelectionBounds(selection);
        return (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1);
      })()
    : 0;

  const handleCopy = useCallback(() => {
    if (!selectionValues) return;
    const text = buildTsv(selectionValues);
    const count = selectionValues.reduce((sum, row) => sum + row.length, 0);
    navigator.clipboard
      ?.writeText(text)
      .then(() => setToast({ type: TOAST_TYPE.SUCCESS, title: t("spreadsheet.viewer.copied", { count }) }))
      .catch(() => setToast({ type: TOAST_TYPE.ERROR, title: t("spreadsheet.errors.copy_failed") }));
  }, [selectionValues, t]);

  const getColumnTitle = useCallback(
    (column: number): string | null => {
      if (!headerRow || !sheet) return null;
      return cellToText(sheet.rows[0]?.[column] ?? null);
    },
    [headerRow, sheet]
  );

  const addFilter = useCallback((filter: Omit<TSpreadsheetFilter, "id">) => {
    filterCounter += 1;
    setFilters((previous) => [...previous, { ...filter, id: `filter-${filterCounter}` }]);
  }, []);

  const renderHeader = useCallback(
    (column: number) => (
      <SpreadsheetColumnHeader
        column={column}
        letter={columnLetter(column)}
        title={getColumnTitle(column)}
        type={columnTypes[column] ?? "text"}
        sort={sort}
        hasFilter={filters.some((filter) => filter.column === column)}
        query={query}
        onSort={(direction: TSortDirection | null) => setSort(direction ? { column, direction } : null)}
        onAddFilter={addFilter}
      />
    ),
    [getColumnTitle, columnTypes, sort, filters, query, addFilter]
  );

  const handleExport = async () => {
    if (!query || !spreadsheet || !sheet || !data) return;
    setIsExporting(true);
    try {
      const { csv } = await getSpreadsheetWorkerClient().request("export", query);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = toExportFileName(spreadsheet.name, sheet.name, data.workbook.sheets.length > 1);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("spreadsheet.errors.export_failed") });
    } finally {
      setIsExporting(false);
    }
  };

  const handleReplaceFile = (file: File | undefined) => {
    if (!file) return;
    const result = store.replaceSpreadsheet(workspaceSlug, projectId, spreadsheetId, file);
    if (!result.ok)
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("spreadsheet.errors.title"),
        message: t(`spreadsheet.errors.${result.error.code}`, result.error.params ?? {}),
      });
  };

  // Esc closes, Ctrl/Cmd+F focuses search
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      // let popovers, menus and dialogs close first
      if (
        document.querySelector(
          "[data-slot='popover-content'], [role='dialog'][aria-modal='true'], [role='menu'], [role='listbox']"
        )
      )
        return;
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const format = createNumberFormatter(currentLocale, 0);
  const currentMode = PEEK_MODES.find((mode) => mode.key === preferences.peekMode) ?? PEEK_MODES[1];
  const dataRowCount = sheet ? Math.max(0, sheet.rows.length - (headerRow ? 1 : 0)) : 0;
  const isFiltered = filters.length > 0;
  const portalContainer = typeof document !== "undefined" ? document.getElementById("full-screen-portal") : null;

  const renderBody = () => {
    if (!spreadsheet) {
      return (
        <ViewerMessage
          icon
          title={t("spreadsheet.viewer.not_found")}
          action={
            <Button variant="secondary" size="lg" onClick={onClose}>
              {t("close")}
            </Button>
          }
        />
      );
    }
    if (state.status === "error") {
      return (
        <ViewerMessage
          icon
          title={t("spreadsheet.viewer.load_failed")}
          description={t(`spreadsheet.errors.${state.error.code}`, state.error.params ?? {})}
          action={
            <div className="flex gap-2">
              {!["zip_bomb", "too_many_rows", "too_many_columns", "too_many_sheets", "unsupported_type"].includes(
                state.error.code
              ) && (
                <Button variant="secondary" size="lg" prependIcon={<RefreshCw />} onClick={reload}>
                  {t("common.retry")}
                </Button>
              )}
              <Button
                variant="secondary"
                size="lg"
                prependIcon={<Download />}
                onClick={() =>
                  window.open(
                    getProjectSpreadsheetService().getDownloadUrl(workspaceSlug, projectId, spreadsheetId),
                    "_blank",
                    "noopener"
                  )
                }
              >
                {t("spreadsheet.viewer.download")}
              </Button>
            </div>
          }
        />
      );
    }
    if (state.status === "loading" || !data || !sheet)
      return (
        <SpreadsheetGridSkeleton
          label={t(`spreadsheet.viewer.loading.${state.status === "loading" ? state.phase : "parse"}`)}
        />
      );
    if (viewFailed) {
      return (
        <ViewerMessage
          icon
          title={t("spreadsheet.viewer.load_failed")}
          action={
            <Button variant="secondary" size="lg" prependIcon={<RefreshCw />} onClick={reload}>
              {t("common.retry")}
            </Button>
          }
        />
      );
    }
    if (columns === 0 || (dataRowCount === 0 && !headerRow))
      return <ViewerMessage title={t("spreadsheet.viewer.empty_sheet")} />;
    if (!view) return <SpreadsheetGridSkeleton label={t("spreadsheet.viewer.loading.parse")} />;
    return (
      <div className="relative size-full">
        <SpreadsheetDataGrid
          gridId={gridId}
          ariaLabel={`${spreadsheet.name} — ${sheet.name}`}
          rows={sheet.rows}
          view={view}
          columns={columns}
          headerRow={headerRow}
          columnTypes={columnTypes}
          columnWidths={columnWidths}
          onColumnResize={handleColumnResize}
          density={preferences.density}
          renderHeader={renderHeader}
          selection={selection}
          onSelectionChange={handleSelectionChange}
          onCopy={handleCopy}
          searchTerm={searchTerm}
          matchKeys={matchKeys}
          activeMatch={getMatch(activeMatch)}
          scrollNonce={scrollNonce}
        />
        {view.length === 0 && isFiltered && (
          <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center">
            <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-lg border border-subtle bg-surface-1 px-5 py-4 text-center shadow-raised-100">
              <p className="text-13 text-secondary">{t("spreadsheet.viewer.no_rows_match")}</p>
              <Button variant="secondary" size="base" onClick={() => setFilters([])}>
                {t("spreadsheet.filter.clear_all")}
              </Button>
            </div>
          </div>
        )}
        {isComputing && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden>
            <div className="h-full w-1/3 animate-pulse bg-accent-primary" />
          </div>
        )}
      </div>
    );
  };

  const content = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={spreadsheet?.name ?? t("spreadsheet.title")}
      className={cn(
        "absolute z-[25] flex flex-col overflow-hidden rounded-sm border border-subtle bg-surface-1 shadow-raised-300 transition-all duration-200",
        {
          "top-0 right-0 bottom-0 w-full border-0 border-l md:w-[60%]": preferences.peekMode === "side-peek",
          "top-[5%] left-[5%] h-[90%] w-[90%] rounded-lg": preferences.peekMode === "modal",
          "inset-0 m-4 rounded-lg": preferences.peekMode === "full-screen",
        }
      )}
    >
      {/* toolbar */}
      <div className="flex flex-col gap-2 border-b border-subtle px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Tooltip tooltipContent={t("common.close_peek_view")}>
            <button
              type="button"
              className={iconButtonClassName}
              onClick={onClose}
              aria-label={t("common.close_peek_view")}
            >
              <MoveRight className="size-4" aria-hidden />
            </button>
          </Tooltip>
          <CustomSelect
            value={currentMode.key}
            onChange={(value: TSpreadsheetPeekMode) => updatePreferences({ peekMode: value })}
            customButton={
              <Tooltip tooltipContent={t("common.toggle_peek_view_layout")}>
                <span className={iconButtonClassName} aria-label={t("common.toggle_peek_view_layout")}>
                  <currentMode.icon className="size-4" />
                </span>
              </Tooltip>
            }
          >
            {PEEK_MODES.map((mode) => (
              <CustomSelect.Option key={mode.key} value={mode.key}>
                <div
                  className={cn(
                    "flex items-center gap-1.5",
                    currentMode.key === mode.key ? "text-secondary" : "text-placeholder hover:text-secondary"
                  )}
                >
                  <mode.icon className="-my-1 size-4 flex-shrink-0" />
                  {t(mode.i18n)}
                </div>
              </CustomSelect.Option>
            ))}
          </CustomSelect>
          <div className="mx-1 h-5 w-px bg-layer-3" aria-hidden />
          {spreadsheet && <FileTypeBadge name={spreadsheet.name} type={spreadsheet.type} size="sm" />}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-14 font-semibold text-primary" title={spreadsheet?.name}>
              {spreadsheet?.name}
            </h2>
            {data && sheet && (
              <p className="truncate text-11 text-tertiary">
                {[
                  data.workbook.sheets.length > 1
                    ? t("spreadsheet.card.sheets", { count: data.workbook.sheets.length })
                    : null,
                  view && isFiltered
                    ? t("spreadsheet.viewer.rows_filtered", {
                        visible: format(view.length),
                        total: format(dataRowCount),
                      })
                    : t("spreadsheet.card.rows", { count: dataRowCount }),
                  t("spreadsheet.viewer.columns", { count: columns }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          {replaceUpload && replaceUpload.status !== "ready" && (
            <span
              className={cn(
                "hidden flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-11 sm:flex",
                replaceUpload.status === "error" ? "bg-danger-subtle text-danger-primary" : "bg-layer-1 text-secondary"
              )}
            >
              {replaceUpload.status === "uploading" &&
                t("spreadsheet.status.uploading", { progress: replaceUpload.progress })}
              {replaceUpload.status === "processing" && t("spreadsheet.status.processing")}
              {replaceUpload.status === "error" && t("spreadsheet.status.failed")}
            </span>
          )}
          <Tooltip tooltipContent={t("spreadsheet.viewer.export")}>
            <button
              type="button"
              className={iconButtonClassName}
              onClick={() => void handleExport()}
              disabled={!query || isExporting}
              aria-label={t("spreadsheet.viewer.export")}
            >
              <FileDown className="size-4" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip tooltipContent={t("spreadsheet.viewer.download")}>
            <a
              className={iconButtonClassName}
              href={getProjectSpreadsheetService().getDownloadUrl(workspaceSlug, projectId, spreadsheetId)}
              aria-label={t("spreadsheet.viewer.download")}
            >
              <Download className="size-4" aria-hidden />
            </a>
          </Tooltip>
          {canEdit && spreadsheet && (
            <>
              <Tooltip tooltipContent={t("spreadsheet.actions.replace")}>
                <button
                  type="button"
                  className={iconButtonClassName}
                  onClick={() => replaceInputRef.current?.click()}
                  disabled={replaceUpload?.status === "uploading" || replaceUpload?.status === "processing"}
                  aria-label={t("spreadsheet.actions.replace")}
                >
                  <RefreshCw className="size-4" aria-hidden />
                </button>
              </Tooltip>
              <input
                ref={replaceInputRef}
                type="file"
                accept={SPREADSHEET_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  handleReplaceFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SpreadsheetSearchBox
            ref={searchRef}
            value={searchTerm}
            onChange={setSearchTerm}
            matchCount={matchCount}
            activeIndex={activeMatch}
            isSearching={search.isSearching}
            truncated={search.truncated}
            onNext={() => goToMatch(activeMatch + 1)}
            onPrevious={() => goToMatch(activeMatch - 1)}
            onEscape={() => {
              if (searchTerm) setSearchTerm("");
              else document.getElementById(gridId)?.focus();
            }}
          />
          <div className="ml-auto flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-12 text-secondary">
              <Switch
                value={headerRow}
                onChange={(value) => setHeaderOverrides((previous) => ({ ...previous, [sheetIndex]: value }))}
                label={t("spreadsheet.viewer.header_toggle")}
                disabled={!data}
              />
              <span className="hidden sm:inline">{t("spreadsheet.viewer.header_toggle")}</span>
            </label>
            <div
              role="radiogroup"
              aria-label={t("spreadsheet.viewer.density")}
              className="flex items-center rounded-md border border-subtle p-0.5"
            >
              {(
                [
                  { key: "compact", icon: Rows3, label: t("spreadsheet.viewer.compact") },
                  { key: "comfortable", icon: Rows2, label: t("spreadsheet.viewer.comfortable") },
                ] as const
              ).map((option) => (
                <Tooltip key={option.key} tooltipContent={option.label}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={preferences.density === option.key}
                    aria-label={option.label}
                    onClick={() => updatePreferences({ density: option.key })}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent-strong",
                      preferences.density === option.key
                        ? "bg-layer-3 text-primary"
                        : "text-tertiary hover:text-secondary"
                    )}
                  >
                    <option.icon className="size-3.5" aria-hidden />
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
        </div>
      </div>
      <SpreadsheetFilterBar
        filters={filters}
        sort={sort}
        getColumnTitle={getColumnTitle}
        onRemoveFilter={(id) => setFilters((previous) => previous.filter((filter) => filter.id !== id))}
        onClearSort={() => setSort(null)}
        onClearAll={() => {
          setFilters([]);
          setSort(null);
        }}
      />
      {/* grid */}
      <div className="relative min-h-0 flex-1 animate-fade-in">{renderBody()}</div>
      {/* footer: sheet tabs + selection stats */}
      <div className="flex min-h-9 items-stretch justify-between gap-2 border-t border-subtle bg-layer-1 pl-2">
        {data && data.workbook.sheets.length > 0 ? (
          <SpreadsheetSheetTabs sheets={data.workbook.sheets} activeSheet={sheetIndex} onChange={setSheetIndex} />
        ) : (
          <div className="flex-1" />
        )}
        <SpreadsheetStatusBar stats={selectionStats} selectedCells={selectedCells} />
      </div>
    </div>
  );

  return portalContainer ? createPortal(content, portalContainer) : content;
});

function ViewerMessage(props: { icon?: boolean; title: string; description?: string; action?: React.ReactNode }) {
  const { icon, title, description, action } = props;
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center" role="status">
      {icon && (
        <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-layer-1 text-tertiary">
          <AlertTriangle className="size-5" aria-hidden />
        </span>
      )}
      <p className="text-14 font-medium text-primary">{title}</p>
      {description && <p className="max-w-md text-13 text-tertiary">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

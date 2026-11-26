/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TSpreadsheetCellValue } from "@plane/types";
import { cn } from "@plane/utils";
// local imports
import { cellToText } from "../helpers/cells";
import type { TColumnType } from "../helpers/detect";
import { splitByMatch } from "../helpers/query";
import { clampColumnWidth, getHeaderHeight, getRowNumberWidth, ROW_HEIGHT } from "./layout";
import type { TGridDensity } from "./layout";
import type { TCellAddress, TGridSelection, TNavigationKey } from "./selection";
import { getSelectionBounds, moveFocus } from "./selection";

type Props = {
  gridId: string;
  ariaLabel: string;
  rows: TSpreadsheetCellValue[][];
  view: Uint32Array;
  columns: number;
  headerRow: boolean;
  columnTypes: TColumnType[];
  columnWidths: number[];
  onColumnResize: (column: number, width: number) => void;
  density: TGridDensity;
  renderHeader: (column: number) => ReactNode;
  selection: TGridSelection;
  onSelectionChange: (selection: TGridSelection) => void;
  onCopy: () => void;
  searchTerm: string;
  /** keys `position * columns + column` of cells that match the search */
  matchKeys: Set<number>;
  activeMatch: TCellAddress | null;
  /** bump to scroll the focus cell into view */
  scrollNonce: number;
};

const NAVIGATION_KEYS = new Set<string>([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export const cellDomId = (gridId: string, address: TCellAddress) => `${gridId}-r${address.row}-c${address.column}`;

function CellText({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = splitByMatch(text, term);
  if (parts.length === 1 && !parts[0].match) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          // oxlint-disable-next-line react/no-array-index-key
          <mark key={index} className="rounded-[2px] bg-warning-subtle text-primary">
            {part.text}
          </mark>
        ) : (
          // oxlint-disable-next-line react/no-array-index-key
          <span key={index}>{part.text}</span>
        )
      )}
    </>
  );
}

/**
 * Excel-like grid: sticky header row, sticky row numbers and a frozen first
 * column, with rows and columns virtualized independently.
 */
export function SpreadsheetDataGrid(props: Props) {
  const {
    gridId,
    ariaLabel,
    rows,
    view,
    columns,
    headerRow,
    columnTypes,
    columnWidths,
    onColumnResize,
    density,
    renderHeader,
    selection,
    onSelectionChange,
    onCopy,
    searchTerm,
    matchKeys,
    activeMatch,
    scrollNonce,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const rowHeight = ROW_HEIGHT[density];
  const headerHeight = getHeaderHeight(headerRow);
  const rowNumberWidth = getRowNumberWidth(rows.length);
  const frozenWidth = rowNumberWidth + (columnWidths[0] ?? 0);
  const totalWidth = useMemo(
    () => rowNumberWidth + columnWidths.reduce((sum, width) => sum + width, 0),
    [columnWidths, rowNumberWidth]
  );

  const rowVirtualizer = useVirtualizer({
    count: view.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
  });

  // column 0 is frozen and rendered outside the virtualizer
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: Math.max(0, columns - 1),
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => columnWidths[index + 1] ?? 120,
    overscan: 3,
    scrollMargin: frozenWidth,
    scrollPaddingStart: frozenWidth,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, headerHeight, rowVirtualizer]);

  useEffect(() => {
    columnVirtualizer.measure();
  }, [columnWidths, frozenWidth, columnVirtualizer]);

  // keep the focus cell visible after keyboard moves / search jumps
  useEffect(() => {
    if (!selection) return;
    const { row, column } = selection.focus;
    if (row < view.length) rowVirtualizer.scrollToIndex(row, { align: "auto" });
    if (column > 0) columnVirtualizer.scrollToIndex(column - 1, { align: "auto" });
    // only when the nonce changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollNonce]);

  useEffect(() => {
    const stop = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const leadingSpacer = virtualColumns.length > 0 ? virtualColumns[0].start - frozenWidth : 0;
  const visibleColumns = useMemo(
    () => [...(columns > 0 ? [0] : []), ...virtualColumns.map((item) => item.index + 1)],
    [columns, virtualColumns]
  );

  const bounds = selection ? getSelectionBounds(selection) : null;
  const focus = selection?.focus ?? null;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (view.length === 0 || columns === 0) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "c") {
      if (selection) {
        event.preventDefault();
        onCopy();
      }
      return;
    }
    if (modifier && event.key.toLowerCase() === "a") {
      event.preventDefault();
      onSelectionChange({ anchor: { row: 0, column: 0 }, focus: { row: view.length - 1, column: columns - 1 } });
      return;
    }
    if (!NAVIGATION_KEYS.has(event.key)) return;
    event.preventDefault();
    const current = selection?.focus ?? { row: 0, column: 0 };
    const viewportRows = Math.max(
      1,
      Math.floor(((scrollRef.current?.clientHeight ?? 400) - headerHeight) / rowHeight) - 1
    );
    const next = selection
      ? moveFocus(current, event.key as TNavigationKey, {
          rowCount: view.length,
          columnCount: columns,
          jump: modifier,
          pageSize: viewportRows,
        })
      : current;
    onSelectionChange({ anchor: event.shiftKey && selection ? selection.anchor : next, focus: next });
  };

  const handleCellMouseDown = (event: React.MouseEvent, address: TCellAddress) => {
    if (event.button !== 0) return;
    event.preventDefault();
    scrollRef.current?.focus({ preventScroll: true });
    draggingRef.current = true;
    if (event.shiftKey && selection) onSelectionChange({ anchor: selection.anchor, focus: address });
    else onSelectionChange({ anchor: address, focus: address });
  };

  const handleCellMouseEnter = (address: TCellAddress) => {
    if (!draggingRef.current || !selection) return;
    if (selection.focus.row === address.row && selection.focus.column === address.column) return;
    onSelectionChange({ anchor: selection.anchor, focus: address });
  };

  const startResize = useCallback(
    (event: React.PointerEvent, column: number) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = columnWidths[column] ?? 120;
      const handleMove = (moveEvent: PointerEvent) =>
        onColumnResize(column, clampColumnWidth(startWidth + moveEvent.clientX - startX));
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        document.body.style.removeProperty("cursor");
      };
      document.body.style.cursor = "col-resize";
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [columnWidths, onColumnResize]
  );

  const handleResizeKey = (event: ReactKeyboardEvent, column: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.key === "ArrowLeft" ? -16 : 16;
    onColumnResize(column, clampColumnWidth((columnWidths[column] ?? 120) + delta));
  };

  const frozenStyle = (column: number): CSSProperties | undefined =>
    column === 0 ? { position: "sticky", left: rowNumberWidth, zIndex: 1 } : undefined;

  const renderHeaderCell = (column: number) => (
    <div
      key={column}
      role="columnheader"
      aria-colindex={column + 2}
      className={cn(
        "group/header relative flex h-full flex-shrink-0 items-stretch border-r border-b border-subtle bg-layer-1",
        column === 0 && "shadow-[1px_0_0_0_var(--border-color-subtle)]"
      )}
      style={{ width: columnWidths[column], ...frozenStyle(column), ...(column === 0 ? { zIndex: 4 } : {}) }}
    >
      <div className="min-w-0 flex-1">{renderHeader(column)}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={columnWidths[column]}
        tabIndex={0}
        onPointerDown={(event) => startResize(event, column)}
        onKeyDown={(event) => handleResizeKey(event, column)}
        onDoubleClick={(event) => event.stopPropagation()}
        className="absolute top-0 -right-[3px] z-[1] h-full w-[6px] cursor-col-resize rounded-sm opacity-0 transition-opacity duration-150 group-hover/header:opacity-100 hover:bg-accent-primary focus-visible:bg-accent-primary focus-visible:opacity-100 focus-visible:outline-none"
      />
    </div>
  );

  const renderCell = (position: number, rowIndex: number, column: number) => {
    const value = rows[rowIndex]?.[column] ?? null;
    const address = { row: position, column };
    const isSelected =
      !!bounds &&
      position >= bounds.top &&
      position <= bounds.bottom &&
      column >= bounds.left &&
      column <= bounds.right;
    const isFocus = !!focus && focus.row === position && focus.column === column;
    const isMatch = matchKeys.size > 0 && matchKeys.has(position * columns + column);
    const isActiveMatch = !!activeMatch && activeMatch.row === position && activeMatch.column === column;
    const text = cellToText(value);
    const isNumber = typeof value === "number" || (columnTypes[column] === "number" && value !== null);
    return (
      <div
        key={column}
        id={cellDomId(gridId, address)}
        role="gridcell"
        aria-colindex={column + 2}
        aria-selected={isSelected}
        title={text.length > 24 ? text : undefined}
        onMouseDown={(event) => handleCellMouseDown(event, address)}
        onMouseEnter={() => handleCellMouseEnter(address)}
        className={cn(
          "relative flex h-full flex-shrink-0 items-center overflow-hidden border-r border-b border-subtle bg-surface-1 px-2 text-13 whitespace-nowrap text-primary select-none",
          isNumber && "justify-end tabular-nums",
          typeof value === "boolean" && "justify-center text-12 font-medium text-secondary",
          column === 0 && "shadow-[1px_0_0_0_var(--border-color-subtle)]",
          isMatch && "bg-warning-subtle",
          isSelected && "bg-accent-subtle",
          isActiveMatch && "outline outline-2 -outline-offset-2 outline-warning-strong",
          isFocus && "outline outline-2 -outline-offset-2 outline-accent-strong"
        )}
        style={{ width: columnWidths[column], ...frozenStyle(column) }}
      >
        <span className="truncate">
          <CellText text={text} term={isMatch ? searchTerm : ""} />
        </span>
      </div>
    );
  };

  const activeDescendant = focus && focus.row < view.length ? cellDomId(gridId, focus) : undefined;

  return (
    <div
      ref={scrollRef}
      id={gridId}
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={view.length + 1}
      aria-colcount={columns + 1}
      aria-multiselectable
      aria-activedescendant={activeDescendant}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="relative size-full overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-inset"
    >
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        {/* header */}
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-[3] flex"
          style={{ height: headerHeight, width: totalWidth }}
        >
          <div
            className="sticky left-0 z-[5] flex-shrink-0 border-r border-b border-subtle bg-layer-1"
            style={{ width: rowNumberWidth }}
            aria-hidden
          />
          {columns > 0 && renderHeaderCell(0)}
          {leadingSpacer > 0 && <div className="flex-shrink-0" style={{ width: leadingSpacer }} aria-hidden />}
          {visibleColumns.slice(1).map((column) => renderHeaderCell(column))}
        </div>
        {/* body */}
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- virtualized div grid: absolutely positioned rows can't live in a <tbody> */}
        <div role="rowgroup" className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
          {virtualRows.map((virtualRow) => {
            const position = virtualRow.index;
            const rowIndex = view[position];
            const rowSelected = !!bounds && position >= bounds.top && position <= bounds.bottom;
            return (
              <div
                key={virtualRow.key}
                role="row"
                aria-rowindex={position + 2}
                className="absolute top-0 left-0 flex"
                style={{
                  height: rowHeight,
                  width: totalWidth,
                  transform: `translateY(${virtualRow.start - headerHeight}px)`,
                }}
              >
                <div
                  role="rowheader"
                  className={cn(
                    "sticky left-0 z-[2] flex h-full flex-shrink-0 items-center justify-end border-r border-b border-subtle bg-layer-1 pr-2 text-11 text-tertiary tabular-nums select-none",
                    rowSelected && "bg-layer-1-selected font-medium text-secondary"
                  )}
                  style={{ width: rowNumberWidth }}
                >
                  {rowIndex + 1}
                </div>
                {columns > 0 && renderCell(position, rowIndex, 0)}
                {leadingSpacer > 0 && <div className="flex-shrink-0" style={{ width: leadingSpacer }} aria-hidden />}
                {visibleColumns.slice(1).map((column) => renderCell(position, rowIndex, column))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

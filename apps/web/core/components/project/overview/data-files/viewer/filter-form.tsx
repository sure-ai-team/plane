/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useId, useState } from "react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
// local imports
import type { TColumnType } from "../helpers/detect";
import { NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS, VALUELESS_OPERATORS } from "../helpers/query";
import type { TSpreadsheetFilterOperator } from "../helpers/query";

type Props = {
  type: TColumnType;
  onSubmit: (operator: TSpreadsheetFilterOperator, value: string) => void;
  onCancel: () => void;
};

export function FilterForm({ type, onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const isNumeric = type === "number" || type === "date";
  const operators = isNumeric ? NUMBER_FILTER_OPERATORS : TEXT_FILTER_OPERATORS;
  const [operator, setOperator] = useState<TSpreadsheetFilterOperator>(isNumeric ? "equals" : "contains");
  const [value, setValue] = useState("");
  const operatorId = useId();
  const valueId = useId();
  const needsValue = !VALUELESS_OPERATORS.includes(operator);
  const canSubmit = !needsValue || value.trim() !== "";

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(operator, needsValue ? value : "");
      }}
    >
      <label htmlFor={operatorId} className="sr-only">
        {t("spreadsheet.filter.operator")}
      </label>
      <select
        id={operatorId}
        value={operator}
        onChange={(event) => setOperator(event.target.value as TSpreadsheetFilterOperator)}
        className="h-7 w-full rounded-md border border-subtle bg-surface-1 px-2 text-13 text-primary outline-none focus-visible:border-accent-strong"
      >
        {operators.map((option) => (
          <option key={option} value={option}>
            {t(`spreadsheet.filter.operators.${option}`)}
          </option>
        ))}
      </select>
      {needsValue && (
        <>
          <label htmlFor={valueId} className="sr-only">
            {t("spreadsheet.filter.value")}
          </label>
          <input
            id={valueId}
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={value}
            inputMode={type === "number" ? "decimal" : undefined}
            placeholder={t("spreadsheet.filter.value")}
            onChange={(event) => setValue(event.target.value)}
            className="h-7 w-full rounded-md border border-subtle bg-surface-1 px-2 text-13 text-primary outline-none placeholder:text-placeholder focus-visible:border-accent-strong"
          />
        </>
      )}
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="base" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" size="base" disabled={!canSubmit}>
          {t("spreadsheet.filter.apply")}
        </Button>
      </div>
    </form>
  );
}

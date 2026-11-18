/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
import type { TPageTransferFormat } from "@plane/types";
import { CustomSelect } from "@plane/ui";
// local imports
import { PAGE_TRANSFER_FORMATS } from "./helpers/formats";

type Props = {
  value: TPageTransferFormat;
  onChange: (value: TPageTransferFormat) => void;
  disabled?: boolean;
};

export function PageTransferFormatSelect(props: Props) {
  const { value, onChange, disabled = false } = props;
  const { t } = useTranslation();

  return (
    <CustomSelect
      label={t(`pages_transfer.formats.${value}`)}
      value={value}
      onChange={(next: TPageTransferFormat) => onChange(next)}
      buttonClassName="border-[0.5px] border-subtle"
      placement="bottom-end"
      disabled={disabled}
    >
      {PAGE_TRANSFER_FORMATS.map((format) => (
        <CustomSelect.Option key={format} value={format}>
          <div className="flex flex-col">
            <span>{t(`pages_transfer.formats.${format}`)}</span>
            <span className="text-11 text-tertiary">{t(`pages_transfer.format_hints.${format}`)}</span>
          </div>
        </CustomSelect.Option>
      ))}
    </CustomSelect>
  );
}

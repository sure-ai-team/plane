/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** Maps app language codes to BCP 47 tags understood by Intl. */
export const toIntlLocale = (locale: string | undefined): string | undefined => {
  if (!locale) return undefined;
  if (locale === "ua") return "uk";
  return locale;
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

/** "3 hours ago", localized with Intl.RelativeTimeFormat. */
export const formatRelativeTime = (date: string | Date, locale?: string, now: number = Date.now()): string => {
  const time = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((time - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(toIntlLocale(locale), { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === "second") {
      const value = Math.round(seconds / size);
      if (unit === "second" && Math.abs(value) < 45) return formatter.format(0, "second");
      return formatter.format(value, unit);
    }
  }
  return "";
};

export const createNumberFormatter = (locale: string | undefined, maximumFractionDigits = 2) => {
  const formatter = new Intl.NumberFormat(toIntlLocale(locale), { maximumFractionDigits });
  return (value: number) => (Number.isFinite(value) ? formatter.format(value) : "–");
};

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TBackupFrequency, TBackupSchedule, TBackupSchedulePayload } from "@plane/types";
import { CustomSearchSelect, CustomSelect, Loader, ToggleSwitch } from "@plane/ui";
import { cn } from "@plane/utils";
// local
import {
  FREQUENCY_OPTIONS,
  KEEP_LAST_OPTIONS,
  WEEKDAYS,
  browserTimezone,
  describeSchedule,
  formatDateTime,
  getErrorMessage,
  getFieldErrors,
  pad,
  relativeTime,
  timezoneOptions,
} from "./helpers";
import { backupService, refreshBackupData, useBackupSchedule } from "./use-backup";

type TForm = Required<TBackupSchedulePayload>;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = [0, 15, 30, 45];
const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, index) => index + 1);

function toForm(schedule: TBackupSchedule): TForm {
  // A schedule that was never set up still has the server default (UTC); suggest the admin's own time zone.
  const neverConfigured = !schedule.is_enabled && !schedule.last_run_at && schedule.timezone === "UTC";
  return {
    is_enabled: schedule.is_enabled,
    frequency: schedule.frequency,
    hour: schedule.hour,
    minute: schedule.minute,
    weekday: schedule.weekday,
    day_of_month: schedule.day_of_month,
    timezone: neverConfigured ? browserTimezone() : schedule.timezone,
    include_files: schedule.include_files,
    keep_last: schedule.keep_last,
  };
}

/** Roughly how far back the kept automatic backups reach. */
function historySpan(frequency: TBackupFrequency, keep: number): string {
  const hours = { every_6_hours: 6, every_12_hours: 12, daily: 24, weekly: 168, monthly: 730 }[frequency] * keep;
  if (hours < 48) return `about ${hours} hours`;
  const days = Math.round(hours / 24);
  if (days < 60) return `about ${days} days`;
  return `about ${Math.round(days / 30)} months`;
}

export function BackupScheduleForm() {
  const { data: schedule, isLoading, mutate } = useBackupSchedule();
  const [form, setForm] = useState<TForm | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (schedule) setForm(toForm(schedule));
  }, [schedule]);

  const timezones = useMemo(
    () =>
      timezoneOptions(form?.timezone ?? "", browserTimezone()).map((zone) => ({
        value: zone,
        query: zone,
        content: zone,
      })),
    [form?.timezone]
  );

  if (isLoading || !schedule || !form) {
    return (
      <Loader className="flex flex-col gap-4 py-6">
        <Loader.Item height="72px" />
        <Loader.Item height="160px" />
      </Loader>
    );
  }

  const initial = toForm(schedule);
  const isDirty = (Object.keys(form) as (keyof TForm)[]).some((key) => form[key] !== initial[key]);
  const update = <K extends keyof TForm>(key: K, value: TForm[K]) => setForm({ ...form, [key]: value });
  const isEveryHours = form.frequency === "every_6_hours" || form.frequency === "every_12_hours";

  const handleSave = async () => {
    setIsSaving(true);
    setErrors({});
    try {
      const saved = await backupService.updateSchedule(form);
      await mutate(saved, { revalidate: false });
      await refreshBackupData();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Schedule saved",
        message: saved.is_enabled
          ? `Next automatic backup ${relativeTime(saved.next_run_at)}.`
          : "Automatic backups are off.",
      });
    } catch (error) {
      setErrors(getFieldErrors(error));
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't save", message: getErrorMessage(error) });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 py-6">
      <div className="flex items-start justify-between gap-6 rounded-lg border border-subtle bg-layer-1 p-4">
        <div className="flex flex-col gap-1">
          <h4 className="text-14 font-medium text-primary">Automatic backups</h4>
          <p className="text-12 text-tertiary">
            {schedule.is_enabled && schedule.next_run_at
              ? `On. Next backup ${relativeTime(schedule.next_run_at)} (${formatDateTime(schedule.next_run_at)}).`
              : "Off. Turn this on so backups happen without anyone having to remember."}
          </p>
        </div>
        <ToggleSwitch value={form.is_enabled} onChange={(value) => update("is_enabled", value)} disabled={isSaving} />
      </div>

      <fieldset className={cn("flex flex-col gap-8", !form.is_enabled && "opacity-60")} disabled={isSaving}>
        <section className="flex flex-col gap-3">
          <div>
            <h4 className="text-14 font-medium text-primary">How often</h4>
            <p className="text-12 text-tertiary">More often means less work lost if something goes wrong.</p>
          </div>
          <div role="radiogroup" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {FREQUENCY_OPTIONS.map((option) => {
              const selected = form.frequency === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => update("frequency", option.key)}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                    selected
                      ? "border-accent-strong bg-accent-subtle"
                      : "border-subtle bg-layer-1 hover:bg-layer-1-hover"
                  )}
                >
                  <span className="text-13 font-medium text-primary">{option.label}</span>
                  <span className="text-12 text-tertiary">{option.hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h4 className="text-14 font-medium text-primary">When</h4>
            <p className="text-12 text-tertiary">
              Pick a quiet time, such as at night. People can keep working during a backup, but it uses some of the
              server&apos;s capacity.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            {form.frequency === "weekly" && (
              <Field label="Day of the week" error={errors.weekday}>
                <CustomSelect
                  value={form.weekday}
                  label={WEEKDAYS[form.weekday]}
                  onChange={(value: number) => update("weekday", value)}
                  buttonClassName="rounded-md border-subtle w-40"
                  input
                >
                  {WEEKDAYS.map((day, index) => (
                    <CustomSelect.Option key={day} value={index}>
                      {day}
                    </CustomSelect.Option>
                  ))}
                </CustomSelect>
              </Field>
            )}
            {form.frequency === "monthly" && (
              <Field label="Day of the month" error={errors.day_of_month}>
                <CustomSelect
                  value={form.day_of_month}
                  label={String(form.day_of_month)}
                  onChange={(value: number) => update("day_of_month", value)}
                  buttonClassName="rounded-md border-subtle w-28"
                  maxHeight="lg"
                  input
                >
                  {DAYS_OF_MONTH.map((day) => (
                    <CustomSelect.Option key={day} value={day}>
                      {day}
                    </CustomSelect.Option>
                  ))}
                </CustomSelect>
              </Field>
            )}
            <Field label={isEveryHours ? "Starting at" : "Time"} error={errors.hour || errors.minute}>
              <div className="flex items-center gap-1">
                <CustomSelect
                  value={form.hour}
                  label={pad(form.hour)}
                  onChange={(value: number) => update("hour", value)}
                  buttonClassName="rounded-md border-subtle w-20"
                  maxHeight="lg"
                  input
                >
                  {HOURS.map((hour) => (
                    <CustomSelect.Option key={hour} value={hour}>
                      {pad(hour)}
                    </CustomSelect.Option>
                  ))}
                </CustomSelect>
                <span className="text-tertiary">:</span>
                <CustomSelect
                  value={form.minute}
                  label={pad(form.minute)}
                  onChange={(value: number) => update("minute", value)}
                  buttonClassName="rounded-md border-subtle w-20"
                  input
                >
                  {Array.from(new Set([...MINUTES, form.minute]))
                    // A fresh array; the admin app targets ES2022, so no toSorted.
                    // oxlint-disable-next-line unicorn/no-array-sort
                    .sort((a, b) => a - b)
                    .map((minute) => (
                      <CustomSelect.Option key={minute} value={minute}>
                        {pad(minute)}
                      </CustomSelect.Option>
                    ))}
                </CustomSelect>
              </div>
            </Field>
            <Field label="Time zone" error={errors.timezone}>
              <CustomSearchSelect
                value={form.timezone}
                label={form.timezone}
                options={timezones}
                onChange={(value: string) => update("timezone", value)}
                buttonClassName="rounded-md border-subtle w-64"
                maxHeight="lg"
                input
              />
            </Field>
          </div>
          <p className="text-13 text-secondary">{describeSchedule(form)}</p>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h4 className="text-14 font-medium text-primary">What to include</h4>
          </div>
          <div className="flex items-start justify-between gap-6 rounded-lg border border-subtle bg-layer-1 p-4">
            <div className="flex flex-col gap-1">
              <span className="text-13 font-medium text-primary">Uploaded files</span>
              <span className="text-12 text-tertiary">
                Attachments, images and chat files. Recommended. Only files added since the last backup are copied, so
                this stays quick after the first time.
              </span>
            </div>
            <ToggleSwitch value={form.include_files} onChange={(value) => update("include_files", value)} />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h4 className="text-14 font-medium text-primary">How many to keep</h4>
            <p className="text-12 text-tertiary">
              Older automatic backups are deleted to save space. Backups you start yourself and pinned backups are
              always kept.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <CustomSelect
              value={form.keep_last}
              label={`Keep the last ${form.keep_last}`}
              onChange={(value: number) => update("keep_last", value)}
              buttonClassName="rounded-md border-subtle w-48"
              input
            >
              {Array.from(new Set([...KEEP_LAST_OPTIONS, form.keep_last]))
                // A fresh array; the admin app targets ES2022, so no toSorted.
                // oxlint-disable-next-line unicorn/no-array-sort
                .sort((a, b) => a - b)
                .map((count) => (
                  <CustomSelect.Option key={count} value={count}>
                    Keep the last {count}
                  </CustomSelect.Option>
                ))}
            </CustomSelect>
            <span className="text-13 text-secondary">
              That is {historySpan(form.frequency, form.keep_last)} of history.
            </span>
          </div>
          {errors.keep_last && <span className="text-12 text-danger-primary">{errors.keep_last}</span>}
        </section>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          onClick={() => void handleSave()}
          loading={isSaving}
          disabled={!isDirty || isSaving}
        >
          {isSaving ? "Saving" : "Save schedule"}
        </Button>
        {isDirty && (
          <Button variant="secondary" size="lg" onClick={() => setForm(initial)} disabled={isSaving}>
            Discard changes
          </Button>
        )}
      </div>
    </div>
  );
}

function Field(props: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-13 text-tertiary">{props.label}</span>
      {props.children}
      {props.error && <span className="text-12 text-danger-primary">{props.error}</span>}
    </div>
  );
}

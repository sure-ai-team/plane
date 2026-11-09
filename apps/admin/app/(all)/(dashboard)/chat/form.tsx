/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Controller, useForm } from "react-hook-form";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IFormattedInstanceConfiguration, TInstanceChatConfigurationKeys } from "@plane/types";
import { Input, ToggleSwitch } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useInstance } from "@/hooks/store";

type TChatConfigFormValues = Record<TInstanceChatConfigurationKeys, string>;

type TLimitField = {
  key: Exclude<TInstanceChatConfigurationKeys, "CHAT_ENABLED">;
  label: string;
  description: string;
  min: number;
  max: number;
  fallback: string;
};

// Bounds match plane/utils/chat_config.py (hard caps the API enforces).
const LIMIT_FIELDS: TLimitField[] = [
  {
    key: "CHAT_MAX_IMAGE_MB",
    label: "Max image size (MB)",
    description: "PNG, JPEG, WebP and GIF.",
    min: 1,
    max: 2048,
    fallback: "10",
  },
  {
    key: "CHAT_MAX_VIDEO_MB",
    label: "Max video size (MB)",
    description: "MP4, WebM and MOV.",
    min: 1,
    max: 2048,
    fallback: "200",
  },
  {
    key: "CHAT_MAX_AUDIO_MB",
    label: "Max audio size (MB)",
    description: "Voice notes and audio files.",
    min: 1,
    max: 2048,
    fallback: "25",
  },
  {
    key: "CHAT_MAX_FILE_MB",
    label: "Max file size (MB)",
    description: "Documents and other files.",
    min: 1,
    max: 2048,
    fallback: "50",
  },
  {
    key: "CHAT_MAX_FILES_PER_MESSAGE",
    label: "Max files per message",
    description: "How many attachments one message can carry.",
    min: 1,
    max: 50,
    fallback: "10",
  },
  {
    key: "CHAT_MAX_VOICE_SECONDS",
    label: "Max voice note length (seconds)",
    description: "Recording stops automatically at this length.",
    min: 1,
    max: 3600,
    fallback: "300",
  },
];

type Props = {
  config: IFormattedInstanceConfiguration;
};

export function InstanceChatConfigForm(props: Props) {
  const { config } = props;
  // store hooks
  const { updateInstanceConfigurations } = useInstance();
  // form
  const {
    handleSubmit,
    control,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<TChatConfigFormValues>({
    defaultValues: {
      CHAT_ENABLED: config.CHAT_ENABLED ?? "1",
      ...Object.fromEntries(LIMIT_FIELDS.map((field) => [field.key, config[field.key] ?? field.fallback])),
    } as TChatConfigFormValues,
  });

  const onSubmit = async (formData: TChatConfigFormValues) => {
    try {
      await updateInstanceConfigurations(formData);
      reset(formData);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Saved", message: "Chat settings updated." });
    } catch (error) {
      console.error(error);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save",
        message: "Check the values and try again.",
      });
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-6 rounded-lg border border-subtle bg-layer-1 p-4">
        <div className="flex flex-col gap-1">
          <h4 className="text-14 font-medium text-primary">Enable chat</h4>
          <p className="text-12 text-tertiary">
            When off, the Chat section is hidden for everyone and chat requests are refused. Messages and files are
            kept.
          </p>
        </div>
        <Controller
          control={control}
          name="CHAT_ENABLED"
          render={({ field: { value, onChange } }) => (
            <ToggleSwitch
              value={value === "1"}
              onChange={() => onChange(value === "1" ? "0" : "1")}
              size="sm"
              disabled={isSubmitting}
            />
          )}
        />
      </div>

      <div className="space-y-3">
        <div>
          <h4 className="text-14 font-medium text-primary">Attachment limits</h4>
          <p className="text-12 text-tertiary">
            Applies to every workspace on this instance. Changes apply right away.
          </p>
        </div>
        <div className="grid w-full grid-cols-1 gap-x-12 gap-y-6 lg:grid-cols-3">
          {LIMIT_FIELDS.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <label htmlFor={field.key} className="text-13 text-tertiary">
                {field.label}
              </label>
              <Controller
                control={control}
                name={field.key}
                rules={{
                  required: `${field.label} is required.`,
                  validate: (value) => {
                    const number = Number(value);
                    if (!Number.isInteger(number)) return "Use a whole number.";
                    if (number < field.min || number > field.max) {
                      return `Must be between ${field.min} and ${field.max}.`;
                    }
                    return true;
                  },
                }}
                render={({ field: { value, onChange, ref } }) => (
                  <Input
                    id={field.key}
                    name={field.key}
                    type="number"
                    inputMode="numeric"
                    min={field.min}
                    max={field.max}
                    step={1}
                    value={value}
                    onChange={onChange}
                    ref={ref}
                    hasError={Boolean(errors[field.key])}
                    className={cn("w-full rounded-md font-medium")}
                  />
                )}
              />
              <p className={cn("pt-0.5 text-11", errors[field.key] ? "text-danger-primary" : "text-tertiary")}>
                {errors[field.key]?.message ?? field.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Button
          variant="primary"
          size="lg"
          onClick={handleSubmit(onSubmit)}
          loading={isSubmitting}
          disabled={!isDirty || isSubmitting}
        >
          {isSubmitting ? "Saving" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import type { IWorkspace, TBulkUserRole } from "@plane/types";
import { CustomSelect } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useWorkspace } from "@/hooks/store";
// local
import { ROLE_OPTIONS } from "./helpers";

export const NO_WORKSPACE = "";

export const DISCARD_PASSWORDS_PROMPT =
  "The temporary passwords on this page are not saved anywhere. Discard them anyway?";

/** Every workspace on the instance, sorted by name. The list endpoint pages 10 at a time. */
export function useAllWorkspaces(): IWorkspace[] {
  const { workspaceIds, getWorkspaceById, fetchWorkspaces, fetchNextWorkspaces } = useWorkspace();

  useSWR("INSTANCE_WORKSPACES_ALL", async () => {
    await fetchWorkspaces();
    let page = await fetchNextWorkspaces();
    // Each page needs the previous page's cursor, so the requests must run one after another.
    // oxlint-disable-next-line no-await-in-loop
    while (page.length > 0) page = await fetchNextWorkspaces();
    return true;
  });

  return (
    workspaceIds
      .map((id) => getWorkspaceById(id))
      .filter((item): item is IWorkspace => Boolean(item))
      // Sorting the fresh array from filter() in place; toSorted() is not in this app's target lib.
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort((a, b) => a.name.localeCompare(b.name))
  );
}

/** Passwords are not stored anywhere; warn before they are lost with the page. */
export function useUnsavedPasswordsWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}

type TWorkspaceSelectProps = {
  label: string;
  value: string;
  onChange: (slug: string) => void;
};

export const WorkspaceSelect = observer(function WorkspaceSelect(props: TWorkspaceSelectProps) {
  const { label, value, onChange } = props;
  const workspaces = useAllWorkspaces();
  const selectedName = workspaces.find((item) => item.slug === value)?.name;

  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-13 text-tertiary">{label}</h4>
      <CustomSelect
        value={value}
        label={selectedName ?? "No workspace"}
        onChange={onChange}
        buttonClassName="rounded-md border-subtle"
        input
      >
        <CustomSelect.Option value={NO_WORKSPACE} className="w-full">
          No workspace
        </CustomSelect.Option>
        {workspaces.map((item) => (
          <CustomSelect.Option key={item.id} value={item.slug} className="w-full">
            {item.name}
          </CustomSelect.Option>
        ))}
      </CustomSelect>
    </div>
  );
});

type TRoleSelectProps = {
  label: string;
  value: TBulkUserRole;
  onChange: (role: TBulkUserRole) => void;
};

export function RoleSelect(props: TRoleSelectProps) {
  const { label, value, onChange } = props;
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-13 text-tertiary">{label}</h4>
      <CustomSelect
        value={value}
        label={ROLE_OPTIONS.find((option) => option.key === value)?.label}
        onChange={onChange}
        buttonClassName="rounded-md border-subtle"
        input
      >
        {ROLE_OPTIONS.map((option) => (
          <CustomSelect.Option key={option.key} value={option.key} className="w-full">
            {option.label}
          </CustomSelect.Option>
        ))}
      </CustomSelect>
    </div>
  );
}

type TStepProps = { number: number; title: string; description: string; children: React.ReactNode };

export function Step(props: TStepProps) {
  const { number, title, description, children } = props;
  return (
    <section className="flex gap-4 border-b border-subtle py-6 last:border-b-0">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-layer-3 text-13 font-medium text-secondary">
        {number}
      </div>
      <div className="flex min-w-0 grow flex-col gap-3">
        <div>
          <div className="text-14 font-medium text-primary">{title}</div>
          <div className="text-13 text-tertiary">{description}</div>
        </div>
        {children}
      </div>
    </section>
  );
}

type TPasswordNoticeProps = { saved: boolean; savedText: string; unsavedText: string };

export function PasswordNotice(props: TPasswordNoticeProps) {
  const { saved, savedText, unsavedText } = props;
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-13",
        saved
          ? "border-subtle bg-layer-1 text-secondary"
          : "border-warning-subtle bg-warning-subtle text-warning-primary"
      )}
    >
      {saved ? savedText : unsavedText}
    </div>
  );
}

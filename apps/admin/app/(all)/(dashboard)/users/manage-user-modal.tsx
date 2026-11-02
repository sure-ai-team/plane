/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import useSWR from "swr";
import { ChevronDown, ChevronRight, Save, Trash2, UserCheck, UserX } from "lucide-react";
// plane imports
import { Badge } from "@plane/propel/badge";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { InstanceService } from "@plane/services";
import type {
  TBulkUserRole,
  TInstanceUserDetail,
  TInstanceUserUpdatePayload,
  TInstanceUserWorkspace,
} from "@plane/types";
import { CustomSelect, EModalWidth, Input, Loader, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
// local
import { ROLE_LABELS, ROLE_OPTIONS, allowedProjectRoles, formatDate, getErrorMessage, getFullName } from "./helpers";
import { RoleSelect, WorkspaceSelect } from "./shared";
import { DeleteUserModal, PasswordForm, SetActiveModal } from "./user-modals";

const instanceService = new InstanceService();

const DETAIL_FIELDS: { key: keyof TInstanceUserUpdatePayload; label: string; type: string; ltr?: boolean }[] = [
  { key: "first_name", label: "First name", type: "text" },
  { key: "last_name", label: "Last name", type: "text" },
  { key: "display_name", label: "Display name", type: "text" },
  { key: "email", label: "Email", type: "email", ltr: true },
  { key: "phone", label: "Phone", type: "tel", ltr: true },
];

type TDetails = Required<TInstanceUserUpdatePayload>;

function detailsOf(user: TInstanceUserDetail): TDetails {
  return {
    first_name: user.first_name,
    last_name: user.last_name,
    display_name: user.display_name,
    email: user.email,
    phone: user.phone,
  };
}

type TSectionProps = { title: string; description?: string; children: React.ReactNode };

function Section(props: TSectionProps) {
  const { title, description, children } = props;
  return (
    <section className="flex flex-col gap-3 border-b border-subtle px-5 py-4 last:border-b-0">
      <div>
        <div className="text-14 font-medium text-primary">{title}</div>
        {description && <div className="text-13 text-tertiary">{description}</div>}
      </div>
      {children}
    </section>
  );
}

type TRoleDropdownProps = {
  value: TBulkUserRole | null;
  options: TBulkUserRole[];
  onChange: (role: TBulkUserRole) => void;
  disabled?: boolean;
  noneLabel?: string;
};

function RoleDropdown(props: TRoleDropdownProps) {
  const { value, options, onChange, disabled, noneLabel = "Not a member" } = props;
  return (
    <CustomSelect
      value={value}
      label={value ? ROLE_LABELS[value] : <span className="text-placeholder">{noneLabel}</span>}
      onChange={onChange}
      buttonClassName="rounded-md border-subtle min-w-32"
      disabled={disabled}
      input
    >
      {options.map((role) => (
        <CustomSelect.Option key={role} value={role} className="w-full">
          {ROLE_LABELS[role]}
        </CustomSelect.Option>
      ))}
    </CustomSelect>
  );
}

type TWorkspaceRowProps = {
  userId: string;
  workspace: TInstanceUserWorkspace;
  onUpdated: (user: TInstanceUserDetail) => void;
};

function WorkspaceRow(props: TWorkspaceRowProps) {
  const { userId, workspace, onUpdated } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const memberOf = workspace.projects.filter((project) => project.role).length;

  const run = async (key: string, action: () => Promise<TInstanceUserDetail>, success: string) => {
    setBusy(key);
    try {
      onUpdated(await action());
      setToast({ type: TOAST_TYPE.SUCCESS, title: success });
    } catch (err) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Could not save the change", message: getErrorMessage(err) });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="rounded-md border border-subtle">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 grow items-center gap-2 text-left"
          onClick={() => setIsOpen((value) => !value)}
          disabled={!workspace.is_active}
          aria-expanded={isOpen}
        >
          {workspace.is_active ? (
            isOpen ? (
              <ChevronDown className="size-3.5 shrink-0 text-tertiary" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-tertiary" />
            )
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <span className={cn("truncate text-13 font-medium", !workspace.is_active && "text-placeholder")}>
            {workspace.name}
          </span>
          {workspace.is_owner && <Badge variant="brand">Owner</Badge>}
          {!workspace.is_active && <Badge variant="neutral">Suspended</Badge>}
          {workspace.is_active && (
            <span className="text-12 text-tertiary">
              {memberOf} of {workspace.projects.length} projects
            </span>
          )}
        </button>
        {workspace.is_active ? (
          <>
            <RoleDropdown
              value={workspace.role}
              options={ROLE_OPTIONS.map((option) => option.key)}
              disabled={Boolean(busy)}
              onChange={(role) =>
                void run(
                  "role",
                  () => instanceService.updateUserWorkspaceRole(userId, workspace.slug, role),
                  `Workspace role changed to ${ROLE_LABELS[role]}`
                )
              }
            />
            <Button
              variant="ghost"
              size="lg"
              loading={busy === "remove"}
              disabled={Boolean(busy)}
              onClick={() => {
                if (!window.confirm(`Remove this user from ${workspace.name} and all its projects?`)) return;
                void run(
                  "remove",
                  () => instanceService.removeUserFromWorkspace(userId, workspace.slug),
                  `Removed from ${workspace.name}`
                );
              }}
            >
              Remove
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="lg"
            loading={busy === "restore"}
            onClick={() =>
              void run(
                "restore",
                () => instanceService.addUserToWorkspace(userId, workspace.slug, workspace.role),
                `Restored in ${workspace.name}`
              )
            }
          >
            Restore as {ROLE_LABELS[workspace.role]}
          </Button>
        )}
      </div>

      {isOpen && workspace.is_active && (
        <div className="flex flex-col border-t border-subtle">
          {workspace.projects.length === 0 ? (
            <div className="px-9 py-3 text-13 text-tertiary">This workspace has no projects.</div>
          ) : (
            workspace.projects.map((project) => (
              <div
                key={project.id}
                className="flex flex-wrap items-center gap-3 border-b border-subtle py-1.5 pr-3 pl-9 last:border-b-0"
              >
                <div className="min-w-0 grow truncate text-13">
                  <span className="text-tertiary">{project.identifier}</span>{" "}
                  <span className={cn(!project.role && "text-tertiary")}>{project.name}</span>
                </div>
                <RoleDropdown
                  value={project.role}
                  options={allowedProjectRoles(workspace.role)}
                  disabled={Boolean(busy)}
                  onChange={(role) =>
                    void run(
                      project.id,
                      () => instanceService.setUserProjectRole(userId, project.id, role),
                      project.role ? `Project role changed to ${ROLE_LABELS[role]}` : `Added to ${project.name}`
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="lg"
                  className={cn(!project.role && "invisible")}
                  disabled={Boolean(busy) || !project.role}
                  loading={busy === `remove-${project.id}`}
                  onClick={() =>
                    void run(
                      `remove-${project.id}`,
                      () => instanceService.removeUserFromProject(userId, project.id),
                      `Removed from ${project.name}`
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

type TAddWorkspaceProps = { user: TInstanceUserDetail; onUpdated: (user: TInstanceUserDetail) => void };

function AddWorkspace(props: TAddWorkspaceProps) {
  const { user, onUpdated } = props;
  const [slug, setSlug] = useState("");
  const [role, setRole] = useState<TBulkUserRole>("member");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAdd = async () => {
    if (!slug) return;
    setIsSubmitting(true);
    try {
      onUpdated(await instanceService.addUserToWorkspace(user.id, slug, role));
      setSlug("");
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Added to the workspace" });
    } catch (err) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Could not add the user", message: getErrorMessage(err) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-56">
        <WorkspaceSelect
          label="Add to workspace"
          value={slug}
          onChange={setSlug}
          emptyLabel="Choose a workspace"
          exclude={user.workspaces.map((workspace) => workspace.slug)}
        />
      </div>
      <div className="w-40">
        <RoleSelect label="Role" value={role} onChange={setRole} />
      </div>
      <Button variant="secondary" size="lg" disabled={!slug} loading={isSubmitting} onClick={() => void handleAdd()}>
        Add
      </Button>
    </div>
  );
}

type Props = {
  userId: string | null;
  loginUrl: string;
  onClose: () => void;
  /** Called after any change, so the list behind the dialog can refresh. */
  onChanged: () => void;
  onDeleted: () => void;
};

export function ManageUserModal(props: Props) {
  const { userId, loginUrl, onClose, onChanged, onDeleted } = props;
  const [details, setDetails] = useState<TDetails | null>(null);
  const [detailsError, setDetailsError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [confirm, setConfirm] = useState<"activation" | "delete" | null>(null);

  const { data: user, mutate } = useSWR(userId ? ["INSTANCE_USER", userId] : null, () =>
    instanceService.getUser(userId as string)
  );

  useEffect(() => {
    if (user) setDetails(detailsOf(user));
  }, [user]);

  useEffect(() => {
    if (!userId) {
      setDetails(null);
      setDetailsError("");
      setConfirm(null);
    }
  }, [userId]);

  const applyUpdate = (updated: TInstanceUserDetail) => {
    void mutate(updated, { revalidate: false });
    onChanged();
  };

  const changed = Boolean(
    user && details && (Object.keys(details) as (keyof TDetails)[]).some((key) => details[key] !== detailsOf(user)[key])
  );

  const handleSave = async () => {
    if (!user || !details) return;
    const original = detailsOf(user);
    const payload: TInstanceUserUpdatePayload = {};
    (Object.keys(details) as (keyof TDetails)[]).forEach((key) => {
      if (details[key] !== original[key]) payload[key] = details[key].trim();
    });
    setIsSaving(true);
    setDetailsError("");
    try {
      applyUpdate(await instanceService.updateUser(user.id, payload));
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Details saved" });
    } catch (err) {
      setDetailsError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const name = user ? getFullName(user) || user.display_name || user.email : "";

  return (
    <>
      <ModalCore isOpen={Boolean(userId) && !confirm} handleClose={onClose} width={EModalWidth.XXXXL}>
        {!user || !details ? (
          <Loader className="flex flex-col gap-3 p-5">
            <Loader.Item height="32px" width="40%" />
            <Loader.Item height="120px" width="100%" />
            <Loader.Item height="120px" width="100%" />
          </Loader>
        ) : (
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-subtle px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-16 font-medium">{name}</h3>
                <div className="text-13 text-tertiary" dir="ltr">
                  {user.email}
                </div>
                <div className="mt-1 text-12 text-tertiary">
                  Joined {formatDate(user.date_joined)} · Last sign-in {formatDate(user.last_login_time)}
                </div>
              </div>
              <div className="flex gap-1">
                <Badge variant={user.is_active ? "success" : "neutral"}>
                  {user.is_active ? "Active" : "Deactivated"}
                </Badge>
                {user.is_instance_admin && <Badge variant="brand">Instance admin</Badge>}
              </div>
            </div>

            <div className="overflow-y-auto">
              <Section title="Details">
                <form
                  className="flex flex-col gap-3"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSave();
                  }}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {DETAIL_FIELDS.map((field) => (
                      <div key={field.key} className="flex flex-col gap-1">
                        <label htmlFor={`edit-user-${field.key}`} className="text-13 text-tertiary">
                          {field.label}
                        </label>
                        <Input
                          id={`edit-user-${field.key}`}
                          type={field.type}
                          value={details[field.key]}
                          onChange={(event) => {
                            setDetails({ ...details, [field.key]: event.target.value });
                            setDetailsError("");
                          }}
                          dir={field.ltr ? "ltr" : undefined}
                          autoComplete="off"
                          className="w-full"
                        />
                      </div>
                    ))}
                  </div>
                  {detailsError && <div className="text-13 text-danger-primary">{detailsError}</div>}
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      prependIcon={<Save />}
                      disabled={!changed}
                      loading={isSaving}
                    >
                      Save details
                    </Button>
                    {changed && (
                      <Button variant="ghost" size="lg" onClick={() => setDetails(detailsOf(user))}>
                        Discard
                      </Button>
                    )}
                  </div>
                </form>
              </Section>

              <Section
                title="Workspaces and projects"
                description="Change roles, add or remove the user. Removing someone shows them as Suspended in that workspace."
              >
                {user.workspaces.length === 0 ? (
                  <div className="text-13 text-tertiary">This user is not in any workspace.</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {user.workspaces.map((workspace) => (
                      <WorkspaceRow key={workspace.id} userId={user.id} workspace={workspace} onUpdated={applyUpdate} />
                    ))}
                  </div>
                )}
                {user.is_active ? (
                  <AddWorkspace user={user} onUpdated={applyUpdate} />
                ) : (
                  <div className="text-13 text-tertiary">Reactivate the account to change its workspace access.</div>
                )}
              </Section>

              {user.is_active && (
                <Section
                  title="Password"
                  description="Set a new password and send it to the user yourself. No email is sent."
                >
                  <PasswordForm key={user.id} user={user} loginUrl={loginUrl} />
                </Section>
              )}

              <Section title="Account">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={user.is_active ? "error-outline" : "secondary"}
                    size="lg"
                    prependIcon={user.is_active ? <UserX /> : <UserCheck />}
                    onClick={() => setConfirm("activation")}
                  >
                    {user.is_active ? "Deactivate account" : "Reactivate account"}
                  </Button>
                  <Button variant="error-fill" size="lg" prependIcon={<Trash2 />} onClick={() => setConfirm("delete")}>
                    Delete permanently
                  </Button>
                </div>
                <div className="text-12 text-tertiary">
                  Deactivating blocks sign-in and keeps all history; it can be undone. Deleting removes the account and
                  data tied to it for good.
                </div>
              </Section>
            </div>
          </div>
        )}
      </ModalCore>

      <SetActiveModal
        user={confirm === "activation" && user ? user : null}
        onClose={() => setConfirm(null)}
        onDone={() => {
          void mutate();
          onChanged();
        }}
      />
      <DeleteUserModal
        user={confirm === "delete" && user ? user : null}
        onClose={() => setConfirm(null)}
        onDone={onDeleted}
      />
    </>
  );
}

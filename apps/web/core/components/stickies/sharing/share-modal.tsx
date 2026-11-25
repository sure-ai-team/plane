/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Lock, Users } from "lucide-react";
// plane imports
import { EUserPermissions } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { CloseIcon, ProjectIcon } from "@plane/propel/icons";
import type { TSticky, TStickyPermission, TStickyShare } from "@plane/types";
import { EStickyAccess } from "@plane/types";
import { Avatar, CustomSelect, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
// local imports
import { useStickyOperations } from "../sticky/use-operations";

type Props = {
  workspaceSlug: string;
  projectId: string;
  sticky: TSticky;
  handleClose: () => void;
};

const ACCESS_OPTIONS = [
  { value: EStickyAccess.PRIVATE, key: "private", icon: Lock },
  { value: EStickyAccess.MEMBERS, key: "members", icon: Users },
  { value: EStickyAccess.PROJECT, key: "project", icon: ProjectIcon },
] as const;

type TPermissionSelectProps = {
  value: TStickyPermission;
  onChange: (value: TStickyPermission) => void;
  label: string;
};

function PermissionSelect(props: TPermissionSelectProps) {
  const { value, onChange, label } = props;
  // plane hooks
  const { t } = useTranslation();

  return (
    <CustomSelect
      value={value}
      onChange={onChange}
      label={<span aria-label={label}>{t(`stickies.sharing.permission.${value}`)}</span>}
      buttonClassName="border-none px-2 py-1 text-12"
      placement="bottom-end"
    >
      {(["view", "edit"] as const).map((permission) => (
        <CustomSelect.Option key={permission} value={permission}>
          {t(`stickies.sharing.permission.${permission}`)}
        </CustomSelect.Option>
      ))}
    </CustomSelect>
  );
}

/** Mounted only while open, so it always starts from the saved sharing. */
export const ShareStickyModal = observer(function ShareStickyModal(props: Props) {
  const { workspaceSlug, projectId, sticky, handleClose } = props;
  // states
  const [access, setAccess] = useState<EStickyAccess>(sticky.access ?? EStickyAccess.PRIVATE);
  const [projectPermission, setProjectPermission] = useState<TStickyPermission>(sticky.project_permission ?? "view");
  const [shares, setShares] = useState<TStickyShare[]>(() =>
    (sticky.shares ?? []).map(({ member_id, permission }) => ({ member_id, permission }))
  );
  const [query, setQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const {
    project: { getProjectMemberIds, getProjectMemberDetails },
  } = useMember();
  const { getPartialProjectById } = useProject();
  const { data: currentUser } = useUser();
  // sticky operations
  const { stickyOperations } = useStickyOperations({ workspaceSlug, projectId });
  // derived values
  const areGuestsExcluded = getPartialProjectById(projectId)?.guest_view_all_features === false;
  const isOwner = sticky.owner === currentUser?.id;
  const hasPeople = access !== EStickyAccess.PRIVATE;
  const isIncomplete = access === EStickyAccess.MEMBERS && shares.length === 0;
  const isGuest = (memberId: string) =>
    Number(getProjectMemberDetails(memberId, projectId)?.role) === Number(EUserPermissions.GUEST);
  const search = query.trim().toLowerCase();
  // not memoised: the observer renders again when the members are loaded
  const candidates = (getProjectMemberIds(projectId, true) ?? [])
    .filter((id) => id !== sticky.owner && !shares.some((share) => share.member_id === id))
    .map((id) => getProjectMemberDetails(id, projectId)?.member)
    .filter((member): member is NonNullable<typeof member> => !!member && !member.is_bot)
    .filter((member) =>
      `${member.display_name} ${member.first_name} ${member.last_name}`.toLowerCase().includes(search)
    );

  const addMember = (memberId: string) => {
    setShares((current) => [...current, { member_id: memberId, permission: "view" }]);
    setQuery("");
  };

  const removeMember = (memberId: string) =>
    setShares((current) => current.filter((share) => share.member_id !== memberId));

  const updatePermission = (memberId: string, permission: TStickyPermission) =>
    setShares((current) => current.map((share) => (share.member_id === memberId ? { ...share, permission } : share)));

  const handleSave = async () => {
    setIsSaving(true);
    const isSaved = await stickyOperations.updateSharing(sticky.id, {
      access,
      project_permission: projectPermission,
      members: hasPeople
        ? shares.map((share) => ({ ...share, permission: isGuest(share.member_id) ? "view" : share.permission }))
        : [],
    });
    setIsSaving(false);
    if (isSaved) handleClose();
  };

  return (
    <ModalCore isOpen handleClose={handleClose} position={EModalPosition.TOP} width={EModalWidth.LG}>
      <div className="flex flex-col gap-4 p-5">
        <h3 className="text-18 font-medium text-primary">{t("stickies.sharing.title")}</h3>

        <div role="radiogroup" aria-label={t("stickies.sharing.title")} className="flex flex-col gap-1">
          {ACCESS_OPTIONS.map((option) => {
            const isSelected = access === option.value;
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setAccess(option.value)}
                className={cn(
                  "flex items-start gap-2.5 rounded-md border border-subtle px-3 py-2 text-left hover:bg-layer-transparent-hover",
                  { "border-accent-strong bg-accent-primary/5": isSelected }
                )}
              >
                <option.icon className="mt-0.5 size-4 flex-shrink-0 text-secondary" />
                <span className="min-w-0">
                  <span className="block text-13 font-medium text-primary">
                    {t(`stickies.sharing.access.${option.key}.label`)}
                  </span>
                  <span className="block text-12 text-tertiary">
                    {t(`stickies.sharing.access.${option.key}.description`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {access === EStickyAccess.PRIVATE && !isOwner && (
          <p className="text-12 text-danger-primary">{t("stickies.sharing.lose_access")}</p>
        )}

        {!!sticky.pinned_at && access !== EStickyAccess.PROJECT && (
          <p className="text-12 text-tertiary">{t("stickies.pin.will_unpin")}</p>
        )}

        {access === EStickyAccess.PROJECT && (
          <div className="flex items-center justify-between gap-2 text-13 text-primary">
            <span>{t("stickies.sharing.everyone_can")}</span>
            <PermissionSelect
              value={projectPermission}
              onChange={setProjectPermission}
              label={t("stickies.sharing.everyone_can")}
            />
          </div>
        )}

        {hasPeople && (
          <div className="flex flex-col gap-2">
            <p className="text-13 font-medium text-primary">{t("stickies.sharing.people")}</p>
            {access === EStickyAccess.PROJECT && areGuestsExcluded && (
              <p className="text-12 text-tertiary">{t("stickies.sharing.guests_hint")}</p>
            )}
            {shares.map((share) => {
              const member = getProjectMemberDetails(share.member_id, projectId)?.member;
              const name = member?.display_name ?? "";
              return (
                <div key={share.member_id} className="flex items-center gap-2 text-13 text-primary">
                  <Avatar name={name} src={getFileURL(member?.avatar_url ?? "")} size="md" showTooltip={false} />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {isGuest(share.member_id) ? (
                    <span className="px-2 py-1 text-12 text-tertiary">{t("stickies.view_only")}</span>
                  ) : (
                    <PermissionSelect
                      value={share.permission}
                      onChange={(permission) => updatePermission(share.member_id, permission)}
                      label={name}
                    />
                  )}
                  <button
                    type="button"
                    className="grid size-6 flex-shrink-0 place-items-center rounded-sm text-tertiary hover:bg-layer-transparent-hover hover:text-primary"
                    aria-label={t("stickies.sharing.remove_person", { name })}
                    onClick={() => removeMember(share.member_id)}
                  >
                    <CloseIcon className="size-3.5" />
                  </button>
                </div>
              );
            })}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("stickies.sharing.search")}
              aria-label={t("stickies.sharing.search")}
              className="h-8 rounded-md border border-strong bg-surface-1 px-2.5 text-13 text-primary placeholder:text-placeholder focus:border-accent-strong focus:outline-none"
            />
            <div className="vertical-scrollbar flex scrollbar-sm max-h-44 flex-col overflow-y-auto rounded-md border border-subtle p-1">
              {candidates.length === 0 ? (
                <p className="px-2 py-4 text-center text-13 text-tertiary">{t("stickies.sharing.no_people")}</p>
              ) : (
                candidates.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => addMember(member.id)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-13 text-primary hover:bg-layer-transparent-hover"
                  >
                    <Avatar
                      name={member.display_name}
                      src={getFileURL(member.avatar_url)}
                      size="md"
                      showTooltip={false}
                    />
                    <span className="flex-1 truncate">{member.display_name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-subtle px-5 py-4">
        {isIncomplete && <p className="mr-auto text-12 text-tertiary">{t("stickies.sharing.choose_someone")}</p>}
        <Button variant="secondary" size="lg" onClick={handleClose}>
          {t("cancel")}
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => void handleSave()}
          disabled={isIncomplete}
          loading={isSaving}
        >
          {t("save")}
        </Button>
      </div>
    </ModalCore>
  );
});

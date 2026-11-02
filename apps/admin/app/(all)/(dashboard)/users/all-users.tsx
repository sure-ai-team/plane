/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import useSWR from "swr";
import { KeyRound, Search, Settings2, Trash2, UserCheck, UserX } from "lucide-react";
// plane imports
import { Badge } from "@plane/propel/badge";
import { Button } from "@plane/propel/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@plane/propel/table";
import { InstanceService } from "@plane/services";
import type { TInstanceUser, TInstanceUserStatusFilter } from "@plane/types";
import { CustomMenu, CustomSelect, Input, Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// local
import { formatDate, getFullName } from "./helpers";
import { ManageUserModal } from "./manage-user-modal";
import { WorkspaceSelect } from "./shared";
import { DeleteUserModal, SetActiveModal, SetPasswordModal } from "./user-modals";

const instanceService = new InstanceService();

const PER_PAGE = 25;

const STATUS_OPTIONS: { key: TInstanceUserStatusFilter; label: string }[] = [
  { key: "", label: "All statuses" },
  { key: "active", label: "Active" },
  { key: "deactivated", label: "Deactivated" },
];

type TDialog = { kind: "manage" | "password" | "activation" | "delete"; user: TInstanceUser } | null;

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

type Props = { loginUrl: string };

export function AllUsers(props: Props) {
  const { loginUrl } = props;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TInstanceUserStatusFilter>("");
  const [workspace, setWorkspace] = useState("");
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<TDialog>(null);
  const query = useDebounced(search.trim());

  // A new filter starts again from the first page.
  useEffect(() => setPage(0), [query, status, workspace]);

  const { data, isLoading, mutate } = useSWR(
    ["INSTANCE_USERS", query, status, workspace, page],
    () =>
      instanceService.listUsers({
        search: query || undefined,
        status: status || undefined,
        workspace: workspace || undefined,
        per_page: PER_PAGE,
        cursor: `${PER_PAGE}:${page}:0`,
      }),
    { keepPreviousData: true, revalidateOnFocus: false }
  );

  const users = data?.results ?? [];
  const total = data?.total_count ?? 0;
  const refresh = () => void mutate();
  const closeDialog = () => setDialog(null);

  return (
    <div className="flex flex-col gap-4 py-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-64 grow flex-col gap-1">
          <label htmlFor="user-search" className="text-13 text-tertiary">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-placeholder" />
            <Input
              id="user-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, email or phone"
              className="w-full pl-8"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="flex w-44 flex-col gap-1">
          <h4 className="text-13 text-tertiary">Status</h4>
          <CustomSelect
            value={status}
            label={STATUS_OPTIONS.find((option) => option.key === status)?.label}
            onChange={setStatus}
            buttonClassName="rounded-md border-subtle"
            input
          >
            {STATUS_OPTIONS.map((option) => (
              <CustomSelect.Option key={option.key} value={option.key} className="w-full">
                {option.label}
              </CustomSelect.Option>
            ))}
          </CustomSelect>
        </div>
        <div className="w-56">
          <WorkspaceSelect label="Workspace" value={workspace} onChange={setWorkspace} emptyLabel="All workspaces" />
        </div>
      </div>

      <div className="text-13 text-tertiary">
        {isLoading && !data ? "Loading users..." : `${total} ${total === 1 ? "user" : "users"}`}
      </div>

      {isLoading && !data ? (
        <Loader className="flex flex-col gap-2">
          <Loader.Item height="40px" width="100%" />
          <Loader.Item height="40px" width="100%" />
          <Loader.Item height="40px" width="100%" />
        </Loader>
      ) : users.length === 0 ? (
        <div className="rounded-md border border-subtle px-4 py-8 text-center text-13 text-tertiary">
          No users match these filters.
        </div>
      ) : (
        <div className="rounded-md border border-subtle">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Workspaces</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const name = getFullName(user) || user.display_name;
                return (
                  <TableRow key={user.id} className="border-b border-subtle last:border-b-0">
                    <TableCell>
                      <button type="button" className="text-left" onClick={() => setDialog({ kind: "manage", user })}>
                        <div className={cn("text-primary hover:underline", !user.is_active && "text-placeholder")}>
                          {name || user.email}
                        </div>
                        {name && (
                          <div className="text-11 text-tertiary" dir="ltr">
                            {user.email}
                          </div>
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-secondary" dir="ltr">
                      {user.phone || "-"}
                    </TableCell>
                    <TableCell className="text-secondary">{user.workspace_count}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={user.is_active ? "success" : "neutral"}>
                          {user.is_active ? "Active" : "Deactivated"}
                        </Badge>
                        {user.is_instance_admin && <Badge variant="brand">Instance admin</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-secondary">
                      {formatDate(user.last_login_time)}
                    </TableCell>
                    <TableCell>
                      <CustomMenu ellipsis placement="bottom-end" closeOnSelect>
                        <CustomMenu.MenuItem
                          onClick={() => setDialog({ kind: "manage", user })}
                          className="flex items-center gap-2"
                        >
                          <Settings2 className="size-3.5" />
                          Edit details and access
                        </CustomMenu.MenuItem>
                        {user.is_active && (
                          <CustomMenu.MenuItem
                            onClick={() => setDialog({ kind: "password", user })}
                            className="flex items-center gap-2"
                          >
                            <KeyRound className="size-3.5" />
                            Set new password
                          </CustomMenu.MenuItem>
                        )}
                        <CustomMenu.MenuItem
                          onClick={() => setDialog({ kind: "activation", user })}
                          className="flex items-center gap-2"
                        >
                          {user.is_active ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
                          {user.is_active ? "Deactivate" : "Reactivate"}
                        </CustomMenu.MenuItem>
                        <CustomMenu.MenuItem
                          onClick={() => setDialog({ kind: "delete", user })}
                          className="flex items-center gap-2 text-danger-primary"
                        >
                          <Trash2 className="size-3.5" />
                          Delete permanently
                        </CustomMenu.MenuItem>
                      </CustomMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {(page > 0 || data?.next_page_results) && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-13 text-tertiary">Page {page + 1}</span>
          <Button variant="secondary" size="lg" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button
            variant="secondary"
            size="lg"
            disabled={!data?.next_page_results}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <ManageUserModal
        userId={dialog?.kind === "manage" ? dialog.user.id : null}
        loginUrl={loginUrl}
        onClose={closeDialog}
        onChanged={refresh}
        onDeleted={() => {
          closeDialog();
          refresh();
        }}
      />
      <SetPasswordModal
        user={dialog?.kind === "password" ? dialog.user : null}
        loginUrl={loginUrl}
        onClose={closeDialog}
      />
      <SetActiveModal
        user={dialog?.kind === "activation" ? dialog.user : null}
        onClose={closeDialog}
        onDone={refresh}
      />
      <DeleteUserModal user={dialog?.kind === "delete" ? dialog.user : null} onClose={closeDialog} onDone={refresh} />
    </div>
  );
}

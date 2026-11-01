/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Download, UserPlus } from "lucide-react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { InstanceService } from "@plane/services";
import type { TBulkUserCreateError, TBulkUserRole, TBulkUserRowResult } from "@plane/types";
import { Input } from "@plane/ui";
// local
import { buildResultsCsv, downloadFile, getFullName, resultsFilename } from "./helpers";
import { BulkUserResultsTable } from "./results-table";
import {
  DISCARD_PASSWORDS_PROMPT,
  NO_WORKSPACE,
  PasswordNotice,
  RoleSelect,
  Step,
  WorkspaceSelect,
  useUnsavedPasswordsWarning,
} from "./shared";

const instanceService = new InstanceService();

const EMPTY_DETAILS = { email: "", first_name: "", last_name: "", phone: "" };
type TDetails = typeof EMPTY_DETAILS;

const FIELDS: { key: keyof TDetails; label: string; placeholder: string; type: string; required?: boolean }[] = [
  { key: "email", label: "Email", placeholder: "name@company.com", type: "email", required: true },
  { key: "phone", label: "Phone", placeholder: "+966551234567", type: "tel" },
  { key: "first_name", label: "First name", placeholder: "Ahmed", type: "text" },
  { key: "last_name", label: "Last name", placeholder: "Ali", type: "text" },
];

type Props = { loginUrl: string };

export function AddUserForm(props: Props) {
  const { loginUrl } = props;
  // state
  const [details, setDetails] = useState<TDetails>(EMPTY_DETAILS);
  const [workspace, setWorkspace] = useState<string>(NO_WORKSPACE);
  const [role, setRole] = useState<TBulkUserRole>("member");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Users added during this visit, newest first. Passwords live only here.
  const [added, setAdded] = useState<TBulkUserRowResult[]>([]);
  const [savedCount, setSavedCount] = useState(0);

  const withPasswords = added.filter((row) => row.password);
  const hasUnsavedPasswords = withPasswords.length > savedCount;
  useUnsavedPasswordsWarning(hasUnsavedPasswords);

  const updateField = (key: keyof TDetails, value: string) => {
    setDetails((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!details.email.trim()) {
      setError("Enter the user's email.");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await instanceService.createUser({
        ...details,
        workspace: workspace || undefined,
        role,
      });
      // Each result gets a unique row number so the table can key and reveal rows independently.
      setAdded((current) => [{ ...result, line: (current[0]?.line ?? 0) + 1 }, ...current]);
      setDetails(EMPTY_DETAILS);
      const name = getFullName(result) || result.email;
      setToast(
        result.status === "created"
          ? { type: TOAST_TYPE.SUCCESS, title: "Account created", message: `Send ${name} their temporary password.` }
          : {
              type: TOAST_TYPE.INFO,
              title: "Account already exists",
              message: workspace ? `${name} was added to the workspace.` : `${name} already has an account.`,
            }
      );
    } catch (err) {
      setError((err as TBulkUserCreateError | undefined)?.error ?? "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownload = () => {
    downloadFile(buildResultsCsv(added), resultsFilename());
    setSavedCount(withPasswords.length);
  };

  const handleClear = () => {
    if (hasUnsavedPasswords && !window.confirm(DISCARD_PASSWORDS_PROMPT)) return;
    setAdded([]);
    setSavedCount(0);
  };

  return (
    <div>
      <Step
        number={1}
        title="Enter the user's details"
        description="A temporary password is generated when you add the user. If the email already has an account, it is only added to the workspace you choose."
      >
        <form onSubmit={(event) => void handleSubmit(event)} className="flex max-w-xl flex-col gap-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <div key={field.key} className="flex flex-col gap-1">
                <label htmlFor={`new-user-${field.key}`} className="text-13 text-tertiary">
                  {field.label}
                  {field.required && <span className="text-danger-primary"> *</span>}
                </label>
                <Input
                  id={`new-user-${field.key}`}
                  name={field.key}
                  type={field.type}
                  value={details[field.key]}
                  onChange={(event) => updateField(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  hasError={field.key === "email" && Boolean(error)}
                  dir={field.type === "tel" || field.type === "email" ? "ltr" : undefined}
                  autoComplete="off"
                  className="w-full"
                />
              </div>
            ))}
            <WorkspaceSelect label="Workspace" value={workspace} onChange={setWorkspace} />
            <RoleSelect label="Workspace role" value={role} onChange={setRole} />
          </div>
          {error && <div className="text-13 text-danger-primary">{error}</div>}
          <div>
            <Button type="submit" variant="primary" size="lg" prependIcon={<UserPlus />} loading={isSubmitting}>
              Add user
            </Button>
          </div>
        </form>
      </Step>

      <Step
        number={2}
        title="Send each user their password"
        description="Copy the user's message and send it to them privately, for example on WhatsApp."
      >
        {added.length === 0 ? (
          <div className="text-13 text-tertiary">Users you add appear here with their temporary password.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" size="lg" prependIcon={<Download />} onClick={handleDownload}>
                Download list (.csv)
              </Button>
              <Button variant="ghost" size="lg" onClick={handleClear}>
                Clear list
              </Button>
            </div>
            {withPasswords.length > 0 && (
              <PasswordNotice
                saved={!hasUnsavedPasswords}
                savedText="List downloaded. Delete the file once every user has their password."
                unsavedText="These temporary passwords are shown only now and are not stored. Copy the messages or download the list before you leave this page."
              />
            )}
            <BulkUserResultsTable rows={added} isPreview={false} loginUrl={loginUrl} showRowNumber={false} />
          </>
        )}
      </Step>
    </div>
  );
}

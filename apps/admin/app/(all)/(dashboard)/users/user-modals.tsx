/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, MessageSquareText } from "lucide-react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { InstanceService } from "@plane/services";
import type { TInstanceUser } from "@plane/types";
import { AlertModalCore, EModalWidth, Input, ModalCore } from "@plane/ui";
// local
import { buildCredentialsMessage, getErrorMessage, getFullName } from "./helpers";
import { copyText } from "./results-table";
import { PasswordNotice, useUnsavedPasswordsWarning } from "./shared";

const instanceService = new InstanceService();

type TUserLike = Pick<TInstanceUser, "id" | "email" | "first_name" | "last_name" | "display_name">;

function displayName(user: TUserLike): string {
  return getFullName(user) || user.display_name || user.email;
}

// ---------------------------------------------------------------------------

type TPasswordFormProps = { user: TUserLike; loginUrl: string; onDone?: () => void };

/** Generates or sets a new password, then shows it once with copy buttons. */
export function PasswordForm(props: TPasswordFormProps) {
  const { user, loginUrl, onDone } = props;
  const [mode, setMode] = useState<"generate" | "custom">("generate");
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState("");
  const [revealed, setRevealed] = useState(false);
  useUnsavedPasswordsWarning(Boolean(result));

  const handleSubmit = async () => {
    if (mode === "custom" && !custom) {
      setError("Enter the new password, or choose to generate one.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const response = await instanceService.setUserPassword(user.id, mode === "custom" ? custom : "");
      setResult(response.password);
      setCustom("");
      onDone?.();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (result) {
    const message = buildCredentialsMessage(
      { first_name: user.first_name, email: user.email, password: result },
      loginUrl,
      true
    );
    return (
      <div className="flex flex-col gap-3">
        <PasswordNotice
          saved={false}
          savedText=""
          unsavedText="The password is set and the user was signed out everywhere. It is shown only now and is not stored, so send it to the user before you close this."
        />
        <div className="flex flex-wrap items-center gap-1">
          <code className="font-mono min-w-44 rounded-sm bg-layer-1 px-2 py-1 text-13" dir="ltr">
            {revealed ? result : "••••••••••••••••"}
          </code>
          <Button
            variant="ghost"
            size="base"
            aria-label={revealed ? "Hide password" : "Show password"}
            onClick={() => setRevealed((value) => !value)}
          >
            {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="base"
            aria-label="Copy password"
            onClick={() => void copyText(result, "Password")}
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="base"
            prependIcon={<MessageSquareText />}
            onClick={() => void copyText(message, "Message")}
          >
            Copy message
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 text-13">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "generate"} onChange={() => setMode("generate")} />
          Generate a strong password
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "custom"} onChange={() => setMode("custom")} />
          Type a password
        </label>
      </div>
      {mode === "custom" && (
        <div className="relative max-w-sm">
          <Input
            type={showCustom ? "text" : "password"}
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              setError("");
            }}
            placeholder="New password"
            autoComplete="new-password"
            hasError={Boolean(error)}
            className="w-full pr-8"
            dir="ltr"
          />
          <button
            type="button"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-tertiary"
            aria-label={showCustom ? "Hide password" : "Show password"}
            onClick={() => setShowCustom((value) => !value)}
          >
            {showCustom ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
      )}
      <div className="text-12 text-tertiary">
        The user is signed out on every device and must sign in with the new password.
      </div>
      {error && <div className="text-13 text-danger-primary">{error}</div>}
      <div>
        <Button
          variant="primary"
          size="lg"
          prependIcon={<KeyRound />}
          loading={isSubmitting}
          onClick={() => void handleSubmit()}
        >
          Set password
        </Button>
      </div>
    </div>
  );
}

type TSetPasswordModalProps = { user: TUserLike | null; loginUrl: string; onClose: () => void };

export function SetPasswordModal(props: TSetPasswordModalProps) {
  const { user, loginUrl, onClose } = props;
  const [hasPassword, setHasPassword] = useState(false);

  useEffect(() => {
    if (user) setHasPassword(false);
  }, [user]);

  const handleClose = () => {
    if (hasPassword && !window.confirm("The new password is not saved anywhere. Close anyway?")) return;
    onClose();
  };

  return (
    <ModalCore isOpen={Boolean(user)} handleClose={handleClose} width={EModalWidth.XL}>
      {user && (
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="text-16 font-medium">Set a new password</h3>
            <p className="text-13 text-secondary">
              For {displayName(user)} <span dir="ltr">({user.email})</span>
            </p>
          </div>
          <PasswordForm user={user} loginUrl={loginUrl} onDone={() => setHasPassword(true)} />
          <div className="flex justify-end border-t border-subtle pt-4">
            <Button variant="secondary" onClick={handleClose}>
              {hasPassword ? "Done" : "Cancel"}
            </Button>
          </div>
        </div>
      )}
    </ModalCore>
  );
}

// ---------------------------------------------------------------------------

type TSetActiveModalProps = {
  user: (TUserLike & Pick<TInstanceUser, "is_active">) | null;
  onClose: () => void;
  onDone: () => void;
};

export function SetActiveModal(props: TSetActiveModalProps) {
  const { user, onClose, onDone } = props;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const deactivate = Boolean(user?.is_active);

  const handleSubmit = async () => {
    if (!user) return;
    setIsSubmitting(true);
    try {
      await instanceService.setUserActive(user.id, !deactivate);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: deactivate ? "Account deactivated" : "Account reactivated",
        message: deactivate
          ? `${displayName(user)} can no longer sign in.`
          : `${displayName(user)} can sign in again. Add them back to their workspaces from "Edit details and access".`,
      });
      onDone();
      onClose();
    } catch (err) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Could not change the account", message: getErrorMessage(err) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertModalCore
      isOpen={Boolean(user)}
      handleClose={onClose}
      handleSubmit={() => void handleSubmit()}
      isSubmitting={isSubmitting}
      variant={deactivate ? "danger" : "primary"}
      title={deactivate ? "Deactivate this account?" : "Reactivate this account?"}
      primaryButtonText={
        deactivate
          ? { loading: "Deactivating", default: "Deactivate" }
          : { loading: "Reactivating", default: "Reactivate" }
      }
      content={
        user &&
        (deactivate ? (
          <>
            {displayName(user)} will be signed out and blocked from signing in. They are removed from every workspace
            and project, which then show them as Suspended. Their work and history stay. You can reactivate the account
            later.
          </>
        ) : (
          <>
            {displayName(user)} will be able to sign in again with their existing password. Their workspace access is
            not restored automatically: add them back to each workspace afterwards.
          </>
        ))
      }
    />
  );
}

// ---------------------------------------------------------------------------

type TDeleteUserModalProps = { user: TUserLike | null; onClose: () => void; onDone: () => void };

export function DeleteUserModal(props: TDeleteUserModalProps) {
  const { user, onClose, onDone } = props;
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setConfirmation("");
    setError("");
  }, [user]);

  const matches = Boolean(user) && confirmation.trim().toLowerCase() === user?.email.toLowerCase();

  const handleSubmit = async () => {
    if (!user || !matches) return;
    setIsSubmitting(true);
    setError("");
    try {
      await instanceService.deleteUser(user.id, confirmation.trim());
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Account deleted",
        message: `${user.email} was permanently deleted.`,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={Boolean(user)} handleClose={onClose} width={EModalWidth.XL}>
      {user && (
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div>
            <h3 className="text-16 font-medium text-danger-primary">Delete this account permanently?</h3>
            <p className="mt-1 text-13 text-secondary">
              This removes {displayName(user)} and everything tied to the account: the pages they own, their comments,
              stickies, notifications and memberships. It cannot be undone. To keep their history, deactivate the
              account instead.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="delete-user-confirm" className="text-13 text-tertiary">
              Type{" "}
              <span className="font-medium text-primary" dir="ltr">
                {user.email}
              </span>{" "}
              to confirm
            </label>
            <Input
              id="delete-user-confirm"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setError("");
              }}
              autoComplete="off"
              dir="ltr"
              className="w-full"
            />
          </div>
          {error && <div className="text-13 text-danger-primary">{error}</div>}
          <div className="flex justify-end gap-2 border-t border-subtle pt-4">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="error-fill" type="submit" disabled={!matches} loading={isSubmitting}>
              Delete permanently
            </Button>
          </div>
        </form>
      )}
    </ModalCore>
  );
}

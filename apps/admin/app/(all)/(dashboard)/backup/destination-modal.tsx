/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, Cloud, Database, Folder, XCircle } from "lucide-react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  TBackupDestination,
  TBackupDestinationConfig,
  TBackupDestinationKind,
  TBackupDestinationPayload,
  TBackupTestResult,
} from "@plane/types";
import { CustomSelect, EModalWidth, Input, ModalCore, ToggleSwitch } from "@plane/ui";
import { cn } from "@plane/utils";
// local
import { DESTINATION_KINDS, getErrorMessage, getFieldErrors } from "./helpers";
import { backupService, refreshBackupData } from "./use-backup";

const KIND_ICONS: Record<TBackupDestinationKind, React.ComponentType<{ className?: string }>> = {
  s3: Cloud,
  local: Folder,
  postgres: Database,
};

type TProvider = "aws" | "minio" | "r2" | "wasabi" | "spaces" | "other";

const PROVIDERS: { key: TProvider; label: string; endpointHint: string; pathStyle: boolean }[] = [
  { key: "aws", label: "Amazon S3", endpointHint: "", pathStyle: false },
  { key: "minio", label: "MinIO", endpointHint: "https://minio.example.com", pathStyle: true },
  {
    key: "r2",
    label: "Cloudflare R2",
    endpointHint: "https://<account-id>.r2.cloudflarestorage.com",
    pathStyle: false,
  },
  { key: "wasabi", label: "Wasabi", endpointHint: "https://s3.eu-central-1.wasabisys.com", pathStyle: false },
  {
    key: "spaces",
    label: "DigitalOcean Spaces",
    endpointHint: "https://fra1.digitaloceanspaces.com",
    pathStyle: false,
  },
  { key: "other", label: "Other S3-compatible service", endpointHint: "https://s3.example.com", pathStyle: false },
];

const SSL_MODES = [
  { key: "prefer", label: "Use encryption if available (default)" },
  { key: "require", label: "Always encrypt" },
  { key: "verify-full", label: "Always encrypt and verify the server" },
  { key: "disable", label: "No encryption (private networks only)" },
];

function guessProvider(endpoint = ""): TProvider {
  if (!endpoint) return "aws";
  if (endpoint.includes("r2.cloudflarestorage.com")) return "r2";
  if (endpoint.includes("wasabisys.com")) return "wasabi";
  if (endpoint.includes("digitaloceanspaces.com")) return "spaces";
  return "other";
}

function defaultConfig(kind: TBackupDestinationKind): TBackupDestinationConfig {
  if (kind === "local") return { folder: "main" };
  if (kind === "s3")
    return {
      bucket: "",
      region: "",
      endpoint_url: "",
      prefix: "sgtpm-backups",
      access_key_id: "",
      force_path_style: false,
      server_side_encryption: true,
    };
  return { host: "", port: 5432, database: "", user: "", sslmode: "prefer" };
}

type Props = {
  isOpen: boolean;
  /** Edit this destination; null adds a new one. */
  destination: TBackupDestination | null;
  onClose: () => void;
};

export function DestinationModal(props: Props) {
  const { isOpen, destination, onClose } = props;
  const isEdit = Boolean(destination);
  const [kind, setKind] = useState<TBackupDestinationKind | null>(null);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<TBackupDestinationConfig>({});
  const [secret, setSecret] = useState("");
  const [provider, setProvider] = useState<TProvider>("aws");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [test, setTest] = useState<TBackupTestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setTest(null);
    setSecret("");
    if (destination) {
      setKind(destination.kind);
      setName(destination.name);
      setConfig({ ...defaultConfig(destination.kind), ...destination.config });
      setProvider(guessProvider(destination.config.endpoint_url));
    } else {
      setKind(null);
      setName("");
      setConfig({});
      setProvider("aws");
    }
  }, [isOpen, destination]);

  const chooseKind = (value: TBackupDestinationKind) => {
    setKind(value);
    setConfig(defaultConfig(value));
    setName(value === "local" ? "Server backup folder" : value === "postgres" ? "Standby database" : "Cloud storage");
  };

  const setField = <K extends keyof TBackupDestinationConfig>(key: K, value: TBackupDestinationConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setTest(null);
  };

  const chooseProvider = (value: TProvider) => {
    setProvider(value);
    const preset = PROVIDERS.find((p) => p.key === value);
    setConfig((current) => ({
      ...current,
      endpoint_url: value === "aws" ? "" : current.endpoint_url,
      force_path_style: preset?.pathStyle ?? false,
      region: value === "r2" ? "auto" : current.region,
    }));
  };

  const secretField = kind === "s3" ? "secret_access_key" : kind === "postgres" ? "password" : null;
  const secretIsStored = Boolean(secretField && destination?.secrets_set?.[secretField]);

  const payload = (): TBackupDestinationPayload => ({
    name: name.trim(),
    kind: kind ?? undefined,
    config,
    secrets: secretField && secret ? { [secretField]: secret } : {},
  });

  const handleTest = async () => {
    setIsTesting(true);
    setErrors({});
    setTest(null);
    try {
      setTest(await backupService.testDestination(payload(), destination?.id));
    } catch (error) {
      setErrors(getFieldErrors(error));
      setTest({ ok: false, message: getErrorMessage(error, "Couldn't test these settings.") });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrors({});
    try {
      const saved = destination
        ? await backupService.updateDestination(destination.id, payload())
        : await backupService.createDestination(payload());
      await refreshBackupData();
      setToast({
        type: saved.last_check_ok === false ? TOAST_TYPE.WARNING : TOAST_TYPE.SUCCESS,
        title: saved.last_check_ok === false ? "Saved, but the connection test failed" : "Destination saved",
        message: saved.last_check_message || "Backups will be saved here.",
      });
      onClose();
    } catch (error) {
      setErrors(getFieldErrors(error));
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't save", message: getErrorMessage(error) });
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isSaving || isTesting;

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} width={EModalWidth.XXL}>
      <form
        className="flex max-h-[85vh] flex-col gap-5 overflow-y-auto p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (kind) void handleSave();
        }}
      >
        <div>
          <h3 className="text-16 font-medium">{isEdit ? "Edit destination" : "Add a destination"}</h3>
          <p className="mt-1 text-13 text-secondary">
            {kind ? DESTINATION_KINDS[kind].description : "Choose where backups should be saved."}
          </p>
        </div>

        {!kind && (
          <div className="flex flex-col gap-2">
            {(Object.keys(DESTINATION_KINDS) as TBackupDestinationKind[]).map((value) => {
              const Icon = KIND_ICONS[value];
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => chooseKind(value)}
                  className="flex items-start gap-3 rounded-lg border border-subtle bg-layer-1 p-4 text-left hover:bg-layer-1-hover"
                >
                  <Icon className="mt-0.5 size-5 shrink-0 text-accent-primary" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-13 font-medium text-primary">{DESTINATION_KINDS[value].label}</span>
                    <span className="text-12 text-tertiary">{DESTINATION_KINDS[value].description}</span>
                  </span>
                </button>
              );
            })}
            <p className="text-12 text-tertiary">
              Tip: use at least one destination outside this server, so a broken server doesn&apos;t take the backups
              with it.
            </p>
          </div>
        )}

        {kind && (
          <>
            <TextField
              id="dest-name"
              label="Name"
              hint="Shown in the backup history."
              value={name}
              onChange={setName}
              error={errors.name}
            />

            {kind === "local" && (
              <TextField
                id="dest-folder"
                label="Folder"
                hint="A folder inside the server's backup area (/backups). It is created if missing."
                value={config.folder ?? ""}
                onChange={(value) => setField("folder", value)}
                error={errors.folder}
              />
            )}

            {kind === "s3" && (
              <>
                <div className="flex flex-col gap-1">
                  <span className="text-13 text-tertiary">Provider</span>
                  <CustomSelect
                    value={provider}
                    label={PROVIDERS.find((p) => p.key === provider)?.label}
                    onChange={chooseProvider}
                    buttonClassName="rounded-md border-subtle"
                    input
                  >
                    {PROVIDERS.map((p) => (
                      <CustomSelect.Option key={p.key} value={p.key} className="w-full">
                        {p.label}
                      </CustomSelect.Option>
                    ))}
                  </CustomSelect>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField
                    id="dest-bucket"
                    label="Bucket name"
                    value={config.bucket ?? ""}
                    onChange={(value) => setField("bucket", value)}
                    error={errors.bucket}
                  />
                  <TextField
                    id="dest-region"
                    label="Region"
                    hint={provider === "aws" ? "For example eu-central-1." : "Leave empty if the provider has none."}
                    value={config.region ?? ""}
                    onChange={(value) => setField("region", value)}
                    error={errors.region}
                  />
                </div>
                {provider !== "aws" && (
                  <TextField
                    id="dest-endpoint"
                    label="Endpoint address"
                    hint={`From your provider, for example ${PROVIDERS.find((p) => p.key === provider)?.endpointHint}`}
                    value={config.endpoint_url ?? ""}
                    onChange={(value) => setField("endpoint_url", value)}
                    error={errors.endpoint_url}
                  />
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField
                    id="dest-access-key"
                    label="Access key ID"
                    value={config.access_key_id ?? ""}
                    onChange={(value) => setField("access_key_id", value)}
                    error={errors.access_key_id}
                    autoComplete="off"
                  />
                  <TextField
                    id="dest-secret"
                    label="Secret access key"
                    type="password"
                    value={secret}
                    onChange={(value) => {
                      setSecret(value);
                      setTest(null);
                    }}
                    placeholder={secretIsStored ? "Saved. Leave empty to keep it." : ""}
                    error={errors.secret_access_key}
                    autoComplete="new-password"
                  />
                </div>
                <TextField
                  id="dest-prefix"
                  label="Folder inside the bucket"
                  hint="Optional. Lets several systems share one bucket."
                  value={config.prefix ?? ""}
                  onChange={(value) => setField("prefix", value)}
                  error={errors.prefix}
                />
                <ToggleRow
                  label="Ask the provider to encrypt stored backups"
                  hint="Recommended. Uses the provider's own encryption; no key to manage."
                  value={Boolean(config.server_side_encryption)}
                  onChange={(value) => setField("server_side_encryption", value)}
                />
                {provider !== "aws" && (
                  <ToggleRow
                    label="Use path-style addresses"
                    hint="Needed by MinIO and some self-hosted services. Leave as set unless the test fails."
                    value={Boolean(config.force_path_style)}
                    onChange={(value) => setField("force_path_style", value)}
                  />
                )}
              </>
            )}

            {kind === "postgres" && (
              <>
                <div className="rounded-md bg-warning-subtle px-3 py-2 text-13 text-warning-primary">
                  Everything in this database is replaced by each backup. Use an empty database created just for this,
                  never one that holds other data.
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px]">
                  <TextField
                    id="dest-host"
                    label="Server address"
                    value={config.host ?? ""}
                    onChange={(value) => setField("host", value)}
                    error={errors.host}
                  />
                  <TextField
                    id="dest-port"
                    label="Port"
                    value={String(config.port ?? "")}
                    onChange={(value) => setField("port", Number(value.replace(/\D/g, "")) || 0)}
                    error={errors.port}
                    inputMode="numeric"
                  />
                </div>
                <TextField
                  id="dest-database"
                  label="Database name"
                  value={config.database ?? ""}
                  onChange={(value) => setField("database", value)}
                  error={errors.database}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField
                    id="dest-user"
                    label="User"
                    value={config.user ?? ""}
                    onChange={(value) => setField("user", value)}
                    error={errors.user}
                    autoComplete="off"
                  />
                  <TextField
                    id="dest-password"
                    label="Password"
                    type="password"
                    value={secret}
                    onChange={(value) => {
                      setSecret(value);
                      setTest(null);
                    }}
                    placeholder={secretIsStored ? "Saved. Leave empty to keep it." : ""}
                    error={errors.password}
                    autoComplete="new-password"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-13 text-tertiary">Connection security</span>
                  <CustomSelect
                    value={config.sslmode ?? "prefer"}
                    label={SSL_MODES.find((m) => m.key === (config.sslmode ?? "prefer"))?.label}
                    onChange={(value: TBackupDestinationConfig["sslmode"]) => setField("sslmode", value)}
                    buttonClassName="rounded-md border-subtle"
                    input
                  >
                    {SSL_MODES.map((mode) => (
                      <CustomSelect.Option key={mode.key} value={mode.key} className="w-full">
                        {mode.label}
                      </CustomSelect.Option>
                    ))}
                  </CustomSelect>
                </div>
              </>
            )}

            {test && (
              <div
                className={cn(
                  "flex items-start gap-2 rounded-md px-3 py-2 text-13",
                  test.ok ? "bg-success-subtle-1 text-success-primary" : "bg-danger-subtle text-danger-primary"
                )}
              >
                {test.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                )}
                <span>{test.message}</span>
              </div>
            )}

            <div className="flex flex-wrap justify-between gap-2 border-t border-subtle pt-4">
              <div className="flex gap-2">
                {!isEdit && (
                  <Button variant="ghost" size="lg" onClick={() => setKind(null)} disabled={busy}>
                    Back
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => void handleTest()}
                  loading={isTesting}
                  disabled={busy}
                >
                  {isTesting ? "Testing" : "Test connection"}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="lg" loading={isSaving} disabled={busy}>
                  {isSaving ? "Saving" : "Save"}
                </Button>
              </div>
            </div>
          </>
        )}
      </form>
    </ModalCore>
  );
}

type TTextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "text";
};

function TextField(props: TTextFieldProps) {
  const { id, label, value, onChange, hint, error, type = "text", placeholder, autoComplete, inputMode } = props;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-13 text-tertiary">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        hasError={Boolean(error)}
        className="w-full"
      />
      {(error || hint) && (
        <span className={cn("text-12", error ? "text-danger-primary" : "text-tertiary")}>{error || hint}</span>
      )}
    </div>
  );
}

function ToggleRow(props: { label: string; hint: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-0.5">
        <span className="text-13 text-primary">{props.label}</span>
        <span className="text-12 text-tertiary">{props.hint}</span>
      </div>
      <ToggleSwitch value={props.value} onChange={props.onChange} size="sm" />
    </div>
  );
}

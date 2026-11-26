/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { BookOpenText, FilePlus2, Network, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TTranslationKeys } from "@plane/i18n";
import { Spinner } from "@plane/ui";
import { cn } from "@plane/utils";
// services
import type { TProjectReadmeTemplate } from "@/services/project/project-readme.service";

type TTemplateOption = {
  key: TProjectReadmeTemplate;
  icon: LucideIcon;
  title: TTranslationKeys;
  description: TTranslationKeys;
};

const TEMPLATE_OPTIONS: TTemplateOption[] = [
  {
    key: "product",
    icon: Target,
    title: "project_overview.readme.templates.product.title",
    description: "project_overview.readme.templates.product.description",
  },
  {
    key: "architecture",
    icon: Network,
    title: "project_overview.readme.templates.architecture.title",
    description: "project_overview.readme.templates.architecture.description",
  },
  {
    key: "onboarding",
    icon: BookOpenText,
    title: "project_overview.readme.templates.onboarding.title",
    description: "project_overview.readme.templates.onboarding.description",
  },
  {
    key: "blank",
    icon: FilePlus2,
    title: "project_overview.readme.templates.blank.title",
    description: "project_overview.readme.templates.blank.description",
  },
];

type Props = {
  /** template whose README is being created, if any */
  creatingTemplate: TProjectReadmeTemplate | undefined;
  onSelect: (template: TProjectReadmeTemplate) => void;
};

export const ProjectReadmeTemplates = observer(function ProjectReadmeTemplates(props: Props) {
  const { creatingTemplate, onSelect } = props;
  // plane hooks
  const { t } = useTranslation();
  // derived values
  const isCreating = !!creatingTemplate;

  return (
    <section aria-labelledby="project-readme-templates" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="project-readme-templates" className="text-16 font-semibold text-primary">
          {t("project_overview.readme.templates.title")}
        </h2>
        <p className="text-13 text-secondary">{t("project_overview.readme.templates.description")}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-busy={isCreating}>
        {TEMPLATE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = creatingTemplate === option.key;
          return (
            <li key={option.key}>
              <button
                type="button"
                disabled={isCreating}
                onClick={() => onSelect(option.key)}
                className={cn(
                  "group flex h-full w-full items-start gap-3 rounded-lg border border-subtle bg-layer-1 p-4 text-left transition-colors",
                  "hover:border-strong hover:bg-layer-1-hover focus-visible:border-accent-strong focus-visible:outline-none",
                  "disabled:cursor-not-allowed",
                  {
                    "border-accent-strong": isSelected,
                    "opacity-60": isCreating && !isSelected,
                  }
                )}
              >
                <span className="grid size-9 flex-shrink-0 place-items-center rounded-md bg-accent-primary/10 text-accent-primary">
                  {isSelected ? <Spinner height="16px" width="16px" /> : <Icon className="size-4" aria-hidden />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-14 font-medium text-primary">{t(option.title)}</span>
                  <span className="text-13 text-tertiary">{t(option.description)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {isCreating && (
        <p className="sr-only" role="status">
          {t("project_overview.readme.templates.creating")}
        </p>
      )}
    </section>
  );
});

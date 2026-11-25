/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
// plane imports
import { useTranslation } from "@plane/i18n";

type TProps = {
  handleResolve: (keep: "mine" | "theirs") => Promise<void>;
};

/** Shown on a sticky that someone else saved while the user was editing it. */
export function StickyConflict(props: TProps) {
  const { handleResolve } = props;
  // states
  const [isResolving, setIsResolving] = useState(false);
  // plane hooks
  const { t } = useTranslation();

  const resolve = async (keep: "mine" | "theirs") => {
    setIsResolving(true);
    await handleResolve(keep);
    setIsResolving(false);
  };

  return (
    <div role="alert" className="mx-2 mt-2 mb-3 flex flex-col gap-1.5 rounded-sm bg-surface-1 p-2 text-12">
      <p className="text-secondary">{t("stickies.conflict.title")}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-medium text-accent-primary">
        <button type="button" disabled={isResolving} onClick={() => void resolve("theirs")}>
          {t("stickies.conflict.use_theirs")}
        </button>
        <button type="button" disabled={isResolving} onClick={() => void resolve("mine")}>
          {t("stickies.conflict.keep_mine")}
        </button>
      </div>
    </div>
  );
}

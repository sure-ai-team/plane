/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useRef, useState } from "react";
import { debounce } from "lodash-es";
import { observer } from "mobx-react";
// plane hooks
import { useOutsideClickDetector } from "@plane/hooks";
// helpers
import { useTranslation } from "@plane/i18n";
import { SearchIcon, CloseIcon } from "@plane/propel/icons";
import type { TStickyScope } from "@plane/types";
import { cn } from "@plane/utils";
import { useSticky } from "@/hooks/use-stickies";
import { IconButton } from "@plane/propel/icon-button";

export const StickySearch = observer(function StickySearch(props: TStickyScope) {
  const { workspaceSlug, projectId } = props;
  // hooks
  const { getList, updateSearchQuery, fetchStickies: fetchStickiesOfScope } = useSticky();
  const { t } = useTranslation();
  // refs
  const inputRef = useRef<HTMLInputElement>(null);
  // derived values
  const scope = { workspaceSlug, projectId };
  const { searchQuery } = getList(scope);
  // states
  const [isSearchOpen, setIsSearchOpen] = useState(searchQuery !== "");

  // outside click detector hook
  useOutsideClickDetector(inputRef, () => {
    if (isSearchOpen && searchQuery.trim() === "") setIsSearchOpen(false);
  });
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (searchQuery && searchQuery.trim() !== "") {
        updateSearchQuery(scope, "");
        fetchStickies();
      } else setIsSearchOpen(false);
    }
  };

  const fetchStickies = async () => {
    await fetchStickiesOfScope({ workspaceSlug, projectId });
  };

  const debouncedSearch = useMemo(
    () => debounce(() => void fetchStickiesOfScope({ workspaceSlug, projectId }), 500),
    [fetchStickiesOfScope, workspaceSlug, projectId]
  );

  return (
    <div className="my-auto mr-2 flex items-center">
      {!isSearchOpen && (
        <IconButton
          variant="ghost"
          size="lg"
          className="-mr-2"
          icon={SearchIcon}
          onClick={() => {
            setIsSearchOpen(true);
            inputRef.current?.focus();
          }}
        />
      )}
      <div
        className={cn(
          "ml-auto flex w-0 items-center justify-start gap-1 overflow-hidden rounded-md border border-transparent text-placeholder opacity-0 transition-[width] ease-linear",
          {
            "w-30 border-subtle px-2.5 py-1.5 opacity-100 md:w-64": isSearchOpen,
          }
        )}
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <input
          ref={inputRef}
          className="w-full max-w-[234px] border-none bg-transparent text-13 text-primary placeholder:text-placeholder focus:outline-none"
          placeholder={t("stickies.search_placeholder")}
          value={searchQuery}
          onChange={(e) => {
            updateSearchQuery(scope, e.target.value);
            debouncedSearch();
          }}
          onKeyDown={handleInputKeyDown}
        />
        {isSearchOpen && (
          <button
            type="button"
            className="grid place-items-center"
            onClick={() => {
              updateSearchQuery(scope, "");
              setIsSearchOpen(false);
              fetchStickies();
            }}
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
});

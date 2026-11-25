/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { MessageSquare } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatApiError, TUserWorkFilters, TUserWorkSummary } from "@plane/types";
import { Loader } from "@plane/ui";
import { calculateTimeAgo, cn, renderFormattedDate } from "@plane/utils";
// components
import { chatPath } from "@/components/chat/common/helpers";
import { useChatAvailability } from "@/components/chat/hooks/use-chat-availability";
import { PageHead } from "@/components/core/page-title";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useUser } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { userWorkService } from "@/services/user-work.service";
// local imports
import { PeriodSelect, ProjectFilter, useUrlFilters } from "../common/filters";
import { useRefreshAfterPeek } from "../common/items";
import { LoadError, MutedCard, PersonAvatar, RoleBadge, StatusBadge } from "../common/primitives";
import { parseUserFilters, userParams } from "../helpers";
import { LatestActivity, UserWorkActivityTab } from "./activity";
import { UserWorkCyclesTab } from "./cycles";
import { ActiveCycles, Attention, CompletionTrend, ProjectWork, WorkStats } from "./overview";
import { UserWorkItemsTab } from "./work";

export const USER_WORK_TABS = ["overview", "work", "cycles", "activity"] as const;
export type TUserWorkTab = (typeof USER_WORK_TABS)[number];

const useSummary = (workspaceSlug: string, userId: string, params: Record<string, string | number>) =>
  useSWR(
    ["USER_WORK_SUMMARY", workspaceSlug, userId, JSON.stringify(params)],
    () => userWorkService.summary(workspaceSlug, userId, params),
    { keepPreviousData: true }
  );

const useCycles = (workspaceSlug: string, userId: string, params: Record<string, string | number>) =>
  useSWR(["USER_WORK_CYCLES", workspaceSlug, userId, JSON.stringify(params)], () =>
    userWorkService.cycles(workspaceSlug, userId, params)
  );

type HeaderProps = { workspaceSlug: string; user: TUserWorkSummary["user"] };

const PersonHeader = observer(function PersonHeader({ workspaceSlug, user }: HeaderProps) {
  const { t } = useTranslation();
  const router = useAppRouter();
  const chat = useChat();
  const { data: currentUser } = useUser();
  const isChatAvailable = useChatAvailability(workspaceSlug);
  const [isOpening, setIsOpening] = useState(false);
  // Guests and people who left cannot chat.
  const canMessage = isChatAvailable && user.status === "active" && user.role > 5 && user.id !== currentUser?.id;

  const message = async () => {
    setIsOpening(true);
    try {
      const conversation = await chat.conversation.create(workspaceSlug, { type: "direct", user_id: user.id });
      router.push(chatPath(workspaceSlug, conversation.id));
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: (error as TChatApiError)?.error });
      setIsOpening(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <PersonAvatar name={user.display_name} url={user.avatar_url} className="size-12 text-18" />
      <div className="min-w-56 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-18 font-semibold text-primary">{user.name}</h2>
          <RoleBadge role={user.role} />
          <StatusBadge status={user.status} />
        </div>
        <p className="flex flex-wrap gap-x-3 text-12 text-tertiary">
          <span className="break-all">{user.email}</span>
          <span>{t("users_work.person.joined_on", { date: renderFormattedDate(user.joined_at) ?? "" })}</span>
          <span>
            {user.last_activity_at
              ? t("users_work.person.last_activity", { time: calculateTimeAgo(user.last_activity_at) })
              : t("users_work.list.no_activity")}
          </span>
          <span>
            {t("users_work.person.timezone")}: {user.timezone}
          </span>
        </p>
      </div>
      {canMessage && (
        <Button
          variant="secondary"
          size="lg"
          prependIcon={<MessageSquare className="size-3.5" />}
          loading={isOpening}
          onClick={() => void message()}
        >
          {t("users_work.person.message")}
        </Button>
      )}
    </div>
  );
});

type OverviewProps = {
  workspaceSlug: string;
  userId: string;
  summary: TUserWorkSummary;
  filters: TUserWorkFilters;
  tabHref: (tab: TUserWorkTab, extra?: Record<string, string>) => string;
  onChange: () => void;
};

function OverviewTab({ workspaceSlug, userId, summary, filters, tabHref, onChange }: OverviewProps) {
  const { data: cycles } = useCycles(workspaceSlug, userId, userParams(filters));
  useRefreshAfterPeek(onChange);

  return (
    <div className="flex flex-col gap-7">
      <WorkStats summary={summary} workHref={(focus) => tabHref("work", focus ? { focus } : {})} />
      <Attention
        workspaceSlug={workspaceSlug}
        attention={summary.attention}
        onJoined={onChange}
        workHref={tabHref("work")}
      />
      <div className="grid grid-cols-1 gap-7 xl:grid-cols-2">
        {cycles && <ActiveCycles workspaceSlug={workspaceSlug} cycles={cycles} href={tabHref("cycles")} />}
        <CompletionTrend trend={summary.trend} />
      </div>
      <ProjectWork projects={summary.projects} />
      <LatestActivity
        workspaceSlug={workspaceSlug}
        userId={userId}
        project={filters.projects.join(",")}
        href={tabHref("activity")}
      />
      <IssuePeekOverview />
    </div>
  );
}

type Props = { workspaceSlug: string; userId: string; tab: TUserWorkTab };

export function UserWorkRoot({ workspaceSlug, userId, tab }: Props) {
  const { t } = useTranslation();
  const { searchParams, setParams } = useUrlFilters();
  const filters = parseUserFilters(searchParams);
  const params = userParams(filters);
  const { data: summary, error, mutate } = useSummary(workspaceSlug, userId, params);

  const tabHref = (target: TUserWorkTab, extra: Record<string, string> = {}) => {
    const query = new URLSearchParams({
      ...(filters.projects.length > 0 ? { project: filters.projects.join(",") } : {}),
      period: String(filters.period),
      ...extra,
    });
    return `/${workspaceSlug}/users/${userId}${target === "overview" ? "" : `/${target}`}?${query.toString()}`;
  };

  if (error && !summary) {
    if ((error as { status?: number }).status === 404)
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
          <MutedCard>{t("users_work.not_found.title")}</MutedCard>
          <Link href={`/${workspaceSlug}/users`} className="text-13 font-medium text-accent-primary hover:underline">
            {t("users_work.not_found.back")}
          </Link>
        </div>
      );
    return <LoadError onRetry={() => void mutate()} />;
  }

  if (!summary)
    return (
      <Loader className="space-y-5 p-6">
        <Loader.Item height="48px" />
        <Loader.Item height="160px" />
        <Loader.Item height="240px" />
      </Loader>
    );

  return (
    <div className="flex h-full w-full flex-col gap-5 overflow-y-auto px-4 py-5 md:px-6">
      <PageHead title={t("users_work.person_page_title", { name: summary.user.name })} />
      <PersonHeader workspaceSlug={workspaceSlug} user={summary.user} />
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-subtle">
        <nav className="flex gap-5 overflow-x-auto">
          {USER_WORK_TABS.map((entry) => (
            <Link
              key={entry}
              href={tabHref(entry)}
              aria-current={entry === tab ? "page" : undefined}
              className={cn("border-b-2 py-2.5 text-13 font-medium whitespace-nowrap", {
                "border-accent-strong text-accent-primary": entry === tab,
                "border-transparent text-tertiary hover:text-primary": entry !== tab,
              })}
            >
              {t(`users_work.tabs.${entry}`)}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <ProjectFilter value={filters.projects} onChange={(ids) => setParams({ project: ids.join(",") || null })} />
          {(tab === "overview" || tab === "work") && (
            <PeriodSelect value={filters.period} onChange={(period) => setParams({ period: String(period) })} />
          )}
        </div>
      </div>
      {tab === "overview" && (
        <OverviewTab
          workspaceSlug={workspaceSlug}
          userId={userId}
          summary={summary}
          filters={filters}
          tabHref={tabHref}
          onChange={() => void mutate()}
        />
      )}
      {tab === "work" && (
        <UserWorkItemsTab workspaceSlug={workspaceSlug} userId={userId} filters={filters} setParams={setParams} />
      )}
      {tab === "cycles" && <UserWorkCyclesTab workspaceSlug={workspaceSlug} userId={userId} filters={filters} />}
      {tab === "activity" && (
        <UserWorkActivityTab workspaceSlug={workspaceSlug} userId={userId} filters={filters} setParams={setParams} />
      )}
    </div>
  );
}

/** The same numbers as admins see, on the person's own "Your work" page. */
export function MyWorkOverview({ workspaceSlug, userId }: { workspaceSlug: string; userId: string }) {
  const { t } = useTranslation();
  const { searchParams, setParams } = useUrlFilters();
  const filters = parseUserFilters(searchParams);
  const params = userParams({ ...filters, projects: [] });
  const { data: summary, error, mutate } = useSummary(workspaceSlug, userId, params);
  const { data: cycles } = useCycles(workspaceSlug, userId, params);
  useRefreshAfterPeek(() => void mutate());

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-16 font-medium">{t("users_work.my_work.title")}</h3>
          <p className="text-12 text-tertiary">{t("users_work.my_work.description")}</p>
        </div>
        <PeriodSelect value={filters.period} onChange={(period) => setParams({ period: String(period) })} />
      </div>
      {error && !summary ? (
        <LoadError onRetry={() => void mutate()} />
      ) : !summary ? (
        <Loader className="space-y-5">
          <Loader.Item height="160px" />
          <Loader.Item height="160px" />
        </Loader>
      ) : (
        <>
          <WorkStats summary={summary} />
          <Attention workspaceSlug={workspaceSlug} attention={summary.attention} onJoined={() => void mutate()} />
          <div className="grid grid-cols-1 gap-7 xl:grid-cols-2">
            {cycles && <ActiveCycles workspaceSlug={workspaceSlug} cycles={cycles} />}
            <CompletionTrend trend={summary.trend} />
          </div>
        </>
      )}
      <IssuePeekOverview />
    </div>
  );
}

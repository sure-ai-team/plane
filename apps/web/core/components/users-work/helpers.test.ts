/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  exportLabels,
  nextSort,
  parseTeamFilters,
  parseUserFilters,
  percentage,
  teamParams,
  userParams,
} from "./helpers";

const PROJECT = "2f1c0a52-3c58-4f7e-9f6f-2d1d7f9d8c11";
const read = (query: string) => new URLSearchParams(query);

describe("team filters", () => {
  it("uses the defaults when the URL is empty", () => {
    expect(parseTeamFilters(read(""))).toEqual({
      search: "",
      roles: [],
      statuses: ["active"],
      projects: [],
      period: 30,
      sort: "name",
      direction: "asc",
      page: 1,
    });
  });

  it("ignores values the API would reject", () => {
    const filters = parseTeamFilters(
      read(`role=20,99&status=gone&project=${PROJECT},x&period=5&sort=password&direction=up&page=-2`)
    );
    expect(filters).toMatchObject({
      roles: ["20"],
      statuses: ["active"],
      projects: [PROJECT],
      period: 30,
      sort: "name",
      direction: "asc",
      page: 1,
    });
  });

  it("sends only the filters that are set", () => {
    expect(teamParams(parseTeamFilters(read("search=%20mus%20&role=15")))).toEqual({
      search: "mus",
      role: "15",
      status: "active",
      period: 30,
      sort: "name",
      direction: "asc",
    });
  });
});

describe("sorting", () => {
  it("starts with the highest number, and with A for names", () => {
    expect(nextSort({ sort: "name", direction: "asc" }, "overdue")).toEqual({ sort: "overdue", direction: "desc" });
    expect(nextSort({ sort: "overdue", direction: "desc" }, "name")).toEqual({ sort: "name", direction: "asc" });
  });

  it("turns around when the same column is clicked again", () => {
    expect(nextSort({ sort: "open", direction: "desc" }, "open").direction).toBe("asc");
    expect(nextSort({ sort: "open", direction: "asc" }, "open").direction).toBe("desc");
  });
});

describe("user filters", () => {
  it("reads the filters of one person's page", () => {
    const filters = parseUserFilters(
      read(`project=${PROJECT}&period=90&focus=stuck&layout=board&start=2026-11-01&end=2026-13-99`)
    );
    expect(filters).toEqual({
      projects: [PROJECT],
      period: 90,
      focus: "stuck",
      layout: "board",
      start: "2026-11-01",
      end: null,
    });
    expect(userParams(filters)).toEqual({ project: PROJECT, period: 90 });
  });
});

describe("numbers and labels", () => {
  it("never divides by zero", () => {
    expect(percentage(0, 0)).toBe(0);
    expect(percentage(1, 3)).toBe(33);
  });

  it("translates every header and value of an export", () => {
    const labels = exportLabels((key) => `t:${key}`);
    expect(labels.overdue).toBe("t:users_work.columns.overdue");
    expect(labels.role_20).toBe("t:users_work.role.admin");
    expect(labels.status_suspended).toBe("t:users_work.status.suspended");
    expect(labels.priority_urgent).toBe("t:reports.values.urgent");
  });
});

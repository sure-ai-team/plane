/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  areHeadingsEqual,
  buildOutline,
  getActiveOutlineIndex,
  parseOverviewTab,
  parseSectionHash,
  slugifyHeading,
  withOverviewTab,
} from "./helpers";

const h = (level: number, text: string) => ({ level, text });

describe("parseOverviewTab", () => {
  it("defaults to the README", () => {
    expect(parseOverviewTab(null)).toBe("readme");
    expect(parseOverviewTab(undefined)).toBe("readme");
    expect(parseOverviewTab("")).toBe("readme");
  });

  it("accepts known tabs, ignoring case and whitespace", () => {
    expect(parseOverviewTab("data")).toBe("data");
    expect(parseOverviewTab(" DATA ")).toBe("data");
    expect(parseOverviewTab("readme")).toBe("readme");
  });

  it("falls back to the README for unknown values", () => {
    expect(parseOverviewTab("files")).toBe("readme");
    expect(parseOverviewTab("__proto__")).toBe("readme");
  });
});

describe("withOverviewTab", () => {
  it("sets the param for non-default tabs and keeps other params", () => {
    const next = withOverviewTab(new URLSearchParams("peek=1"), "data");
    expect(next.get("tab")).toBe("data");
    expect(next.get("peek")).toBe("1");
  });

  it("removes the param for the default tab", () => {
    const next = withOverviewTab(new URLSearchParams("tab=data&peek=1"), "readme");
    expect(next.has("tab")).toBe(false);
    expect(next.toString()).toBe("peek=1");
  });

  it("does not mutate the input", () => {
    const current = new URLSearchParams("tab=data");
    withOverviewTab(current, "readme");
    expect(current.get("tab")).toBe("data");
  });
});

describe("slugifyHeading", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugifyHeading("Getting Started!")).toBe("getting-started");
    expect(slugifyHeading("  API & SDK — v2  ")).toBe("api-sdk-v2");
  });

  it("strips accents but keeps non-Latin scripts", () => {
    expect(slugifyHeading("Café déjà vu")).toBe("cafe-deja-vu");
    expect(slugifyHeading("Начало работы")).toBe("начало-работы");
    expect(slugifyHeading("Мой проект")).toBe("мой-проект");
    expect(slugifyHeading("はじめに")).toBe("はじめに");
  });

  it("falls back when nothing is left", () => {
    expect(slugifyHeading("!!!")).toBe("section");
    expect(slugifyHeading("")).toBe("section");
  });
});

describe("buildOutline", () => {
  it("returns nothing for a document without headings", () => {
    expect(buildOutline([])).toEqual([]);
    expect(buildOutline([h(1, "   ")])).toEqual([]);
  });

  it("keeps the original heading index so items map to DOM headings", () => {
    const outline = buildOutline([h(1, "Intro"), h(2, ""), h(4, "Deep"), h(2, "Setup")]);
    expect(outline.map((item) => [item.index, item.text])).toEqual([
      [0, "Intro"],
      [3, "Setup"],
    ]);
  });

  it("indents relative to the shallowest heading", () => {
    const outline = buildOutline([h(2, "Goals"), h(3, "Non-goals"), h(2, "Users")]);
    expect(outline.map((item) => item.depth)).toEqual([0, 1, 0]);
  });

  it("gives duplicate headings unique ids", () => {
    const outline = buildOutline([h(2, "Notes"), h(2, "Notes"), h(3, "notes")]);
    expect(outline.map((item) => item.id)).toEqual(["notes", "notes-2", "notes-3"]);
  });

  it("trims heading text", () => {
    expect(buildOutline([h(1, "  Overview  ")])[0]).toMatchObject({ text: "Overview", id: "overview" });
  });
});

describe("areHeadingsEqual", () => {
  it("compares level and text in order", () => {
    expect(areHeadingsEqual([h(1, "A"), h(2, "B")], [h(1, "A"), h(2, "B")])).toBe(true);
    expect(areHeadingsEqual([], [])).toBe(true);
  });

  it("detects edits, reordering, and level changes", () => {
    expect(areHeadingsEqual([h(1, "A")], [h(1, "Ab")])).toBe(false);
    expect(areHeadingsEqual([h(1, "A"), h(2, "B")], [h(2, "B"), h(1, "A")])).toBe(false);
    expect(areHeadingsEqual([h(1, "A")], [h(2, "A")])).toBe(false);
    expect(areHeadingsEqual([h(1, "A")], [h(1, "A"), h(2, "B")])).toBe(false);
  });
});

describe("getActiveOutlineIndex", () => {
  it("returns -1 without headings", () => {
    expect(getActiveOutlineIndex([], 80)).toBe(-1);
  });

  it("highlights the first heading before any has been scrolled past", () => {
    expect(getActiveOutlineIndex([200, 600, 900], 80)).toBe(0);
  });

  it("highlights the last heading scrolled past the offset", () => {
    expect(getActiveOutlineIndex([-400, -10, 80, 300], 80)).toBe(2);
    expect(getActiveOutlineIndex([-900, -600, -300], 80)).toBe(2);
  });
});

describe("parseSectionHash", () => {
  it("reads and decodes the section id", () => {
    expect(parseSectionHash("#getting-started")).toBe("getting-started");
    expect(parseSectionHash("#%D0%BD%D0%B0%D1%87%D0%B0%D0%BB%D0%BE")).toBe("начало");
  });

  it("returns null for an empty hash", () => {
    expect(parseSectionHash("")).toBeNull();
    expect(parseSectionHash("#")).toBeNull();
    expect(parseSectionHash(null)).toBeNull();
  });

  it("keeps malformed escapes as they are", () => {
    expect(parseSectionHash("#100%")).toBe("100%");
  });
});

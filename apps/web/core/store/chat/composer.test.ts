/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  EMOJI_SHORTCODES,
  MAX_EMOJI_SUGGESTIONS,
  emojiSuggestions,
  replaceTrailingToken,
  shortcodeQuery,
  slashQuery,
  slashSuggestions,
  workItemLinkHtml,
} from "@/components/chat/composer/helpers";

/** Mirrors BROWSE_PATH in apps/api/plane/utils/chat_work_items.py. */
const BROWSE_PATH = /^\/(?<slug>[^/]+)\/browse\/(?<identifier>[A-Za-z0-9]+)-(?<sequence>\d+)\/?$/;

describe("emoji shortcodes", () => {
  it("detects a :word being typed at the end", () => {
    expect(shortcodeQuery("ship it :thu")).toBe("thu");
    expect(shortcodeQuery(":ta")).toBe("ta");
    expect(shortcodeQuery("ship it :t")).toBeNull();
    expect(shortcodeQuery("time 10:30")).toBeNull();
    expect(shortcodeQuery("ship :thu done")).toBeNull();
  });

  it("suggests prefix matches first, capped", () => {
    expect(emojiSuggestions("thu")[0]).toEqual({ name: "thumbsup", emoji: "👍" });
    expect(emojiSuggestions("heart").map((item) => item.name)).toEqual([
      "heart",
      "heart_eyes",
      "green_heart",
      "blue_heart",
    ]);
    expect(emojiSuggestions("a").length).toBeLessThanOrEqual(MAX_EMOJI_SUGGESTIONS);
    expect(new Set(EMOJI_SHORTCODES.map(([name]) => name)).size).toBe(EMOJI_SHORTCODES.length);
  });
});

describe("slash commands", () => {
  it("only trigger when the whole message is the command", () => {
    expect(slashQuery("/wo")).toBe("wo");
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("see /wo")).toBeNull();
    expect(slashQuery("/wo rk")).toBeNull();
    expect(slashSuggestions("wo")).toEqual(["workitem"]);
    expect(slashSuggestions("")).toHaveLength(5);
  });
});

describe("replaceTrailingToken", () => {
  it("replaces the token at the end of the editor HTML", () => {
    expect(replaceTrailingToken("<p>ship it :thu</p>", ":thu", "👍 ")).toBe("<p>ship it 👍 </p>");
    expect(replaceTrailingToken("<p><strong>ok :ta</strong></p>", ":ta", "🎉")).toBe("<p><strong>ok 🎉</strong></p>");
    expect(replaceTrailingToken("<p>/wo</p>", "/wo", "")).toBe("<p></p>");
  });

  it("refuses when the token isn't last, and treats it literally", () => {
    expect(replaceTrailingToken("<p>:thu then more</p>", ":thu", "👍")).toBeNull();
    expect(replaceTrailingToken("<p>a+b</p>", "a+b", "x")).toBe("<p>x</p>");
  });
});

describe("work item links", () => {
  it("builds the canonical link the server turns into a reference", () => {
    const html = workItemLinkHtml("acme", { identifier: "MOB", sequenceId: 142, name: "Fix <login> & crash" });
    expect(html).toBe('<a href="/acme/browse/MOB-142/">MOB-142 Fix &lt;login&gt; &amp; crash</a>');
    const href = /href="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(BROWSE_PATH.exec(href)?.groups).toEqual({ slug: "acme", identifier: "MOB", sequence: "142" });
  });
});

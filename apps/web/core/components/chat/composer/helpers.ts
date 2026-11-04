/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Common `:shortcode:` names. The full picker (search, categories, skin tones)
 * covers everything else; this list keeps inline suggestions instant and offline.
 */
export const EMOJI_SHORTCODES: Array<[string, string]> = [
  ["thumbsup", "👍"],
  ["+1", "👍"],
  ["thumbsdown", "👎"],
  ["heart", "❤️"],
  ["joy", "😂"],
  ["laughing", "😆"],
  ["smile", "😄"],
  ["grin", "😁"],
  ["slightly_smiling", "🙂"],
  ["wink", "😉"],
  ["blush", "😊"],
  ["heart_eyes", "😍"],
  ["thinking", "🤔"],
  ["neutral", "😐"],
  ["expressionless", "😑"],
  ["sweat_smile", "😅"],
  ["rofl", "🤣"],
  ["sob", "😭"],
  ["cry", "😢"],
  ["angry", "😠"],
  ["rage", "😡"],
  ["scream", "😱"],
  ["sleeping", "😴"],
  ["sunglasses", "😎"],
  ["upside_down", "🙃"],
  ["facepalm", "🤦"],
  ["shrug", "🤷"],
  ["pray", "🙏"],
  ["clap", "👏"],
  ["wave", "👋"],
  ["ok_hand", "👌"],
  ["muscle", "💪"],
  ["raised_hands", "🙌"],
  ["point_up", "☝️"],
  ["eyes", "👀"],
  ["tada", "🎉"],
  ["party", "🥳"],
  ["fire", "🔥"],
  ["rocket", "🚀"],
  ["star", "⭐"],
  ["sparkles", "✨"],
  ["100", "💯"],
  ["check", "✅"],
  ["white_check_mark", "✅"],
  ["x", "❌"],
  ["warning", "⚠️"],
  ["question", "❓"],
  ["exclamation", "❗"],
  ["bulb", "💡"],
  ["memo", "📝"],
  ["pushpin", "📌"],
  ["calendar", "📅"],
  ["clock", "🕒"],
  ["hourglass", "⏳"],
  ["bug", "🐛"],
  ["wrench", "🔧"],
  ["hammer", "🔨"],
  ["gear", "⚙️"],
  ["lock", "🔒"],
  ["key", "🔑"],
  ["link", "🔗"],
  ["chart", "📈"],
  ["coffee", "☕"],
  ["pizza", "🍕"],
  ["cake", "🎂"],
  ["gift", "🎁"],
  ["trophy", "🏆"],
  ["medal", "🏅"],
  ["handshake", "🤝"],
  ["sunny", "☀️"],
  ["moon", "🌙"],
  ["rainbow", "🌈"],
  ["zap", "⚡"],
  ["boom", "💥"],
  ["skull", "💀"],
  ["see_no_evil", "🙈"],
  ["green_heart", "💚"],
  ["blue_heart", "💙"],
  ["saudi", "🇸🇦"],
];

export const MAX_EMOJI_SUGGESTIONS = 6;

/** The `:word` being typed at the end of the text, or null. */
export const shortcodeQuery = (text: string): string | null => {
  const match = /(?:^|\s):([a-z0-9_+-]{2,30})$/i.exec(text);
  return match ? match[1].toLowerCase() : null;
};

/** Shortcodes starting with the query first, then ones containing it. */
export const emojiSuggestions = (query: string): Array<{ name: string; emoji: string }> => {
  const starts: Array<{ name: string; emoji: string }> = [];
  const contains: Array<{ name: string; emoji: string }> = [];
  for (const [name, emoji] of EMOJI_SHORTCODES) {
    if (name.startsWith(query)) starts.push({ name, emoji });
    else if (name.includes(query)) contains.push({ name, emoji });
  }
  return [...starts, ...contains].slice(0, MAX_EMOJI_SUGGESTIONS);
};

export type TSlashCommand = "workitem" | "link" | "mute" | "code" | "shrug";
export const SLASH_COMMANDS: TSlashCommand[] = ["workitem", "link", "mute", "code", "shrug"];

/** The command being typed when the whole message is "/word", or null. */
export const slashQuery = (text: string): string | null => {
  const match = /^\/([a-z]*)$/i.exec(text.trim());
  return match ? match[1].toLowerCase() : null;
};

export const slashSuggestions = (query: string, commands: TSlashCommand[] = SLASH_COMMANDS): TSlashCommand[] =>
  commands.filter((command) => command.startsWith(query));

/**
 * Replace a token typed at the very end of the composer (":thu", "/wo") in the
 * editor HTML. Returns null when the token isn't the last text in the HTML.
 */
export const replaceTrailingToken = (html: string, token: string, replacement: string): string | null => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}((?:\\s*</[a-z0-9-]+>)*\\s*)$`, "i");
  if (!pattern.test(html)) return null;
  return html.replace(pattern, `${replacement}$1`);
};

/** A link to a work item that chat turns into a card (docs/chat/phase-2/DECISIONS.md P2-D13). */
export const workItemLinkHtml = (
  workspaceSlug: string,
  item: { identifier: string; sequenceId: number; name: string }
): string => {
  const key = `${item.identifier}-${item.sequenceId}`;
  const label = `${key} ${item.name}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<a href="/${workspaceSlug}/browse/${key}/">${label}</a>`;
};

export const SHRUG = "¯\\_(ツ)_/¯";

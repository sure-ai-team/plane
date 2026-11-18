# 10 — i18n keys (additions)

Namespace `chat`, ICU format, English in **both** `packages/i18n/src/locales/en/chat.json` and `packages/i18n/locales/en/chat.json` (the runtime loads the second). Other locales stay `{}` until the translations PR (D22). Follow the `translate` skill when that PR happens.

```text
chat.reactions.add                 "Add reaction"
chat.reactions.tooltip             "{names} reacted with {emoji}"
chat.reactions.and_others          "{names} and {count, plural, one {# other} other {# others}}"
chat.picker.search                 "Search emoji"
chat.picker.frequent               "Frequently used"
chat.pins.title                    "Pinned"
chat.pins.count                    "Pinned · {index} of {total}"
chat.pins.pin / unpin              "Pin message" / "Unpin message"
chat.pins.system_pinned            "{name} pinned a message"
chat.pins.system_unpinned          "{name} unpinned a message"
chat.pins.limit                    "This conversation has reached 50 pinned messages."
chat.jump.to_message               "Jump to message"
chat.jump.highlight                "Jumped here from a reply"
chat.unread.divider                "New"
chat.unread.pill                   "{count, plural, one {# new message} other {# new messages}} since {time}"
chat.unread.jump                   "Jump"
chat.message.edited                "(edited)"
chat.message.copy_link             "Copy link to message"
chat.message.no_access             "You don't have access to this message."
chat.forward.title                 "Forward message"
chat.forward.to                    "To"
chat.forward.note                  "Add a message (optional)"
chat.forward.submit                "{count, plural, one {Send to # conversation} other {Send to # conversations}}"
chat.forward.from                  "Forwarded from {name}"
chat.sidebar.filter.all / unread / mentions
chat.sidebar.starred / archived / draft ("Draft: {text}")
chat.sidebar.star / unstar / archive / unarchive / mark_read
chat.search.placeholder            "Search messages"
chat.search.filter.in / from / has / date
chat.search.results                "{count, plural, one {# result} other {# results}}"
chat.search.empty                  "No messages match your search."
chat.notify.level.all / mentions / off (+ .description)
chat.notify.snooze / snooze_1h / snooze_8h / snooze_tomorrow
chat.notify.blocked                "Your browser is blocking notifications for this site."
chat.notify.how_to_allow           "How to allow"
chat.notify.new_message            "New message"
chat.notify.sent_photo / sent_video / sent_voice / sent_file
chat.prefs.title / desktop / sound / preview / inbox (+ .description)
chat.prefs.layout.title / bubbles / compact / direct_only
chat.prefs.minimize.title / docked / heads
chat.composer.toolbar.bold / italic / strike / code / list / ordered_list / quote / link
chat.composer.draft_saved          "Draft saved"
chat.slash.workitem / link / mute / code / shrug (+ .description)
chat.dock.open_full / minimize / close / launcher / open_in_window
chat.workitem.share / discuss / discussed_in ("Discussed in chat · {count}")
chat.states.empty_title            "Talk with your workspace"
chat.states.empty_body             …
chat.states.new_conversation       "This is the start of your conversation with {name}."
chat.states.offline                "You're offline. Messages you send will go out when you reconnect."
chat.states.waiting                "Waiting to send"
chat.states.back_online            "Back online · caught up on {count, plural, one {# new message} other {# new messages}}"
chat.shortcuts.title + one key per row in P2PowerK
chat.inbox.mentioned               "{name} mentioned you in {conversation}"
chat.inbox.direct                  "{name} sent you a message"
```

Exact strings are final in each PR; this list is the inventory, so nothing is missed.

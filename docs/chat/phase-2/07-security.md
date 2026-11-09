# 07 — Security and privacy (additions)

Phase 1's threat list (`docs/chat/07-security.md`, S1–S…) still applies. New cases:

| #      | Threat                                                                      | Control                                                                                                                                                                  | PR    |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| P2-S1  | Search returns messages from conversations you left or were never in        | The query joins on **active** membership; contract test with a former member and an outsider                                                                             | 9     |
| P2-S2  | Search snippet injects HTML                                                 | Snippet built from `body_stripped`, escaped, then only `<mark>` restored; the client renders through the sanitizer                                                       | 9     |
| P2-S3  | Forward leaks a private conversation's name or files                        | Forwarder must be in source and targets; `forwarded_from.conversation_*` only for viewers who are members of the source; files copied to new objects owned by the target | 9     |
| P2-S4  | Work-item card leaks a private project's work item                          | API returns ids only; details come from existing issue APIs with project permissions; unknown → plain chip                                                               | 9, 15 |
| P2-S5  | "Discussed in chat" reveals private conversations                           | Only conversations where the caller is an active member                                                                                                                  | 9     |
| P2-S6  | Message link opened by a non-member                                         | `around_seq` checks membership (404); UI shows "no access"                                                                                                               | 9, 10 |
| P2-S7  | Reaction / pin spam                                                         | Throttles `chat_react`, `chat_pin`; 20 distinct emoji per message; 50 pins per conversation                                                                              | 9     |
| P2-S8  | Emoji field abused for arbitrary text                                       | Server validates a single emoji grapheme (regex on Unicode emoji properties + length ≤ 32 bytes)                                                                         | 9     |
| P2-S9  | Desktop notification shows private text on a shared screen                  | `show_preview` toggle; default on, documented                                                                                                                            | 12    |
| P2-S10 | Inbox row survives a hard delete                                            | Message delete deletes its Inbox rows in the same transaction                                                                                                            | 9     |
| P2-S11 | Dock state in `localStorage` shows conversations after logout / user switch | Keys include the user id; cleared on sign-out together with drafts                                                                                                       | 14    |
| P2-S12 | Drafts persisted in `localStorage` on shared machines                       | Same as above; drafts are cleared on sign-out                                                                                                                            | 11    |

## Per-PR checklist

- [ ] Every new endpoint checks workspace role (admin/member, not guest) **and** conversation membership.
- [ ] No new response field exposes data from a conversation the viewer isn't in.
- [ ] Throttles registered and tested (429).
- [ ] Hard delete: new rows cascade or are deleted explicitly; storage copies scheduled for deletion.

# 06 — Search

## Engine

Postgres full-text search on `Message.body_stripped` (P2-D3):

- Index: `GinIndex(SearchVector("body_stripped", config="simple"))`, created concurrently.
- **`simple` config**, not `english`: no stemming, but it works the same for Arabic and English text and doesn't drop words. Prefix matching covers most of what stemming would (`to_tsquery('simple', 'deploy:*')`).
- Query building: split the user's text into terms, escape, AND them with `:*` on the last term (search-as-you-type). Quoted phrases use `<->`.
- Attachment names: the `has=file` filter plus matching `FileAsset.attributes->>'name' ILIKE` for the attachment list. Results include `attachment_names`.

## Query shape

```sql
-- conversations the caller can read
WITH mine AS (
  SELECT conversation_id FROM chat_conversation_members
  WHERE member_id = :user AND workspace_id = :ws AND is_active)
SELECT m.*, ts_rank(...) AS rank,
       ts_headline('simple', m.body_stripped, q, 'StartSel=<mark>,StopSel=</mark>,MaxWords=30,MinWords=12') AS snippet
FROM chat_messages m JOIN mine USING (conversation_id), to_tsquery('simple', :q) q
WHERE to_tsvector('simple', m.body_stripped) @@ q
  [AND m.conversation_id = :conv] [AND m.sender_id = :from] [AND m.created_at BETWEEN …] [has-filter EXISTS (…)]
ORDER BY rank DESC, m.created_at DESC
LIMIT 26;  -- 25 + 1 to detect next page
```

- Cursor: opaque base64 of `(rank, created_at, id)`.
- `total_estimate`: `count(*)` capped at 1,000 ("1,000+"), computed only for the first page.
- `ts_headline` runs only on the 25 returned rows (wrap in a subquery).
- The snippet is escaped first, then the `<mark>` tags are restored, so message HTML can never be injected.

## Has filters

| `has`                       | Condition                                                                   |
| --------------------------- | --------------------------------------------------------------------------- |
| `file`                      | Any `FileAsset` with `chat_message = m` and kind `file`                     |
| `image` / `video` / `voice` | Attachment kind; voice = `is_voice`                                         |
| `link`                      | `body_html` contains `<a href="http` (pre-computed `meta.has_link` on send) |
| `work_item`                 | `EXISTS MessageWorkItem`                                                    |

## Performance budget

- p95 < 300 ms for a workspace with 2 M messages and a user in 200 conversations (seeded in a perf test, not CI).
- A contract test asserts the plan uses `chat_msg_search_idx` (`EXPLAIN` contains the index name) on a seeded dataset.

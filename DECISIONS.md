# Decisions

## Three most important decisions

1. **A separate Express API with a layered structure, instead of a full-stack framework.**
   Routes → controller → service → model, with Zod validating every request at the edge and a
   single error-handling middleware. Each layer has one job, the app is built by a factory so it
   can be tested without opening a port, and the API can be reused by other clients later.

2. **Validate everything at the boundary and make failure predictable.**
   Zod schemas reject bad input (unknown fields, bad enums, malformed ids, out-of-range paging)
   with a consistent `{ error: { code, message, details } }` shape. Search input is regex-escaped,
   bodies are size-limited, and Helmet, CORS and rate limiting are on. The environment is also
   validated at startup so the server fails fast on bad config. `POST` accepts an `Idempotency-Key`
   so a retry can never create a duplicate task (details below).

3. **TanStack Query with optimistic updates for the UI.**
   Server state lives in the query cache, not in hand-rolled `useEffect` fetching. Status changes
   and deletes update the UI instantly, roll back from a snapshot if the request fails, and
   always re-sync with the server afterwards. Failed creates keep what the user typed.

## Three things I chose not to implement

1. **Authentication and multi-user accounts.** The brief is a simple task manager. Auth would add
   sessions, password handling and per-user data rules, and a half-done version is worse than
   none. Tasks are global for now. The next step would be JWT, a user model and a `userId` on
   every task and query (the idempotency key would then be scoped per user).
2. **Real-time sync (WebSockets).** Useful for collaboration, but it needs auth and conflict
   handling first, and a single-user task list doesn't benefit from it.
3. **Subtasks, tags and recurring tasks.** These grow the data model and UI a lot. I spent the
   time on a solid core: validation, tests, tooling and UX states.

## One limitation I would fix with one more day

**Search is a case-insensitive regex scan over title and description.** The input is escaped, so it
is safe, but a pattern like this cannot use an index, so MongoDB has to read every task and the
cost grows with the size of the collection. With another day I would add a MongoDB text index, which
is fast and ranks results. It matches whole words and stems, not parts of a word ("inv" would no
longer find "invoice"), so I would check that trade-off with users first; if partial matching
matters, Atlas Search handles it.

## Also worth knowing

- **One small fetch client, not Axios.** All web requests go through `api/http.ts`, which has
  request, response and error interceptors (request ids, error reporting, timing) and mirrors the
  Axios interceptor API in about 150 tested lines with no dependency. Feature code only calls
  `http.get/post/...`, so adding auth later means registering an interceptor, and switching to Axios
  would mean editing one file. I would pick Axios for upload progress, very old browsers or built-in
  XSRF handling, none of which apply. Environment is read only through `config/env.ts`.
- **Idempotency on `POST` only.** `PATCH` (`$set`) and `DELETE` are already safe to repeat; `POST`
  is the one request where a timeout followed by a retry creates a duplicate. The first request
  claims the key with a unique-index insert (atomic). The same key and body replays the stored
  response, a different body returns 422, and a concurrent duplicate returns 409. Only 2xx
  responses are stored. An unfinished request holds the key under a 60-second lease, so a crash
  cannot block it for the full 24-hour expiry: after the lease, exactly one retry takes it over with
  an atomic conditional update. The known risk is a request slower than the lease, which would run
  twice; the lease is far longer than any request here. The records live in MongoDB so the app needs
  no extra service and they survive restarts; at higher load Redis (set-if-not-exists with an expiry)
  would be the faster home. The client reuses a key only for a retry of
  identical data.
- **One source of truth.** Enums, limits, error codes and header names live in `shared/`, which both
  the API and the UI import. Request validation drives the OpenAPI document, and a test fails if a
  route is undocumented. Enum-like values are `as const` objects rather than `enum`s: plain
  JavaScript that works with Zod, Mongoose, esbuild and `isolatedModules`.
- **Swappable seams for logging, caching and error reporting.** The app depends on small interfaces
  (`Logger`, `Cache`, `ErrorReporter`) and one file per interface chooses the implementation: pino,
  an in-memory cache and a console reporter today; Winston, Redis and Sentry or Last9 would each be
  one new file and one changed line. Logs are JSON in production with a request id on every line,
  a single masking policy (`logging/redact.ts`) replaces any field whose name looks sensitive, at any depth and in any letter case, before it reaches the logger, and query strings are never logged because they can contain search text.
- **Indexes designed from query plans.** I checked the real queries with `explain("executionStats")`
  on 50,000 synthetic tasks. An index only helps a sorted list if it ends with the same sort keys,
  including the `_id` tiebreaker used for stable pagination; otherwise MongoDB sorts in memory.

  | Query (50,000 tasks)        | Documents examined without it   | With the matching index   |
  | --------------------------- | ------------------------------- | ------------------------- |
  | List, newest first          | 50,000 (collection scan + sort) | 10                        |
  | List, status = todo         | 16,779 (in-memory sort)         | 10                        |
  | List, priority = high       | 16,676 (in-memory sort)         | 10                        |
  | List, page 200 (skip 1,990) | 50,000                          | 2,000 index keys, 10 docs |
  | Overdue count               | 33,388                          | 6,708                     |

  Priority and status are stored as readable words (`"high"`, `"in_progress"`) rather than numbers,
  so a record is clear in the database, the API and the logs without a lookup table. I chose that
  clarity over raw speed. Its cost is that sorting by priority needs a computed rank, and sorting by
  due date puts "none" last, so neither can use an index and those sorts run in memory over the
  matching documents: about 29 ms for priority and 26 ms for due date at 50,000 tasks, against 8 ms for the
  indexed newest-first list. That is fine here and grows linearly; the next step would be a
  denormalised `priorityRank` field with a compound index, not worth its backfill migration below
  roughly 100,000 tasks. `allowDiskUse` is on so the 100 MB in-memory sort limit degrades gracefully.
  The data is synthetic and the timings are from a laptop, so trust the document counts more than
  the milliseconds. Every extra index costs write time and storage, which is why there are four.

- **A cache with correct invalidation.** The stats aggregation scans every task, so it is cached for
  a few seconds. Concurrent misses share one load (no stampede), writes through the API clear the
  cache, and a slow read that started before a write cannot store its stale result after the write.
  With several instances each cache can be one TTL stale; the next step is Redis behind the same
  interface. Lists are not cached on the server: clients revalidate with an ETag and get a bodyless 304.
- **Failures are visible and traceable.** A React error boundary replaces the blank page a render
  error would otherwise cause. Uncaught errors, unhandled rejections, 5xx responses and timeouts go
  through the `ErrorReporter`. Server errors show a short reference that is the request id, which is
  also on every server log line.
- **Accessibility is audited, not assumed.** axe-core in real Chrome (WCAG 2.0 to 2.2 A/AA, including
  colour contrast and target size) reports zero violations across the list, the form, edit mode and
  the delete dialog, in light and dark, at desktop and mobile widths. The UI uses native controls
  (radio group, `<select>`, `<dialog>`), never relies on colour alone ("Overdue · 20 Oct" is words
  plus colour), and keeps the Tab order the same as the reading order.

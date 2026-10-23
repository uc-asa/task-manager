# Task Manager

A small full-stack task manager built for the Hammoq Infosystems MERN assessment.

**Stack:** MongoDB · Express 5 · React 19 (Vite) · Node 22 — all TypeScript.

## Features

- Create, edit, delete tasks (title, description, status, priority, due date)
- Quick-add bar with one-click priority and due-date shortcuts (Today / Tomorrow / Next week), a one-click complete checkbox, status tabs with counts, and a summary (open / overdue / done)
- Change status inline with an **optimistic update** (rolls back if the request fails)
- Search (debounced), filter by status and priority, sort, server-side pagination
- Safe retries: creating a task sends an `Idempotency-Key`, so a retry never makes a duplicate
- Relative due dates ("Due today", "Overdue · 20 Oct"), skeleton loading, empty and error states, a custom delete confirmation modal
- A React error boundary and an error-reporting hook; server errors show a request reference
- Accessible: zero axe-core violations (WCAG 2.2 AA, incl. colour contrast and target size) in light and dark, on desktop and mobile; native form controls, labelled groups, logical tab order, 44px touch targets
- Light and dark theme via `prefers-color-scheme`

## Quick start

Requirements: Node 22 (`nvm use`; 20.19+ works) and MongoDB (local, or via Docker).

```bash
npm install                 # also builds the shared package
cp .env.example .env        # defaults work with a local MongoDB or the docker-compose one
docker compose up -d        # MongoDB only; skip if you already run it locally
npm run seed -w server      # optional: 12 sample tasks (only if the database is empty)
npm run dev                 # API on :4000, web app on :5173
```

Open http://localhost:5173. Editing `shared/` rebuilds it and restarts the API automatically. API documentation (Swagger UI) is at http://localhost:4000/api/docs.

### Everything in Docker

```bash
docker compose --profile app up --build   # MongoDB + API + web (nginx) on http://localhost:8080
```

nginx serves the built web app and proxies `/api` to the API, so the browser sees one origin.

## Scripts

| Command                           | What it does                                        |
| --------------------------------- | --------------------------------------------------- |
| `npm run dev`                     | Run API and web app together                        |
| `npm run lint` / `lint:fix`       | ESLint (type-aware rules)                           |
| `npm run format` / `format:check` | Prettier                                            |
| `npm run typecheck`               | `tsc --noEmit` for both workspaces                  |
| `npm test`                        | API and client unit tests (see below)               |
| `npm run check`                   | Lint + format + typecheck + tests (what CI runs)    |
| `npm run build`                   | Production build of API (`server/dist`) and web app |
| `npm run seed -w server`          | 12 sample tasks (add `-- --reset` to replace tasks) |

A Husky pre-commit hook runs lint-staged (ESLint + Prettier on staged files).
GitHub Actions (`.github/workflows/ci.yml`) runs the full check on every push / PR.

## Tests

Run everything with `npm test`.

**Web (`client/src`)**

- `App.test.tsx`: the whole app through React Testing Library: the optimistic update **and its rollback**, delete, the form, filters, sorting, pagination, idempotency keys, counts and relative dates.
- `api/http.test.ts`, `api/tasks.test.ts`: the HTTP client and its interceptors, and the **exact requests that are sent** (so a filter or sort that never reaches the URL is caught).
- `components/ErrorBoundary.test.tsx`, `observability/errorReporter.test.ts`, `utils/errors.test.ts`: crash handling and error reporting.
- `config/env.test.ts`, `utils/date.test.ts`: environment parsing and date/timezone helpers.

**API (`server/tests`)**

- `validation.test.ts`: request validation, error format, security headers. No database needed.
- `tasks.integration.test.ts`: CRUD, filtering, search, sorting (including priority), pagination, stats, caching and idempotency (including a crashed request) against an in-memory MongoDB (`mongodb-memory-server`, which downloads a MongoDB binary on first run).
- `cache.test.ts`: the cache, including single-flight loading and not storing stale data after an invalidation.
- `logging.test.ts`, `redact.test.ts`: the access log, request ids, and that secrets are masked at any depth.
- `openapi.test.ts`: the API docs are generated from the validation schemas, and a test fails if a route is added without being documented.

## API

All responses are JSON. Errors always look like `{ "error": { "code", "message", "details?" } }`.

| Method | Path               | Description                                                     |
| ------ | ------------------ | --------------------------------------------------------------- |
| GET    | `/api/health`      | Liveness check (process is up)                                  |
| GET    | `/api/ready`       | Readiness check (503 until MongoDB is connected)                |
| GET    | `/api/tasks`       | List. Query: `status`, `priority`, `q`, `page`, `limit`, `sort` |
| POST   | `/api/tasks`       | Create (`title` required). Optional `Idempotency-Key` header    |
| GET    | `/api/tasks/stats` | Counts by status and overdue (`?today=YYYY-MM-DD`)              |
| GET    | `/api/tasks/:id`   | Get one                                                         |
| PATCH  | `/api/tasks/:id`   | Partial update (at least one field)                             |
| DELETE | `/api/tasks/:id`   | Delete (204)                                                    |

Headers: every response carries `X-Request-Id` (send your own to correlate logs). A `POST` with an
`Idempotency-Key` is stored for 24h: the same key and body replays the original response
(`Idempotent-Replayed: true`), a different body returns 422, a concurrent duplicate returns 409.
`PATCH` and `DELETE` are naturally idempotent and need no key.

List response: `{ "data": Task[], "meta": { "total", "page", "limit", "totalPages" } }`.

`sort` values: `-createdAt` (default, newest first), `createdAt`, `dueDate`, `-dueDate` (tasks without a due date always last), `-priority` (high first), `priority` (low first). Unknown query parameters are rejected with a 400.

## Project structure

```
shared/src                types and constants used by both sides (statuses, priorities, error codes,
                          header names, API shapes): one source of truth, built to shared/dist
server/src
  app.ts                  app factory (middleware, routes, docs): no side effects, easy to test
  server.ts               process entry: DB connection, listen, graceful shutdown
  config/env.ts           Zod-validated environment
  logging/                Logger interface (what the app uses), pino adapter (the only pino import),
                          redact.ts (the one place that decides which fields are masked)
  cache/                  Cache interface + in-memory store + read-through wrapper (single flight, safe invalidation)
  middleware/             request id · access log · one place that turns every error into a JSON response
  modules/tasks/          schema (Zod) · model (Mongoose) · service · controller · routes
  modules/idempotency/    Idempotency-Key middleware + TTL-indexed record store
  docs/openapi.ts         OpenAPI document generated from the Zod schemas
  scripts/seed.ts         sample data
client/src
  config/env.ts           validated VITE_* environment (dev vs prod behaviour in one place)
  api/http.ts             fetch client with request / response / error interceptors
  api/interceptors.ts     request id, auth header, 401 handling, timing
  api/client.ts           the app's single client instance; register interceptors here
  api/tasks.ts            task endpoints (feature modules only call the client)
  observability/          ErrorReporter interface + global handlers (swap in Sentry or Last9)
  hooks/                  useTasks (TanStack Query: optimistic updates, idempotency keys), useTaskFilters
  components/             TaskForm, TaskList (loading / error / empty / list), TaskItem, Filters, ...
Dockerfile · docker/      multi-stage build for the API and the nginx web image
```

## Configuration

| Where                | File                  | Notes                                                                                                                        |
| -------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| API (`.env` in root) | `.env.example`        | `NODE_ENV`, `PORT`, `MONGODB_URI`, `CORS_ORIGIN`, `TRUST_PROXY`, `API_DOCS`, `STATS_CACHE_TTL_MS`, `LOG_LEVEL`, `LOG_PRETTY` |
| Web (`client/.env*`) | `client/.env.example` | `VITE_API_URL`, `VITE_API_TIMEOUT_MS`, `VITE_LOG_REQUESTS`                                                                   |

Both sides validate their environment on startup and fail fast on bad values. Vite picks
`.env.development` / `.env.production` automatically for `vite` / `vite build`.

Deploying to AWS (ECS Fargate, ALB, Atlas, CloudWatch) is described in [DEPLOY.md](./DEPLOY.md).

## Logging in one paragraph

Any code logs with one line (`log.info("message", { fields })`). Every call goes through one wrapper
that first masks secrets (any field named like `password`, `token`, `cookie` or an API key, at any
depth) and then hands the line to pino, which writes JSON in production and readable output in
development. Each request gets its own logger that stamps a `requestId` on every line; the same id is
sent back in the `X-Request-Id` header and shown in the UI as a short reference on server errors, so a
user report can be traced to the exact log lines. `LOG_LEVEL` and `LOG_PRETTY` control the output.

## Design notes

See [DECISIONS.md](./DECISIONS.md) for the key decisions, what was deliberately left out, and the known limitation.

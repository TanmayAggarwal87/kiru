# Kiru — Frontend Architecture (`frontend/`)

> Audience: AI coding agents and developers. Read this fully before writing code.
> Security rules live ONLY in `instructions.md`. Task order lives ONLY in `todo.md`.
> Section 0 is identical in all three `architecture.md` files (backend, frontend, worker). If you change it, change it in all three.

---

## 0. System overview (shared)

**Kiru** turns one long video into several short vertical (9:16) clips, automatically: transcribe → find the best moments → reframe with face tracking → burn animated captions → render 30–60 s shorts. Editing is automatic; the user may only trim, fix caption text, change caption style, and regenerate. Content: universal (English transcription in v1). Budget: **$0**, so everything runs on free tiers or the developer's own machine, and every heavy component is swappable.

### 0.1 Deployables (sibling folders)

| Folder | Role | Stack |
|---|---|---|
| `backend/` | Public API, auth verification, upload signing, pipeline orchestrator, job queue, internal worker API | NestJS, Prisma, Supabase Postgres, Cloudflare R2 (S3 API) |
| `frontend/` | Web app: auth, upload, progress, clip review/edit, download | Next.js (App Router), Tailwind, TanStack Query, Uppy |
| `worker/` | All media + AI work (ffmpeg, ASR, LLM scoring, face tracking, render) | Python 3.12, uv, ffmpeg, faster-whisper, MediaPipe, Modal (GPU) |

Assumed layout: `kiru/backend`, `kiru/frontend`, `kiru/worker` as siblings.

### 0.2 Component diagram

```
Browser (Next.js)
  │  Supabase Auth (Google / email)  → access token (JWT)
  │  REST (Bearer JWT)  ───────────────────────────────► NestJS API ──► Supabase Postgres
  │  multipart upload (presigned URLs) ──► Cloudflare R2 ◄── presigned GET/PUT ──┐   (stage_runs = queue)
  │                                                                              │
  │                                  workers PULL jobs (HTTPS, worker token)     │
  │                                              ┌───────────────────────────────┘
  │                                              ▼
  │                              Python worker  ─ local executor (laptop / free VM)
  │                                              └ Modal executor (GPU, scale-to-zero)
  └─ polls / streams progress from the API
```

### 0.3 Architectural rules (non-negotiable)

1. Only the **backend** talks to Postgres and holds R2 credentials. Frontend and worker never do.
2. Video bytes **never pass through the API**. Browser → R2 via presigned multipart; worker ↔ R2 via presigned URLs the API issues per job.
3. Workers are **pull-based** (no inbound connectivity needed). They authenticate with a worker token and only receive URLs scoped to their own job's project/run.
4. The `stage_runs` table **is the queue** (leases + `FOR UPDATE SKIP LOCKED`). No Redis, no separate queue service.
5. Every stage is **idempotent**; output object keys are deterministic, so retries overwrite instead of duplicating.
6. Every heavy model sits behind an **adapter interface** (ASR, LLM, face detection) so it can move between CPU, Modal, or an API.
7. The backend's **OpenAPI** file is the single contract source. Frontend and worker generate types from it.
8. The pipeline is **versioned** (`pipeline_version`). Old runs keep the DAG they started with.
9. Wire format: **camelCase JSON everywhere** (API bodies and artifact files). DB columns are snake_case (Prisma `@map`). Python uses snake_case with pydantic aliases. Times are **integer milliseconds** from source start. IDs are UUIDs.

### 0.4 Stage DAG

```
probe → prepare_media ─┬─► transcribe ───────┐
                       └─► analyze_signals ──┼─► segment → score ─► (fan-out per selected clip)
                                              │                         ├─ reframe ─┐
                                              └─(segment needs transcribe)         ├─ captions ┴─► render
```
Precisely: `segment` needs `transcribe`; `score` needs `segment` + `analyze_signals`; per clip, `reframe` and `captions` run in parallel and `render` needs both.

| Stage | Resource class | Runs | Output assets |
|---|---|---|---|
| `probe` | cpu | once | (metadata in `output`) |
| `prepare_media` | cpu | once | `audio` (16 kHz mono FLAC), `proxy_video` (540p, no audio) |
| `transcribe` | accelerated | once | `transcript` (word-level JSON) |
| `analyze_signals` | cpu | once | `signals` (audio energy, scene cuts) |
| `segment` | cpu | once | `candidates` |
| `score` | accelerated | once | `scores` |
| `reframe` | cpu | per clip | `crop_path` |
| `captions` | cpu | per clip | `captions` (.ass) |
| `render` | cpu | per clip | `clip_video`, `thumbnail` |

`accelerated` stages prefer a GPU worker but may be claimed by a CPU worker with smaller models (this is how $0 local development works).

### 0.5 Shared vocabulary (identical string values everywhere)

- **StageName**: `probe` `prepare_media` `transcribe` `analyze_signals` `segment` `score` `reframe` `captions` `render`
- **StageStatus**: `pending` (deps unmet) · `ready` (claimable) · `leased` · `succeeded` · `failed` · `canceled` · `skipped`
- **RunStatus**: `queued` `running` `succeeded` `partial` `failed` `canceled`
- **ProjectStatus**: `draft` `uploading` `uploaded` `processing` `ready` `failed`
- **ClipStatus**: `pending` `rendering` `ready` `failed`
- **AssetKind**: `source_video` `audio` `proxy_video` `transcript` `signals` `candidates` `scores` `crop_path` `captions` `clip_video` `thumbnail`
- **AssetStatus**: `pending` `uploaded` `ready` `deleted`
- **ReframeMode**: `face_track` `blur_fit` `center`
- **CaptionStyle**: `pop` `clean` `bold`
- **ResourceClass**: `cpu` `accelerated`
- **ExecutorKind**: `local` `modal`
- **Error codes**: `E_UNAUTHENTICATED` `E_FORBIDDEN` `E_NOT_FOUND` `E_VALIDATION` `E_RATE_LIMITED` `E_QUOTA_EXCEEDED` `E_UPLOAD_TOO_LARGE` `E_UNSUPPORTED_FILE_TYPE` `E_NOT_A_VIDEO` `E_NO_AUDIO` `E_NO_SPEECH` `E_TOO_LONG` `E_UNSUPPORTED_FORMAT` `E_MEDIA_CORRUPT` `E_LEASE_LOST` `E_BAD_STAGE_OUTPUT` `E_STAGE_TIMEOUT` `E_MODEL_FAILED` `E_RENDER_FAILED` `E_INTERNAL`

### 0.6 R2 object key layout (server-generated only)

The frontend never builds or sees storage keys. It only receives short-lived presigned URLs from the API. (Layout is in `backend/architecture.md` §0.6.)

### 0.7 Environments and free-tier assumptions (verify before depending on them)

- **Local dev**: Supabase CLI local stack (Docker), API on `:4000`, web on `:3000`, worker on the developer's laptop (CPU), one R2 dev bucket.
- **Prod (pre-launch)**: hosted Supabase project, R2 bucket, Vercel for web, API + CPU worker on a free VM or own machine behind Cloudflare Tunnel, Modal Starter plan for GPU (it advertises $30/month of free credits).
- Free tiers change. Treat every limit (R2 storage, Supabase DB size and inactivity pausing, Vercel Hobby being non-commercial, Modal credits) as **unverified until checked on the provider's pricing page**.

---

## 1. Frontend responsibilities

**Does:** sign-in via Supabase Auth; upload large files straight to R2 (resumable multipart); show real-time processing progress; display, preview, trim, caption-edit, regenerate, and download clips; show usage/plan; marketing and legal pages.

**Does not:** talk to Postgres or the Supabase Data API for app data (all data goes through the NestJS API); hold or see storage credentials or storage keys; process video in the browser (only previews). It never uses a Supabase `service_role`/secret key.

---

## 2. Routes (Next.js App Router)

| Route | Type | Purpose | Phase |
|---|---|---|---|
| `/` | public | Landing (built via the UI/UX skill) | P0 stub, P10 final |
| `/login` | public | Google + email sign-in | P1 |
| `/auth/callback` | route handler | Exchange auth code, redirect to a validated relative `next` path | P1 |
| `/app` | protected | Project list + usage meter | P1 |
| `/app/new` | protected | Create project, choose options, upload | P1 |
| `/app/projects/[projectId]` | protected | Status (stage stepper) → clip grid → transcript tab | P2–P6 |
| `/app/projects/[projectId]/clips/[clipId]` | protected | Clip editor: preview, trim, caption text/style, regenerate, download | P8 |
| `/app/settings` | protected | Account, plan, usage, delete account | P10 |
| `/pricing`, `/terms`, `/privacy` | public | Marketing/legal | P10 |
| `not-found`, `error`, `loading` boundaries | — | per segment | P0 |

Route protection uses the file convention of the **installed Next.js major** (`middleware.ts`, or `proxy.ts` in Next 16+). Check the docs for the installed version. The protection runs the Supabase SSR session refresh.

---

## 3. Folder structure

```
frontend/
├─ design-system/                  # output of the ui-ux-pro-max skill (source of truth for UI decisions)
├─ public/
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/              # /, /pricing, /terms, /privacy
│  │  ├─ (auth)/login/
│  │  ├─ auth/callback/route.ts
│  │  ├─ app/                      # protected area
│  │  │  ├─ layout.tsx             # app shell
│  │  │  ├─ page.tsx               # project list
│  │  │  ├─ new/page.tsx
│  │  │  ├─ projects/[projectId]/page.tsx
│  │  │  ├─ projects/[projectId]/clips/[clipId]/page.tsx
│  │  │  └─ settings/page.tsx
│  │  ├─ layout.tsx, error.tsx, not-found.tsx, global-error.tsx
│  ├─ components/
│  │  ├─ ui/                       # primitives chosen by the UI/UX skill (generated via its tooling/CLI)
│  │  └─ features/
│  │     ├─ upload/                # UploadDropzone, UploadProgress, uploader.ts (Uppy setup)
│  │     ├─ projects/              # ProjectCard, ProjectList, RunProgress (stage stepper)
│  │     ├─ clips/                 # ClipCard, ClipGrid, ClipPlayer, TrimControl, CaptionEditor, StylePicker
│  │     ├─ transcript/            # TranscriptView
│  │     └─ usage/                 # UsageMeter, PlanBadge
│  ├─ lib/
│  │  ├─ api/                      # generated types (schema.d.ts) + client.ts (openapi-fetch + auth) + query-keys.ts
│  │  ├─ supabase/                 # client.ts (browser), server.ts (RSC/route handlers), session helper for the proxy/middleware
│  │  ├─ env.ts                    # zod-validated NEXT_PUBLIC_* only
│  │  ├─ format.ts                 # time/size formatting
│  │  └─ stage-labels.ts           # StageName → human label/description
│  ├─ hooks/                       # use-run-status, use-upload, use-clip-edit, …
│  └─ styles/
├─ tests/                          # Playwright e2e
├─ .env.example
└─ package.json                    # scripts: dev, build, lint, typecheck, test, test:e2e, gen:api, check
```

Feature-first: components, hooks, and helpers for one feature live together under `components/features/<feature>`. Shared primitives stay in `components/ui`.

---

## 4. Data layer

- **Typed API client**: `pnpm gen:api` runs `openapi-typescript` on `../backend/openapi/openapi.json` → `src/lib/api/schema.d.ts`; `client.ts` wraps `openapi-fetch` and injects `Authorization: Bearer <access token>` from the Supabase session. Never hand-write API types. If the contract is wrong, fix the backend and regenerate.
- **Server state**: TanStack Query. Query keys come from `query-keys.ts` only. Mutations invalidate by key.
- **Rendering split**: server components for static shells/layout and auth gating; client components for upload, progress, player, and editors.
- **Progress**: `useRunStatus(runId)` polls `GET /v1/runs/:id` every 2–3 s while `status ∈ {queued, running}`, backs off to 10 s on errors, and stops on a terminal status. In P8 it upgrades to SSE (`GET /v1/runs/:id/events`) using a `fetch` stream that carries the Bearer header (native `EventSource` cannot send it), falling back to polling on any stream failure.
- **Presigned media URLs** (clip video, thumbnails, proxy preview, transcript) expire. Fetch them on demand via the API, cache for less than the TTL, and refetch on `403/expired`. Do not store them in persistent storage.
- **Errors**: map the API error envelope (`error.code`) to user-facing messages in one place (`lib/api/errors.ts`). Never show raw server text for `E_INTERNAL`.

---

## 5. Auth flow

1. `/login` → Supabase `signInWithOAuth({ provider: 'google' })` or email link/OTP.
2. Provider redirects to `/auth/callback` → exchange code for a session (cookies via `@supabase/ssr`) → redirect to validated `next` (relative paths only, default `/app`).
3. The route-protection file (`proxy.ts`/`middleware.ts`) refreshes the session and redirects unauthenticated requests for `/app/*` to `/login?next=…`.
4. Client API calls read the access token from the Supabase browser client's session.
5. Sign-out clears the session and the TanStack Query cache.

---

## 6. Upload flow (resumable, direct to R2)

```
User drops file
 → client checks: type allowlist (mp4, mov, webm, mkv), size ≤ 2 GB (UX only; server enforces)
 → POST /v1/projects            (create project)
 → Uppy @uppy/aws-s3 (multipart) with callbacks:
     createMultipartUpload → POST /v1/projects/:id/uploads
     signPart              → POST /v1/uploads/:assetId/parts/sign
     listParts             → GET  /v1/uploads/:assetId/parts          (resume)
     completeMultipartUpload → POST /v1/uploads/:assetId/complete
     abortMultipartUpload  → DELETE /v1/uploads/:assetId
 → fixed chunk size 16 MiB (must equal the API's partSizeBytes)
 → on complete → POST /v1/projects/:id/runs (config from the New Project form)
 → navigate to /app/projects/[projectId]
```
UI states: idle · validating · uploading (percent, speed, ETA) · paused · failed (retry) · completing · done. Cancel aborts the multipart upload. Optional: `@uppy/golden-retriever` to resume after a reload (P9). Uppy's API changes between majors, so consult the installed version's docs before coding.

---

## 7. Project page state machine

| Project/run state | View |
|---|---|
| `draft`/`uploading` | Upload progress (or "resume upload") |
| `uploaded` (no run yet) | "Start" button with options |
| `processing` | `RunProgress` stage stepper, overall progress bar, human stage labels, cancel button |
| `ready` / run `succeeded` | Clip grid (ranked), transcript tab |
| run `partial` | Clip grid + banner "N clips failed" with per-clip retry |
| `failed` | Friendly error from `error.code`, retry/start-over |

Stage labels (in `stage-labels.ts`): probe → "Checking your video", prepare_media → "Preparing media", transcribe → "Transcribing speech", analyze_signals → "Analyzing audio", segment → "Finding candidate moments", score → "Picking the best moments", reframe → "Framing for vertical", captions → "Writing captions", render → "Rendering clips".

---

## 8. Clip editor (P8)

- Player: 9:16 `<video>` with the rendered clip (`clip_video`).
- **Trim**: dual-handle control over the *source proxy preview* (`GET /v1/runs/:id/preview` URL, 540p) constrained to 5–90 s and to the source duration; shows the proposed range live; "Apply" sends `PATCH /v1/clips/:id { startMs, endMs }`.
- **Caption text**: list of caption words/lines from the transcript for the clip range; edits are text-only (timing preserved); sent as `captionOverrides`.
- **Style**: `pop | clean | bold` picker with static previews.
- **Regenerate**: re-run reframe/captions/render.
- During re-render the card shows `rendering` with progress and keeps the previous version playable until the new one is `ready`.
- Keyboard accessible (space = play/pause, arrow keys on trim handles), captions toggle, focus management.

---

## 9. Design system

All visual and UX decisions come from the installed **ui-ux-pro-max** skill (see `instructions.md`). Persist the skill's output under `design-system/` and treat it as the source of truth. The frontend architecture only fixes structure, not appearance.

---

## 10. Configuration (all `NEXT_PUBLIC_*` values are public by design; there are no secrets in this folder)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_URL` | canonical site URL (callbacks, metadata) |
| `NEXT_PUBLIC_API_BASE_URL` | NestJS API base (e.g. `http://localhost:4000`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key (public by design) |

Validated at build/start by `src/lib/env.ts` (zod). The build fails on missing values.

---

## 11. Testing strategy

- **Unit/component**: Vitest + React Testing Library for hooks (`useRunStatus` backoff and terminal states), stage label mapping, error mapping, format helpers, and key components (RunProgress, ClipCard, TrimControl).
- **E2E**: Playwright against the local stack (backend + Supabase local + a worker or a stub): login → upload a small fixture → progress → clip visible → download. A mocked-API suite covers failure states.
- **Accessibility**: automated axe checks in Playwright on main pages.
- **Contract**: `pnpm gen:api` must produce no diff in CI.

---

## 12. Performance budgets

LCP < 2.5 s on the landing page and dashboard (mobile profile); no layout shift from async media (reserve 9:16 boxes); lazy-load video (`preload="metadata"`); thumbnails use plain `<img>` with explicit dimensions (presigned URLs are not suitable for `next/image` optimization); route-level code splitting; Uppy only loaded on `/app/new`.

---

## 13. Deployment

Vercel (Hobby is non-commercial. Move to a paid plan or another host before charging users). Environment variables set in the host dashboard, never committed. The `NEXT_PUBLIC_API_BASE_URL` must be an HTTPS origin that is present in the backend's `CORS_ORIGINS`.

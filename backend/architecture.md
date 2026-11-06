# Kiru — Backend Architecture (`backend/`)

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

```
users/{userId}/projects/{projectId}/source/{assetId}.{ext}
users/{userId}/projects/{projectId}/runs/{runId}/prepare_media/audio.flac
users/{userId}/projects/{projectId}/runs/{runId}/prepare_media/proxy.mp4
users/{userId}/projects/{projectId}/runs/{runId}/transcribe/transcript.json
users/{userId}/projects/{projectId}/runs/{runId}/analyze_signals/signals.json
users/{userId}/projects/{projectId}/runs/{runId}/segment/candidates.json
users/{userId}/projects/{projectId}/runs/{runId}/score/scores.json
users/{userId}/projects/{projectId}/runs/{runId}/clips/{clipId}/v{version}/crop_path.json
users/{userId}/projects/{projectId}/runs/{runId}/clips/{clipId}/v{version}/captions.ass
users/{userId}/projects/{projectId}/runs/{runId}/clips/{clipId}/v{version}/clip.mp4
users/{userId}/projects/{projectId}/runs/{runId}/clips/{clipId}/v{version}/thumb.jpg
```

### 0.7 Environments and free-tier assumptions (verify before depending on them)

- **Local dev**: Supabase CLI local stack (Docker), API on `:4000`, web on `:3000`, worker on the developer's laptop (CPU), one R2 dev bucket.
- **Prod (pre-launch)**: hosted Supabase project, R2 bucket, Vercel for web, API + CPU worker on a free VM or own machine behind Cloudflare Tunnel, Modal Starter plan for GPU (it advertises $30/month of free credits).
- Free tiers change. Treat every limit (R2 storage, Supabase DB size and inactivity pausing, Vercel Hobby being non-commercial, Modal credits) as **unverified until checked on the provider's pricing page**.

---

## 1. Backend responsibilities

**Does:** verify Supabase JWTs; own all business data; sign multipart uploads; create and orchestrate pipeline runs; act as the job queue and lease manager; issue per-job presigned URLs to workers; expose progress; enforce quotas and retention; export OpenAPI.

**Does not:** touch video bytes; run ffmpeg or any model; hold user sessions or cookies (stateless Bearer auth); call Supabase's REST/Data API or use the Supabase `service_role` key (not needed in the MVP).

---

## 2. Folder structure

```
backend/
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/                  # Prisma Migrate is the ONLY schema owner
├─ openapi/openapi.json            # generated + committed; consumed by frontend and worker
├─ scripts/export-openapi.ts
├─ supabase/                       # `supabase init` output; used ONLY for the local stack, never for migrations
├─ src/
│  ├─ main.ts                      # scaffolded; edited only for bootstrap wiring
│  ├─ app.module.ts                # scaffolded; edited only to import modules/providers
│  ├─ config/                      # zod env schema + typed config service
│  ├─ common/
│  │  ├─ decorators/  (public, current-user)
│  │  ├─ guards/      (supabase-jwt, worker-token)
│  │  ├─ filters/     (all-exceptions → error envelope)
│  │  ├─ interceptors/ (request-id, logging)
│  │  ├─ errors/      (AppError, error-codes)
│  │  └─ utils/       (keys, hash, time)
│  ├─ database/                    # PrismaModule / PrismaService
│  ├─ storage/                     # R2 client wrapper: presign, head, delete, multipart
│  └─ modules/
│     ├─ health/
│     ├─ auth/
│     ├─ users/
│     ├─ projects/
│     ├─ uploads/
│     ├─ pipelines/                # DAG definition, orchestrator, stage-runs (queue), contracts/, reaper
│     ├─ worker-gateway/           # /internal/v1/worker/* (claim, heartbeat, complete, fail, presign, queue-stats)
│     ├─ clips/
│     ├─ events/                   # SSE
│     ├─ usage/
│     ├─ retention/
│     └─ billing/                  # P10
├─ test/                           # e2e (supertest)
├─ .env.example
└─ package.json                    # scripts: dev, build, lint, typecheck, test, test:e2e, check, openapi:export
```

---

## 3. Module map

Create every item with the **Nest CLI** (see `instructions.md`). Path is relative to `src/`.

| Module | CLI | Responsibility |
|---|---|---|
| health | `nest g module modules/health` + controller | `/health/live`, `/health/ready` (DB ping) via Terminus |
| auth | `nest g module modules/auth` + `nest g guard common/guards/supabase-jwt` | JWKS verification, `@Public()`, `@CurrentUser()` |
| users | module/controller/service | JIT-provision user from JWT claims, `GET /v1/me` |
| projects | `nest g resource modules/projects` | CRUD, ownership-scoped, soft delete |
| uploads | module/controller/service | R2 multipart init/sign/list/complete/abort |
| storage | `nest g module storage` + service | S3 client configured for R2 |
| pipelines | module + `orchestrator`, `stage-runs`, `pipeline-definition`, `reaper` services | DAG, run lifecycle, queue, leases, roll-ups |
| worker-gateway | module/controller + `nest g guard common/guards/worker-token` | Internal API for workers |
| clips | module/controller/service | list/get/patch/regenerate/download/delete |
| events | module/controller/service | SSE stream of run/clip changes |
| usage | module/service/controller | quota checks, ledger, `GET /v1/usage` |
| retention | module/service | cron: delete expired R2 objects, reap stuck uploads |
| billing | module/controller/service | P10: plans, webhooks |

---

## 4. Data model (Prisma, Postgres)

Conventions: UUID PKs (`gen_random_uuid()`), `timestamptz`, snake_case columns via `@map`/`@@map`, enums mirror section 0.5. **Row Level Security is enabled on every table with no policies** (deny-by-default for the Supabase Data API); the backend connects with a server-side role, which bypasses RLS.

| Table | Columns (key ones) | Notes |
|---|---|---|
| `users` | `id` (= Supabase `auth.users.id`), `email` unique, `display_name?`, `plan` (`free`/`pro`), timestamps | Created lazily on first authenticated request |
| `projects` | `id`, `user_id`→users, `title`, `status`, `source_asset_id?`, `deleted_at?`, timestamps | Index `(user_id, created_at desc)` where not deleted |
| `assets` | `id`, `user_id`, `project_id`, `run_id?`, `clip_id?`, `kind`, `status`, `storage_key` unique, `content_type`, `size_bytes?`, `checksum_sha256?`, `multipart_upload_id?`, `metadata` jsonb, `expires_at?`, `created_at` | Index `(project_id, kind)`, `(expires_at)` where status ≠ deleted |
| `pipeline_runs` | `id`, `project_id`, `user_id`, `status`, `pipeline_version`, `config` jsonb, `progress` smallint, `error_code?`, `error_message?`, `started_at?`, `finished_at?`, `created_at` | Index `(project_id, created_at desc)`, `(status)` |
| `stage_runs` | `id`, `run_id`, `clip_id?`, `clip_version?`, `stage`, `status`, `resource_class`, `priority` int, `attempt`, `max_attempts` (3), `available_at`, `lease_owner?`, `lease_expires_at?`, `started_at?`, `finished_at?`, `input` jsonb, `input_hash`, `output?` jsonb, `error_code?`, `error_message?`, `metrics` jsonb, `created_at` | Partial unique `(run_id, stage)` where `clip_id is null`; partial unique `(run_id, stage, clip_id, clip_version)` where `clip_id is not null`; claim index `(status, available_at, priority desc, created_at)` where `status='ready'` |
| `candidates` | `id`, `run_id`, `start_ms`, `end_ms`, `text_preview`, `signal_scores` jsonb, `llm_scores` jsonb, `final_score` real, `rank?`, `selected`, `title?`, `reason?`, `flags` text[] | Index `(run_id, final_score desc)` |
| `clips` | `id`, `run_id`, `project_id`, `user_id`, `candidate_id?`, `rank`, `title`, `start_ms`, `end_ms`, `status`, `caption_style`, `reframe_mode?`, `caption_overrides?` jsonb, `version` (default 1), `video_asset_id?`, `thumbnail_asset_id?`, `error_code?`, `deleted_at?`, timestamps | `version` increments on every edit/regenerate |
| `usage_ledger` | `id`, `user_id`, `run_id?`, `metric`, `quantity` numeric, `created_at` | Metrics: `video_seconds_processed`, `clips_rendered` |
| (P10) `subscriptions`, `billing_events`, `invites` | provider ids, plan, status, idempotency key | Added in P10 |

**Migrations:** `prisma migrate dev` locally; `prisma migrate deploy` in CI/prod. Every migration that creates a table also contains `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`. Never edit an applied migration. The Supabase CLI is for the local stack only. Do not create a second migration system. Follow the installed Prisma major's official Supabase guide for config (pooled URL for runtime, direct URL for migrations, driver adapter requirements).

---

## 5. API surface

Public routes are under `/v1`, require `Authorization: Bearer <Supabase access token>` (except `/health/*`). All JSON is camelCase. Error envelope:
```json
{ "error": { "code": "E_VALIDATION", "message": "Human readable", "requestId": "…", "details": {} } }
```

### 5.1 Public

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/me` | profile + plan + usage summary |
| POST | `/v1/projects` | `{ title }` |
| GET | `/v1/projects` | paginated (`limit` ≤ 50, cursor) |
| GET | `/v1/projects/:id` | includes latest run summary |
| DELETE | `/v1/projects/:id` | soft delete + schedule asset deletion |
| POST | `/v1/projects/:id/uploads` | init multipart: `{ filename, contentType, sizeBytes }` → `{ assetId, uploadId, key, partSizeBytes }` |
| POST | `/v1/uploads/:assetId/parts/sign` | `{ partNumbers: number[] }` (≤ 20) → `{ urls: { [partNumber]: url } }` |
| GET | `/v1/uploads/:assetId/parts` | list uploaded parts (resume) |
| POST | `/v1/uploads/:assetId/complete` | `{ parts: [{ partNumber, etag }] }` → HEAD-verifies size, sets asset `uploaded`, project `uploaded` |
| DELETE | `/v1/uploads/:assetId` | abort |
| POST | `/v1/projects/:id/runs` | `{ config?: { clipCount, minDurationSec, maxDurationSec, captionStyle } }` → run |
| GET | `/v1/projects/:id/runs/latest` | latest run summary |
| GET | `/v1/runs/:id` | status, `progress` 0–100, stages summary, clips |
| POST | `/v1/runs/:id/cancel` | |
| GET | `/v1/runs/:id/events` | SSE (P8) |
| GET | `/v1/runs/:id/transcript` | `{ url }` short-lived presigned GET (P3) |
| GET | `/v1/runs/:id/preview` | `{ url }` presigned GET of `proxy_video` for trim preview (P8) |
| GET | `/v1/runs/:id/clips` | ordered by rank |
| GET | `/v1/clips/:id` | |
| PATCH | `/v1/clips/:id` | `{ title?, startMs?, endMs?, captionStyle?, captionOverrides? }` → bumps `version`, enqueues re-render (P8) |
| POST | `/v1/clips/:id/regenerate` | re-run `reframe`+`captions`+`render` (P8) |
| GET | `/v1/clips/:id/download` | `{ url }` presigned GET with `attachment` disposition |
| DELETE | `/v1/clips/:id` | |
| GET | `/v1/usage` | period usage vs plan |
| GET | `/health/live`, `/health/ready` | public |

### 5.2 Internal (workers only), prefix `/internal/v1/worker`, header `Authorization: Bearer <worker token>`

| Method | Path | Purpose |
|---|---|---|
| POST | `/jobs/claim` | `{ workerId, executor, stages: StageName[], leaseSeconds, waitSeconds? }` → `200 Job` or `204` |
| POST | `/jobs/:jobId/heartbeat` | `{ workerId, progress?, message? }` → `{ cancel: boolean, leaseExpiresAt }` |
| POST | `/jobs/:jobId/complete` | `{ workerId, output, assets[], metrics }` |
| POST | `/jobs/:jobId/fail` | `{ workerId, errorCode, message, retryable }` |
| POST | `/storage/presign` | `{ jobId, workerId, ops: [{ op: 'get'|'put', key, contentType? }] }` → URLs |
| GET | `/queue-stats` | ready-job counts by `resourceClass` (for the Modal dispatcher, P9) |

Job payload (claim response):
```json
{
  "jobId": "uuid", "runId": "uuid", "projectId": "uuid", "stage": "transcribe",
  "clipId": null, "clipVersion": null, "attempt": 1, "pipelineVersion": "v1",
  "leaseExpiresAt": "2026-01-01T00:00:00Z", "heartbeatIntervalSeconds": 20,
  "params": { },
  "inputs": { "audio": { "assetId": "uuid", "downloadUrl": "https://…", "sizeBytes": 123, "contentType": "audio/flac" } },
  "outputPrefix": "users/…/runs/…/",
  "limits": { "maxVideoSeconds": 3600, "maxStageSeconds": 14400 }
}
```
Per-stage `params`, `inputs`, and `output` shapes are defined by DTO classes in `src/modules/pipelines/contracts/` and exposed in OpenAPI (`oneOf` by `stage`). The worker generates its pydantic models from them. Worker-side shapes are described in `worker/architecture.md` §4.

Presign scope rule: the backend MUST verify that every requested `key` starts with the job's own `users/{userId}/projects/{projectId}/runs/{runId}/` prefix for `put`, or belongs to the same project for `get`, before signing.

---

## 6. Orchestration

### 6.1 Run lifecycle
1. `POST /v1/projects/:id/runs` validates ownership, project `uploaded`, quota → creates `pipeline_runs` (`queued`) and all **static** `stage_runs` (`pending`, root stage `ready`). Project → `processing`.
2. A worker claims, heartbeats, completes. On completion the orchestrator, **inside one transaction that first locks the run row (`SELECT … FOR UPDATE`)**: stores output + assets, marks the stage `succeeded`, promotes dependents whose deps are all done to `ready`, recomputes `progress`, rolls up run/project status.
3. After `score` succeeds: persist `candidates`, create `clips` for selected candidates, and **fan out** per-clip `stage_runs` (`reframe`, `captions`, `render`) with `clip_id` and `clip_version = 1`. Fan-out is idempotent (unique indexes make double-insert a no-op).
4. When every clip is terminal: run `succeeded` if all clips ready, `partial` if ≥ 1 ready and ≥ 1 failed, `failed` if none ready. Project → `ready` or `failed`.
5. Skeleton (P2) uses a **baseline selector inside the orchestrator** (one clip, 0–45 s) instead of `score`. It is removed in P6.

### 6.2 Claim (reference SQL)
```sql
UPDATE stage_runs
SET status = 'leased', lease_owner = $workerId,
    lease_expires_at = now() + make_interval(secs => $leaseSeconds),
    attempt = attempt + 1, started_at = COALESCE(started_at, now())
WHERE id = (
  SELECT id FROM stage_runs
  WHERE status = 'ready' AND stage = ANY($stages) AND available_at <= now()
  ORDER BY priority DESC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```
Run through Prisma `$queryRaw` (tagged template only). Long-poll: if nothing is claimable and `waitSeconds` > 0, poll the query every ~1 s for up to `waitSeconds` (max 20) before returning `204`.

### 6.3 Leases, retries, timeouts
- Lease 60 s, extended by heartbeat (every 20 s). `complete`/`fail`/`heartbeat` require `lease_owner = workerId` and an unexpired lease, otherwise `409 E_LEASE_LOST`.
- **Reaper** (cron every 30 s): leased rows with `lease_expires_at < now()` → back to `ready` with backoff, or `failed` when `attempt ≥ max_attempts`. Also fails leased rows exceeding the stage's hard `maxRuntimeSeconds` with `E_STAGE_TIMEOUT`.
- Retryable failure: `status='ready'`, `available_at = now() + min(15s × 2^attempt, 10 min)`. Non-retryable or attempts exhausted: `failed`; a failed required stage fails the run (clip-level stage failures fail only that clip).
- Hard runtime caps (defaults): probe 300 s · prepare_media 3600 · transcribe 14400 · analyze_signals 1800 · segment 300 · score 3600 · reframe 1800 · captions 300 · render 1800.
- Cancel: run → `canceled`; non-leased stages → `canceled`; leased stages see `cancel: true` on the next heartbeat.

### 6.4 Idempotency and versioning
- `input_hash = sha256(stage + pipelineVersion + canonical(params) + input asset checksums)`. If an identical hash already succeeded in the same run, mark the stage `skipped` and reuse its output.
- Clip edits create new `stage_runs` with `clip_version = clip.version`, and new object keys under `v{version}/`. The previous version's assets are kept until the new one is `ready`, then expire via retention.

### 6.5 Progress weights (sum 100)
probe 2 · prepare_media 8 · transcribe 30 · analyze_signals 5 · segment 3 · score 17 · per-clip stages 35 (reframe 10, captions 5, render 20, split evenly across clips). Weights live in one constants file; the frontend only displays `progress`.

### 6.6 Pipeline versions
A `PipelineDefinition` is versioned code that lists stages, dependencies, resource classes, and params. Each phase that adds a stage adds a new version (`v0-skeleton` → `v1`). The version is stored on the run.

---

## 7. Upload design

- Browser uses Uppy `@uppy/aws-s3` multipart with custom endpoints (section 5.1). No Uppy Companion.
- Fixed part size **16 MiB** (R2 multipart wants uniform part sizes except the last; 2 GB ≈ 128 parts; ≤ 10 000 parts).
- Limits (env): `MAX_UPLOAD_BYTES` = 2 GB, content-type allowlist `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`; extension allowlist matches. The worker's `probe` stage is the real validation. The API check is only a first filter.
- On `complete`: `CompleteMultipartUpload`, then `HeadObject` to confirm size equals declared size (±0). Mismatch → delete object, `E_VALIDATION`.
- **R2 gotchas to handle:** (1) bucket CORS must `ExposeHeaders: ETag` or the client cannot complete the upload; (2) the AWS SDK v3 default checksum behaviour can break R2 presigned requests, so configure `requestChecksumCalculation` and `responseChecksumValidation` to `WHEN_REQUIRED`; (3) lifecycle rule to abort incomplete multipart uploads after 1 day. Verify each against current R2 docs.
- Presigned TTLs: part PUT 60 min, worker GET/PUT 60 min, download GET 15 min (all env-driven).

---

## 8. Auth design

Supabase Auth issues JWTs; the backend only **verifies** them. Use `jose` `createRemoteJWKSet` against the project's JWKS URL and check `iss`, `aud` (`authenticated`), `exp`. If the project still uses the legacy shared-secret signing, verify per the Supabase docs for that mode (check the dashboard's JWT settings). The guard attaches `{ id: sub, email }`. `UsersService.ensure()` upserts the user row on first sight. No cookies, no sessions.

---

## 9. Configuration (validated at boot with zod; process exits on invalid env)

| Variable | Purpose |
|---|---|
| `NODE_ENV`, `PORT` (4000), `LOG_LEVEL` | runtime |
| `CORS_ORIGINS` | comma-separated allowlist of web origins |
| `DATABASE_URL` | pooled runtime connection (Supabase) |
| `DIRECT_URL` | direct/session connection for migrations |
| `SUPABASE_URL` | derive issuer + JWKS URL |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | storage |
| `WORKER_TOKEN_HASHES` | comma-separated SHA-256 hashes of accepted worker tokens |
| `MAX_UPLOAD_BYTES`, `MAX_VIDEO_SECONDS` | limits |
| `PRESIGN_PUT_TTL_SECONDS`, `PRESIGN_GET_TTL_SECONDS`, `DOWNLOAD_TTL_SECONDS` | URL lifetimes |
| `RETENTION_SOURCE_DAYS`, `RETENTION_INTERMEDIATE_DAYS`, `RETENTION_CLIP_DAYS` | cleanup (defaults 3 / 1 / 30) |
| `PLAN_FREE_MINUTES_PER_MONTH` | quota (placeholder 120, tune in P9) |
| `THROTTLE_TTL_SECONDS`, `THROTTLE_LIMIT` | default rate limit |

`.env.example` holds names and placeholder values only.

---

## 10. Observability

`nestjs-pino` JSON logs with `requestId` (accept `x-request-id` or generate), redaction per `instructions.md`. Each stage run persists `metrics` (`durationMs`, `executor`, `model`, `inputSeconds`) to enable **cost per video-minute** reporting in P9. Optional free-tier error tracking in P10.

---

## 11. Testing strategy

- **Unit**: DAG promotion logic, progress math, key builder, hash function, NMS-independent backend rules (clip trim bounds), error mapping.
- **Integration (real Postgres from the Supabase local stack)**: claim concurrency (N parallel claimers, each job claimed once), lease expiry and reaper, fan-out idempotency, run roll-up (`succeeded`/`partial`/`failed`), cancel.
- **E2E (supertest)**: auth guard, ownership/IDOR for every resource, upload flow with a mocked S3 client, worker-gateway presign scope.
- **Contract**: exported `openapi.json` is committed; CI fails if regenerating it changes the file.
- Never run tests against production data or the hosted prod project.

---

## 12. Deployment notes

API is a stateless Node process (`node dist/main`) behind HTTPS. Pre-launch options for the host (decision gate G1): own machine + Cloudflare Tunnel, or a free VM; verify current terms. Run `prisma migrate deploy` before start. Back up Postgres on a schedule (`pg_dump`) because free-tier backups may be limited.

---

## 13. Open decisions (tracked as gates in `todo.md`)

G1 API production host · G2 billing provider available in the founder's country · G3 LLM serving on Modal · G4 local dev LLM size · G5 reframe render method (worker-side).

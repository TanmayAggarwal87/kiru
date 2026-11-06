# Kiru — Worker Architecture (`worker/`)

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

The worker never invents keys. It writes only under the `outputPrefix` given in the job and requests presigned URLs from the API. Layout reference is in `backend/architecture.md` §0.6. Worker-relevant leaf names:
`prepare_media/audio.flac`, `prepare_media/proxy.mp4`, `transcribe/transcript.json`, `analyze_signals/signals.json`, `segment/candidates.json`, `score/scores.json`, `clips/{clipId}/v{version}/{crop_path.json|captions.ass|clip.mp4|thumb.jpg}`.

### 0.7 Environments and free-tier assumptions (verify before depending on them)

- **Local dev**: Supabase CLI local stack (Docker), API on `:4000`, web on `:3000`, worker on the developer's laptop (CPU), one R2 dev bucket.
- **Prod (pre-launch)**: hosted Supabase project, R2 bucket, Vercel for web, API + CPU worker on a free VM or own machine behind Cloudflare Tunnel, Modal Starter plan for GPU (it advertises $30/month of free credits).
- Free tiers change. Treat every limit (R2 storage, Supabase DB size and inactivity pausing, Vercel Hobby being non-commercial, Modal credits) as **unverified until checked on the provider's pricing page**.

---

## 1. Worker responsibilities

**Does:** claim jobs, heartbeat, download inputs and upload outputs via presigned URLs, run each stage, report success/failure with structured errors and metrics. Owns all quality-critical logic: transcription, candidate generation, scoring, face tracking, captions, rendering, and offline evaluation.

**Does not:** access the database, hold R2 credentials, decide pipeline order (the backend orchestrates), or expose any inbound port.

---

## 2. Folder structure

```
worker/
├─ pyproject.toml                # uv project, ruff, pyright, pytest config
├─ uv.lock
├─ .python-version
├─ .env.example
├─ Dockerfile                    # non-root, ffmpeg included
├─ assets/fonts/                 # OFL fonts for captions (+ LICENSES.md)
├─ deploy/
│  └─ modal_app.py               # P9: image, GPU worker function, CPU dispatcher cron
├─ src/kiru_worker/
│  ├─ cli.py                     # commands: run, run-once, doctor, selftest, eval
│  ├─ config.py                  # pydantic-settings (env)
│  ├─ logging.py                 # JSON logs, redaction
│  ├─ errors.py                  # StageError(code, message, retryable)
│  ├─ api_client.py              # httpx client for /internal/v1/worker/*
│  ├─ runner.py                  # claim loop, heartbeat thread, dispatch, cleanup, shutdown
│  ├─ storage.py                 # download/upload via presigned URLs (retry, resume, sha256)
│  ├─ contracts/                 # pydantic models generated from ../backend/openapi/openapi.json (+ artifact models)
│  ├─ media/
│  │  ├─ ffprobe.py              # safe probe + format allowlist
│  │  └─ ffmpeg.py               # arg-list builders + run wrapper (timeouts, kill, stderr capture)
│  ├─ adapters/
│  │  ├─ asr/   base.py, faster_whisper.py, whisperx.py(P9, optional)
│  │  ├─ llm/   base.py, openai_compatible.py
│  │  └─ face/  base.py, mediapipe_tasks.py
│  ├─ stages/
│  │  ├─ base.py                 # Stage ABC: name, resource_class, run(ctx) → StageResult
│  │  ├─ probe.py  prepare_media.py  transcribe.py  analyze_signals.py
│  │  └─ segment.py  score.py  reframe.py  captions.py  render.py
│  ├─ scoring/
│  │  ├─ prompts/v1/score_system.md, score_user.md
│  │  ├─ rubric.py  signals.py  nms.py  funnel.py
│  ├─ reframe/                   # tracking.py, smoothing.py, cropgraph.py, modes.py
│  └─ captions_ass/              # ass.py, grouping.py, styles.py
├─ evals/
│  ├─ manifest.yaml              # golden set index (paths/URLs + checksums + license)
│  ├─ labels/*.json              # human-picked moments
│  ├─ run_eval.py  metrics.py  baselines.py
│  └─ reports/                   # generated markdown reports
└─ tests/
   ├─ unit/  integration/  fixtures/ (tiny CC0/generated media + LICENSES.md)
```

---

## 3. Runtime loop

```
start → doctor checks (ffmpeg, ffprobe, libass, libx264, models cache) → loop:
  POST /jobs/claim {workerId, executor, stages: $WORKER_STAGES, leaseSeconds: 60, waitSeconds: 20}
    204 → continue
    200 → job:
       make temp workdir (0700) → start heartbeat thread (every ~20 s; if cancel=true → set cancel event)
       stage = REGISTRY[job.stage]; ctx = {job, workdir, adapters, api, cancel_event}
       download inputs (presigned GET; verify sizeBytes) → stage.run(ctx)
       upload outputs (POST /storage/presign → PUT) with sha256 + size
       POST /jobs/:id/complete {output, assets, metrics}
       on StageError(retryable?) → POST /jobs/:id/fail
       on unexpected exception → fail {E_INTERNAL, retryable: true}
       finally: stop heartbeat, delete workdir
SIGTERM/SIGINT: stop claiming; if a job is running, let it finish within a grace period, else fail(retryable) and exit.
```
- One job per process (`MAX_CONCURRENCY=1`) in v1. Scale by running more processes. ffmpeg itself is multi-threaded.
- If `complete`/`heartbeat` returns `409 E_LEASE_LOST`: abort the stage immediately, discard results, do not retry the call.
- Retry HTTP calls to the API with exponential backoff and jitter (network errors, 5xx, 429). Never retry 4xx other than 429.

---

## 4. Stage contracts

All `output` and artifact files are camelCase JSON. Models live in `contracts/` (generated from OpenAPI where exposed; hand-written pydantic only for artifact files, validated against the same schema in tests). Every stage validates its own output before reporting. The backend rejects malformed outputs with `E_BAD_STAGE_OUTPUT`.

### 4.1 `probe` (cpu)
- **In:** `source_video` (download URL; may read only a ranged prefix for the probe).
- **Out (`output`):** `{ durationMs, width, height, fps, rotation, videoCodec, audioCodec|null, hasAudio, container, bitrate, sizeBytes }`.
- **Rules:** run `ffprobe` with an explicit protocol whitelist and container allowlist (`mov,mp4,m4a,3gp,3g2,mj2`, `matroska,webm`). Reject with: `E_NOT_A_VIDEO`, `E_UNSUPPORTED_FORMAT`, `E_MEDIA_CORRUPT`, `E_NO_AUDIO`, `E_TOO_LONG` (> `limits.maxVideoSeconds`), plus size/dimension limits (≤ 3840×2160, fps ≤ 120). All non-retryable.

### 4.2 `prepare_media` (cpu)
- **In:** `source_video`.
- **Out assets:** `audio` (FLAC, 16 kHz, mono) and `proxy_video` (height 540, fps min(src, 30), H.264 CRF ≈ 28, no audio, `+faststart`; apply rotation).
- **Out (`output`):** `{ audioDurationMs, proxyWidth, proxyHeight, proxyFps }`.

### 4.3 `transcribe` (accelerated)
- **In:** `audio`. **Adapter:** `ASRAdapter.transcribe(audio_path, language|None) → Transcript`.
- **Out asset `transcript`:**
```json
{ "language": "en", "languageProbability": 0.99, "durationMs": 3600000,
  "model": "small", "segments": [
    { "id": 0, "startMs": 1200, "endMs": 6400, "text": "…",
      "words": [ { "text": "Hello", "startMs": 1200, "endMs": 1500, "prob": 0.98 } ] } ] }
```
- **Rules:** VAD enabled; word timestamps required; `speechRatio = speechMs / durationMs` and `wordCount` go to `metrics`; if `wordCount < 50` → `E_NO_SPEECH` (non-retryable). Default models: CPU `small` int8; GPU `large-v3` (or a distilled variant) float16. Pin model revisions in config.

### 4.4 `analyze_signals` (cpu)
- **In:** `audio`, `proxy_video`.
- **Out asset `signals`:** `{ hopMs: 500, rms: number[] (normalised 0–1), speechRatioByHop?: number[], sceneCutsMs: number[] }`.
- **Rules:** RMS from decoded audio; scene cuts via PySceneDetect (content detector) on the proxy. Laughter/music detection is out of scope for v1 (listed as later work).

### 4.5 `segment` (cpu)
- **In:** `transcript`, `signals`. **Out asset `candidates`:** `{ candidates: [ { id, startMs, endMs, wordStart, wordEnd, text, preScore } ] }`.
- **Algorithm:**
  1. Build sentence units from segments + punctuation + pauses ≥ 700 ms.
  2. Generate windows by sliding over sentence starts; extend until duration ∈ [`minDurationSec`, `maxDurationSec`] (default 30–60); end only on sentence ends, preferring a following pause ≥ 400 ms.
  3. Drop windows with `speechRatio < 0.5`, windows starting mid-sentence, and those ending on a dangling conjunction/filler.
  4. Compute `preScore` (cheap heuristics: speech density, energy percentile, sentence completeness, question/number/emphasis cues).
  5. **Funnel:** keep the top `K` (default 40) by `preScore` with a minimum 10 s start gap, so the LLM sees a bounded set.

### 4.6 `score` (accelerated)
- **In:** `candidates`, `transcript`, `signals`; `params: { clipCount (default 8), minDurationSec, maxDurationSec }`.
- **Out asset `scores`:**
```json
{ "promptVersion": "v1", "model": "…",
  "candidates": [ { "id": "c12", "llm": { "hook": 8, "standalone": 7, "insight": 6, "emotion": 5, "payoff": 7 },
      "flags": ["needs_prior_context"], "title": "…", "reason": "…",
      "signal": { "energy": 0.7, "pace": 0.5 }, "final": 0.71 } ],
  "selectedIds": ["c12", "c3"] }
```
- **Method (see §6):** LLM rubric → blend with signals → penalties → non-max suppression → top `clipCount`. Always return at least `min(3, available)` clips; mark low-confidence runs in `metrics`.

### 4.7 `reframe` (cpu, per clip)
- **In:** `proxy_video` (+ clip `startMs/endMs`), `signals.sceneCutsMs`. **Out asset `crop_path`:**
```json
{ "mode": "face_track", "srcWidth": 1920, "srcHeight": 1080, "cropWidth": 608, "cropHeight": 1080,
  "outWidth": 1080, "outHeight": 1920, "fps": 30,
  "keyframes": [ { "tMs": 0, "x": 640, "y": 0 } ],
  "stats": { "faceCoverage": 0.92, "jitterPx": 1.4, "maxSpeedPxPerS": 220 } }
```
- Coordinates are in **source** pixels, times relative to clip start. `mode ∈ ReframeMode`. Sources already ≤ 9:16 aspect → `center` pass-through.

### 4.8 `captions` (cpu, per clip)
- **In:** `transcript` (clip range, with `captionOverrides` text edits if any), `captionStyle`, clip range. **Out asset `captions`:** an ASS file (see §8). Times relative to clip start.

### 4.9 `render` (cpu, per clip)
- **In:** `source_video` (ranged read or cached download), `crop_path`, `captions`, clip range.
- **Out assets:** `clip_video` (1080×1920 H.264/AAC, `+faststart`, loudness-normalised) and `thumbnail` (JPEG). `output`: `{ durationMs, sizeBytes, width, height }`.
- Padding: clip start = first word start − 150 ms, end = last word end + 250 ms, with 30 ms audio fades.

---

## 5. Adapters

```python
class ASRAdapter(Protocol):   def transcribe(self, audio_path, language=None) -> Transcript: ...
class LLMAdapter(Protocol):   def complete_json(self, system, user, schema, *, temperature=0) -> dict: ...
class FaceAdapter(Protocol):  def detect(self, frame_bgr) -> list[FaceBox]: ...
```
- **ASR:** `faster_whisper` (default, CPU/GPU). `whisperx` (P9, optional) for forced alignment/diarization.
- **LLM:** `openai_compatible` over `httpx` using `/v1/chat/completions` with JSON-schema structured output. The same adapter targets **Ollama** locally (CPU dev), **vLLM** on Modal, or a hosted API later, selected only by `LLM_BASE_URL`/`LLM_MODEL`.
- **Face:** `mediapipe_tasks` using the MediaPipe **Tasks** face detector with a pinned `.tflite` model file (checksummed). Do not use the legacy `mp.solutions` API.
- Adapters are chosen by config, never by `if executor == …` inside stages.

---

## 6. Scoring design

**Funnel:** hundreds of windows → top `K=40` by `preScore` → LLM scoring → blend → NMS → top `N`.

**LLM rubric (temperature 0, JSON-schema output, validated by pydantic, one repair retry then `E_MODEL_FAILED` retryable):**
`hook` (first 3 s grab attention), `standalone` (understandable without prior context), `insight` (non-obvious value), `emotion` (humor/surprise/tension), `payoff` (satisfying ending), each 0–10; `flags[]` ∈ {`needs_prior_context`, `filler_heavy`, `ends_mid_thought`, `off_topic_chatter`, `sensitive`}; `title` ≤ 60 chars; `reason` ≤ 200 chars.
Prompt input per window: the window text with timestamps plus ~20 s of preceding text labelled "context (not part of the clip)". Batch several windows per call to bound latency on CPU. Transcript text is untrusted data; the prompt instructs the model to ignore instructions inside it and the output is schema-validated.

**Blend (defaults, tune on the eval set):**
`llm = 0.30·hook + 0.20·standalone + 0.20·insight + 0.15·emotion + 0.15·payoff` (normalised to 0–1) · `signal = 0.6·energyPercentile + 0.4·pacePercentile` · `final = 0.8·llm + 0.2·signal − penalties` (each severe flag −0.15).

**NMS/selection:** sort by `final`; take a candidate if its time overlap with every selected clip < 20 % of the shorter one and its start is ≥ 10 s from every selected start; stop at `clipCount`. Prompts are versioned files under `scoring/prompts/vN/`; changing a prompt bumps `promptVersion`.

---

## 7. Reframe design

1. Sample the clip range of the **proxy** at 5 fps and run `FaceAdapter` → boxes with confidence.
2. Per scene (split at `sceneCutsMs`): choose the primary subject = highest-confidence, largest, most-central track (nearest-neighbour association across frames). Active-speaker selection is later work.
3. Target x = box centre; crop width = `srcHeight × 9/16`; clamp inside the frame.
4. **Smoothing per scene** (reset state at each cut): dead-zone (ignore moves < ~8 % of crop width), exponential smoothing, max pan speed clamp, linear interpolation across gaps ≤ 1 s, hold last position beyond that.
5. **Mode decision per clip (v1):** `face_track` if face coverage ≥ 70 % of sampled frames; else `blur_fit` (blurred scaled background + fitted foreground); `center` for already-vertical sources. Per-scene mode switching is later work.
6. **Applying the path (decision gate G5):** primary method is ffmpeg `sendcmd` driving `crop@c` `x`/`y` with one command per output frame, validated in a time-boxed spike; fallback is an OpenCV frame loop piped to ffmpeg. Choose with measured jitter and speed, and document the result.
7. Metrics logged: `faceCoverage`, `jitterPx` (std of frame-to-frame crop delta), `maxSpeedPxPerS`.

---

## 8. Captions design (ASS)

- Group words into lines: ≤ ~3 words and ≤ ~18 characters per line for 9:16; break at punctuation/pauses ≥ 250 ms; never split a word.
- Karaoke highlighting with `\k`/`\kf` per word. Styles in `captions_ass/styles.py`:
  `pop` (large bold, word-by-word highlight colour + scale pop), `clean` (medium, white, subtle shadow, highlight underline), `bold` (uppercase, heavy stroke).
- Canvas `PlayResX=1080`, `PlayResY=1920`; bottom margin ≈ 25 % of height to stay clear of platform UI; outline ≈ 6 px; font size ≈ 72–96 px.
- Fonts: bundled OFL-licensed fonts in `assets/fonts` (record licenses); ffmpeg `ass` filter with `fontsdir`. Never rely on system fonts.
- `captionOverrides` replace word **text** only. Timing is kept.

---

## 9. Render spec (illustrative; validate in P2/P7, do not copy blindly)

```
ffmpeg -hide_banner -nostdin -y \
  -protocol_whitelist file,http,https,tcp,tls,crypto \
  -ss {startSec} -i {sourcePathOrPresignedUrl} -t {durSec} \
  -filter_complex "[0:v]fps=30,sendcmd=f=crop.cmd,crop@c=w={cropW}:h={cropH}:x=0:y=0,\
scale=1080:1920:flags=lanczos,setsar=1,ass=captions.ass:fontsdir=fonts,format=yuv420p[v];\
[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.03,afade=t=out:st={durSec-0.03}:d=0.03[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 128k \
  -movflags +faststart out.mp4
```
- `fps=30` first so variable-frame-rate phone video aligns with per-frame crop commands.
- Input seeking resets timestamps to 0, so crop/caption times are clip-relative.
- For `blur_fit`, replace the crop chain with `split` → blurred cover background + fitted foreground `overlay`.
- If ranged reads from the presigned URL prove unreliable, first stream-copy `[start−2 s, end+2 s]` to a temp file, then re-encode from it. Keep a bounded LRU download cache for the source.
- Thumbnail: single frame at ~1 s or the first frame with a detected face, `-frames:v 1`.
- Always call ffmpeg with **argument lists** (no shell), timeouts, stderr capture, and the cancel event.

---

## 10. Executors

| | Local (dev/free VM) | Modal (P9) |
|---|---|---|
| Stages | all (`WORKER_STAGES` configurable) | `transcribe`, `score` (GPU); optional CPU render |
| Models | ASR `small` int8; LLM small instruct via Ollama | ASR `large-v3`/distilled fp16; LLM via vLLM (gate G3) |
| Start | `uv run kiru-worker run` | CPU **dispatcher** cron polls `/queue-stats` and `.spawn()`s a GPU function that runs the same claim loop until idle timeout |
| Secrets | `.env` (gitignored) | `modal secret` objects |
| Model cache | local `HF_HOME` | Modal Volume |

The dispatcher design means the API has no knowledge of Modal and needs no inbound exposure.

---

## 11. Configuration (pydantic-settings; process exits on invalid config)

| Variable | Purpose |
|---|---|
| `KIRU_API_BASE_URL` | backend base URL |
| `KIRU_WORKER_TOKEN` | raw worker token (secret) |
| `WORKER_ID` | defaults to hostname + pid |
| `WORKER_EXECUTOR` | `local` \| `modal` |
| `WORKER_STAGES` | comma-separated stages this worker will claim |
| `WORK_DIR` | scratch directory root |
| `MAX_CONCURRENCY` | default 1 |
| `WHISPER_MODEL`, `WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE`, `WHISPER_MODEL_REVISION` | ASR |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY?` | LLM endpoint |
| `FACE_MODEL_PATH` | pinned MediaPipe `.tflite` |
| `SOURCE_CACHE_MAX_GB` | cache limit |
| `LOG_LEVEL` | logging |

---

## 12. Error taxonomy

`StageError(code, message, retryable)`. **Non-retryable:** `E_NOT_A_VIDEO`, `E_UNSUPPORTED_FORMAT`, `E_MEDIA_CORRUPT`, `E_NO_AUDIO`, `E_NO_SPEECH`, `E_TOO_LONG`. **Retryable:** network/R2 timeouts, `E_MODEL_FAILED` (first occurrences), `E_RENDER_FAILED` (ffmpeg crash/OOM, with reduced threads on retry), `E_INTERNAL`. Messages are user-safe; internals go to logs only.

---

## 13. Evaluation (offline, no backend needed)

`uv run kiru-worker eval` runs the stages in library mode on the golden set.
- **Golden set:** 20–30 videos across podcast, lecture, interview, vlog, gaming/screen-recording, with human-labelled best moments (`labels/*.json` = list of `{startMs,endMs}`), stored outside git (manifest holds checksums + licence/permission notes). Use only content you have rights to.
- **Metrics:** precision@k and recall@k (a pick matches a label if overlap ≥ 50 % of the shorter span), ASR WER on a small subset, reframe jitter and face coverage, caption sync error, stage runtimes, estimated cost per video-minute.
- **Baselines:** random, evenly spaced, energy-only. The scorer must beat all three before tuning is accepted. Tune weights on a train split; report on a held-out split.
- Reports are written to `evals/reports/YYYY-MM-DD.md`.

---

## 14. Testing strategy

- **Unit:** grouping/ASS generation, smoothing math, NMS, funnel, blend formula, argument builders (assert no shell and correct whitelists), contract validation.
- **Integration:** run each stage on small fixtures (synthetic `lavfi` video/audio plus tiny licensed speech/face clips); assert outputs validate and durations are right; ffmpeg render produces 1080×1920 with expected duration; captions burn-in verified by frame inspection.
- **End-to-end:** worker against a local backend (`run-once`), asserting stage statuses and uploaded assets.
- CI must not download large models; mark model-dependent tests so they can be skipped, and run a small-model smoke test locally or nightly.

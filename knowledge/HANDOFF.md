
---

## Update 2026-04-10 (Render stable hotfix: transcript status reliability)

- Date: 2026-04-10
- Task: fix transcript status errors on Render stable branch and restore behavior for Cyrillic/spaced filenames.
- Changed:
  - `backend/main.py`:
    - added filename normalization and resolver helpers:
      - `_normalize_filename`
      - `_resolve_existing_filename`
      - `_resolve_recording_or_404`
    - upload now normalizes incoming filename (`NFC`) to avoid future mismatch.
    - all detail-related API endpoints now resolve actual file name robustly before processing (`/api/recordings/*`, transcript, overview, actions, expert, document).
    - transcript read now uses `errors="replace"` and returns controlled error status instead of backend crash on corrupted stored transcript text.
  - `frontend/app.js`:
    - detail page now tolerates double-encoded `file` query value.
    - transcript API errors now show precise backend detail/HTTP code.
    - transcript polling is cleared on error to avoid endless failing loop.
- Not changed:
  - no new features were added.
  - recorder UX structure and tabs were not changed.
  - no AI/provider behavior changes.
- Risks:
  - existing old files with truly broken/non-audio content can still fail transcription, but now should surface controlled error text instead of generic server failure.
  - Node was not available in environment, so frontend syntax check via `node --check` was not run.
- Exact next step:
  1. Deploy updated `render-stable-freeze` branch on Render.
  2. Hard-refresh detail page (`Ctrl+F5`) to load new JS.
  3. Upload one file with Cyrillic + spaces and verify transcript tab no longer shows generic server status error.

## Update 2026-04-16 (hotfix: remove duplicated HTTP code text in transcript error)

- Date: 2026-04-16
- Task: eliminate duplicated `(HTTP 502)` text and keep transcript error UX clear.
- Changed:
  - `frontend/app.js`
    - in transcript tab error handling, changed `_extractApiError` fallback text to plain messages:
      - `Ошибка сервера`
      - `Ошибка запуска`
    - this prevents duplicate message form like `(HTTP 502) (HTTP 502)`.
- Not changed:
  - backend logic unchanged.
  - no endpoint contracts changed.
- Risks:
  - still depends on Render instance availability; true upstream 502 can still occur on free-tier limits.
- Exact next step:
  1. Redeploy branch `render-stable-freeze` on Render.
  2. Hard refresh browser (`Ctrl+F5`).
  3. Re-test transcript start on one new uploaded file.

## Update 2026-04-16 (pre-paid-cutover audit snapshot)

- Date: 2026-04-16
- Task: full readiness audit for paid hosting cutover + STT/GPT integration planning.
- Changed:
  - No functional code changes.
  - Performed checks:
    - `python -m compileall backend/main.py backend/ai_module.py` -> OK
    - `python -c "import backend.main, backend.ai_module"` -> OK
    - API smoke via FastAPI TestClient for upload/transcript/overview/actions/expert/document/delete -> all 200 in local test path.
  - Collected architectural findings for cutover:
    - service currently uses single-worker executor (`ThreadPoolExecutor(max_workers=1)`) -> throughput bottleneck under concurrent jobs.
    - upload endpoint has extension check only; no explicit size limit/quotas.
    - document export in stable branch is text draft (`.txt`) only, not docx/pdf in this branch.
    - expert module remains rule-based demo engine (no external LLM yet).
    - render blueprint still configured as free plan.
- Not changed:
  - Backend logic, frontend UX structure, API contracts unchanged.
- Risks:
  - Free-plan infra instability persists until paid cutover.
  - Without explicit upload limits, paid instance can be exhausted by large files.
  - Single worker can create long queue delays during investor demo if multiple operations are triggered.
- Exact next step:
  1. Switch Render to paid always-on instance and keep branch `render-stable-freeze`.
  2. Add operational env policy (size/time limits, timeout, logging) before enabling external STT/GPT providers.
  3. Integrate STT/GPT behind feature flags with fallback path preserved.

## Update 2026-04-16 (stage 1 hardening for stable hosting)

- Date: 2026-04-16
- Task: complete Stage 1 backend hardening before paid cutover.
- Changed:
  - `backend/main.py`:
    - added bounded env parsing for operational limits and worker config.
    - added upload-size guard (`ARGUS_MAX_UPLOAD_MB`) with clear `413` response and partial-file cleanup.
    - added audio-duration guard (`ARGUS_MAX_AUDIO_SECONDS`) before transcription start.
    - split background execution pools:
      - `_transcribe_executor` for transcription queue
      - `_analysis_executor` for overview/actions/expert queue
    - added running-job timeout guards for all async job types:
      - transcription (`ARGUS_TRANSCRIBE_JOB_TIMEOUT_SEC`)
      - overview/actions/expert (`ARGUS_ANALYSIS_JOB_TIMEOUT_SEC`)
    - added infra endpoints:
      - `/healthz` (basic liveness)
      - `/readyz` (recordings dir writable check + ffmpeg availability snapshot)
  - `render.yaml`:
    - health check switched to `/healthz`.
    - added env vars for limits/workers/timeouts with safe defaults.
  - verification:
    - `python -m compileall backend/main.py backend/ai_module.py` -> OK
    - `python -c "import backend.main, backend.ai_module"` -> OK
    - FastAPI TestClient smoke (upload/transcript/overview/actions/expert/document/delete + health/readiness + upload limit path) -> OK.
- Not changed:
  - frontend structure and 4-tab detail UX unchanged.
  - AI provider integration (Yandex/GPT) not added in this step.
  - official docx/pdf generator not added in this step.
- Risks:
  - free Render outages/traffic caps can still cause upstream 5xx regardless of code quality.
  - duration probing for non-wav relies on ffmpeg metadata output; if host ffmpeg behaves non-standard, only upload-size limits stay guaranteed.
- Exact next step:
  1. Deploy branch `render-stable-freeze` with new Stage 1 guards.
  2. Move Render service to paid always-on plan (to remove free-tier stop/start and quota instability).
  3. Start Stage 2: provider-adapter layer for production STT (Yandex + fallback) and GPT report generation under feature flags.

## Update 2026-04-16 (stage 2 start: yandex stt provider in backend)

- Date: 2026-04-16
- Task: switch transcription runtime to Yandex STT as primary provider, without frontend changes.
- Changed:
  - `backend/main.py`:
    - added `ARGUS_STT_PROVIDER` (default: `yandex_sync`).
    - added Yandex STT env knobs:
      - `ARGUS_YANDEX_TIMEOUT_SEC`
      - `ARGUS_YANDEX_RETRIES`
      - `ARGUS_YANDEX_CHUNK_SECONDS`
    - added Yandex sync STT pipeline:
      - audio conversion to mono PCM16 16kHz
      - chunked recognition for long audio
      - HTTP calls to SpeechKit `speech/v1/stt:recognize`
      - robust API/network error surfacing
    - transcription runner now routes by provider:
      - `yandex_sync` (primary)
      - `whisper_local` (explicit fallback only)
    - `/readyz` now validates Yandex credentials when `yandex_sync` is selected and returns `stt_provider` in payload.
  - verification:
    - `python -m compileall backend/main.py backend/ai_module.py` -> OK
    - `python -c "import backend.main, backend.ai_module"` -> OK
    - local TestClient smoke with mocked Yandex recognizer path -> OK
- Not changed:
  - frontend files unchanged.
  - tabs/ux flow unchanged.
  - GPT logic unchanged.
- Risks:
  - real Yandex recognition requires valid `YC_API_KEY` and `YC_FOLDER_ID` in Render env.
  - if SpeechKit rejects request (roles/scope/billing), transcript returns clear backend error text.
- Exact next step:
  1. Set Render env for Yandex credentials (`YC_API_KEY`, `YC_FOLDER_ID`) and `ARGUS_STT_PROVIDER=yandex_sync`.
  2. Redeploy and run live e2e check on one real investor-style recording.

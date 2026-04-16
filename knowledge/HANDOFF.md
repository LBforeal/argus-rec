
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

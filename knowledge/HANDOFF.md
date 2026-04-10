
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

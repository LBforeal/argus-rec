# Argus REC - Session Handoff

## Current snapshot
- Date: 2026-04-06
- Branch: `ui-redesign-demo`
- Latest pushed commit: `61c1905` (`origin/ui-redesign-demo`)
- Goal now: stabilize production-ready short release for demo/sales without breaking existing recorder core.

## Last confirmed context
- Old long chat was imported to `ARGUS_OLD_CHAT.md/Новый текстовый документ.txt`.
- Main unresolved stream in old chat: Yandex STT authorization instability (`401 PermissionDenied`) on Render.
- Agreed direction at stop point:
  - switch/auth-improve via IAM token flow (service account based)
  - keep compatibility with `YC_API_KEY`

## Changed in this step
- Added persistent memory system files:
  - `knowledge/PROJECT_MEMORY.md`
  - `knowledge/HANDOFF.md`
- Updated `AGENTS.md` with mandatory continuity rules.
- Updated `backend/main.py` (STT reliability patch):
  - added Yandex auth mode support via `YC_IAM_TOKEN` (Bearer) and `YC_API_KEY` (Api-Key)
  - Yandex strict mode default switched to non-strict (`YC_STT_STRICT=0` by default)
  - Russian language is now forced by default for fallback whisper backends (`ARGUS_TRANSCRIBE_LANGUAGE=ru`)
  - auth diagnostics now log mode/fingerprint safely (`mode`, `fp`, `len`)
- Updated `render.yaml` defaults:
  - `YC_STT_STRICT="0"`
  - `ARGUS_TRANSCRIBE_LANGUAGE=ru`

## Not changed in this step
- Backend files except `backend/main.py` not changed.
- Frontend/UI (`frontend/*`) not changed.
- Deployment config updated only in `render.yaml` env defaults for STT stability.

## Risks
- Chat memory can still be lost between sessions, but source-of-truth files now exist in repo.
- If handoff is not updated after future work, continuity will degrade.
- If both Yandex auth methods are invalid and fallback backend is unavailable in environment, transcript can still fail.
- Non-strict mode may produce fallback transcription quality lower than cloud STT during Yandex outages.

## Exact next step
1. Wait for Render auto-deploy of commit `61c1905` (or run Manual Deploy if auto-deploy disabled).
2. In Render env set (recommended):
   - `YC_IAM_TOKEN` (preferred) or valid `YC_API_KEY`
   - `YC_STT_STRICT=0`
   - `ARGUS_TRANSCRIBE_LANGUAGE=ru`
3. Run one real-audio transcription test and capture one log line with `[Yandex STT auth]`.
4. Record real test outcome and remaining issue (if any) in this file.

---

## Update template (copy for next sessions)
- Date:
- Task:
- Changed:
- Not changed:
- Risks:
- Exact next step:

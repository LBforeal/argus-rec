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
- Validation pass (no logic changes):
  - `python -m compileall backend/main.py backend/ai_module.py` passed
  - `python -c "import backend.main; import backend.ai_module"` passed (`import_ok`)
  - `render.yaml` parsed successfully via `yaml.safe_load` (`yaml_ok`)
  - merge-conflict markers scan returned no matches
- Updated Yandex STT auth strategy in `backend/main.py`:
  - added support for authorized service account key (`YC_SA_KEY_JSON` or `YC_SA_KEY_FILE`)
  - implemented automatic IAM token mint/refresh via `https://iam.api.cloud.yandex.net/iam/v1/tokens`
  - auth selection order is now:
    1) `YC_IAM_TOKEN`
    2) service-account generated IAM token
    3) `YC_API_KEY`
  - added `folderId` injection into STT recognize request when `YC_FOLDER_ID` is set
- Updated `requirements.txt`:
  - added `PyJWT[crypto]` for service-account JWT signing
- Updated `backend/main.py` document generation:
  - added auto-detection for ДТП transcript (`_is_dtp_transcript`)
  - added ДТП document builder (`_build_dtp_document_payload`)
  - new template: `dtp_notice_837p_draft_v1`
  - official basis stored in payload fields:
    - `official_basis`: Приложение 3 к Положению Банка России N 837-П
    - `official_source_url`: официальный Вестник Банка России с текстом формы
  - `/api/document/{filename}` now uses `_build_document_payload`:
    - ДТП transcript -> ДТП template
    - otherwise -> existing scene template

## Not changed in this step
- Backend files except `backend/main.py` not changed.
- Frontend/UI (`frontend/*`) not changed.
- Deployment config updated only in `render.yaml` env defaults for STT stability.
- During validation pass: no new code/config edits were made.
- Frontend/UI (`frontend/*`) still unchanged.
- No tab/navigation changes; endpoint contract preserved.

## Risks
- Chat memory can still be lost between sessions, but source-of-truth files now exist in repo.
- If handoff is not updated after future work, continuity will degrade.
- If both Yandex auth methods are invalid and fallback backend is unavailable in environment, transcript can still fail.
- Non-strict mode may produce fallback transcription quality lower than cloud STT during Yandex outages.
- Frontend JS syntax was not auto-checked because `node` is unavailable in this environment.
- Service-account mode requires valid YC authorized key JSON with fields: `id`, `service_account_id`, `private_key`.
- ДТП field extraction is quote/rule-based and may leave fields empty if they are not present in transcript.

## Exact next step
1. Wait for Render auto-deploy of commit `61c1905` (or run Manual Deploy if auto-deploy disabled).
2. In Render env set (recommended):
   - preferred: `YC_SA_KEY_JSON` (full authorized key JSON string) and `YC_FOLDER_ID`
   - optional alternatives: `YC_IAM_TOKEN` or valid `YC_API_KEY`
   - `YC_STT_STRICT=0`
   - `ARGUS_TRANSCRIBE_LANGUAGE=ru`
3. Run one real-audio transcription test and capture one log line with `[Yandex STT auth]`.
4. Record real test outcome and remaining issue (if any) in this file.
5. Optional: install Node locally and run `node --check frontend/app.js` for extra frontend syntax verification.
6. Run one real ДТП conversation audio and call `POST /api/document/{filename}`:
   - verify template is `dtp_notice_837p_draft_v1`
   - verify fields are filled only from transcript quotes.

---

## Update template (copy for next sessions)
- Date:
- Task:
- Changed:
- Not changed:
- Risks:
- Exact next step:

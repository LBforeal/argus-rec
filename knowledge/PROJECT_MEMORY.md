# Argus REC - Project Memory (Source of Truth)

## 1. Product definition
Argus REC is an intelligent professional recorder:
- record or upload audio
- get transcript
- get overview
- get actions
- get expert analysis (scenario-aware)
- later: generate official document draft

This is not a casual notes app. Main focus is professional use (legal, security, public service), while keeping UX clear for regular users.

## 2. Hard product constraints
- No fake transcript/summary/actions/expert output.
- Any AI result must come only from real processed audio.
- If audio is not processed yet, show empty/no-data state.
- Main screen: record button, upload button, file list.
- Detail screen: exactly 4 tabs:
  - Overview
  - Transcript
  - Actions
  - Expert

## 3. Current repository shape
- Backend: `backend/main.py`, `backend/ai_module.py`
- Frontend: `frontend/index.html`, `frontend/detail.html`, `frontend/app.js`, `frontend/style.css`
- Domain knowledge texts: `knowledge/*.txt.txt`
- Deployment docs: `DEPLOY_RENDER.md`, `render.yaml`, `Procfile`

## 4. Current technical direction (important)
- Keep existing Argus recorder framework stable.
- STT quality target for Russian speech is Yandex SpeechKit.
- Priority is reliable real transcription pipeline (no emulation).
- If STT auth fails, fix auth/permissions path, not UI cosmetics.

## 5. Known context from previous long chat
- Repeated issue track: Yandex STT `401 PermissionDenied`.
- A fix was discussed/applied in prior work for API key normalization (zero-width character cleanup).
- Next strategic step agreed in prior context:
  - move to IAM-token auth via service account credentials
  - keep backward compatibility with `YC_API_KEY`

## 6. Working style for every session
- Make only step-by-step, scoped changes.
- Do not touch unrelated files.
- Before change: state what will be changed.
- After change: report
  - changed
  - unchanged
  - risks
- Always write latest status into `knowledge/HANDOFF.md`.

## 7. Recovery in a new chat
If chat context is lost:
1. Read this file.
2. Read `knowledge/HANDOFF.md`.
3. If needed, read `ARGUS_OLD_CHAT.md/Новый текстовый документ.txt`.
4. Continue from "Exact next step" in handoff.

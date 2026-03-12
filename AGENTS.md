# Argus project rules

You are working on Argus, a smart recorder MVP.

Core rules:
- Never invent transcript text, summary, action items, or expert analysis from fake or placeholder content.
- Any transcript, summary, speaker split, or expert result must come only from a real uploaded or recorded audio file.
- If there is no real processed audio, show empty state or "no data yet" state instead of fake content.
- Work strictly step by step.
- Do not add extra features unless explicitly asked.
- Do not refactor unrelated files.
- Do not rename files or move architecture without explicit approval.
- Before making changes, briefly state what you will change.
- After making changes, provide a short report: what changed, what did not change, and any risks.

Product constraints:
- Keep the app simple and clear.
- Main screen should focus on:
  - record button
  - upload audio button
  - file list
- Record detail screen should have exactly 4 tabs:
  - Overview
  - Transcript
  - Actions
  - Expert
- Avoid clutter.
- Avoid overloaded navigation.
- Avoid placeholder AI outputs.

Workflow rules:
- Use real user-provided audio only.
- No fake transcripts.
- No fake summaries.
- No fake expert reasoning.
- If a backend or processing step is not implemented yet, do not simulate final AI results.
import os
import re
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RECORDINGS_DIR = os.path.join(BASE_DIR, "recordings")
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")

os.makedirs(RECORDINGS_DIR, exist_ok=True)

app = FastAPI()

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".flac", ".aac"}
TRANSCRIPT_SUFFIX = ".transcript.txt"
OVERVIEW_SUFFIX = ".overview.txt"
ACTIONS_SUFFIX = ".actions.json"
EXPERT_SUFFIX = ".expert.json"

# ── TRANSCRIPTION STATE ──────────────────────────────────────

# In-memory job state: filename -> {status, text?, error?}
# "idle"    - not started
# "running" - in progress
# "done"    - completed, text is stored
# "error"   - failed, error message stored
_jobs: dict = {}
_jobs_lock = threading.Lock()

_executor = ThreadPoolExecutor(max_workers=1)

_whisper_model = None
_whisper_model_lock = threading.Lock()


def _get_whisper_model():
    global _whisper_model
    with _whisper_model_lock:
        if _whisper_model is None:
            import whisper
            _whisper_model = whisper.load_model("base")
        return _whisper_model


def _transcript_path(filename: str) -> str:
    return os.path.join(RECORDINGS_DIR, filename + TRANSCRIPT_SUFFIX)


_overview_jobs: dict = {}
_overview_jobs_lock = threading.Lock()


def _overview_path(filename: str) -> str:
    return os.path.join(RECORDINGS_DIR, filename + OVERVIEW_SUFFIX)


def _extract_overview(text: str) -> str:
    """Extract 3-5 key sentences directly from text. Pure extractive, no rewording."""
    sentences = [s.strip() for s in re.split(r'(?<=[.!?…])\s+', text) if len(s.strip()) >= 15]

    if not sentences:
        return text.strip()

    if len(sentences) <= 5:
        return '\n'.join(sentences)

    n_select = min(5, max(3, len(sentences) // 3))
    scored = []
    n = len(sentences)
    for i, s in enumerate(sentences):
        score = 0.0
        if i < 2:
            score += 2.0
        elif i >= n - 1:
            score += 1.5
        else:
            score += 1.0
        score += min(len(s) / 150, 1.0)
        scored.append((i, s, score))

    scored.sort(key=lambda x: x[2], reverse=True)
    top = scored[:n_select]
    top.sort(key=lambda x: x[0])
    return '\n'.join(t[1] for t in top)


def _run_overview(filename: str):
    try:
        tpath = _transcript_path(filename)
        with open(tpath, "r", encoding="utf-8") as f:
            transcript = f.read().strip()

        if not transcript:
            with _overview_jobs_lock:
                _overview_jobs[filename] = {"status": "error", "error": "Транскрипт пуст"}
            return

        overview_text = _extract_overview(transcript)

        with open(_overview_path(filename), "w", encoding="utf-8") as f:
            f.write(overview_text)

        with _overview_jobs_lock:
            _overview_jobs[filename] = {"status": "done", "text": overview_text}
    except Exception as e:
        with _overview_jobs_lock:
            _overview_jobs[filename] = {"status": "error", "error": str(e)}


_actions_jobs: dict = {}
_actions_jobs_lock = threading.Lock()

_ACTION_MARKERS = re.compile(
    r'(?:нужно|надо|необходимо|следует|должн|обязательно|'
    r'сделать|подготовить|отправить|позвонить|договориться|'
    r'запланировать|назначить|проверить|написать|связаться|'
    r'обсудить|решить|завершить|закончить|передать|согласовать|'
    r'утвердить|выполнить|срок|дедлайн)',
    re.IGNORECASE,
)


def _actions_path(filename: str) -> str:
    return os.path.join(RECORDINGS_DIR, filename + ACTIONS_SUFFIX)


def _extract_actions(text: str) -> list:
    """Filter sentences containing action/task markers. Pure extractive."""
    sentences = [s.strip() for s in re.split(r'(?<=[.!?…])\s+', text) if len(s.strip()) >= 10]
    return [s for s in sentences if _ACTION_MARKERS.search(s)]


def _run_actions(filename: str):
    import json
    try:
        tpath = _transcript_path(filename)
        with open(tpath, "r", encoding="utf-8") as f:
            transcript = f.read().strip()

        if not transcript:
            with _actions_jobs_lock:
                _actions_jobs[filename] = {"status": "error", "error": "Транскрипт пуст"}
            return

        items = _extract_actions(transcript)

        with open(_actions_path(filename), "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False)

        with _actions_jobs_lock:
            _actions_jobs[filename] = {"status": "done", "items": items}
    except Exception as e:
        with _actions_jobs_lock:
            _actions_jobs[filename] = {"status": "error", "error": str(e)}


_expert_jobs: dict = {}
_expert_jobs_lock = threading.Lock()


def _expert_path(filename: str) -> str:
    return os.path.join(RECORDINGS_DIR, filename + EXPERT_SUFFIX)


def _run_expert(filename: str):
    import json
    try:
        tpath = _transcript_path(filename)
        with open(tpath, "r", encoding="utf-8") as f:
            transcript = f.read().strip()

        if not transcript:
            with _expert_jobs_lock:
                _expert_jobs[filename] = {"status": "error", "error": "Транскрипт пуст"}
            return

        from backend.ai_module import run_expert_analysis
        result = run_expert_analysis(transcript)

        with open(_expert_path(filename), "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)

        with _expert_jobs_lock:
            _expert_jobs[filename] = {"status": "done", "sections": result.get("sections", [])}
    except Exception as e:
        with _expert_jobs_lock:
            _expert_jobs[filename] = {"status": "error", "error": str(e)}


def _run_transcription(filename: str):
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    try:
        model = _get_whisper_model()
        result = model.transcribe(audio_path)
        text = result["text"].strip()

        with open(_transcript_path(filename), "w", encoding="utf-8") as f:
            f.write(text)

        with _jobs_lock:
            _jobs[filename] = {"status": "done", "text": text}
    except Exception as e:
        with _jobs_lock:
            _jobs[filename] = {"status": "error", "error": str(e)}


# ── EXISTING ENDPOINTS ───────────────────────────────────────

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    name = os.path.basename(file.filename or "")
    if not name:
        raise HTTPException(status_code=400, detail="Имя файла не указано")

    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Неподдерживаемый формат файла")

    save_path = os.path.join(RECORDINGS_DIR, name)
    base, extension = os.path.splitext(name)
    counter = 1
    while os.path.exists(save_path):
        name = f"{base}_{counter}{extension}"
        save_path = os.path.join(RECORDINGS_DIR, name)
        counter += 1

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    return {"filename": name}


@app.get("/api/recordings")
def list_recordings():
    result = []
    for fname in os.listdir(RECORDINGS_DIR):
        fpath = os.path.join(RECORDINGS_DIR, fname)
        if os.path.isfile(fpath) and not fname.endswith(TRANSCRIPT_SUFFIX) and not fname.endswith(OVERVIEW_SUFFIX) and not fname.endswith(ACTIONS_SUFFIX) and not fname.endswith(EXPERT_SUFFIX):
            stat = os.stat(fpath)
            result.append({
                "filename": fname,
                "size": stat.st_size,
                "modified": stat.st_mtime,
            })
    result.sort(key=lambda x: x["modified"], reverse=True)
    return result


@app.get("/api/recordings/{filename}")
def get_recording(filename: str):
    filename = os.path.basename(filename)
    fpath = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(fpath)


# ── TRANSCRIPTION ENDPOINTS ──────────────────────────────────

@app.post("/api/transcribe/{filename}")
def start_transcription(filename: str):
    filename = os.path.basename(filename)
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    with _jobs_lock:
        if _jobs.get(filename, {}).get("status") == "running":
            return {"status": "running"}
        _jobs[filename] = {"status": "running"}

    _executor.submit(_run_transcription, filename)
    return {"status": "running"}


@app.get("/api/transcript/{filename}")
def get_transcript(filename: str):
    filename = os.path.basename(filename)
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    with _jobs_lock:
        job = _jobs.get(filename)
        if job:
            return job

    # Check disk for a saved transcript (survives server restart)
    tpath = _transcript_path(filename)
    if os.path.isfile(tpath):
        with open(tpath, "r", encoding="utf-8") as f:
            text = f.read()
        return {"status": "done", "text": text}

    return {"status": "idle"}


# ── OVERVIEW ENDPOINTS ────────────────────────────────────────

@app.post("/api/overview/{filename}")
def start_overview(filename: str):
    filename = os.path.basename(filename)
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    tpath = _transcript_path(filename)
    if not os.path.isfile(tpath):
        return {"status": "no_transcript"}

    with _overview_jobs_lock:
        if _overview_jobs.get(filename, {}).get("status") == "running":
            return {"status": "running"}
        _overview_jobs[filename] = {"status": "running"}

    _executor.submit(_run_overview, filename)
    return {"status": "running"}


@app.get("/api/overview/{filename}")
def get_overview(filename: str):
    filename = os.path.basename(filename)
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    tpath = _transcript_path(filename)
    if not os.path.isfile(tpath):
        return {"status": "no_transcript"}

    with _overview_jobs_lock:
        job = _overview_jobs.get(filename)
        if job:
            return job

    opath = _overview_path(filename)
    if os.path.isfile(opath):
        with open(opath, "r", encoding="utf-8") as f:
            text = f.read()
        return {"status": "done", "text": text}

    return {"status": "idle"}


# ── ACTIONS ENDPOINTS ─────────────────────────────────────────

@app.post("/api/actions/{filename}")
def start_actions(filename: str):
    filename = os.path.basename(filename)
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    tpath = _transcript_path(filename)
    if not os.path.isfile(tpath):
        return {"status": "no_transcript"}

    with _actions_jobs_lock:
        if _actions_jobs.get(filename, {}).get("status") == "running":
            return {"status": "running"}
        _actions_jobs[filename] = {"status": "running"}

    _executor.submit(_run_actions, filename)
    return {"status": "running"}


@app.get("/api/actions/{filename}")
def get_actions(filename: str):
    import json
    filename = os.path.basename(filename)
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    tpath = _transcript_path(filename)
    if not os.path.isfile(tpath):
        return {"status": "no_transcript"}

    with _actions_jobs_lock:
        job = _actions_jobs.get(filename)
        if job:
            return job

    apath = _actions_path(filename)
    if os.path.isfile(apath):
        try:
            with open(apath, "r", encoding="utf-8") as f:
                items = json.load(f)
            return {"status": "done", "items": items}
        except Exception:
            return {"status": "error", "error": "Не удалось прочитать сохранённые действия. Попробуйте построить заново."}

    return {"status": "idle"}


# ── EXPERT ENDPOINTS ──────────────────────────────────────────

@app.post("/api/expert/{filename}")
def start_expert(filename: str):
    filename = os.path.basename(filename)
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    tpath = _transcript_path(filename)
    if not os.path.isfile(tpath):
        return {"status": "no_transcript"}

    with _expert_jobs_lock:
        if _expert_jobs.get(filename, {}).get("status") == "running":
            return {"status": "running"}
        _expert_jobs[filename] = {"status": "running"}

    _executor.submit(_run_expert, filename)
    return {"status": "running"}


@app.get("/api/expert/{filename}")
def get_expert(filename: str):
    import json
    filename = os.path.basename(filename)
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    tpath = _transcript_path(filename)
    if not os.path.isfile(tpath):
        return {"status": "no_transcript"}

    with _expert_jobs_lock:
        job = _expert_jobs.get(filename)
        if job:
            return job

    epath = _expert_path(filename)
    if os.path.isfile(epath):
        with open(epath, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {"status": "done", "sections": data.get("sections", [])}

    return {"status": "idle"}


# Static files must be mounted last
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")

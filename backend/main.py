import os
import re
import shutil
import tempfile
import threading
import traceback
import wave
import subprocess
import gc
import json
import glob
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")

# Local: backend/recordings
# Render/cloud: /tmp/argus_recordings (writable ephemeral storage)
if os.getenv("ARGUS_RECORDINGS_DIR"):
    RECORDINGS_DIR = os.getenv("ARGUS_RECORDINGS_DIR")
elif os.getenv("RENDER"):
    RECORDINGS_DIR = "/tmp/argus_recordings"
else:
    RECORDINGS_DIR = os.path.join(BASE_DIR, "recordings")

os.makedirs(RECORDINGS_DIR, exist_ok=True)

app = FastAPI()

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".flac", ".aac"}
TRANSCRIPT_SUFFIX = ".transcript.txt"
OVERVIEW_SUFFIX = ".overview.txt"
ACTIONS_SUFFIX = ".actions.json"
EXPERT_SUFFIX = ".expert.json"
DOCUMENT_SUFFIX = ".document.json"

# ── TRANSCRIPTION STATE ──────────────────────────────────────

# In-memory job state: filename -> {status, text?, error?}
# "idle"    - not started
# "running" - in progress
# "done"    - completed, text is stored
# "error"   - failed, error message stored
_jobs: dict = {}
_jobs_lock = threading.Lock()

_executor = ThreadPoolExecutor(max_workers=1)

_ffmpeg_executable = None
_ffmpeg_checked = False
_ffmpeg_lock = threading.Lock()


def _transcribe_audio_with_light_backend(audio_data):
    """
    Memory-friendly transcription path for small cloud instances.
    Uses faster-whisper by default; falls back to openai-whisper if installed.
    """
    model_name = os.getenv("ARGUS_WHISPER_MODEL")
    if not model_name:
        model_name = "tiny" if os.getenv("RENDER") else "base"

    # Preferred backend: faster-whisper (lower memory footprint on CPU)
    try:
        from faster_whisper import WhisperModel

        compute_type = os.getenv("ARGUS_COMPUTE_TYPE", "int8")
        cpu_threads_env = os.getenv("ARGUS_CPU_THREADS")
        cpu_threads = int(cpu_threads_env) if cpu_threads_env else (1 if os.getenv("RENDER") else 0)

        model = WhisperModel(
            model_name,
            device="cpu",
            compute_type=compute_type,
            cpu_threads=cpu_threads if cpu_threads > 0 else 0,
        )
        segments, _info = model.transcribe(
            audio_data,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = " ".join((seg.text or "").strip() for seg in segments).strip()

        del model
        gc.collect()
        return text
    except Exception:
        pass

    # Fallback backend: openai-whisper (if present in environment)
    try:
        import whisper
        model = whisper.load_model(model_name)
        result = model.transcribe(audio_data)
        text = (result.get("text") or "").strip()
        del model
        gc.collect()
        return text
    except Exception as e:
        raise RuntimeError(
            "Не удалось запустить распознавание речи в текущем окружении. "
            "Требуется установленный faster-whisper."
        ) from e


def _is_yandex_stt_configured() -> bool:
    return bool((os.getenv("YC_API_KEY") or "").strip())


def _is_yandex_stt_strict() -> bool:
    value = (os.getenv("YC_STT_STRICT") or "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def _transcribe_audio_with_yandex(path: str, ffmpeg_executable: str) -> str:
    """
    Cloud STT path for memory-limited instances:
    1) split audio into short OggOpus chunks
    2) send each chunk to Yandex SpeechKit sync API
    3) concatenate recognized text
    """
    api_key = (os.getenv("YC_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Yandex SpeechKit не настроен: отсутствует YC_API_KEY.")

    if not ffmpeg_executable:
        raise RuntimeError("Для облачной расшифровки нужен ffmpeg.")

    lang = (os.getenv("YC_STT_LANG") or "ru-RU").strip()
    topic = (os.getenv("YC_STT_TOPIC") or "general").strip()
    bitrate = (os.getenv("YC_STT_BITRATE") or "24k").strip()
    try:
        chunk_seconds = int((os.getenv("YC_STT_CHUNK_SECONDS") or "25").strip())
    except Exception:
        chunk_seconds = 25
    chunk_seconds = max(10, min(chunk_seconds, 30))

    tmp_dir = tempfile.mkdtemp(prefix="argus_yc_stt_")
    try:
        chunk_pattern = os.path.join(tmp_dir, "chunk_%05d.ogg")
        split_cmd = [
            ffmpeg_executable,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            path,
            "-ac",
            "1",
            "-ar",
            "48000",
            "-c:a",
            "libopus",
            "-b:a",
            bitrate,
            "-vbr",
            "on",
            "-f",
            "segment",
            "-segment_time",
            str(chunk_seconds),
            "-reset_timestamps",
            "1",
            chunk_pattern,
        ]
        try:
            subprocess.run(split_cmd, capture_output=True, check=True)
        except subprocess.CalledProcessError as e:
            stderr = (e.stderr or b"").decode("utf-8", errors="replace").strip()
            raise RuntimeError(
                f"Не удалось подготовить аудио для облачной расшифровки: {stderr[:240] or 'ошибка ffmpeg'}"
            ) from e

        chunks = sorted(glob.glob(os.path.join(tmp_dir, "chunk_*.ogg")))
        if not chunks:
            raise RuntimeError("Не удалось разделить аудио на фрагменты для облачной расшифровки.")

        base_url = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize"
        recognized_parts = []

        for idx, chunk_path in enumerate(chunks, start=1):
            with open(chunk_path, "rb") as f:
                payload = f.read()
            if not payload:
                continue

            params = urllib.parse.urlencode(
                {
                    "lang": lang,
                    "topic": topic,
                    "format": "oggopus",
                }
            )
            req = urllib.request.Request(
                f"{base_url}?{params}",
                data=payload,
                method="POST",
                headers={
                    "Authorization": f"Api-Key {api_key}",
                    "Content-Type": "application/octet-stream",
                },
            )

            last_err = None
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(req, timeout=60) as resp:
                        body = (resp.read() or b"").decode("utf-8", errors="replace")
                    data = json.loads(body) if body else {}
                    if "error_code" in data or "error_message" in data:
                        msg = str(data.get("error_message") or data.get("error_code") or "unknown error")
                        raise RuntimeError(f"Yandex STT вернул ошибку на фрагменте {idx}: {msg}")
                    part = (data.get("result") or "").strip()
                    if part:
                        recognized_parts.append(part)
                    last_err = None
                    break
                except urllib.error.HTTPError as e:
                    try:
                        err_body = (e.read() or b"").decode("utf-8", errors="replace")
                    except Exception:
                        err_body = ""
                    retryable = e.code in {429, 500, 502, 503, 504}
                    last_err = RuntimeError(
                        f"Yandex STT HTTP {e.code} на фрагменте {idx}: {err_body[:200] or e.reason}"
                    )
                    if retryable and attempt < 2:
                        time.sleep(1.0 * (attempt + 1))
                        continue
                    raise last_err
                except urllib.error.URLError as e:
                    last_err = RuntimeError(f"Сетевая ошибка Yandex STT на фрагменте {idx}: {e}")
                    if attempt < 2:
                        time.sleep(1.0 * (attempt + 1))
                        continue
                    raise last_err
                except Exception as e:
                    last_err = RuntimeError(f"Ошибка Yandex STT на фрагменте {idx}: {e}")
                    if attempt < 2:
                        time.sleep(1.0 * (attempt + 1))
                        continue
                    raise last_err

            if last_err:
                raise last_err

        return " ".join(recognized_parts).strip()
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


def _is_ffmpeg_usable(command: str) -> bool:
    try:
        probe = subprocess.run(
            [command, "-version"],
            capture_output=True,
            check=False,
            text=True,
            timeout=5,
        )
        return probe.returncode == 0
    except Exception:
        return False


def _resolve_ffmpeg_executable():
    global _ffmpeg_executable, _ffmpeg_checked
    with _ffmpeg_lock:
        if _ffmpeg_checked:
            return _ffmpeg_executable

        env_path = os.getenv("ARGUS_FFMPEG_PATH")
        if env_path and _is_ffmpeg_usable(env_path):
            _ffmpeg_executable = env_path
            _ffmpeg_checked = True
            return _ffmpeg_executable

        if _is_ffmpeg_usable("ffmpeg"):
            _ffmpeg_executable = "ffmpeg"
            _ffmpeg_checked = True
            return _ffmpeg_executable

        try:
            import imageio_ffmpeg
            bundled = imageio_ffmpeg.get_ffmpeg_exe()
            if bundled and _is_ffmpeg_usable(bundled):
                _ffmpeg_executable = bundled
                _ffmpeg_checked = True
                return _ffmpeg_executable
        except Exception:
            pass

        _ffmpeg_executable = None
        _ffmpeg_checked = True
        return None


def _load_audio_with_ffmpeg(path: str, ffmpeg_executable: str, target_sr: int = 16000):
    cmd = [
        ffmpeg_executable,
        "-nostdin",
        "-threads",
        "0",
        "-i",
        path,
        "-f",
        "s16le",
        "-ac",
        "1",
        "-acodec",
        "pcm_s16le",
        "-ar",
        str(target_sr),
        "-",
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, check=True).stdout
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or b"").decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg не смог обработать аудио: {stderr[:240] or 'неизвестная ошибка'}") from e

    if not out:
        raise RuntimeError("ffmpeg вернул пустой аудиопоток.")

    audio = np.frombuffer(out, np.int16).astype(np.float32) / 32768.0
    return np.clip(audio, -1.0, 1.0)


def _load_wav_for_whisper(path: str, target_sr: int = 16000):
    """Load WAV audio without ffmpeg and return mono float32 waveform."""
    with wave.open(path, "rb") as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        sample_rate = wf.getframerate()
        frames = wf.getnframes()
        raw = wf.readframes(frames)

    if frames == 0:
        return np.zeros((0,), dtype=np.float32)

    if sample_width == 1:
        audio = np.frombuffer(raw, dtype=np.uint8).astype(np.float32)
        audio = (audio - 128.0) / 128.0
    elif sample_width == 2:
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        audio = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Неподдерживаемая WAV-разрядность: {sample_width * 8} бит")

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    if sample_rate != target_sr and audio.size > 0:
        duration = audio.size / float(sample_rate)
        target_len = max(1, int(round(duration * target_sr)))
        old_x = np.linspace(0.0, 1.0, num=audio.size, endpoint=False)
        new_x = np.linspace(0.0, 1.0, num=target_len, endpoint=False)
        audio = np.interp(new_x, old_x, audio).astype(np.float32)
    else:
        audio = audio.astype(np.float32, copy=False)

    np.clip(audio, -1.0, 1.0, out=audio)
    return audio


def _transcript_path(filename: str) -> str:
    return os.path.join(RECORDINGS_DIR, filename + TRANSCRIPT_SUFFIX)


_overview_jobs: dict = {}
_overview_jobs_lock = threading.Lock()


def _overview_path(filename: str) -> str:
    return os.path.join(RECORDINGS_DIR, filename + OVERVIEW_SUFFIX)


def _clear_derived_outputs(filename: str) -> None:
    """Remove previous derived artifacts before a fresh transcription run."""
    for path in (
        _transcript_path(filename),
        _overview_path(filename),
        _actions_path(filename),
        _expert_path(filename),
        _document_path(filename),
    ):
        try:
            if os.path.exists(path):
                os.remove(path)
        except OSError:
            # Non-fatal: new run can still proceed, and errors will surface if write fails later.
            pass


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


def _document_path(filename: str) -> str:
    return os.path.join(RECORDINGS_DIR, filename + DOCUMENT_SUFFIX)


def _read_optional_text(path: str) -> str:
    if not os.path.isfile(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()


def _read_optional_json(path: str, fallback):
    if not os.path.isfile(path):
        return fallback
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return fallback


def _extract_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text) if len(s.strip()) >= 10]


def _find_first_sentence(text: str, keywords: list[str]) -> str:
    sentences = _extract_sentences(text)
    for sentence in sentences:
        normalized = sentence.lower()
        if any(keyword in normalized for keyword in keywords):
            return sentence
    return ""


def _collect_scene_quotes(text: str, keywords: list[str], limit: int = 5) -> list[str]:
    seen = set()
    result = []
    for sentence in _extract_sentences(text):
        normalized = sentence.lower()
        if not any(keyword in normalized for keyword in keywords):
            continue
        key = normalized.strip()
        if key in seen:
            continue
        seen.add(key)
        result.append(sentence)
        if len(result) >= limit:
            break
    return result


def _build_scene_document_payload(filename: str) -> dict:
    transcript = _read_optional_text(_transcript_path(filename))
    if not transcript:
        raise RuntimeError("Транскрипт отсутствует.")

    overview = _read_optional_text(_overview_path(filename))
    actions_items = _read_optional_json(_actions_path(filename), [])
    expert_report = _read_optional_json(_expert_path(filename), {})

    date_match = re.search(r"\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b", transcript)
    time_match = re.search(r"\b\d{1,2}:\d{2}\b", transcript)

    location = _find_first_sentence(
        transcript,
        ["адрес", "место", "квартира", "подъезд", "территор", "помещен", "комната"],
    )
    participants = _find_first_sentence(
        transcript,
        ["участ", "понят", "следоват", "сотрудник", "заявител", "свидетел", "оператив"],
    )
    findings = _collect_scene_quotes(
        transcript,
        ["обнаруж", "след", "предмет", "поврежден", "взлом", "осмотр", "место", "вещ"],
        limit=6,
    )
    fixation = _collect_scene_quotes(
        transcript,
        ["фото", "видео", "зафиксир", "схем", "изъят", "упак", "опечат", "протокол"],
        limit=6,
    )

    actions = [str(item).strip() for item in actions_items if str(item).strip()]
    if not actions:
        actions = _collect_scene_quotes(
            transcript,
            ["нужно", "надо", "следует", "обязательно", "сделать", "проверить", "оформить"],
            limit=6,
        )

    expert_scenario = str(expert_report.get("scenario") or "").strip()
    expert_match = str(expert_report.get("match_level") or "").strip()
    expert_signs = [str(s).strip() for s in (expert_report.get("found_signs") or []) if str(s).strip()]

    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    def _lines_from_list(items: list[str], fallback: str) -> list[str]:
        if not items:
            return [f"- {fallback}"]
        return [f"- {item}" for item in items]

    lines = [
        "ЧЕРНОВИК ДОКУМЕНТА",
        "Тип: Осмотр места (рабочая заготовка)",
        f"Источник: аудиозапись \"{filename}\"",
        f"Сформировано: {generated_at}",
        "",
        "Важно: документ собран только из реальной расшифровки записи и требует проверки человеком.",
        "",
        "1. Исходные сведения",
        f"- Дата из записи: {date_match.group(0) if date_match else 'Не указано в записи'}",
        f"- Время из записи: {time_match.group(0) if time_match else 'Не указано в записи'}",
        f"- Место (фрагмент): {location if location else 'Не указано в записи'}",
        f"- Участники (фрагмент): {participants if participants else 'Не указано в записи'}",
        "",
        "2. Обстоятельства и обнаруженные данные (цитаты из записи)",
    ]
    lines.extend(_lines_from_list(findings, "В записи не найдено явных формулировок по обстоятельствам/находкам."))
    lines.append("")
    lines.append("3. Фиксация и процессуальные действия (цитаты из записи)")
    lines.extend(_lines_from_list(fixation, "В записи не найдено явных формулировок по фиксации/процессуальным действиям."))
    lines.append("")
    lines.append("4. Действия по итогам записи")
    lines.extend(_lines_from_list(actions, "В записи не найдено явных поручений/действий."))
    lines.append("")
    lines.append("5. Дополнительные блоки из Argus")
    lines.append(f"- Обзор: {overview if overview else 'Не сформирован'}")
    lines.append(f"- Экспертный сценарий: {expert_scenario if expert_scenario else 'Не определен'}")
    lines.append(f"- Уровень совпадения: {expert_match if expert_match else 'Не определен'}")
    lines.append(
        f"- Признаки сценария: {', '.join(expert_signs) if expert_signs else 'Не определены'}"
    )
    lines.append("")
    lines.append("6. Служебная пометка")
    lines.append("- Черновик не заменяет официальный процессуальный документ.")
    lines.append("- Перед использованием требуется ручная проверка и редактирование.")

    text = "\n".join(lines).strip()
    return {
        "template": "scene_inspection_draft_v1",
        "filename": filename,
        "generated_at": generated_at,
        "text": text,
        "fields": {
            "date": date_match.group(0) if date_match else "",
            "time": time_match.group(0) if time_match else "",
            "location_quote": location,
            "participants_quote": participants,
            "findings_quotes": findings,
            "fixation_quotes": fixation,
            "actions": actions,
            "overview": overview,
            "expert_scenario": expert_scenario,
            "expert_match_level": expert_match,
            "expert_signs": expert_signs,
        },
    }


def _run_expert(filename: str, analysis_mode: str | None = None):
    import json
    try:
        tpath = _transcript_path(filename)
        with open(tpath, "r", encoding="utf-8") as f:
            transcript = f.read().strip()

        from backend.ai_module import run_expert_analysis
        result = run_expert_analysis(transcript, analysis_mode=analysis_mode)

        with open(_expert_path(filename), "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)

        with _expert_jobs_lock:
            _expert_jobs[filename] = {"status": "done", "report": result}
    except Exception as e:
        with _expert_jobs_lock:
            _expert_jobs[filename] = {"status": "error", "error": str(e)}


def _run_transcription(filename: str):
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    ext = os.path.splitext(filename)[1].lower()
    tmp_path = None
    diag = {}  # diagnostic accumulator
    try:
        # ── STEP 1: check source file accessibility ──────────────
        diag["audio_path"] = audio_path
        diag["audio_exists"] = os.path.isfile(audio_path)
        diag["audio_size"] = os.path.getsize(audio_path) if diag["audio_exists"] else -1

        # Try to open source file for reading explicitly
        try:
            with open(audio_path, "rb") as _ftest:
                diag["audio_readable"] = True
        except OSError as _oe:
            diag["audio_readable"] = False
            diag["audio_open_error"] = f"{type(_oe).__name__}: {_oe}"
            raise

        # ── STEP 2: backend init is deferred until transcription ─

        # ── STEP 3: create temp file ─────────────────────────────
        diag["step"] = "mkstemp"
        suffix = os.path.splitext(filename)[1] or ".audio"
        fd, tmp_path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        diag["tmp_path"] = tmp_path

        # ── STEP 4: copy to temp (retry on PermissionError — Windows file lock) ──
        diag["step"] = "copy2"
        import time as _time
        for _attempt in range(5):
            try:
                shutil.copy2(audio_path, tmp_path)
                break
            except PermissionError as _pe:
                diag[f"copy2_attempt_{_attempt}_error"] = str(_pe)
                if _attempt == 4:
                    raise
                _time.sleep(0.5 * (_attempt + 1))
        diag["tmp_size"] = os.path.getsize(tmp_path)

        # ── STEP 5: transcribe from temp ─────────────────────────
        diag["step"] = "transcribe"
        ffmpeg_executable = _resolve_ffmpeg_executable()
        diag["ffmpeg_executable"] = ffmpeg_executable or "none"
        diag["yandex_enabled"] = _is_yandex_stt_configured()
        if diag["yandex_enabled"]:
            try:
                diag["step"] = "transcribe_yandex"
                text = _transcribe_audio_with_yandex(tmp_path, ffmpeg_executable)
            except Exception as yandex_err:
                strict_yandex = _is_yandex_stt_strict()
                diag["yandex_strict"] = strict_yandex
                # Safe fallback: do not block transcription flow if cloud STT misconfigured.
                diag["yandex_error"] = str(yandex_err)
                print(f"[Yandex STT fallback] file={filename} error={yandex_err}", flush=True)
                # In strict mode we stop here to avoid silently returning low-quality fallback text.
                if strict_yandex:
                    raise RuntimeError(f"Ошибка Yandex STT: {yandex_err}") from yandex_err
                if ffmpeg_executable:
                    audio_data = _load_audio_with_ffmpeg(tmp_path, ffmpeg_executable)
                else:
                    if ext != ".wav":
                        raise RuntimeError(
                            "Для этого формата нужен ffmpeg. Установите ffmpeg в систему или imageio-ffmpeg."
                        )
                    wav_audio = _load_wav_for_whisper(tmp_path)
                    audio_data = wav_audio
                diag["step"] = "init_backend"
                text = _transcribe_audio_with_light_backend(audio_data)
        else:
            if ffmpeg_executable:
                audio_data = _load_audio_with_ffmpeg(tmp_path, ffmpeg_executable)
            else:
                if ext != ".wav":
                    raise RuntimeError(
                        "Для этого формата нужен ffmpeg. Установите ffmpeg в систему или imageio-ffmpeg."
                    )
                wav_audio = _load_wav_for_whisper(tmp_path)
                audio_data = wav_audio
            diag["step"] = "init_backend"
            text = _transcribe_audio_with_light_backend(audio_data)

        # ── STEP 5: write transcript ─────────────────────────────
        diag["step"] = "write_transcript"
        with open(_transcript_path(filename), "w", encoding="utf-8") as f:
            f.write(text)

        with _jobs_lock:
            _jobs[filename] = {"status": "done", "text": text}

    except Exception as e:
        tb = traceback.format_exc()
        # Full diagnostic goes to server log only — never exposed to the UI
        print(
            f"[TRANSCRIPTION ERROR] file={filename}"
            f" step={diag.get('step', '?')}"
            f" audio_path={diag.get('audio_path', '?')}"
            f" tmp={diag.get('tmp_path', 'не создан')}"
            f" audio_readable={diag.get('audio_readable', '?')}"
            f"\n{tb}",
            flush=True,
        )
        # Clean Russian message for the UI
        step = diag.get("step", "")
        if step in ("", "load_model", "init_backend"):
            user_msg = "Не удалось загрузить модель распознавания. Перезапустите сервер."
        elif step == "copy2":
            user_msg = "Нет доступа к аудиофайлу. Попробуйте ещё раз через несколько секунд."
        elif step in ("transcribe", "transcribe_yandex"):
            if isinstance(e, RuntimeError):
                user_msg = str(e)
            else:
                user_msg = "Ошибка при распознавании речи. Попробуйте ещё раз."
        else:
            user_msg = "Ошибка расшифровки. Попробуйте ещё раз."
        with _jobs_lock:
            _jobs[filename] = {"status": "error", "error": user_msg}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


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
        if os.path.isfile(fpath) and not fname.endswith(TRANSCRIPT_SUFFIX) and not fname.endswith(OVERVIEW_SUFFIX) and not fname.endswith(ACTIONS_SUFFIX) and not fname.endswith(EXPERT_SUFFIX) and not fname.endswith(DOCUMENT_SUFFIX):
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


@app.delete("/api/recordings/{filename}")
def delete_recording(filename: str):
    filename = os.path.basename(filename)
    if not filename:
        raise HTTPException(status_code=400, detail="Имя файла не указано")

    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    with _jobs_lock:
        if _jobs.get(filename, {}).get("status") == "running":
            raise HTTPException(status_code=409, detail="Нельзя удалить файл во время расшифровки")
    with _overview_jobs_lock:
        if _overview_jobs.get(filename, {}).get("status") == "running":
            raise HTTPException(status_code=409, detail="Нельзя удалить файл во время построения обзора")
    with _actions_jobs_lock:
        if _actions_jobs.get(filename, {}).get("status") == "running":
            raise HTTPException(status_code=409, detail="Нельзя удалить файл во время построения действий")
    with _expert_jobs_lock:
        if _expert_jobs.get(filename, {}).get("status") == "running":
            raise HTTPException(status_code=409, detail="Нельзя удалить файл во время экспертного анализа")

    for path in (
        audio_path,
        _transcript_path(filename),
        _overview_path(filename),
        _actions_path(filename),
        _expert_path(filename),
        _document_path(filename),
    ):
        try:
            if os.path.exists(path):
                os.remove(path)
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Не удалось удалить файл: {e}") from e

    with _jobs_lock:
        _jobs.pop(filename, None)
    with _overview_jobs_lock:
        _overview_jobs.pop(filename, None)
    with _actions_jobs_lock:
        _actions_jobs.pop(filename, None)
    with _expert_jobs_lock:
        _expert_jobs.pop(filename, None)

    return {"status": "deleted", "filename": filename}


# ── TRANSCRIPTION ENDPOINTS ──────────────────────────────────

@app.post("/api/transcribe/{filename}")
def start_transcription(filename: str):
    filename = os.path.basename(filename)
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    # Ensure a fresh run and avoid showing stale results from previous attempts.
    _clear_derived_outputs(filename)
    with _overview_jobs_lock:
        _overview_jobs.pop(filename, None)
    with _actions_jobs_lock:
        _actions_jobs.pop(filename, None)
    with _expert_jobs_lock:
        _expert_jobs.pop(filename, None)
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
def start_expert(filename: str, analysis_mode: str | None = None):
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

    _executor.submit(_run_expert, filename, analysis_mode)
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
        try:
            with open(epath, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {"status": "done", "report": data}
        except Exception:
            return {"status": "error", "error": "Не удалось прочитать сохранённый отчёт. Попробуйте запустить анализ заново."}

    return {"status": "idle"}


@app.post("/api/document/{filename}")
def build_document(filename: str):
    filename = os.path.basename(filename)
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    tpath = _transcript_path(filename)
    if not os.path.isfile(tpath):
        return {"status": "no_transcript"}

    try:
        payload = _build_scene_document_payload(filename)
        with open(_document_path(filename), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        return {"status": "done", "document": payload}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.get("/api/document/{filename}")
def get_document(filename: str):
    filename = os.path.basename(filename)
    audio_path = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(audio_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    tpath = _transcript_path(filename)
    if not os.path.isfile(tpath):
        return {"status": "no_transcript"}

    dpath = _document_path(filename)
    if not os.path.isfile(dpath):
        return {"status": "idle"}

    try:
        with open(dpath, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return {"status": "done", "document": payload}
    except Exception:
        return {
            "status": "error",
            "error": "Не удалось прочитать сохранённый черновик документа. Сформируйте заново.",
        }


# Static files must be mounted last
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")

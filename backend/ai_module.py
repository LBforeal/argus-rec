"""Expert analysis module: LM Studio local server + knowledge files."""

import json
import os
import re

KNOWLEDGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "knowledge")

KNOWLEDGE_FILES = [
    "osmotr_uchastniki.txt.txt",
    "osmotr_deistviya_na_meste.txt.txt",
    "osmotr_gotovnost_k_vyezdu.txt.txt",
]

DISPLAY_NAMES = {
    "osmotr_uchastniki.txt.txt": "osmotr_uchastniki.txt",
    "osmotr_deistviya_na_meste.txt.txt": "osmotr_deistviya_na_meste.txt",
    "osmotr_gotovnost_k_vyezdu.txt.txt": "osmotr_gotovnost_k_vyezdu.txt",
}


MAX_TRANSCRIPT_CHARS = 1500
MAX_KNOWLEDGE_CHARS = 800


def _truncate(text: str, limit: int) -> str:
    """Truncate text to limit characters, cutting at last space if possible."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    last_space = cut.rfind(' ')
    if last_space > limit // 2:
        cut = cut[:last_space]
    return cut + "..."


def _load_knowledge() -> dict:
    """Read all knowledge files from disk, truncated to MAX_KNOWLEDGE_CHARS."""
    result = {}
    for fname in KNOWLEDGE_FILES:
        fpath = os.path.join(KNOWLEDGE_DIR, fname)
        with open(fpath, "r", encoding="utf-8") as f:
            text = f.read().strip()
        result[fname] = _truncate(text, MAX_KNOWLEDGE_CHARS)
    return result


def _build_prompt(transcript: str, knowledge: dict) -> str:
    transcript = _truncate(transcript, MAX_TRANSCRIPT_CHARS)
    k1 = knowledge.get("osmotr_uchastniki.txt.txt", "")
    k2 = knowledge.get("osmotr_deistviya_na_meste.txt.txt", "")
    k3 = knowledge.get("osmotr_gotovnost_k_vyezdu.txt.txt", "")

    return f"""ТРАНСКРИПТ:
{transcript}

БАЗА ЗНАНИЙ:
[osmotr_uchastniki.txt]
{k1}

[osmotr_deistviya_na_meste.txt]
{k2}

[osmotr_gotovnost_k_vyezdu.txt]
{k3}

ЗАДАЧА: сравни транскрипт с базой знаний. Для каждой секции выведи максимум 1 item. Item: {{"text":"...","quote":"...","source_file":"...","source_excerpt":"..."}}. Если нет находок — пустой items. Верни ТОЛЬКО JSON, без пояснений:
{{"sections":[{{"title":"Участники","items":[]}},{{"title":"Действия на месте","items":[]}},{{"title":"Готовность к выезду","items":[]}},{{"title":"Неопределённости","items":[]}}]}}"""


LM_STUDIO_BASE_URL = os.environ.get("LM_STUDIO_BASE_URL", "http://127.0.0.1:1234/v1")
LM_STUDIO_MODEL = os.environ.get("LM_STUDIO_MODEL", "qwen2.5-3b-instruct")
LM_STUDIO_API_KEY = os.environ.get("LM_STUDIO_API_KEY", "lm-studio")


def _extract_json(text: str) -> dict:
    """Extract JSON object from LLM response text. Handles markdown fences and surrounding text."""
    # Try direct parse first
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code fence
    m = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```', text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding first { ... last }
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError("LM Studio вернул ответ, но не удалось извлечь JSON из текста")


def run_expert_analysis(transcript: str) -> dict:
    """Run expert analysis via LM Studio local server. Returns dict with 'sections' key. Raises on error."""
    import urllib.request
    import urllib.error

    knowledge = _load_knowledge()
    prompt = _build_prompt(transcript, knowledge)

    url = LM_STUDIO_BASE_URL.rstrip("/") + "/chat/completions"
    payload = json.dumps({
        "model": LM_STUDIO_MODEL,
        "messages": [
            {"role": "system", "content": "Ты эксперт-аналитик. Отвечай только JSON, без пояснений."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
        "max_tokens": 400,
        "stream": False,
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        raise RuntimeError(
            f"Не удалось подключиться к LM Studio ({url}). "
            f"Убедитесь, что сервер запущен. Ошибка: {e.reason}"
        ) from e
    except TimeoutError:
        raise RuntimeError(
            "LM Studio не ответил за 120 секунд. Модель может быть перегружена."
        )
    except Exception as e:
        raise RuntimeError(f"Ошибка запроса к LM Studio: {str(e)[:300]}") from e

    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise ValueError(
            f"LM Studio вернул неожиданный формат ответа. "
            f"Ответ: {json.dumps(body, ensure_ascii=False)[:300]}"
        )

    if not content or not content.strip():
        raise ValueError("LM Studio вернул пустой ответ. Модель не сгенерировала текст.")

    raw_preview = content.strip()[:300]

    try:
        result = _extract_json(content)
    except (ValueError, json.JSONDecodeError):
        raise ValueError(
            f"LM Studio вернул ответ, но он не является валидным JSON. "
            f"Ответ модели: {raw_preview}"
        )

    if "sections" not in result:
        raise ValueError(
            f"LM Studio вернул JSON без ключа 'sections'. "
            f"Ответ модели: {raw_preview}"
        )

    return result

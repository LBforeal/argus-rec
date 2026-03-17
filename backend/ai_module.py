"""Expert analysis module: rule-based demo expert engine. No external API."""

import re
from difflib import SequenceMatcher
from collections import defaultdict

# ── SEMANTIC GROUPS ──────────────────────────────────────────────────────────
# Flat dict of all groups across all scenarios.
# Each group: {label, variants[]}.

SEMANTIC_GROUPS = {

    # ── Сценарий 1: Осмотр места происшествия ───────────────────────────────
    "on_site_presence": {
        "label": "группа на месте",
        "variants": [
            "группа на месте", "все на месте", "уже на месте", "на месте уже",
            "прибыли на место", "все уже на месте", "мы на месте",
            "уже приехали", "подъехали", "прибыли на точку", "группа прибыла",
        ],
    },
    "readiness": {
        "label": "готовность к выезду",
        "variants": [
            "готовность к выезду", "к выезду готовы", "выезд подтвержден",
            "выезд подтверждён", "готовность подтверждена", "готовы к выезду",
            "можно работать", "можно приступать", "все готовы", "готов",
        ],
    },
    "inspection_start": {
        "label": "начинаем осмотр",
        "variants": [
            "начинаем осмотр", "приступаем к осмотру", "можно начинать осмотр",
            "начинаем осмотр места", "начнем осмотр", "начнём осмотр",
            "можно начинать", "приступаем", "начнем работать", "начнём работать",
            "давай осматривать место", "начали осмотр",
        ],
    },
    "participants": {
        "label": "участники осмотра",
        "variants": [
            "участники осмотра", "проверь участников", "проверить участников",
            "кто участвует", "состав участников", "уточни участников",
            "всех участников проверь", "кто здесь", "кто присутствует",
            "перечисли участников",
        ],
    },
    "photo_fixation": {
        "label": "фотофиксация",
        "variants": [
            "фотофиксация", "фотофиксацию", "сделать фотофиксацию",
            "сделай фотофиксацию", "нужна фотофиксация", "провести фотофиксацию",
            "фото обязательно", "сфотографируй", "снимай", "делай фото",
            "фотографируем", "сделай снимки места",
        ],
    },
    "traces": {
        "label": "следы",
        "variants": [
            "зафиксировать следы", "следы зафиксировать", "фиксация следов",
            "обнаруженные следы", "следы на месте", "следы отметь",
            "следы запиши", "вижу следы", "есть следы", "следы",
            "следы отдельно отметь",
        ],
    },
    "protocol": {
        "label": "протокол осмотра",
        "variants": [
            "оформить протокол", "внести в протокол", "занести в протокол",
            "все занести в протокол", "оформить в протоколе", "протокол осмотра",
            "все занеси в протокол", "вноси в протокол", "запиши в протокол",
            "занеси в протокол", "внесем в протокол", "внесём в протокол",
            "занеси это в протокол",
        ],
    },
    "scene_context": {
        "label": "место происшествия",
        "variants": [
            "место происшествия", "осмотр места", "обстановка на месте",
            "на месте происшествия", "осматриваем место",
        ],
    },

    # ── Сценарий 2: Опрос свидетеля ─────────────────────────────────────────
    "witness": {
        "label": "свидетель",
        "variants": [
            "свидетеля нашли", "нашли свидетеля", "есть свидетель",
            "свидетель найден", "опрашиваем свидетеля",
        ],
    },
    "testimony": {
        "label": "показания",
        "variants": [
            "показания нормально зафиксируй", "показания зафиксируй",
            "зафиксируй показания", "взять показания",
            "фиксируй показания", "записать показания", "показания",
            "запиши со слов свидетеля",
        ],
    },
    "explanation": {
        "label": "объяснение свидетеля",
        "variants": [
            "возьмём объяснение", "возьмем объяснение", "взять объяснение",
            "взять объяснения", "объяснения", "объяснение", "зафиксируй объяснение",
        ],
    },
    "contacts": {
        "label": "контактные данные",
        "variants": [
            "контакты у него уточним", "контакты уточним", "уточним контакты",
            "контактные данные", "контакты уточни", "уточни контакты",
            "уточни его контакты",
        ],
    },
    "witness_protocol": {
        "label": "протокол опроса",
        "variants": [
            "протокол опроса", "оформим протокол опроса",
            "составить протокол опроса", "оформить протокол опроса",
            "оформи протокол опроса",
        ],
    },

    # ── Сценарий 3: Изъятие и упаковка объекта ──────────────────────────────
    "seizure": {
        "label": "изъятие объекта",
        "variants": [
            "сделать изъятие", "аккуратно сделать изъятие",
            "произвести изъятие", "выполнить изъятие", "изъятие объекта",
            "изъятие", "изымаем объект", "изъятие провели",
        ],
    },
    "packaging": {
        "label": "упаковка",
        "variants": [
            "упаковка и маркировка", "упаковать объект", "упаковываем",
            "упаковка объекта", "упаковка", "упакуй в пакет",
        ],
    },
    "marking": {
        "label": "маркировка",
        "variants": [
            "маркировка", "маркировать", "промаркировать", "промаркируй пакет",
        ],
    },
    "sealing": {
        "label": "опечатывание",
        "variants": [
            "пакет опечатаем", "опечатать пакет", "опечатаем", "опечатать",
            "пакет опечатан",
        ],
    },
    "find_location": {
        "label": "место обнаружения",
        "variants": [
            "место обнаружения зафиксирую", "зафиксировать место обнаружения",
            "место обнаружения", "фиксирую место обнаружения",
        ],
    },

    # ── Сценарий 4: Проверка видеонаблюдения ────────────────────────────────
    "camera_records": {
        "label": "записи с камеры",
        "variants": [
            "записи с камеры", "подними записи", "видеозаписи с камеры",
            "подними видеозаписи", "записи камеры", "подними видео с камеры",
        ],
    },
    "time_interval": {
        "label": "временной интервал",
        "variants": [
            "нужен интервал", "временной интервал", "интервал записи",
            "промежуток времени", "с восьми двадцати", "нужен фрагмент за период",
        ],
    },
    "video_fragment": {
        "label": "нужный фрагмент",
        "variants": [
            "нужный фрагмент сохраню", "нужный фрагмент", "фрагмент сохраню",
            "сохраню фрагмент", "вырезать фрагмент", "сохрани фрагмент",
        ],
    },
    "event_time": {
        "label": "время события",
        "variants": [
            "время события отмечу", "время события", "отмечу время",
            "зафиксировать время события", "отметь время на записи",
        ],
    },
    "video_export": {
        "label": "выгрузка материалов",
        "variants": [
            "выгрузку к материалам приложу", "выгрузку приложу",
            "выгрузку к материалам", "приложить к материалам", "приложи выгрузку",
        ],
    },

    # ── Сценарий 5: Оцепление и ограничение доступа ─────────────────────────
    "no_entry": {
        "label": "запрет прохода",
        "variants": [
            "никого не пускаем", "сюда никого не пускаем",
            "не пропускать", "никого не пускать", "посторонних не пускать",
        ],
    },
    "access_restriction": {
        "label": "ограничение доступа",
        "variants": [
            "доступ сразу ограничь", "ограничь доступ", "ограничение доступа",
            "закрыть доступ", "перекрыть доступ", "доступ перекрыт",
        ],
    },
    "cordon": {
        "label": "оцепление",
        "variants": [
            "начинаем оцепление", "оцепление", "провести оцепление",
            "установить оцепление", "выставить оцепление",
        ],
    },
    "perimeter": {
        "label": "периметр",
        "variants": [
            "внутри периметра", "границы периметра", "периметр",
            "границы отмечаю", "отмечаю границы", "держим периметр",
        ],
    },
    "entry_control": {
        "label": "контроль входов",
        "variants": [
            "входы проверяю", "проверяю входы", "контроль входов",
            "проверить входы", "контролируй входы",
        ],
    },
}


# ── SCENARIO DEFINITIONS ─────────────────────────────────────────────────────
# Each entry: name, title, subtitle, conclusion, action_items,
#             groups (set of group_ids), key_groups (high-weight subset).

SCENARIO_MAP = [
    {
        "name": "Осмотр места происшествия",
        "title": "Осмотр места происшествия: первичные действия и фиксация",
        "subtitle": "Структурированный разбор записи по найденным доменным признакам",
        "conclusion": (
            "Запись содержит признаки обсуждения готовности к осмотру "
            "и выполнения первичных действий по фиксации обстановки и следов."
        ),
        "action_items": [
            "проверить состав участников осмотра",
            "выполнить фотофиксацию",
            "зафиксировать обнаруженные следы",
            "оформить результаты в протоколе",
        ],
        "groups": {
            "on_site_presence", "readiness", "inspection_start", "participants",
            "photo_fixation", "traces", "protocol", "scene_context",
        },
        "key_groups": {"readiness", "inspection_start", "photo_fixation", "traces", "protocol"},
    },
    {
        "name": "Опрос свидетеля",
        "title": "Опрос свидетеля: фиксация показаний",
        "subtitle": "Структурированный разбор записи по признакам сценария опроса",
        "conclusion": (
            "Запись содержит признаки проведения опроса свидетеля "
            "с фиксацией показаний и контактных данных."
        ),
        "action_items": [
            "уточнить контактные данные свидетеля",
            "зафиксировать показания по времени и месту",
            "оформить протокол опроса",
        ],
        "groups": {"witness", "testimony", "explanation", "contacts", "witness_protocol"},
        "key_groups": {"testimony", "witness_protocol"},
    },
    {
        "name": "Изъятие и упаковка объекта",
        "title": "Изъятие и упаковка объекта: процедура фиксации",
        "subtitle": "Структурированный разбор записи по признакам сценария изъятия",
        "conclusion": (
            "Запись содержит признаки проведения изъятия объекта "
            "с упаковкой, маркировкой и внесением в протокол."
        ),
        "action_items": [
            "зафиксировать место обнаружения объекта",
            "выполнить изъятие аккуратно",
            "упаковать и маркировать объект",
            "опечатать пакет",
            "внести изъятое в протокол",
        ],
        "groups": {"seizure", "packaging", "marking", "sealing", "find_location"},
        "key_groups": {"seizure", "packaging"},
    },
    {
        "name": "Проверка видеонаблюдения",
        "title": "Проверка видеонаблюдения: анализ записей",
        "subtitle": "Структурированный разбор записи по признакам работы с видеоматериалами",
        "conclusion": (
            "Запись содержит признаки работы с видеозаписями: "
            "запрос нужного фрагмента, фиксация времени события и подготовка выгрузки."
        ),
        "action_items": [
            "поднять записи с камеры за нужный временной интервал",
            "найти и сохранить нужный фрагмент",
            "отметить время события",
            "приложить выгрузку к материалам дела",
        ],
        "groups": {
            "camera_records", "time_interval", "video_fragment", "event_time", "video_export",
        },
        "key_groups": {"camera_records", "video_fragment"},
    },
    {
        "name": "Оцепление и ограничение доступа",
        "title": "Оцепление и ограничение доступа: охрана периметра",
        "subtitle": "Структурированный разбор записи по признакам организации оцепления",
        "conclusion": (
            "Запись содержит признаки организации оцепления, "
            "ограничения доступа и контроля периметра."
        ),
        "action_items": [
            "ограничить доступ на место",
            "начать оцепление периметра",
            "отметить границы периметра",
            "проверить все входы",
            "учесть, кто остался внутри периметра",
        ],
        "groups": {"no_entry", "access_restriction", "cordon", "perimeter", "entry_control"},
        "key_groups": {"cordon", "perimeter"},
    },
]


# ── NORMALIZATION ─────────────────────────────────────────────────────────────

DEFAULT_ANALYSIS_MODE = "Следователь СК"

ANALYSIS_MODE_PROFILES = {
    "Сотрудник МВД": {
        "subtitle": "Подача ориентирована на служебную фиксацию обстановки и первичные меры.",
        "conclusion": "Профиль МВД: приоритет — фактическая фиксация и оперативная ясность.",
        "action_lead": "Приоритет МВД",
    },
    "Следователь СК": {
        "subtitle": "Подача ориентирована на процессуальную последовательность и доказательственные признаки.",
        "conclusion": "Профиль СК: приоритет — процессуальная полнота и непротиворечивость фиксации.",
        "action_lead": "Приоритет СК",
    },
    "Судья / помощник": {
        "subtitle": "Подача ориентирована на нейтральную структуру фактов и проверяемость формулировок.",
        "conclusion": "Профиль суда: приоритет — структурированность и однозначная интерпретация фактов.",
        "action_lead": "Приоритет суда",
    },
    "Адвокат / юрист": {
        "subtitle": "Подача ориентирована на юридическую точность формулировок и зоны уточнения.",
        "conclusion": "Профиль юриста: приоритет — выявление неоднозначностей и точек для уточняющих вопросов.",
        "action_lead": "Приоритет юриста",
    },
    "Служба безопасности": {
        "subtitle": "Подача ориентирована на риски доступа, контроль периметра и протокол реагирования.",
        "conclusion": "Профиль безопасности: приоритет — снижение рисков и контроль уязвимых зон.",
        "action_lead": "Приоритет безопасности",
    },
    "Прокуратура": {
        "subtitle": "Подача ориентирована на полноту проверки и процессуальный контроль достаточности данных.",
        "conclusion": "Профиль прокуратуры: приоритет — оценка достаточности и корректности процессуальных шагов.",
        "action_lead": "Приоритет прокуратуры",
    },
    "Налоговый орган": {
        "subtitle": "Подача ориентирована на документируемые факты, сроки и подтверждающие следы.",
        "conclusion": "Профиль налогового органа: приоритет — проверяемость данных и связность по времени.",
        "action_lead": "Приоритет налогового органа",
    },
    "МФЦ / приёмная": {
        "subtitle": "Подача ориентирована на понятность для заявителя и корректную маршрутизацию действий.",
        "conclusion": "Профиль МФЦ: приоритет — ясная коммуникация и корректное оформление дальнейших шагов.",
        "action_lead": "Приоритет МФЦ",
    },
}


def _normalize_analysis_mode(analysis_mode: str | None) -> str:
    if not analysis_mode:
        return DEFAULT_ANALYSIS_MODE
    value = analysis_mode.strip()
    if value in ANALYSIS_MODE_PROFILES:
        return value
    return DEFAULT_ANALYSIS_MODE


def _apply_analysis_mode_profile(report: dict, analysis_mode: str | None) -> dict:
    mode = _normalize_analysis_mode(analysis_mode)
    profile = ANALYSIS_MODE_PROFILES[mode]

    result = dict(report)
    result["analysis_mode"] = mode

    subtitle = (result.get("subtitle") or "").strip()
    result["subtitle"] = f"{subtitle} {profile['subtitle']}".strip()

    conclusion = (result.get("conclusion") or "").strip()
    if conclusion:
        result["conclusion"] = f"{profile['conclusion']} {conclusion}"
    else:
        result["conclusion"] = profile["conclusion"]

    actions = result.get("action_items") or []
    if actions:
        result["action_items"] = [f"{profile['action_lead']}: {actions[0]}"] + actions[1:]
    else:
        result["action_items"] = [f"{profile['action_lead']}: уточнить следующий шаг по профилю."]

    note = (result.get("note") or "").strip()
    if note:
        result["note"] = f"{note} Профиль анализа: {mode}."
    else:
        result["note"] = f"Профиль анализа: {mode}."

    return result


def _normalize(text: str) -> str:
    text = text.lower()
    text = text.replace("ё", "е")
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ── MATCHING ─────────────────────────────────────────────────────────────────

def _tokenize_words(text: str) -> list:
    return re.findall(r"[a-zA-Zа-яА-ЯёЁ0-9]+", text.lower())


def _similar_words(a: str, b: str) -> bool:
    if a == b:
        return True
    if abs(len(a) - len(b)) > 2:
        return False
    return SequenceMatcher(None, a, b).ratio() >= 0.80


def _contains_variant(normalized: str, variant: str) -> bool:
    # Exact fast path
    if variant in normalized:
        return True

    # Fuzzy path for minor STT typos (example: "слебы" ~ "следы")
    variant_words = _tokenize_words(variant)
    text_words = _tokenize_words(normalized)
    if not variant_words or not text_words:
        return False

    m = len(variant_words)
    n = len(text_words)
    if n < m:
        return False

    for i in range(n - m + 1):
        window = text_words[i:i + m]
        matched = 0
        for vw, tw in zip(variant_words, window):
            if vw == tw:
                matched += 1
                continue
            # Keep fuzzy matching conservative for short words.
            if len(vw) >= 4 and len(tw) >= 4 and _similar_words(vw, tw):
                matched += 1
        if matched == m:
            return True
        if m >= 3 and matched >= m - 1:
            return True

    return False


def _find_groups(normalized: str) -> dict:
    """Return {group_id: (label, matched_variant)} for each group with a match."""
    found = {}
    for group_id, group in SEMANTIC_GROUPS.items():
        for variant in group["variants"]:
            if _contains_variant(normalized, variant):
                found[group_id] = (group["label"], variant)
                break
    return found


def _detect_scenario(found: dict):
    """Return the SCENARIO_MAP entry with the best match, or None."""
    best = None
    best_score = -1
    for sc in SCENARIO_MAP:
        matched = found.keys() & sc["groups"]
        n = len(matched)
        has_key = bool(matched & sc["key_groups"])
        score = n * 10 + (5 if has_key else 0)
        if score > best_score:
            best_score = score
            best = sc
    # Require at least 2 matched groups within the winning scenario
    return best if best_score >= 20 else None


def _match_level(found: dict, scenario: dict) -> str:
    matched = found.keys() & scenario["groups"]
    n = len(matched)
    has_key = bool(matched & scenario["key_groups"])
    if n >= 3 and has_key:
        return "Высокий"
    elif n >= 2:
        return "Средний"
    return "Низкий"


# ── SPEAKER SEPARATION ────────────────────────────────────────────────────────

def _split_speakers(transcript: str) -> list:
    """Alternate sentences between 2 speakers. Returns [] if < 2 sentences."""
    sentences = [
        s.strip()
        for s in re.split(r"(?<=[.!?…])\s+", transcript)
        if len(s.strip()) >= 5
    ]
    if len(sentences) < 2:
        return []
    return [
        {"speaker": f"Спикер {(i % 2) + 1}", "text": s}
        for i, s in enumerate(sentences)
    ]


def _build_speaker_data(sentences: list) -> tuple:
    """Return (speakers_summary, speaker_signs)."""
    if not sentences:
        return [], []

    combined = defaultdict(list)
    for item in sentences:
        combined[item["speaker"]].append(item["text"])

    speakers_summary = [
        {"speaker": sp, "text": " ".join(texts)}
        for sp, texts in combined.items()
    ]

    speaker_signs = []
    for sp, texts in combined.items():
        norm = _normalize(" ".join(texts))
        labels = [
            group["label"]
            for gid, group in SEMANTIC_GROUPS.items()
            if any(v in norm for v in group["variants"])
        ]
        speaker_signs.append({
            "speaker": sp,
            "signs": labels if labels else ["признаки не найдены"],
        })

    return speakers_summary, speaker_signs


# ── REPORT BUILDERS ───────────────────────────────────────────────────────────

def _confirmed_report(
    found: dict, level: str, scenario: dict,
    speakers_summary: list, speaker_signs: list,
) -> dict:
    relevant = {gid: v for gid, v in found.items() if gid in scenario["groups"]}
    found_signs = [label for label, _ in relevant.values()]
    key_phrases = [variant for _, variant in relevant.values()]
    return {
        "title": scenario["title"],
        "subtitle": scenario["subtitle"],
        "scenario": scenario["name"],
        "match_level": level,
        "found_signs": found_signs,
        "conclusion": scenario["conclusion"],
        "action_items": scenario["action_items"],
        "key_phrases": key_phrases,
        "note": (
            "Отчёт сформирован на основе найденных доменных признаков "
            "в транскрипте и предназначен для быстрого первичного разбора."
        ),
        "speakers_available": bool(speakers_summary),
        "speakers_summary": speakers_summary,
        "speaker_signs": speaker_signs,
    }


def _fallback_report(
    found: dict, level: str,
    speakers_summary: list, speaker_signs: list,
) -> dict:
    found_signs = [label for label, _ in found.values()]
    key_phrases = [variant for _, variant in found.values()]
    return {
        "title": "Недостаточно доменных признаков для экспертного разбора",
        "subtitle": (
            "Запись не содержит достаточного количества признаков "
            "ни одного из доменных сценариев"
        ),
        "scenario": "Экспертный шаблон не применён",
        "match_level": "Низкий",
        "found_signs": found_signs if found_signs else ["доменные признаки не найдены"],
        "conclusion": (
            "Запись относится к нейтральному или бытовому разговору "
            "и не подходит для доменного экспертного разбора."
        ),
        "action_items": ["экспертный шаблон не применён"],
        "key_phrases": key_phrases if key_phrases else ["значимые доменные фразы не обнаружены"],
        "note": (
            "Для demo expert mode требуется запись с ключевыми признаками "
            "одного из доменных сценариев."
        ),
        "speakers_available": bool(speakers_summary),
        "speakers_summary": speakers_summary,
        "speaker_signs": speaker_signs,
    }


# ── PUBLIC API ────────────────────────────────────────────────────────────────

def run_expert_analysis(transcript: str, analysis_mode: str | None = None) -> dict:
    """Rule-based demo expert engine. Fully offline. No fake content."""
    normalized = _normalize(transcript)
    found = _find_groups(normalized)
    scenario = _detect_scenario(found)

    sentences = _split_speakers(transcript)
    speakers_summary, speaker_signs = _build_speaker_data(sentences)

    if scenario is None:
        base_report = _fallback_report(found, "Низкий", speakers_summary, speaker_signs)
        return _apply_analysis_mode_profile(base_report, analysis_mode)

    level = _match_level(found, scenario)
    base_report = _confirmed_report(found, level, scenario, speakers_summary, speaker_signs)
    return _apply_analysis_mode_profile(base_report, analysis_mode)

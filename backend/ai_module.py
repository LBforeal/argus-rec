"""Expert analysis module: rule-based demo expert engine. No external API."""

import re
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
            "уже приехали", "подъехали",
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
            "фотографируем",
        ],
    },
    "traces": {
        "label": "следы",
        "variants": [
            "зафиксировать следы", "следы зафиксировать", "фиксация следов",
            "обнаруженные следы", "следы на месте", "следы отметь",
            "следы запиши", "вижу следы", "есть следы", "следы",
        ],
    },
    "protocol": {
        "label": "протокол осмотра",
        "variants": [
            "оформить протокол", "внести в протокол", "занести в протокол",
            "все занести в протокол", "оформить в протоколе", "протокол осмотра",
            "все занеси в протокол", "вноси в протокол", "запиши в протокол",
            "занеси в протокол", "внесем в протокол", "внесём в протокол",
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
            "свидетель найден",
        ],
    },
    "testimony": {
        "label": "показания",
        "variants": [
            "показания нормально зафиксируй", "показания зафиксируй",
            "зафиксируй показания", "взять показания",
            "фиксируй показания", "записать показания", "показания",
        ],
    },
    "explanation": {
        "label": "объяснение свидетеля",
        "variants": [
            "возьмём объяснение", "возьмем объяснение", "взять объяснение",
            "взять объяснения", "объяснения", "объяснение",
        ],
    },
    "contacts": {
        "label": "контактные данные",
        "variants": [
            "контакты у него уточним", "контакты уточним", "уточним контакты",
            "контактные данные", "контакты уточни", "уточни контакты",
        ],
    },
    "witness_protocol": {
        "label": "протокол опроса",
        "variants": [
            "протокол опроса", "оформим протокол опроса",
            "составить протокол опроса", "оформить протокол опроса",
        ],
    },

    # ── Сценарий 3: Изъятие и упаковка объекта ──────────────────────────────
    "seizure": {
        "label": "изъятие объекта",
        "variants": [
            "сделать изъятие", "аккуратно сделать изъятие",
            "произвести изъятие", "выполнить изъятие", "изъятие объекта",
            "изъятие",
        ],
    },
    "packaging": {
        "label": "упаковка",
        "variants": [
            "упаковка и маркировка", "упаковать объект", "упаковываем",
            "упаковка объекта", "упаковка",
        ],
    },
    "marking": {
        "label": "маркировка",
        "variants": [
            "маркировка", "маркировать", "промаркировать",
        ],
    },
    "sealing": {
        "label": "опечатывание",
        "variants": [
            "пакет опечатаем", "опечатать пакет", "опечатаем", "опечатать",
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
            "подними видеозаписи", "записи камеры",
        ],
    },
    "time_interval": {
        "label": "временной интервал",
        "variants": [
            "нужен интервал", "временной интервал", "интервал записи",
            "промежуток времени", "с восьми двадцати",
        ],
    },
    "video_fragment": {
        "label": "нужный фрагмент",
        "variants": [
            "нужный фрагмент сохраню", "нужный фрагмент", "фрагмент сохраню",
            "сохраню фрагмент", "вырезать фрагмент",
        ],
    },
    "event_time": {
        "label": "время события",
        "variants": [
            "время события отмечу", "время события", "отмечу время",
            "зафиксировать время события",
        ],
    },
    "video_export": {
        "label": "выгрузка материалов",
        "variants": [
            "выгрузку к материалам приложу", "выгрузку приложу",
            "выгрузку к материалам", "приложить к материалам",
        ],
    },

    # ── Сценарий 5: Оцепление и ограничение доступа ─────────────────────────
    "no_entry": {
        "label": "запрет прохода",
        "variants": [
            "никого не пускаем", "сюда никого не пускаем",
            "не пропускать", "никого не пускать",
        ],
    },
    "access_restriction": {
        "label": "ограничение доступа",
        "variants": [
            "доступ сразу ограничь", "ограничь доступ", "ограничение доступа",
            "закрыть доступ", "перекрыть доступ",
        ],
    },
    "cordon": {
        "label": "оцепление",
        "variants": [
            "начинаем оцепление", "оцепление", "провести оцепление",
            "установить оцепление",
        ],
    },
    "perimeter": {
        "label": "периметр",
        "variants": [
            "внутри периметра", "границы периметра", "периметр",
            "границы отмечаю", "отмечаю границы",
        ],
    },
    "entry_control": {
        "label": "контроль входов",
        "variants": [
            "входы проверяю", "проверяю входы", "контроль входов",
            "проверить входы",
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

def _normalize(text: str) -> str:
    text = text.lower()
    text = text.replace("ё", "е")
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ── MATCHING ─────────────────────────────────────────────────────────────────

def _find_groups(normalized: str) -> dict:
    """Return {group_id: (label, matched_variant)} for each group with a match."""
    found = {}
    for group_id, group in SEMANTIC_GROUPS.items():
        for variant in group["variants"]:
            if variant in normalized:
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
    return {
        "title": "Недостаточно доменных признаков для экспертного разбора",
        "subtitle": (
            "Запись не содержит достаточного количества признаков "
            "ни одного из доменных сценариев"
        ),
        "scenario": "Экспертный шаблон не применён",
        "match_level": "Низкий",
        "found_signs": ["доменные признаки не найдены"],
        "conclusion": (
            "Запись относится к нейтральному или бытовому разговору "
            "и не подходит для доменного экспертного разбора."
        ),
        "action_items": ["экспертный шаблон не применён"],
        "key_phrases": ["значимые доменные фразы не обнаружены"],
        "note": (
            "Для demo expert mode требуется запись с ключевыми признаками "
            "одного из доменных сценариев."
        ),
        "speakers_available": bool(speakers_summary),
        "speakers_summary": speakers_summary,
        "speaker_signs": speaker_signs,
    }


# ── PUBLIC API ────────────────────────────────────────────────────────────────

def run_expert_analysis(transcript: str) -> dict:
    """Rule-based demo expert engine. Fully offline. No fake content."""
    normalized = _normalize(transcript)
    found = _find_groups(normalized)
    scenario = _detect_scenario(found)

    sentences = _split_speakers(transcript)
    speakers_summary, speaker_signs = _build_speaker_data(sentences)

    if scenario is None:
        return _fallback_report(found, "Низкий", speakers_summary, speaker_signs)

    level = _match_level(found, scenario)
    return _confirmed_report(found, level, scenario, speakers_summary, speaker_signs)

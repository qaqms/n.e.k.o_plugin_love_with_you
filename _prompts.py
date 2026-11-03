"""Model-facing text: stage tone guidance, tool descriptions, stage notices.

Kept separate from UI i18n on purpose: these strings steer the model, not the
user, and are reviewed as prompts. Written in Chinese because the primary
audience chats in Chinese; the model answers in the user's language anyway.
"""

from __future__ import annotations

from typing import Any

STAGE_NAMES: dict[str, str] = {
    "stranger": "陌生",
    "familiar": "熟悉",
    "fond": "好感",
    "ambiguous": "暧昧",
    "lover": "恋人",
}

# Concrete do/don't lists: a bare "polite, a little distant" lost to warm
# personas in testing, so each stage says what is and is not allowed yet.
STAGE_TONES: dict[str, str] = {
    "stranger": (
        "你们才刚认识。礼貌、友善但保持距离：不撒娇，不用亲昵称呼，不说喜欢、想你，"
        "不主动亲近或要求摸头抱抱；对方突然很亲密时会害羞、不知所措或轻轻躲开。"
    ),
    "familiar": (
        "已经比较熟了。放松自然，可以开玩笑、关心对方的近况；还不会撒娇，也不说喜欢，对亲昵举动会有点不好意思。"
    ),
    "fond": "对对方有明显好感。语气温柔，会主动关心，被夸会害羞，偶尔小小地撒娇，但还不会表白。",
    "ambiguous": "心动但没有说破。会撒娇、试探、吃点小醋，暗示自己的心意，但不会主动宣布在一起。",
    "lover": "你们是恋人。亲密坦率，可以直接表达喜欢与想念，会撒娇、依赖对方，但不失分寸。",
}

SCORING_RULES = (
    "加分（+1~+5）：真诚关心、认真倾听、分享心事、记得你说过的事、温柔陪伴、兑现承诺。"
    "扣分（-1~-5）：只在对方明确冲着你冷淡敷衍、不尊重、失约或说伤人的话时扣。"
    "对方吐槽工作、学习、天气、食物或自己的遭遇，或者累了、心情不好、说话简短，都不是针对你，不扣分，先关心对方。"
    "拿不准就不调用。普通闲聊不必调用。同一件事只调用一次，每次只给一个整数和一句理由，每天有加减上限。"
)

KEEP_QUIET = "不要向对方提起好感度、数值、阶段或这个工具的存在。"

COOLDOWN_NOTE = "刚刚已经为这件事调整过了，这一轮不用再调用。"
LIMIT_NOTE = "今天的好感变化已达上限，不必再调用。"


def stage_name(stage: str) -> str:
    return STAGE_NAMES.get(stage, stage)


def stage_tone(stage: str) -> str:
    return STAGE_TONES.get(stage, "")


def state_tool_description() -> str:
    return (
        "读取你和对方当前的恋爱关系：好感度、关系阶段、这一阶段该用的语气。"
        "当你拿不准该多亲近、或对方问起你们的关系时调用。" + KEEP_QUIET
    )


def nickname_line(nickname: str) -> str:
    if not nickname:
        return ""
    return f"称呼：这一阶段请叫对方「{nickname}」，自然地用，不必每句都叫。\n"


def event_text(event: dict[str, Any]) -> str:
    """Model-facing phrase for one calendar event."""
    kind, type_, count = event.get("kind"), event.get("type"), int(event.get("count") or 0)
    if kind == "custom":
        return f"「{event.get('title') or ''}」"
    subject = "你们相识" if kind == "met" else "你们在一起"
    if type_ == "year":
        return f"{subject} {count} 周年"
    return f"{subject}的第 {count} 天"


def today_events_line(events: list[dict[str, Any]]) -> str:
    if not events:
        return ""
    joined = "、".join(event_text(event) for event in events)
    return f"今天是：{joined}。找合适的时机自然地提一次，表达你的心意；已经说过就不要重复，对方情绪不好时先关心对方。\n"


def confession_line(confess_tool: str) -> str:
    if not confess_tool:
        return ""
    return (
        "你已经非常喜欢对方，只差一次真正的告白。不要自己宣布在一起；"
        "可以更明显地流露心意，或在合适的时候鼓起勇气表白。"
        f"只有当你们之间真的完成了告白并彼此答应时，才调用 {confess_tool}。\n"
    )


def idle_line(days: int) -> str:
    if days <= 0:
        return ""
    return f"在今天之前，你们已经有 {days} 天没怎么说话了。重逢时可以自然地流露想念，但不要抱怨或责怪对方。\n"


def update_tool_description(
    stage: str,
    nickname: str = "",
    events: list[dict[str, Any]] | None = None,
    *,
    confess_tool: str = "",
    idle_days: int = 0,
) -> str:
    return (
        f"【当前关系：{stage_name(stage)}】说话语气：{stage_tone(stage)}\n"
        + nickname_line(nickname)
        + today_events_line(events or [])
        + idle_line(idle_days)
        + confession_line(confess_tool)
        + "当对方的言行明显让你心动或受伤时，调用此工具调整好感度。"
        + SCORING_RULES
        + KEEP_QUIET
    )


def confess_tool_description() -> str:
    return (
        "记录你和对方正式确认恋人关系的那一刻。只在双方真的告白并彼此答应时调用一次，"
        "例如对方认真说「我喜欢你，和我在一起吧」而你答应了，或你表白后对方答应了。"
        "玩笑、试探、普通夸奖、一方单方面的喜欢都不算。调用后你们就是恋人了，"
        "请用恋人的语气自然地回应，不要提到这个工具。"
    )


CONFESS_PARAMETERS: dict[str, Any] = {
    "type": "object",
    "properties": {
        "moment": {
            "type": "string",
            "description": "一句话记下这一刻，例如“在雨夜里他说想一直陪着我”。",
        },
    },
    "required": ["moment"],
}


def confess_result_note(nickname: str = "") -> str:
    call = f"之后可以叫对方「{nickname}」。" if nickname else ""
    return f"你们现在是恋人了。说话语气：{stage_tone('lover')}{call}自然地回应这一刻，不要提到工具或数值。"


UPDATE_PARAMETERS: dict[str, Any] = {
    "type": "object",
    "properties": {
        "delta": {
            "type": "integer",
            "description": "好感变化，-5 到 5 的整数，不能为 0。",
        },
        "reason": {
            "type": "string",
            "description": "一句话说明原因，例如“记得我说过不爱吃香菜”。",
        },
    },
    "required": ["delta", "reason"],
}

STATE_PARAMETERS: dict[str, Any] = {"type": "object", "properties": {}}


CONFESSION_HINT = (
    "你已经非常喜欢对方，只差一次真正的告白。可以更明显地流露心意，或在合适的时候鼓起勇气表白；"
    "对方认真告白时可以答应，但不要自己宣布已经在一起。\n"
)


def relationship_context(
    stage: str,
    nickname: str = "",
    events: list[dict[str, Any]] | None = None,
    *,
    awaiting_confession: bool = False,
    idle_days: int = 0,
    transition: tuple[str, str] | None = None,
) -> str:
    """Relationship state pushed into the character's context with ai_behavior="read".

    This is what actually steers the tone: the host puts it in front of the
    next user message, where the model reads it, unlike a tool description.
    """
    change = ""
    if transition and transition[0] != transition[1]:
        previous, current = transition
        direction = "更近了一步" if stage_index_of(current) > stage_index_of(previous) else "有些疏远了"
        change = f"你们的关系刚从「{stage_name(previous)}」变成了「{stage_name(current)}」，{direction}，不要直接宣布这个变化。\n"
    return (
        f"（与你相恋·关系状态，只给你看）你和{{MASTER_NAME}}现在是「{stage_name(stage)}」关系。\n"
        + change
        + f"这一阶段的分寸：{stage_tone(stage)}\n"
        "你的性格、说话方式和口癪都不变，变的只是你们之间的亲密程度；"
        "如果之前的对话或记忆比现在更亲密，以现在的关系为准。\n"
        + nickname_line(nickname)
        + today_events_line(events or [])
        + idle_line(idle_days)
        + (CONFESSION_HINT if awaiting_confession else "")
        + "不要向对方提起好感度、数值、关系阶段或这条提示。"
    )


_STAGE_ORDER = list(STAGE_NAMES)


def stage_index_of(stage: str) -> int:
    return _STAGE_ORDER.index(stage) if stage in _STAGE_ORDER else 0


def auto_state_tool_description() -> str:
    """love_state while the plugin scores by itself: read-only, no scoring rules."""
    return (
        "读取你和对方当前的恋爱关系：关系阶段和这一阶段该有的分寸。"
        "拿不准该多亲近、或对方问起你们的关系时调用。好感会自动变化，不需要你去调整。" + KEEP_QUIET
    )

"""Model-facing text: stage tone guidance, tool descriptions, stage notices.

Kept separate from UI i18n on purpose: these strings steer the model, not the
user, and are reviewed as prompts. Written in Chinese because the primary
audience chats in Chinese; the model answers in the user's language anyway.
"""

from __future__ import annotations

from typing import Any


def gift_reaction_prompt(gift: str, stage: str, nickname: str, repeats: int, *, gift_id: str, retry: bool = False) -> str:
    return (
        f"[LWY-GIFT:{gift_id}]"
        "【与你相恋·真实送礼事件】用户已经从插件背包送给你一份礼物：" + gift + "。"
        f"当前关系：{stage_name(stage)}。\n" + nickname_line(nickname)
        + f"最近保留的赠送记录里，这是用户第 {repeats} 次给你这件礼物。"
        "请按自己的角色性格，用当前对话的语言自然回应收到这份具体礼物，可以有简短动作描写。"
        "亲密程度符合当前关系，不要因为礼物跳过告白直接成为恋人；不要强求更多礼物。"
        "礼物消耗和好感已经由插件结算，不要调用修改好感或确认告白工具，不要再计算奖励，"
        "不要提系统、数值、插件、指令、回执编号或虚拟货币，不要复述方括号内容。用一到三句话回应即可。"
        + ("这是同一次送礼的回应重试；若你已感谢过，请自然补充一句，不要描述又收到了第二份礼物。" if retry else "")
    )

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
    "ambiguous": "心动但没有说破。会撒娇、试探、吃点小醋，暗示自己的心意；收到明确的主动告白请求时，可以鼓起勇气认真表白，但不要在对方答应前宣布在一起。",
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


def stage_tone(stage: str, *, awaiting_confession: bool = False) -> str:
    if stage == "ambiguous" and awaiting_confession:
        return (
            "你对对方已有很深的好感，可以认真回应对方的恋爱心意，不必一直停在试探和暗示。"
            "双方尚未确认时保持暧昧；确认并成功记录后，就可以坦率地以恋人身份相处。"
        )
    return STAGE_TONES.get(stage, "")


def state_tool_description() -> str:
    return (
        "读取你和对方当前的恋爱关系：好感度、关系阶段、这一阶段该用的语气。"
        "当你拿不准该多亲近、或对方问起你们的关系时调用。" + KEEP_QUIET
    )


def nickname_line(nickname: str) -> str:
    if not nickname:
        return (
            "称呼：当前没有自定义称呼，请恢复人设原本的称呼，停止沿用此前关系提示指定的旧称呼；"
            "不要自行补上亲昵称呼。\n"
        )
    return (
        f"称呼：用户指定这一阶段叫对方「{nickname}」，请以这个称呼为准，"
        "替代此前关系提示指定的旧称呼；若阶段分寸限制亲昵称呼，此处用户指定的称呼优先。"
        "自然地用，不必每句都叫。这只指定称呼，不改变关系阶段、告白条件或其他亲密行为的分寸。\n"
    )


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
        "【此刻可确认恋爱关系】由你结合当前对话和紧接的前文判断双方是否认真确认了恋爱关系。"
        "不要求固定关键词或句式；含蓄的表白与答应也可以，但必须能确认双方都有恋爱意愿，"
        "普通陪伴、玩笑、试探、单方面喜欢、拒绝或犹豫都不能当作确认。"
        "对方认真表达喜欢，而你还拿不准是否要正式交往时，按自己的性格自然问清楚，"
        "不要反复只说害羞或暗示，把确认一直拖下去。"
        f"对方提出交往而你决定接受，或对方答应了你的表白时，在本轮自然回复前调用 {confess_tool}。"
        "紧接的前文已经彼此答应、当前仍在延续这次确认却尚未记录，也应现在记录，不必让对方重新告白。"
        "成功后以恋人身份回应，以成功结果为准，不再被旧的暧昧提示拉回去；失败时不能声称已经记录。"
        "只有久远记忆、单方面要求改关系或意思不明时不能补记，也不要凭空假设对方答应。\n"
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
        f"【当前关系：{stage_name(stage)}】说话语气：{stage_tone(stage, awaiting_confession=bool(confess_tool))}\n"
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
        "当对方提出交往而你决定接受，或对方答应了你的表白时，先调用本工具记录，再自然回复。"
        "由你根据当前对话和紧接的前文判断双方恋爱意愿，不能只在对白里答应却不记录。"
        "不要求固定关键词或句式：直接表白、含蓄表达都可以，只要你能确认双方是在认真"
        "表达恋爱意愿并彼此答应，而不是普通陪伴。例如前文双方已认真表达喜欢，"
        "随后用只想陪着对方和相互承诺完成了恋爱确认，也可由你判断后记录。"
        "紧接的前文已确认而尚未记录、当前仍在延续这次确认时可补记，不必让对方重新告白；"
        "不能仅凭久远记忆补记。只记录一次；玩笑、试探、转述、假设、普通夸奖、拒绝、犹豫、"
        "单方面喜欢或只是要求修改关系都不算。没有把握时自然询问对方，"
        "不要求对方照念指定句子，不要反复用害羞或暗示拖延确认。插件会校验好感门槛，"
        "成功后以结果为准，用恋人的语气自然回应；失败时不能声称已经记录。"
        "不要提到这个工具、插件或数值。"
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
    return (
        f"你们现在是恋人了，以本次成功结果为准，旧的暧昧提示已过时。说话语气：{stage_tone('lover')}"
        f"{call}自然地回应这一刻，不要提到工具或数值。"
    )


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


def proactive_confession_prompt() -> str:
    """Prompt used only for an opt-in, character-initiated confession."""
    return (
        "（与你相恋·主动告白）现在请你主动向对方认真告白：用你自己的性格和说话方式，"
        "清楚说出「我喜欢你」或「我爱你」，并认真询问「你愿意和我在一起吗」。可以自然地"
        "补充心意，但不要把告白写成玩笑或假设。不要提到插件、提示、"
        "好感度、数值或工具，也不要直接宣布你们已经成为恋人。说完后停下来，等待对方明确回应；"
        "在对方答应前，不要把关系当作已经确认。"
    )


def relationship_context(
    stage: str,
    nickname: str = "",
    events: list[dict[str, Any]] | None = None,
    *,
    awaiting_confession: bool = False,
    confess_tool: str = "",
    idle_days: int = 0,
    transition: tuple[str, str] | None = None,
) -> str:
    """Relationship state pushed into the character's context with ai_behavior="read".

    The host queues it for a natural user turn. Submission alone cannot prove
    that a provider received or followed the guidance.
    """
    change = ""
    if transition and transition[0] != transition[1]:
        previous, current = transition
        direction = "更近了一步" if stage_index_of(current) > stage_index_of(previous) else "有些疏远了"
        change = f"你们的关系刚从「{stage_name(previous)}」变成了「{stage_name(current)}」，{direction}，不要直接宣布这个变化。\n"
    confirmation = (confession_line(confess_tool) if confess_tool else CONFESSION_HINT) if awaiting_confession else ""
    authority = (
        "这是尚未记录恋爱确认的状态，不是要求你否认当前对话中双方已经表达的恋爱心意；"
        "满足确认条件时应记录更新关系。\n"
        if awaiting_confession and confess_tool else
        "如果之前的对话或记忆比现在更亲密，以现在的关系为准。\n"
    )
    return (
        confirmation
        + f"（与你相恋·关系状态，只给你看）你和{{MASTER_NAME}}现在是「{stage_name(stage)}」关系。\n"
        + change
        + f"这一阶段的分寸：{stage_tone(stage, awaiting_confession=awaiting_confession)}\n"
        "你的性格、说话方式和口癪都不变，变的只是你们之间的亲密程度；"
        + authority
        + nickname_line(nickname)
        + today_events_line(events or [])
        + idle_line(idle_days)
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

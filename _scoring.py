"""Plugin-side affection scoring (pure, unit tested).

The chat model rarely calls a tool on its own, so the plugin judges each
finished exchange itself:

* with a model the user bound to this plugin in N.E.K.O's Plugin API page
  (``build_prompt`` + ``parse_verdict``; the call lives in ``_judge``);
* otherwise with ``rule_verdict``, a small offline keyword judge. It is much
  cruder, but needs no setup, costs nothing and sends nothing anywhere.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

# Smaller than the tool's per-call cap: every exchange is scored, so each one
# should move the value a little.
AUTO_MAX_DELTA = 3
REASON_MAX_CHARS = 30
DEFAULT_REASON = "聊天时的互动"

_JSON_OBJECT = re.compile(r"\{.*?\}", re.S)

_RULES = (
    "评分规则：\n"
    "- 0：普通闲聊、提问、陈述、请角色做事。拿不准就给 0。\n"
    "- +1~+3：真诚的关心、夸奖、示好、亲昵举动（摸头、拥抱）、分享心事、说喜欢、兑现承诺。越真诚越高。\n"
    "- -1~-3：明确冲着角色的冷淡、嘲讽、辱骂、不尊重、失约。越伤人越低。\n"
    "- 对方吐槽工作、学习或自己的遭遇，累了、心情不好，都不是针对角色，给 0。\n"
    "- 明显是玩笑或打情骂俏、而角色也没有当真时，给 0。\n"
    "- 和上一轮几乎一样的举动（例如连续摸头），第二次起最多 +1。\n"
)


@dataclass(frozen=True)
class Verdict:
    delta: int
    reason: str
    confession: bool


def build_prompt(
    *,
    character: str,
    stage_name: str,
    affection: int,
    user: str,
    reply: str,
    previous_user: str = "",
    previous_reply: str = "",
    awaiting_confession: bool = False,
) -> str:
    previous = ""
    if previous_user or previous_reply:
        previous = f"上一轮：\n对方：{previous_user}\n{character}：{previous_reply}\n\n"
    confession_rule = (
        "- confession：只有当对方认真地表白（例如“我喜欢你，和我在一起吧”）并且角色在回复里明确答应时才为 true，"
        "或者角色表白而对方明确答应。玩笑、试探、只说喜欢但没有确认关系，都是 false。\n"
        if awaiting_confession
        else "- confession 固定为 false。\n"
    )
    return (
        f"你在为一段恋爱模拟打分。角色「{character}」和对方现在的关系是「{stage_name}」，好感 {affection}/100。\n"
        "判断这一轮对话里，对方的言行让角色对他的好感变化多少。只看对方说的话，角色的回复用来理解语境。\n\n"
        + _RULES
        + confession_rule
        + "\n"
        + previous
        + f"这一轮：\n对方：{user}\n{character}：{reply}\n\n"
        + '只输出一行 JSON，不要解释：{"delta": 整数, "reason": "不超过15个字，用角色的口吻写原因，例如：他摸了摸我的头", '
        '"confession": false}'
    )


def _clean_reason(value: Any) -> str:
    text = " ".join(str(value or "").split()).strip("。.，, ")
    return text[:REASON_MAX_CHARS] or DEFAULT_REASON


def parse_verdict(text: Any) -> Verdict | None:
    """Parse the model's answer. None when nothing usable came back."""
    if not isinstance(text, str) or not text.strip():
        return None
    for match in _JSON_OBJECT.finditer(text):
        try:
            data = json.loads(match.group(0))
        except ValueError:
            continue
        if not isinstance(data, dict) or "delta" not in data:
            continue
        raw = data.get("delta")
        if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
            continue
        try:
            delta = int(round(float(raw)))
        except (TypeError, ValueError):
            continue
        delta = max(-AUTO_MAX_DELTA, min(AUTO_MAX_DELTA, delta))
        return Verdict(
            delta=delta,
            reason=_clean_reason(data.get("reason")),
            confession=data.get("confession") is True,
        )
    return None


# ------------------------------------------------------------ offline fallback

# (keywords, delta, reason). Checked against the user's message only.
_WARM: tuple[tuple[tuple[str, ...], int, str], ...] = (
    (("喜欢你", "爱你", "想你", "在乎你", "love you", "miss you"), 2, "他说喜欢我"),
    (("摸摸头", "摸头", "抱抱", "抱你", "亲亲", "贴贴", "摸摸"), 1, "他和我亲近"),
    (("谢谢你", "辛苦了", "可爱", "好看", "真棒", "好厉害", "陪着你", "陪你", "关心你"), 1, "他对我很温柔"),
    (("对不起", "抱歉", "我错了", "别生气"), 1, "他向我道歉"),
)
_HURT: tuple[tuple[tuple[str, ...], int, str], ...] = (
    (("滚", "闭嘴", "讨厌你", "烦死了", "恶心", "去死", "垃圾", "废物"), -3, "他说了伤人的话"),
    (("笨蛋", "傻瓜", "白痴", "蠢"), -1, "他说我笨"),
    (("不想理你", "别烦我", "无聊", "随便你"), -1, "他对我很冷淡"),
)
_NEGATIONS = ("不", "没", "别")
_CONFESS_USER = ("在一起", "做我女朋友", "做我男朋友", "交往", "嫁给我", "做我的恋人", "be my")
_ACCEPT = ("我愿意", "好呀", "好的", "嗯！", "答应", "当然", "我也喜欢你", "我也爱你")
_REFUSE = ("不行", "不要", "对不起", "还不", "再等等", "不愿意")


def _hit(text: str, words: tuple[str, ...]) -> bool:
    """A keyword counts unless a negation sits right before it (不喜欢你)."""
    for word in words:
        start = text.find(word)
        while start != -1:
            if not (start > 0 and text[start - 1] in _NEGATIONS):
                return True
            start = text.find(word, start + 1)
    return False


def rule_verdict(user: str, reply: str, *, awaiting_confession: bool = False) -> Verdict:
    """Offline judgement from keywords in the user's message.

    Hurtful words outweigh warm ones in the same message. Ordinary messages
    score 0, so this never drifts on its own.
    """
    text = str(user or "").lower()
    hurt = [(delta, reason) for words, delta, reason in _HURT if _hit(text, words)]
    warm = [(delta, reason) for words, delta, reason in _WARM if _hit(text, words)]
    if hurt:
        delta, reason = min(hurt)
    elif warm:
        delta = min(AUTO_MAX_DELTA, sum(d for d, _ in warm))
        reason = max(warm)[1]
    else:
        delta, reason = 0, DEFAULT_REASON
    confession = False
    if awaiting_confession and not hurt:
        answer = str(reply or "")
        confession = (
            _hit(text, ("喜欢你", "爱你"))
            and _hit(text, _CONFESS_USER)
            and any(word in answer for word in _ACCEPT)
            and not any(word in answer for word in _REFUSE)
        )
        if confession:
            reason = "他向我告白了"
    return Verdict(delta=max(-AUTO_MAX_DELTA, min(AUTO_MAX_DELTA, delta)), reason=reason, confession=confession)

"""v0.4: conversation bus pairing, plugin-side scoring, relationship context."""

from __future__ import annotations

from types import SimpleNamespace

DAY = 1_750_000_000.0


def _rec(turn_type, lanlan, content, ts, *, nested=False):
    if nested:  # raw host dict shape
        return {"content": content, "timestamp": ts, "metadata": {"turn_type": turn_type, "lanlan_name": lanlan}}
    return SimpleNamespace(
        turn_type=turn_type, lanlan_name=lanlan, content=content, timestamp=ts, metadata={}, raw=None
    )


# ------------------------------------------------------------ bus records


def test_parse_record_shapes(conv):
    user = conv.parse_record(_rec("user_message", "YUI", "  摸摸头 ", DAY))
    reply = conv.parse_record(_rec("assistant_message", "YUI", "喵~", DAY + 1, nested=True))
    assert user == conv.Message(ts=DAY, role="user", lanlan="YUI", content="摸摸头")
    assert reply is not None and reply.role == "reply" and reply.content == "喵~"
    proactive = conv.parse_proactive_record(_rec("proactive_reply", "YUI", "我有话想对你说", DAY + 2))
    assert proactive == conv.Message(ts=DAY + 2, role="proactive_reply", lanlan="YUI", content="我有话想对你说")


def test_parse_record_skips_other_turns(conv):
    assert conv.parse_record(_rec("proactive_reply", "YUI", "早上好", DAY)) is None
    assert conv.parse_record(_rec("proactive_instruction", "YUI", "x", DAY)) is None
    assert conv.parse_record(_rec("user_message", "", "hi", DAY)) is None
    assert conv.parse_record(_rec("user_message", "YUI", "   ", DAY)) is None
    assert conv.parse_record({"content": "hi", "metadata": {"turn_type": "user_message", "lanlan_name": "Y"}}) is None
    assert conv.parse_proactive_record(_rec("assistant_message", "YUI", "喵", DAY)) is None
    assert conv.parse_proactive_record({
        "content": "我喜欢你，和我在一起吧", "timestamp": DAY,
        "metadata": {"event_type": "proactive_confession", "turn_type": "proactive_instruction", "lanlan_name": "YUI"},
    }) is None


def test_parse_record_clips_long_text(conv):
    message = conv.parse_record(_rec("user_message", "YUI", "啊" * 1000, DAY))
    assert message is not None and len(message.content) == conv.MESSAGE_MAX_CHARS


def test_cursor_hands_out_each_message_once(conv):
    cursor = conv.BusCursor(DAY)
    old = conv.Message(DAY - 5, "user", "YUI", "旧消息")
    a = conv.Message(DAY + 1, "user", "YUI", "a")
    b = conv.Message(DAY + 2, "reply", "YUI", "b")
    assert cursor.fresh([b, old, a]) == [a, b]  # sorted, history before start skipped
    assert cursor.fresh([a, b]) == []
    c = conv.Message(DAY + 2, "user", "ATLS", "c")  # same ts, different message
    assert cursor.fresh([a, b, c]) == [c]


# ------------------------------------------------------------ pairing


def test_tracker_pairs_user_with_reply(conv):
    tracker = conv.ExchangeTracker()
    assert tracker.feed(conv.Message(DAY, "user", "YUI", "你个笨蛋")) is None
    first = tracker.feed(conv.Message(DAY + 1, "reply", "YUI", "呜……"))
    assert first is not None and (first.user, first.reply, first.previous_user) == ("你个笨蛋", "呜……", "")
    tracker.feed(conv.Message(DAY + 2, "user", "YUI", "摸摸头"))
    second = tracker.feed(conv.Message(DAY + 3, "reply", "YUI", "那你不要说我笨了"))
    assert second is not None and second.previous_user == "你个笨蛋" and second.previous_reply == "呜……"


def test_tracker_merges_messages_and_ignores_unasked_replies(conv):
    tracker = conv.ExchangeTracker()
    assert tracker.feed(conv.Message(DAY, "reply", "YUI", "主人回来啦")) is None  # greeting
    tracker.feed(conv.Message(DAY + 1, "user", "YUI", "我回来了"))
    tracker.feed(conv.Message(DAY + 2, "user", "YUI", "想你了"))
    exchange = tracker.feed(conv.Message(DAY + 3, "reply", "YUI", "真的吗"))
    assert exchange is not None and exchange.user == "我回来了 / 想你了"


def test_tracker_keeps_characters_apart(conv):
    tracker = conv.ExchangeTracker()
    tracker.feed(conv.Message(DAY, "user", "YUI", "给 YUI 的"))
    assert tracker.feed(conv.Message(DAY + 1, "reply", "ATLS", "ATLS 的回复")) is None
    exchange = tracker.feed(conv.Message(DAY + 2, "reply", "YUI", "YUI 的回复"))
    assert exchange is not None and exchange.lanlan == "YUI" and exchange.user == "给 YUI 的"


def test_tracker_never_pairs_a_user_message_with_proactive_speech(conv):
    tracker = conv.ExchangeTracker()
    tracker.feed(conv.Message(DAY, "user", "YUI", "你好"))
    assert tracker.feed(conv.Message(DAY + 1, "proactive_reply", "YUI", "早上好")) is None
    exchange = tracker.feed(conv.Message(DAY + 2, "reply", "YUI", "你好呀"))
    assert exchange is not None and exchange.user == "你好"


def test_arrival_cursor_and_spoken_chronology_remain_separate(conv):
    raw = _rec("assistant_message", "YUI", "较早开始的回复", DAY + 5, nested=True)
    raw["metadata"]["ts"] = DAY + 1
    reply = conv.parse_record(raw)
    assert reply.ts == DAY + 5 and reply.said_at == DAY + 1
    cursor = conv.BusCursor(DAY + 3)
    assert cursor.fresh([reply]) == [reply]
    assert cursor.since == DAY + 5
    assert cursor.fresh([reply]) == []


def test_tracker_leaves_newer_user_for_its_own_reply(conv):
    tracker = conv.ExchangeTracker()
    tracker.feed(conv.Message(100, "user", "YUI", "帮我找书", spoken_at=100))
    tracker.feed(conv.Message(102, "user", "YUI", "和我在一起吧", spoken_at=102))
    old = tracker.feed(conv.Message(103, "reply", "YUI", "我愿意", spoken_at=101))
    assert old.user == "帮我找书"
    new = tracker.feed(conv.Message(104, "reply", "YUI", "我还没准备好", spoken_at=103.5))
    assert new.user == "和我在一起吧"
    assert new.previous_user == old.user and new.previous_reply == old.reply


def test_reply_older_than_all_pending_users_does_not_consume_them(conv):
    tracker = conv.ExchangeTracker()
    tracker.feed(conv.Message(102, "user", "YUI", "新问题", spoken_at=102))
    assert tracker.feed(conv.Message(103, "reply", "YUI", "旧回答", spoken_at=101)) is None
    current = tracker.feed(conv.Message(104, "reply", "YUI", "新回答", spoken_at=103.5))
    assert current.user == "新问题" and current.previous_user == ""


# ------------------------------------------------------------ scoring


def test_parse_verdict_variants(scoring):
    v = scoring.parse_verdict('{"delta": 2, "reason": "他摸了摸我的头。", "confession": false}')
    assert v == scoring.Verdict(delta=2, reason="他摸了摸我的头", confession=False)
    fenced = scoring.parse_verdict('好的\n```json\n{"delta": -9, "reason": "", "confession": true}\n```')
    assert fenced == scoring.Verdict(delta=-scoring.AUTO_MAX_DELTA, reason=scoring.DEFAULT_REASON, confession=True)
    assert scoring.parse_verdict('{"delta": "1"}').delta == 1
    assert scoring.parse_verdict('{"confession": "yes", "delta": 0}').confession is False


def test_parse_verdict_rejects_garbage(scoring):
    for text in (None, "", "无法判断", '{"reason": "x"}', '{"delta": true}', '{"delta": null}', "{bad json}"):
        assert scoring.parse_verdict(text) is None


def test_build_prompt_includes_context(scoring):
    prompt = scoring.build_prompt(
        character="YUI",
        stage_name="陌生",
        affection=0,
        user="你个笨蛋",
        reply="呜……",
        previous_user="摸摸头",
        previous_reply="喵~",
    )
    assert "「陌生」" in prompt and "对方：你个笨蛋" in prompt and "上一轮：\n" in prompt
    assert "confession 固定为 false" in prompt
    waiting = scoring.build_prompt(
        character="YUI", stage_name="暧昧", affection=85, user="我喜欢你", reply="我也是", awaiting_confession=True
    )
    assert "明确答应" in waiting and "上一轮：\n" not in waiting


def test_auto_source_and_no_cooldown(engine):
    record = engine.new_record(10, now=DAY)
    first = engine.apply_model_delta(record, 2, "摸头", now=DAY, cooldown=0, source="auto")
    second = engine.apply_model_delta(record, 2, "又摸头", now=DAY + 5, cooldown=0, source="auto")
    assert (first["applied"], second["applied"]) == (2, 2)
    assert record["history"][-1]["source"] == "auto"
    assert engine.DEFAULT_SETTINGS["auto_score"] is True
    assert engine.normalize_settings({"auto_score": False})["auto_score"] is False


# ------------------------------------------------------------ relationship context


def test_relationship_context_text(prompts):
    text = prompts.relationship_context("stranger", "", [], transition=("familiar", "stranger"))
    assert "「陌生」" in text and "不撒娇" in text and "有些疏远了" in text
    assert "以现在的关系为准" in text and "{MASTER_NAME}" in text
    assert "工具" not in text
    lover = prompts.relationship_context(
        "ambiguous", "小笨蛋", [{"kind": "met", "type": "day", "count": 100}], awaiting_confession=True
    )
    assert "「小笨蛋」" in lover and "第 100 天" in lover and "告白" in lover
    assert "关系刚从" not in lover


# ------------------------------------------------------------ offline judge


def test_nickname_prompts_revoke_old_names_and_resolve_stage_priority(prompts):
    for text in (
        prompts.relationship_context("stranger", ""),
        prompts.update_tool_description("stranger", ""),
        prompts.gift_reaction_prompt("tea", "stranger", "", 1, gift_id="gift_000000001"),
    ):
        assert "恢复人设原本的称呼" in text
        assert "停止沿用" in text
    for text in (
        prompts.relationship_context("stranger", "亲爱的"),
        prompts.update_tool_description("stranger", "亲爱的"),
        prompts.gift_reaction_prompt("tea", "stranger", "亲爱的", 1, gift_id="gift_000000001"),
    ):
        assert "用户指定的称呼优先" in text
        assert "不改变关系阶段、告白条件" in text


def test_rule_verdict_scores_warm_and_hurtful_words(scoring):
    assert scoring.rule_verdict("摸摸头", "嗯").delta == 1
    assert scoring.rule_verdict("我喜欢你，抱抱", "").delta == 3  # capped at AUTO_MAX_DELTA
    assert scoring.rule_verdict("你个笨蛋", "").delta == -1
    hurt = scoring.rule_verdict("我喜欢你，但是滚开", "")
    assert hurt.delta == -3 and hurt.reason == "他说了伤人的话"
    assert scoring.rule_verdict("今天吃什么", "面条吧").delta == 0


def test_rule_verdict_respects_negation(scoring):
    assert scoring.rule_verdict("我不喜欢你", "").delta == 0
    assert scoring.rule_verdict("我没想你", "").delta == 0


def test_rule_verdict_confession_needs_gate_and_acceptance(scoring):
    user = "我喜欢你，和我在一起吧"
    assert scoring.rule_verdict(user, "我愿意！", awaiting_confession=True).confession is True
    assert scoring.rule_verdict(user, "我愿意！", awaiting_confession=False).confession is False
    assert scoring.rule_verdict(user, "对不起，还不行", awaiting_confession=True).confession is False
    assert scoring.rule_verdict("我喜欢你", "好呀", awaiting_confession=True).confession is False


def test_proactive_response_requires_clear_answer(scoring):
    assert scoring.proactive_response("我愿意") == "accept"
    assert scoring.proactive_response("我愿意和你在一起") == "accept"
    assert scoring.proactive_response("我也喜欢你") == "accept"
    assert scoring.proactive_response("好，我们在一起") == "accept"
    assert scoring.proactive_response("我不想和你在一起") == "refuse"
    assert scoring.proactive_response("我也喜欢你，但是我还没准备好") == "refuse"
    assert scoring.proactive_response("好") is None
    assert scoring.proactive_response("我愿意帮你找个对象") is None
    assert scoring.proactive_response("我愿意，但我是说愿意帮你") is None
    assert scoring.proactive_response("我愿意，开玩笑的") is None
    assert scoring.proactive_response("如果我说我愿意呢？") is None
    assert scoring.proactive_response("我愿意吗？") is None
    assert scoring.proactive_response("我愿意", require_relationship=True) is None
    assert scoring.proactive_response("我愿意和你在一起", require_relationship=True) == "accept"


def test_proactive_reply_must_contain_a_real_proposal(scoring):
    assert scoring.confession_proposal("我喜欢你，和我在一起吧")
    assert scoring.confession_proposal("我喜欢你，你愿意和我在一起吗？")
    assert not scoring.confession_proposal("我喜欢你")
    assert not scoring.confession_proposal("我喜欢你，和我在一起吧，开玩笑的")
    assert not scoring.confession_proposal("如果我说我喜欢你，和我在一起吧")
    assert not scoring.confession_proposal("我喜欢你，但是我还不想和你在一起")
    assert not scoring.confession_proposal("我喜欢你，和我在一起吧。你愿意帮我找一本书吗？")


# ------------------------------------------------------------ model gateway


class _Err(Exception):
    def __init__(self, status):
        super().__init__("secret upstream body")
        self.status_code = status


def _models(*, reply=None, error=None, unavailable=False):
    calls = []

    async def create(**kwargs):
        calls.append(kwargs)
        if error is not None:
            raise error
        msg = SimpleNamespace(content=reply)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    async def get_client():
        if unavailable:
            raise RuntimeError("no gateway")
        return client

    return SimpleNamespace(get_client=get_client), calls


def _run(coro):
    import asyncio

    return asyncio.run(coro)


def test_judge_uses_declared_usage(judge):
    models, calls = _models(reply='{"delta": 1}')
    assert _run(judge.complete(models, "p")) == ('{"delta": 1}', "ok")
    assert calls[0]["model"] == "judge"
    assert calls[0]["messages"] == [{"role": "user", "content": "p"}]


def test_judge_statuses_never_leak_messages(judge):
    assert _run(judge.complete(_models(error=_Err(403))[0], "p")) == (None, "unbound")
    assert _run(judge.complete(_models(error=_Err(409))[0], "p")) == (None, "binding_incompatible")
    assert _run(judge.complete(_models(error=_Err(502))[0], "p")) == (None, "http_502")
    assert _run(judge.complete(_models(unavailable=True)[0], "p")) == (None, "gateway_unavailable")
    assert _run(judge.complete(None, "p")) == (None, "gateway_unavailable")
    assert _run(judge.complete(_models(reply="  ")[0], "p")) == (None, "empty_reply")

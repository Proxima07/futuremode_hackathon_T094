"""Offline contract tests. No API keys, live camera or billable VLM calls."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError
from server.config import settings
from server.models.schemas import PlanRequest
from server.routers.plan import LAYOUT_SLOTS, plan
from server.services import prompts
from server.services.validate import validate_plan
from server.services.vlm.base import OpenAICompatible, VLMResult


CURRENT = {"id": "rule_thirds", "name": "三分法", "guide_only": True,
           "composition": "thirds", "slots": [
               {"id": "main", "box": [.1, .2, .5, .6], "anchor": [.33, .33],
                "prefer": "hero", "item": "飲料杯", "feature": "杯標中心"},
               {"id": "secondary", "box": [.5, .5, .8, .7], "prefer": "any"}]}


def raw(**extra):
    return {"layout": "rule_thirds", "fit": "good", "alignment": "ready",
            "placements": [{"slot": "main", "item": "杯子", "feature": "杯蓋"}],
            "remove": [], **extra}


def clean(data, **extra):
    return validate_plan(data, set(LAYOUT_SLOTS), LAYOUT_SLOTS, current=CURRENT, **extra)


class ValidationTests(unittest.TestCase):
    def test_guiding_cannot_change_layout_or_feature(self):
        p = clean(raw(layout="diagonal", fit="adjust", adjust={"mirror": True, "shift_y": .08}), phase="guiding")
        self.assertEqual(p["layout"], "rule_thirds")
        self.assertEqual(p["fit"], "good")
        self.assertIsNone(p["adjust"])
        self.assertEqual(p["placements"][0]["feature"], "杯標中心")
        self.assertEqual(p["placements"][0]["item"], "飲料杯")

    def test_searching_can_still_adjust_and_flip(self):
        p = clean(raw(fit="adjust", adjust={"mirror": "true", "flip_y": "false", "shift_y": .03}))
        self.assertTrue(p["adjust"]["mirror"])
        self.assertFalse(p["adjust"]["flip_y"])
        self.assertEqual(p["adjust"]["shift_y"], .03)

    def test_no_subject_or_only_secondary_cannot_be_ready(self):
        for placements in [[], [{"slot": "secondary", "item": "醬料杯"}]]:
            p = clean(raw(placements=placements), phase="guiding")
            self.assertEqual(p["alignment"], "lost")
            self.assertFalse(p["ready_to_capture"])

    def test_clutter_blocks_ready_without_erasing_it(self):
        p = clean(raw(remove=["無關線材"]), phase="guiding")
        self.assertEqual(p["alignment"], "move")
        self.assertEqual(p["remove"], ["無關線材"])

    def test_ready_clears_movement_advice_and_action(self):
        p = clean(raw(action="move_left", advice="往左移"), phase="guiding")
        self.assertEqual(p["action"], "none")
        self.assertEqual(p["advice"], "")
        self.assertTrue(p["ready_to_capture"])

    def test_bad_collections_and_missing_alignment_fail_conservatively(self):
        p = clean(raw(placements=3, remove="紙張", light=[], adjust=[]))
        self.assertEqual(p["alignment"], "lost")
        p = raw(); del p["alignment"]
        self.assertEqual(clean(p)["alignment"], "move")

    def test_dynamic_target_is_valid_in_guiding(self):
        current = {"id": "custom", "slots": [{"id": "cup", "prefer": "hero"}]}
        p = validate_plan(raw(placements=[{"slot": "cup", "item": "杯子"}]),
                          set(LAYOUT_SLOTS), LAYOUT_SLOTS, current=current, phase="guiding")
        self.assertEqual(p["layout"], "custom")
        self.assertTrue(p["ready_to_capture"])

    def test_phase_validation_and_old_request_defaults(self):
        self.assertEqual(PlanRequest(image="test", layouts=["single"]).phase, "searching")
        with self.assertRaises(ValidationError):
            PlanRequest(image="test", layouts=["single"], phase="ready")

    def test_guiding_prompt_has_fixed_target_not_layout_catalog(self):
        text = prompts.plan_text("food", list(LAYOUT_SLOTS), CURRENT,
                                 phase="guiding", last_action="move_left", last_advice="杯標靠左")
        self.assertNotIn("可用版型與用途", text)
        self.assertIn("杯標中心", text)
        self.assertIn("move_left", text)
        self.assertIn("印刷墊紙", text)
        self.assertIn("最高優先級", prompts.GUIDING_SYSTEM)


class AsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_route_uses_phase_prompt_and_disallows_custom_when_guiding(self):
        output = VLMResult(json.dumps(raw(fit="custom")), "mock", "mock", 1)
        with patch("server.routers.plan.chain.ask", new=AsyncMock(return_value=output)) as ask:
            request = PlanRequest(image="test", layouts=list(LAYOUT_SLOTS), current=CURRENT, phase="guiding")
            p = await plan(request)
            self.assertFalse(p["needs_custom"])
            self.assertEqual(ask.call_args.args[0], prompts.GUIDING_SYSTEM)
            request.phase = "searching"
            p = await plan(request)
            self.assertTrue(p["needs_custom"])
            self.assertEqual(ask.call_args.args[0], prompts.PLAN_SYSTEM)

    async def test_missing_guiding_target_does_not_call_model(self):
        with patch("server.routers.plan.chain.ask", new=AsyncMock()) as ask:
            p = await plan(PlanRequest(image="test", layouts=["single"], phase="guiding"))
            self.assertTrue(p["fallback"])
            ask.assert_not_called()

    async def test_malformed_response_is_fallback(self):
        output = VLMResult("not json", "mock", "mock", 1)
        with patch("server.routers.plan.chain.ask", new=AsyncMock(return_value=output)):
            p = await plan(PlanRequest(image="test", layouts=["single"]))
            self.assertTrue(p["fallback"])

    async def test_provider_temperature_is_configured_at_runtime(self):
        create = AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="{}"))]))
        provider = OpenAICompatible("mock", "https://example.invalid", "mock", "gemma-test")
        provider._client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(settings, "VLM_TEMPERATURE", 0.0):
            await provider.chat("system", "test", "user")
        self.assertEqual(create.call_args.kwargs["temperature"], 0.0)


if __name__ == "__main__":
    unittest.main()

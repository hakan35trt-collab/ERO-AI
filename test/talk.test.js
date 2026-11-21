import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_TOKEN_MS, LITE_TOKEN_MS, TEXT_MODELS, takeSseEvents, tokenBudget } from "../src/gemini.js";
import { SILENCE_MS, recognitionShouldRestart } from "../src/voice.js";

test("flash-lite is the only model allowed to wait", () => {
  assert.equal(TEXT_MODELS[0], "gemini-3.5-flash-lite");
  assert.equal(tokenBudget(TEXT_MODELS[0]), LITE_TOKEN_MS);
  assert.equal(LITE_TOKEN_MS, 5000);
  for (const model of TEXT_MODELS.slice(1)) {
    assert.equal(tokenBudget(model), FALLBACK_TOKEN_MS);
    assert.ok(FALLBACK_TOKEN_MS <= 3000);
  }
  assert.ok(!TEXT_MODELS.includes("gemini-3.8-flash"));
  assert.ok(!TEXT_MODELS.includes("gemini-2.5-flash"));
});

test("recognition restarts after silence and soft errors", () => {
  assert.equal(SILENCE_MS, 700);
  assert.equal(recognitionShouldRestart("no-speech", true), true);
  assert.equal(recognitionShouldRestart("network", true), true);
  assert.equal(recognitionShouldRestart("aborted", true), true);
  assert.equal(recognitionShouldRestart("not-allowed", true), false);
  assert.equal(recognitionShouldRestart("network", false), false);
});

test("CRLF event streams yield the first text chunk", () => {
  const raw = 'data: {"candidates":[{"content":{"parts":[{"text":"Merhaba"}]}}]}\r\n\r\n';
  const parsed = takeSseEvents(raw, false);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].candidates[0].content.parts[0].text, "Merhaba");
  const tail = takeSseEvents('data: {"candidates":[{"content":{"parts":[{"text":"Selam"}]}}]}', true);
  assert.equal(tail.events[0].candidates[0].content.parts[0].text, "Selam");
});

test("a turn always settles back to listening or idle", () => {
  const settle = (running, speaking) => (speaking ? "speak" : running ? "listen" : "idle");
  assert.equal(settle(true, false), "listen");
  assert.equal(settle(false, false), "idle");
  assert.equal(settle(true, true), "speak");
});

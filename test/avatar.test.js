import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { resolveViseme, visemeFromAudio, visemeFromChar, visemeFromShape } from "../src/avatar.js";
import { GEMINI_VOICE, LIVE_MODELS, TEXT_MODELS, TTS_MODELS, textFromGenerate } from "../src/gemini.js";

test("sessizlikte ağız kapalı, yüksek enerjide açık hece", () => {
  assert.equal(visemeFromAudio({ rms: 0, centroid: 0 }), "rest");
  assert.equal(visemeFromAudio({ rms: 0.28, centroid: 0.4 }), "a");
  assert.equal(visemeFromChar("a"), "a");
  assert.equal(visemeFromChar("m"), "mbp");
  assert.equal(resolveViseme("fv"), "u");
  assert.equal(resolveViseme("mbp"), null);
  assert.equal(visemeFromShape({ open: 0.8, round: 0.1, smile: 0 }), "a");
  assert.equal(visemeFromShape({ open: 0.4, round: 0.9, smile: 0 }), "u");
});

test("Gemini sırası meşgul modellere düşer ve ses Charon", () => {
  assert.equal(TEXT_MODELS[0], "gemini-3.5-flash-lite");
  assert.ok(TEXT_MODELS.includes("gemini-3.8-flash"));
  assert.ok(LIVE_MODELS.includes("gemini-omni-flash-preview"));
  assert.ok(LIVE_MODELS.includes("gemini-omni-1.2-flash"));
  assert.deepEqual(TTS_MODELS, ["gemini-2.5-flash-preview-tts"]);
  assert.equal(GEMINI_VOICE, "Charon");
  assert.equal(textFromGenerate({ candidates: [{ content: { parts: [{ text: "Merhaba" }] } }] }), "Merhaba");
});

test("avatar manifesti gerçek kareleri ve yamaları sayar", () => {
  const manifest = JSON.parse(fs.readFileSync("public/avatar/manifest.json", "utf8"));
  assert.equal(manifest.width, 864);
  assert.equal(manifest.height, 1152);
  assert.equal(manifest.base, "base.jpg");
  for (const name of ["a", "e", "i", "o", "u"]) {
    assert.ok(fs.existsSync(`public/avatar/${manifest.mouth[name].file}`));
  }
  assert.ok(fs.existsSync(`public/avatar/${manifest.eyes.blink.file}`));
  assert.ok(fs.existsSync(`public/avatar/${manifest.eyes.left.file}`));
  assert.ok(fs.existsSync(`public/avatar/${manifest.head.right.file}`));
  assert.ok(fs.existsSync(`public/avatar/${manifest.emotions.joy.file}`));
  assert.match(manifest.generated["eye-left"], /ayna/);
  assert.match(manifest.generated["head-right"], /ERO/);
  for (const name of ["happy", "surprised", "think"]) {
    assert.equal(manifest.expressions[name].file, `expr-${name}.jpg`);
    assert.ok(fs.existsSync(`public/avatar/${manifest.expressions[name].file}`));
  }
  for (const file of ["base.jpg", "viseme-a.jpg", "viseme-u.jpg", "expr-blink.jpg", "expr-thinking.jpg"]) {
    assert.ok(fs.existsSync(`public/avatar/raw/${file}`));
  }
});

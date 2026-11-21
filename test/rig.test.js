import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { deform, emptyPose, createSpring, springTo } from "../src/face-rig.js";
import { emotionPreset } from "../src/face-life.js";
import { buildTrack, sampleTrack } from "../src/lipsync.js";
import { effectiveGeminiKey, parseSetupKey } from "../src/memory.js";

const rig = JSON.parse(fs.readFileSync("public/avatar/rig.json", "utf8"));

test("kafes 478 nokta, ceket sabit, ağız ve göz delikleri var", () => {
  assert.equal(rig.landmarks.length, 478);
  assert.equal(rig.width, 864);
  assert.equal(rig.height, 1152);
  assert.ok(rig.skin.length > 1000);
  assert.ok(rig.mouthCover.length > 30);
  assert.ok(rig.stats.mouthHoles > 0);
  assert.ok(fs.existsSync("public/avatar/teeth.png"));
  const jacket = rig.anchors.findIndex((item) => item[4] === "jacket");
  assert.ok(jacket >= 0);
  assert.equal(rig.influence[478 + jacket], 0);
  const rest = deform(rig, emptyPose());
  const turned = deform(rig, { yaw: 0.2, pitch: 0.2, roll: 0.2 });
  const index = 478 + jacket;
  assert.equal(turned.pos[index * 2], rest.pos[index * 2]);
  assert.equal(turned.pos[index * 2 + 1], rest.pos[index * 2 + 1]);
  const chin = rig.groups.chin[0];
  const open = deform(rig, { jawOpen: 1 });
  assert.ok(open.pos[chin * 2 + 1] > rest.pos[chin * 2 + 1] + 4);
  const lid = rig.groups.lidUpperLeft[0];
  const shut = deform(rig, { lidLeft: 1 });
  assert.ok(shut.pos[lid * 2 + 1] > rest.pos[lid * 2 + 1] + 1);
});

test("yay hedefe sıçramadan yaklaşır", () => {
  const spring = createSpring(0);
  springTo(spring, 1, 1 / 60, 8);
  assert.ok(spring.value > 0);
  assert.ok(spring.value < 0.5);
});

test("sonraki hece 60 ms önce karışır", () => {
  const track = buildTrack("ma", 220);
  assert.equal(track.length, 2);
  const pose = sampleTrack(track, track[0].t1 - 30, 60);
  assert.ok(pose.jawOpen > track[0].pose.jawOpen);
  assert.ok(pose.jawOpen < track[1].pose.jawOpen);
});

test("duygu ön ayarları ve anahtar seçimi", () => {
  assert.ok(emotionPreset("joy").mouthWide > 0.4);
  assert.ok(emotionPreset("happy").cheekRaise > 0);
  assert.equal(emotionPreset("mutlu"), null);
  assert.equal(effectiveGeminiKey({ geminiKey: "yerel" }, "yerlesik"), "yerel");
  assert.equal(effectiveGeminiKey({ geminiKey: "" }, "yerlesik"), "yerlesik");
  assert.equal(effectiveGeminiKey({}, ""), "");
  assert.equal(parseSetupKey("#key=abc%20d"), "abc d");
  assert.equal(parseSetupKey("#baska"), "");
});

test("kaynakta anahtar dizisi yok", () => {
  const files = ["src/memory.js", "src/gemini.js", "src/app.js", ".github/workflows/pages.yml", "README.md"];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal(/AIza[0-9A-Za-z\-_]{20}/.test(text), false, file);
  }
});

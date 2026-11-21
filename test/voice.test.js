import assert from "node:assert/strict";
import test from "node:test";
import { chooseVoice } from "../src/voice.js";

test("Türkçe sesi seçer, yoksa varsayılanı zorlamaz", () => {
  const voices = [
    { voiceURI: "en", lang: "en-US", name: "English" },
    { voiceURI: "tr", lang: "tr-TR", name: "Türkçe" },
  ];
  assert.equal(chooseVoice(voices, "").voiceURI, "tr");
  assert.equal(chooseVoice(voices, "en").voiceURI, "en");
  assert.equal(chooseVoice([{ voiceURI: "en", lang: "en-US", name: "English" }], ""), null);
});

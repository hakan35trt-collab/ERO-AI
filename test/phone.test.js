import assert from "node:assert/strict";
import test from "node:test";
import {
  PHONE_TOOLS,
  bestLabel,
  compareVersions,
  isNo,
  isYes,
  needsSpokenYes,
  resetPhoneGates,
  runTool,
  safeHttpUrl,
  scoreLabel,
  webSearchUrl,
  youtubeSearchUrl,
  youtubeWatchUrl,
} from "../src/phone.js";

test("uygulama adları Türkçe ve İngilizce eşleşir", () => {
  assert.equal(scoreLabel("youtube", "YouTube"), 100);
  assert.ok(scoreLabel("ayarlar", "Settings") >= 90);
  assert.ok(scoreLabel("haritalar", "Maps") >= 90);
  assert.equal(bestLabel("kamera", ["Chrome", "Kamera", "Müzik"]).label, "Kamera");
  assert.equal(bestLabel("olmayan", ["Chrome"]), null);
});

test("YouTube ve adres niyetleri güvenli kurulur", () => {
  assert.equal(youtubeSearchUrl("kedi videosu"), "https://www.youtube.com/results?search_query=kedi%20videosu");
  assert.equal(youtubeWatchUrl("dQw4w9wgxcq"), "vnd.youtube:dQw4w9wgxcq");
  assert.equal(youtubeWatchUrl("kısa"), "");
  assert.equal(safeHttpUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(webSearchUrl("hava"), "https://www.google.com/search?q=hava");
});

test("arama, mesaj ve ödeme sesli evet ister", async () => {
  resetPhoneGates();
  const call = await runTool("call_contact", { name: "Annem" });
  assert.equal(call.need_yes, true);
  assert.match(call.say, /onaylıyor musun/);
  const pay = await runTool("tap", { text: "Ödemeyi onayla" });
  assert.equal(pay.need_yes, true);
  const scroll = await runTool("scroll", { direction: "down" });
  assert.equal(scroll.need_yes, undefined);
  assert.equal(needsSpokenYes("send_sms", { name: "Ali", text: "gel" }), true);
  assert.equal(needsSpokenYes("tap", { text: "Kaydet" }), false);
  assert.equal(isYes("Evet, ara"), true);
  assert.equal(isNo("hayır"), true);
  assert.equal(isYes("hayır"), false);
});

test("sürüm karşılaştırması ve araç listesi", () => {
  assert.equal(compareVersions("1.0.2", "1.0.1"), 1);
  assert.equal(compareVersions("v1.0.1", "1.0.1"), 0);
  assert.equal(compareVersions("1.0.0", "1.2.0"), -1);
  for (const name of ["open_app", "youtube_search", "youtube_play", "open_url", "web_search", "set_alarm", "set_timer", "call_contact", "send_sms", "whatsapp", "flashlight", "volume", "brightness", "open_settings", "media", "camera", "battery", "notifications", "navigate", "share", "screen_read", "tap", "scroll", "type_text", "nav_key"]) {
    assert.ok(PHONE_TOOLS.some((tool) => tool.name === name), name);
  }
});

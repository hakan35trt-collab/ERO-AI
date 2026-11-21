import assert from "node:assert/strict";
import test from "node:test";
import {
  StreamCleaner,
  cleanQuery,
  detectDelivery,
  explicitMemories,
  extractWake,
  needsResearch,
  takeSpeakable,
} from "../src/text.js";

test("uyandırma sözü ERO'yu ayırır", () => {
  assert.deepEqual(extractWake("Hey, ERO!"), { wake: true, rest: "" });
  assert.deepEqual(extractWake("merhaba ero nasılsın"), { wake: true, rest: "nasılsın" });
  assert.deepEqual(extractWake("selam ero bana bir şiir oku"), { wake: true, rest: "bana bir şiir oku" });
  assert.equal(extractWake("bir şey söyle").wake, false);
});

test("araştırma şiirde kapalı, olguda açık", () => {
  assert.equal(needsResearch("bana kısa bir şiir yaz"), false);
  assert.equal(needsResearch("merhaba"), false);
  assert.equal(needsResearch("Tek cümleyle kendini tanıt. Adın ne?"), false);
  assert.equal(needsResearch("İstanbul'un nüfusu kaç?"), true);
  assert.equal(needsResearch("Ankara'da hava nasıl?"), true);
});

test("sorgu eklerini temizler", () => {
  const query = cleanQuery("İstanbul'un nüfusu kaç?");
  assert.match(query, /İstanbul/i);
  assert.doesNotMatch(query, /kaç/);
});

test("anı ve kalan isteği ayırır", () => {
  const only = explicitMemories("Hatırla kedimin adı Misket");
  assert.deepEqual(only.facts, ["kedimin adı Misket"]);
  assert.equal(only.remainder, "");
  const mixed = explicitMemories("Hatırla kedimin adı Misket ve bana bir şiir yaz");
  assert.equal(mixed.facts[0], "kedimin adı Misket");
  assert.match(mixed.remainder, /şiir/);
});

test("akıştaki duygu etiketini gizler", () => {
  const cleaner = new StreamCleaner();
  let shown = cleaner.push("Merhaba. ");
  shown += cleaner.push('<er');
  shown += cleaner.push('o>{"emotion":"happy","memories":["Çay sever"]}</ero>');
  const done = cleaner.finish();
  assert.equal(shown.includes("emotion"), false);
  assert.equal(done.emotion, "happy");
  assert.deepEqual(done.memories, ["Çay sever"]);
});

test("cümleleri ses için böler, ondalığı bölmez", () => {
  const first = takeSpeakable("Merhaba. Nasılsın bugün?");
  assert.deepEqual(first.sentences, ["Merhaba.", "Nasılsın bugün?"]);
  assert.equal(first.rest, "");
  const number = takeSpeakable("3.14 bir sayıdır.", { flush: true });
  assert.equal(number.sentences.length, 1);
  assert.match(number.sentences[0], /3\.14/);
});

test("şiir, şarkı ve hikâye üslubunu seçer", () => {
  assert.equal(detectDelivery("bana bir şarkı söyle"), "song");
  assert.equal(detectDelivery("kısa bir şiir yaz"), "poem");
  assert.equal(detectDelivery("uyku hikâyesi anlat"), "story");
  assert.equal(detectDelivery("naber"), "chat");
});

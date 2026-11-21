import assert from "node:assert/strict";
import test from "node:test";
import { applyIntent, createDemoDevices, parseHomeIntent, serviceFor } from "../src/smarthome.js";

test("ışık, klima, perde ve televizyon komutlarını anlar", () => {
  const lights = parseHomeIntent("ışıkları aç");
  assert.equal(lights.matched, true);
  assert.equal(lights.domain, "light");
  assert.equal(lights.action, "on");
  assert.equal(lights.room, null);

  const kitchen = parseHomeIntent("mutfak ışığını kapat");
  assert.equal(kitchen.domain, "light");
  assert.equal(kitchen.action, "off");
  assert.equal(kitchen.room, "mutfak");

  const climate = parseHomeIntent("klimayı 22 dereceye ayarla");
  assert.equal(climate.domain, "climate");
  assert.equal(climate.temperature, 22);

  const cover = parseHomeIntent("perdeleri yüzde 40 aç");
  assert.equal(cover.domain, "cover");
  assert.equal(cover.position, 40);

  const closed = parseHomeIntent("perdeleri kapat");
  assert.equal(closed.position, 0);

  const tv = parseHomeIntent("televizyonu aç");
  assert.equal(tv.domain, "media_player");
  assert.equal(tv.action, "on");
});

test("şiiri komut sanmaz, karışık cümlede kalanı bırakır", () => {
  assert.equal(parseHomeIntent("bana bir şiir yazar mısın").matched, false);
  assert.equal(parseHomeIntent("merhaba nasılsın").matched, false);
  const mixed = parseHomeIntent("ışıkları aç ve bana şiir yaz");
  assert.equal(mixed.matched, true);
  assert.match(mixed.remainder, /şiir/);
});

test("simülasyon doğru cihazı değiştirir", () => {
  const devices = createDemoDevices();
  const kitchen = applyIntent(devices, parseHomeIntent("mutfak ışığını aç"));
  assert.equal(kitchen.devices.find((item) => item.id === "light.mutfak").state, "on");
  assert.equal(kitchen.devices.find((item) => item.id === "light.salon").state, "off");
  const warmed = applyIntent(devices, parseHomeIntent("klimayı 22 dereceye ayarla"));
  const climate = warmed.devices.find((item) => item.id === "climate.klima");
  assert.equal(climate.temperature, 22);
  assert.equal(climate.state, "on");
  const lights = applyIntent(devices, parseHomeIntent("ışıkları aç"));
  assert.equal(lights.devices.filter((item) => item.domain === "light" && item.state === "on").length, 3);
});

test("Home Assistant servis çağrısını kurar", () => {
  const call = serviceFor(parseHomeIntent("klimayı 21 dereceye ayarla"));
  assert.equal(call.domain, "climate");
  assert.equal(call.service, "set_temperature");
  assert.equal(call.data.temperature, 21);
});

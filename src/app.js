import { createAvatar } from "./avatar.js";
import { createConversation } from "./session.js";
import { createStore, loadSettings, saveSettings } from "./memory.js";
import { KOCAELI, localForecast, research, sourceLabels } from "./search.js";
import { createDemoDevices, createHomeAssistant, deviceLabel, runHomeCommand } from "./smarthome.js";
import { emotionFromText, sanitizeFinal } from "./text.js";
import { createVoice } from "./voice.js";

const PILL = {
  idle: ["ERO Hazır", "Seninle konuşmaya hazırım..."],
  listen: ["Dinliyorum", "Konuşman bitince yanıtlarım."],
  think: ["Düşünüyorum", "Bir saniye..."],
  speak: ["Konuşuyorum", "Sözümü kesmek için dokun."],
};

const RIDDLES = [
  { q: "Sabah dört ayağı, öğlen iki ayağı, akşam üç ayağı var. Nedir?", a: "İnsan." },
  { q: "Kanadı yok uçar, ağzı yok konuşur. Nedir?", a: "Mektup." },
  { q: "Altı daire, üstü daire, ortası kare. Nedir?", a: "Yüzük." },
];

const MOOD = { happy: "happy", surprised: "surprised", sad: "sad" };

export function mount(doc, hooks = {}) {
  const store = createStore();
  let settings = loadSettings();
  let devices = createDemoDevices();
  let messages = [];
  let assistant = null;
  let notes = "";
  let mood = "";
  let riddle = 0;
  let soundOn = true;
  const avatar = createAvatar(doc.querySelector("#avatar"));
  const voice = createVoice({
    getSettings: () => settings,
    onViseme: (shape) => avatar.setViseme(shape),
    onSpeakStart: () => hooks.onSpeaking?.(true),
    onSpeakEnd: () => hooks.onSpeaking?.(false),
  });

  const session = createConversation({
    getSettings: () => settings,
    getHistory: () => messages,
    getMemories: () => store.memories(),
    research,
    onResearch(text) {
      notes = text;
    },
    onState: paintState,
    onStatus: (text) => toast(text),
    onLevel: (rms) => {
      avatar.setLevel(rms);
      doc.documentElement.style.setProperty("--level", String(Math.min(1, rms * 4)));
    },
    onAudio: (level) => avatar.setAudio(level),
    onUser: addUser,
    onAssistant: addAssistant,
    onMemories: async (facts) => {
      for (const fact of facts) await store.addMemory(fact);
      toast("Bunu hatırlayacağım.");
      renderMemories();
    },
    onHome: async (intent) => {
      let assistantClient = null;
      if (settings.homeEnabled && settings.haUrl && settings.haToken) {
        assistantClient = createHomeAssistant({ url: settings.haUrl, token: settings.haToken });
      }
      const result = await runHomeCommand({ intent, settings, devices, assistant: assistantClient });
      devices = result.devices;
      paintDevices();
      return result;
    },
    speakFallback: (text, style) => {
      if (!soundOn) return;
      voice.speak(text, style);
    },
  });

  function toast(text) {
    if (!text) return;
    const node = doc.createElement("p");
    node.className = "toast";
    node.textContent = text;
    doc.querySelector("#toasts").append(node);
    setTimeout(() => node.remove(), 4200);
  }

  function paintState(state) {
    const pill = doc.querySelector("#pill");
    const [title, sub] = PILL[state] || PILL.idle;
    pill.dataset.state = state;
    doc.querySelector("#pill-title").textContent = title;
    doc.querySelector("#pill-sub").textContent = state === "idle" && mood === "happy" ? "Bu hoşuma gitti." : sub;
    avatar.setMode(state === "listen" || state === "think" || state === "speak" ? state : "idle");
    if (mood) avatar.setEmotion(mood);
    hooks.onSpeaking?.(state === "speak");
    const mic = doc.querySelector("#mic");
    const live = session.active();
    mic.classList.toggle("on", live);
    mic.textContent = live ? "Durdur" : "Konuşmayı başlat";
  }

  function addUser(text, meta = {}) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const last = messages.at(-1);
    if (last?.role === "user" && last.partial) {
      last.text = clean;
      last.partial = Boolean(meta.partial);
      if (!last.partial) store.addMessage({ ...last, partial: false });
    } else {
      const row = { id: crypto.randomUUID(), role: "user", text: clean, at: Date.now(), partial: Boolean(meta.partial) };
      messages.push(row);
      if (!row.partial) store.addMessage(row);
    }
    assistant = null;
    renderTranscript();
  }

  function addAssistant(text, meta = {}) {
    const parsed = sanitizeFinal(text);
    const clean = parsed.spoken;
    const feeling = emotionFromText(text) || parsed.emotion || "";
    if (feeling && feeling !== "neutral") {
      mood = feeling;
      avatar.setEmotion(feeling);
    }
    if (!clean) return;
    if (!assistant || !assistant.pending) {
      assistant = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: clean,
        pending: Boolean(meta.pending),
        at: Date.now(),
      };
      messages.push(assistant);
    } else {
      assistant.text = clean;
      assistant.pending = Boolean(meta.pending);
    }
    if (meta.emotion) {
      mood = meta.emotion;
      avatar.setEmotion(meta.emotion);
    }
    if (!meta.pending) {
      assistant.pending = false;
      if (notes) assistant.sources = sourceLabels(notes);
      store.addMessage({ ...assistant });
      notes = "";
      assistant = null;
    }
    renderTranscript();
    if (mood === "happy" || mood === "surprised") avatar.setMode(mood);
  }

  function renderTranscript() {
    const root = doc.querySelector("#transcript");
    root.replaceChildren(...messages.slice(-40).map((entry) => {
      const node = doc.createElement("p");
      node.className = `bubble ${entry.role}${entry.pending ? " pending" : ""}`;
      node.textContent = entry.text;
      if (entry.sources?.length) {
        const source = doc.createElement("small");
        source.textContent = `Kaynak: ${entry.sources.join(", ")}`;
        node.append(doc.createElement("br"), source);
      }
      return node;
    }));
    root.scrollTop = root.scrollHeight;
  }

  async function renderMemories() {
    const list = doc.querySelector("#memory-list");
    const rows = await store.memories();
    list.replaceChildren(...rows.map((row) => {
      const item = doc.createElement("li");
      item.textContent = row.text;
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = "Sil";
      button.addEventListener("click", async () => {
        await store.deleteMemory(row.id);
        renderMemories();
      });
      item.append(button);
      return item;
    }));
    if (!rows.length) {
      const item = doc.createElement("li");
      item.textContent = "Henüz bir anı yok. “Bunu hatırla” diyebilirsin.";
      list.append(item);
    }
  }

  function paintDevices() {
    const on = (domain) => devices.some((item) => item.domain === domain && item.state === "on");
    for (const button of doc.querySelectorAll("[data-tile]")) {
      const tile = button.dataset.tile;
      const active = tile === "lights" ? on("light")
        : tile === "climate" ? on("climate")
          : tile === "tv" ? on("media_player")
            : tile === "music" ? on("music")
              : tile === "security" ? on("security")
                : false;
      button.classList.toggle("on", active);
    }
    const list = doc.querySelector("#device-list");
    list.replaceChildren(...devices.map((device) => {
      const item = doc.createElement("li");
      item.textContent = `${device.name}: ${deviceLabel(device)}`;
      return item;
    }));
  }

  function toggleTile(tile) {
    const flip = (device) => ({ ...device, state: device.state === "on" ? "off" : "on" });
    if (tile === "lights") devices = devices.map((device) => device.domain === "light" ? flip(device) : device);
    if (tile === "climate") devices = devices.map((device) => device.domain === "climate" ? flip(device) : device);
    if (tile === "tv") devices = devices.map((device) => device.domain === "media_player" ? flip(device) : device);
    if (tile === "music") devices = devices.map((device) => device.domain === "music" ? flip(device) : device);
    if (tile === "security") devices = devices.map((device) => device.domain === "security" ? flip(device) : device);
    paintDevices();
    const names = { lights: "Işıklar", climate: "Klima", tv: "Televizyon", music: "Müzik", security: "Güvenlik" };
    toast(`${names[tile]} ${devices.some((item) => item.state === "on" && (
      (tile === "lights" && item.domain === "light")
      || (tile === "climate" && item.domain === "climate")
      || (tile === "tv" && item.domain === "media_player")
      || (tile === "music" && item.domain === "music")
      || (tile === "security" && item.domain === "security")
    )) ? "açık" : "kapalı"}.`);
  }

  function openSheet(id) {
    for (const sheet of doc.querySelectorAll(".sheet")) sheet.hidden = sheet.id !== id;
    doc.querySelectorAll(".rail button").forEach((button) => {
      button.classList.toggle("on", button.dataset.panel === id.replace("sheet-", ""));
    });
  }

  function closeSheets() {
    for (const sheet of doc.querySelectorAll(".sheet")) sheet.hidden = true;
    doc.querySelectorAll(".rail button").forEach((button) => button.classList.toggle("on", button.dataset.panel === "home"));
  }

  function showRiddle() {
    const item = RIDDLES[riddle % RIDDLES.length];
    doc.querySelector("#riddle").textContent = item.q;
  }

  async function loadWeather() {
    let place = KOCAELI;
    try {
      const position = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) reject(new Error("konum yok"));
        else navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 4000, maximumAge: 900000 });
      });
      let name = "Buradasın";
      try {
        const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${position.coords.latitude}&longitude=${position.coords.longitude}&language=tr&count=1`);
        const data = await geo.json();
        name = data.results?.[0]?.name || name;
      } catch {
        name = "Buradasın";
      }
      place = { latitude: position.coords.latitude, longitude: position.coords.longitude, name };
    } catch {
      place = KOCAELI;
    }
    try {
      const forecast = await localForecast(place);
      if (!forecast) return;
      doc.querySelector("#weather-city").textContent = forecast.name;
      doc.querySelector("#weather-temp").textContent = `${forecast.temp}°`;
      doc.querySelector("#weather-sky").textContent = forecast.sky;
    } catch {
      doc.querySelector("#weather-sky").textContent = "hava alınamadı";
    }
  }

  function tickClock() {
    const now = new Date();
    doc.querySelector("#clock-time").textContent = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    doc.querySelector("#clock-date").textContent = now.toLocaleDateString("tr-TR", { weekday: "short", day: "numeric", month: "short" });
  }

  function showGate() {
    doc.querySelector("#gate").hidden = Boolean(settings.geminiKey || settings.geminiSkipped);
  }

  doc.querySelector("#gate-save").addEventListener("click", () => {
    const key = doc.querySelector("#gate-key").value.trim();
    if (!key) {
      toast("Anahtarı yapıştır, sonra kaydet.");
      return;
    }
    settings = { ...settings, geminiKey: key, geminiSkipped: false };
    saveSettings(settings);
    doc.querySelector("#gate-key").value = "";
    showGate();
    toast("Anahtar bu telefonda kaldı. Konuşmayı başlatabilirsin.");
  });
  doc.querySelector("#gate-skip").addEventListener("click", () => {
    settings = { ...settings, geminiSkipped: true };
    saveSettings(settings);
    showGate();
    toast("Anahtarsız yedek hat açık. Ses, cihazın kendi sesi olur.");
  });

  doc.querySelector("#btn-menu").addEventListener("click", () => {
    doc.querySelector(".phone").classList.toggle("menu");
    closeSheets();
  });
  doc.querySelector("#btn-bell").addEventListener("click", () => toast("Şu an yeni bildirim yok."));
  doc.querySelector("#btn-power").addEventListener("click", () => {
    session.stop();
    voice.stopSpeaking();
    paintState("idle");
    toast("ERO uyudu.");
  });
  doc.querySelector("#mic").addEventListener("click", async () => {
    voice.unlock();
    if (session.active()) {
      session.stop();
      paintState("idle");
      return;
    }
    const ok = await session.start();
    if (!ok) paintState("idle");
  });
  doc.querySelector("#btn-key").addEventListener("click", () => {
    openSheet("sheet-chat");
    doc.querySelector("#prompt").focus();
  });
  doc.querySelector("#btn-wave").addEventListener("click", () => {
    soundOn = !soundOn;
    session.setMuted(!soundOn);
    doc.body.classList.toggle("wave-off", !soundOn);
    doc.querySelector("#btn-wave").setAttribute("aria-pressed", soundOn ? "true" : "false");
    toast(soundOn ? "Ses açık." : "Ses kapalı. ERO yazmaya devam eder.");
  });

  doc.querySelector("#composer").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = doc.querySelector("#prompt");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    voice.unlock();
    session.ask(text);
  });
  doc.querySelector("#memory-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = doc.querySelector("#memory-input");
    const text = input.value.trim();
    if (!text) return;
    await store.addMemory(text);
    input.value = "";
    renderMemories();
  });
  doc.querySelector("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    settings = {
      ...settings,
      geminiKey: doc.querySelector("#set-gemini").value.trim(),
      geminiSkipped: !doc.querySelector("#set-gemini").value.trim() && settings.geminiSkipped,
      wakeWord: doc.querySelector("#set-wake").checked,
      homeEnabled: doc.querySelector("#set-home").checked,
      homeDemo: true,
      haUrl: doc.querySelector("#set-ha").value.trim(),
      haToken: doc.querySelector("#set-token").value.trim(),
    };
    saveSettings(settings);
    showGate();
    toast("Ayarlar bu cihazda duruyor.");
    closeSheets();
  });
  doc.querySelector("#ha-test").addEventListener("click", async () => {
    try {
      await createHomeAssistant({
        url: doc.querySelector("#set-ha").value.trim(),
        token: doc.querySelector("#set-token").value.trim(),
      }).test();
      toast("Home Assistant yanıt verdi.");
    } catch (error) {
      toast(error.message);
    }
  });
  doc.querySelector("#clear-chat").addEventListener("click", async () => {
    messages = [];
    assistant = null;
    await store.clearMessages();
    renderTranscript();
    toast("Sohbet silindi.");
  });

  for (const button of doc.querySelectorAll("[data-close]")) {
    button.addEventListener("click", closeSheets);
  }
  for (const button of doc.querySelectorAll(".rail button")) {
    button.addEventListener("click", () => {
      const panel = button.dataset.panel;
      if (panel === "home") {
        closeSheets();
        return;
      }
      if (panel === "games") showRiddle();
      if (panel === "layers") renderMemories();
      openSheet(`sheet-${panel}`);
    });
  }
  doc.querySelector("#riddle-next").addEventListener("click", () => {
    riddle += 1;
    showRiddle();
  });
  for (const button of doc.querySelectorAll("[data-tile]")) {
    button.addEventListener("click", () => {
      if (button.dataset.tile === "add") {
        openSheet("sheet-house");
        return;
      }
      toggleTile(button.dataset.tile);
    });
  }

  let installEvent = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event;
    doc.querySelector("#install").hidden = false;
  });
  doc.querySelector("#install-go").addEventListener("click", async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    doc.querySelector("#install").hidden = true;
    installEvent = null;
  });
  doc.querySelector("#install-hide").addEventListener("click", () => {
    doc.querySelector("#install").hidden = true;
  });
  doc.addEventListener("pointerdown", () => voice.unlock(), { once: true });

  doc.querySelector("#set-gemini").value = settings.geminiKey || "";
  doc.querySelector("#set-wake").checked = Boolean(settings.wakeWord);
  doc.querySelector("#set-home").checked = Boolean(settings.homeEnabled);
  doc.querySelector("#set-ha").value = settings.haUrl || "";
  doc.querySelector("#set-token").value = settings.haToken || "";
  doc.querySelector("#build-line").textContent = `Sürüm ${__ERO_BUILD__}`;
  showGate();
  showRiddle();
  paintDevices();
  paintState("idle");
  tickClock();
  setInterval(tickClock, 1000);
  loadWeather();
  store.messages().then((rows) => {
    messages = rows.filter((row) => row.role === "user" || row.role === "assistant");
    renderTranscript();
  });
  renderMemories();

  return { toast, avatar, session };
}

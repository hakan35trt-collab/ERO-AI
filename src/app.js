import { createFace } from "./face.js";
import { createVoice, isEcho } from "./voice.js";
import { buildMessages, streamChat } from "./llm.js";
import { createStore, loadSettings, saveSettings } from "./memory.js";
import { research, sourceLabels } from "./search.js";
import {
  createDemoDevices,
  createHomeAssistant,
  deviceLabel,
  parseHomeIntent,
  runHomeCommand,
  tuyaAdapter,
} from "./smarthome.js";
import {
  detectDelivery,
  explicitMemories,
  extractWake,
  forSpeech,
  guessEmotion,
  needsResearch,
  sanitizeFinal,
  StreamCleaner,
  takeSpeakable,
} from "./text.js";

const STATUS = {
  idle: "Bekliyor",
  listen: "Dinliyor",
  think: "Düşünüyor",
  speak: "Konuşuyor",
  happy: "Mutlu",
  surprised: "Şaşırmış",
  sad: "Üzgün",
  curious: "Meraklı",
};

const FORCED = {
  bekliyor: "idle",
  idle: "idle",
  dinliyor: "listen",
  listen: "listen",
  düşünüyor: "think",
  dusunuyor: "think",
  think: "think",
  konuşuyor: "speak",
  konusuyor: "speak",
  speak: "speak",
  mutlu: "happy",
  happy: "happy",
  şaşırmış: "surprised",
  sasirmis: "surprised",
  surprised: "surprised",
  üzgün: "sad",
  uzgun: "sad",
  sad: "sad",
  meraklı: "curious",
  merakli: "curious",
  curious: "curious",
};

export function mount(doc, hooks = {}) {
  const $ = (id) => doc.getElementById(id);
  const face = createFace($("face"));
  const store = createStore();
  let settings = loadSettings();
  let messages = [];
  let devices = createDemoDevices();
  let activity = "idle";
  let emotion = "neutral";
  let emotionUntil = 0;
  let lockedMode = "";
  let pushActive = false;
  let followUntil = 0;
  let silenceTimer = 0;
  let chatAbort = null;
  let turn = 0;
  let allowEmotion = true;
  let pendingEmotion = "neutral";
  let lastProvider = "";
  let ha = null;

  const voice = createVoice({
    getSettings: () => settings,
    onInterim: (text) => {
      if (doc.activeElement === $("text") && $("text").dataset.dictated !== "1" && $("text").value.trim()) return;
      $("text").dataset.dictated = "1";
      $("text").value = mergeTranscript($("text").value, text);
      armSilence();
    },
    onFinal: (text) => heard(text),
    onVolume: (value) => face.setVolume(value),
    onViseme: (value) => face.setViseme(value),
    onSpeakStart: () => {
      activity = "speak";
      syncFace();
    },
    onSpeakEnd: () => {
      if (activity === "speak") activity = "idle";
      if (allowEmotion && pendingEmotion !== "neutral") emotionUntil = Date.now() + 4200;
      syncFace();
    },
    onError: (error) => {
      if (error.code === "not-allowed") toast(error.message);
      else if (error.code !== "unsupported") $("substatus").textContent = error.message;
    },
  });

  const params = new URLSearchParams(location.search);
  const forced = FORCED[(params.get("ifade") || "").toLocaleLowerCase("tr-TR")];
  if (forced) {
    lockedMode = forced;
    face.lockMode(forced);
    $("status").textContent = STATUS[forced];
  }

  function toast(text) {
    const el = doc.createElement("div");
    el.className = "toast";
    el.textContent = text;
    $("toasts").append(el);
    setTimeout(() => el.remove(), 3400);
  }

  function toastAsk(text, onYes) {
    const el = doc.createElement("div");
    el.className = "toast ask";
    const p = doc.createElement("p");
    p.textContent = text;
    const yes = doc.createElement("button");
    yes.type = "button";
    yes.textContent = "Evet";
    const no = doc.createElement("button");
    no.type = "button";
    no.textContent = "Şimdi değil";
    yes.addEventListener("click", () => {
      el.remove();
      onYes();
    });
    no.addEventListener("click", () => el.remove());
    el.append(p, yes, no);
    $("toasts").append(el);
  }

  function emotionMode() {
    if (Date.now() >= emotionUntil) return "idle";
    if (emotion === "happy") return "happy";
    if (emotion === "surprised") return "surprised";
    if (emotion === "sad") return "sad";
    if (emotion === "curious") return "curious";
    return "idle";
  }

  function syncFace() {
    hooks.onSpeaking?.(voice.isSpeaking());
    paintMic();
    if (lockedMode) {
      $("status").textContent = STATUS[lockedMode];
      return;
    }
    const mode = voice.isSpeaking() ? "speak" : activity === "listen" ? "listen" : activity === "think" ? "think" : emotionMode();
    face.setMode(mode);
    $("status").textContent = STATUS[mode];
  }

  function paintMic() {
    const speaking = voice.isSpeaking();
    const listening = voice.listening() && (pushActive || settings.handsFree);
    $("mic").classList.toggle("live", listening && !speaking);
    $("mic").classList.toggle("stop", speaking);
    $("mic-label").textContent = speaking ? "Kes" : listening && pushActive ? "Dinliyor" : "Konuş";
    $("mic").setAttribute("aria-label", speaking ? "ERO'yu durdur" : "Mikrofon");
  }

  function interrupt() {
    allowEmotion = false;
    pendingEmotion = "neutral";
    chatAbort?.abort();
    voice.stopSpeaking();
    if (activity === "speak" || activity === "think") activity = "idle";
    syncFace();
  }

  function armSilence() {
    clearTimeout(silenceTimer);
    if (!pushActive) return;
    silenceTimer = setTimeout(() => {
      const text = $("text").value.trim();
      if (!pushActive || !text) return;
      endListen();
      submit(text);
    }, 1300);
  }

  async function beginListen(push) {
    voice.unlock();
    pushActive = push;
    const ok = await voice.start({ handsFree: settings.handsFree || push });
    activity = "listen";
    $("substatus").textContent = settings.handsFree && !push ? "Eller serbest. ERO diyebilirsin." : "Dinliyorum…";
    syncFace();
    if (!ok) {
      $("support").hidden = false;
      $("support").textContent = "Bu tarayıcı sesi metne çeviremiyor. Chrome veya Android'de mikrofon çalışır; yazarak da konuşabiliriz.";
    }
  }

  function endListen() {
    pushActive = false;
    clearTimeout(silenceTimer);
    if (!settings.handsFree) {
      voice.stop();
      if (activity === "listen") activity = "idle";
    }
    syncFace();
  }

  function heard(text) {
    if (voice.isSpeaking()) {
      if (isEcho(text, voice.lastSpoken())) return;
      interrupt();
    }
    if (settings.handsFree && !pushActive) {
      const wake = extractWake(text);
      const follow = Date.now() < followUntil;
      if (!wake.wake && !follow) return;
      const query = wake.wake ? wake.rest : text;
      if (!query) {
        followUntil = Date.now() + 8000;
        allowEmotion = true;
        pendingEmotion = "curious";
        voice.speak("Efendim?", "chat");
        $("substatus").textContent = "Evet, dinliyorum.";
        return;
      }
      followUntil = 0;
      submit(query);
      return;
    }
    $("text").dataset.dictated = "1";
    $("text").value = mergeTranscript($("text").value, text);
    armSilence();
  }

  function render() {
    const box = $("transcript");
    box.innerHTML = "";
    if (!messages.length) {
      const empty = doc.createElement("p");
      empty.className = "empty";
      empty.textContent = "Merhaba, ben ERO. Bir şey sor, bir şiir iste ya da sadece sohbet edelim.";
      box.append(empty);
      return;
    }
    for (const message of messages) {
      const article = doc.createElement("article");
      article.className = `bubble ${message.role}${message.pending ? " pending" : ""}`;
      article.dataset.id = message.id;
      if (message.via) article.dataset.provider = message.via;
      const body = doc.createElement("p");
      body.className = "body";
      body.textContent = message.text || "…";
      article.append(body);
      if (message.source) {
        const source = doc.createElement("p");
        source.className = "source";
        source.textContent = message.source;
        article.append(source);
      }
      if (message.retry) {
        const retry = doc.createElement("button");
        retry.type = "button";
        retry.textContent = "Yeniden dene";
        retry.addEventListener("click", () => submit(message.retry));
        article.append(retry);
      }
      box.append(article);
    }
    box.scrollTop = box.scrollHeight;
  }

  function setBubbleText(bubble, text) {
    bubble.text = text;
    const node = $("transcript").querySelector(`[data-id="${bubble.id}"] .body`);
    if (node) node.textContent = text || "…";
    else render();
    $("transcript").scrollTop = $("transcript").scrollHeight;
  }

  async function persist(message) {
    await store.addMessage({
      id: message.id,
      role: message.role,
      text: message.text,
      at: message.at,
      source: message.source || "",
      via: message.via || "",
    });
    await store.trimMessages(200);
  }

  async function remember(fact, quiet) {
    const existing = await store.memories();
    const key = fact.toLocaleLowerCase("tr-TR");
    if (existing.some((item) => item.text.toLocaleLowerCase("tr-TR") === key)) return;
    await store.addMemory(fact);
    if (!quiet) toast("Hatırladım.");
    renderMemories();
  }

  async function renderMemories() {
    const list = $("memory-list");
    const rows = await store.memories();
    list.innerHTML = "";
    if (!rows.length) {
      const empty = doc.createElement("p");
      empty.className = "hint";
      empty.textContent = "Henüz bir anı yok. Sohbette “bunu hatırla” diyebilirsin.";
      list.append(empty);
      return;
    }
    for (const row of rows) {
      const item = doc.createElement("div");
      item.className = "memory-item";
      const text = doc.createElement("span");
      text.textContent = row.text;
      const del = doc.createElement("button");
      del.type = "button";
      del.textContent = "Sil";
      del.addEventListener("click", async () => {
        await store.deleteMemory(row.id);
        renderMemories();
      });
      item.append(text, del);
      list.append(item);
    }
  }

  function renderDevices() {
    const box = $("devices");
    box.innerHTML = "";
    if (settings.homeDemo) $("home-note").textContent = "Simülasyon açık. Komutlar ve düğmeler bu cihazları değiştirir.";
    else if (settings.homeEnabled && settings.homeAdapter === "tuya") $("home-note").textContent = "Tuya bağdaştırıcısı hazır, henüz bağlı değil.";
    else if (homeReady()) $("home-note").textContent = "Home Assistant bağlantısı açık.";
    else $("home-note").textContent = "Modül kapalı. Ayarlardan simülasyonu veya Home Assistant’ı açabilirsin.";
    for (const device of devices) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = `device ${device.state === "on" || device.state === "open" ? "on" : ""}`;
      const copy = doc.createElement("span");
      const name = doc.createElement("strong");
      name.textContent = device.name;
      const state = doc.createElement("small");
      state.textContent = ` ${deviceLabel(device)}`;
      copy.append(name, state);
      button.append(copy);
      if (device.domain === "climate") {
        const temp = doc.createElement("span");
        temp.className = "temp";
        for (const step of [-1, 1]) {
          const knob = doc.createElement("button");
          knob.type = "button";
          knob.textContent = step < 0 ? "−" : "+";
          knob.addEventListener("click", (event) => {
            event.stopPropagation();
            changeTemp(device, step);
          });
          temp.append(knob);
        }
        button.append(temp);
      }
      button.addEventListener("click", () => toggleDevice(device));
      box.append(button);
    }
  }

  function homeReady() {
    return Boolean(settings.homeEnabled && settings.homeAdapter === "homeassistant" && settings.haUrl && settings.haToken);
  }

  function ensureHa() {
    if (!homeReady()) return null;
    if (!ha) {
      ha = createHomeAssistant({
        url: settings.haUrl,
        token: settings.haToken,
        onState: () => refreshHome(),
      });
      ha.connect();
    }
    return ha;
  }

  async function refreshHome() {
    if (homeReady()) {
      try {
        devices = await ensureHa().listDevices();
      } catch (error) {
        $("home-note").textContent = error.message;
      }
    } else if (!settings.homeDemo) {
      devices = createDemoDevices();
    }
    renderDevices();
  }

  async function toggleDevice(device) {
    if (!settings.homeDemo && !homeReady()) {
      toast("Simülasyon veya bağlantı kapalı.");
      return;
    }
    if (settings.homeDemo && !homeReady()) {
      devices = devices.map((item) => {
        if (item.id !== device.id) return item;
        if (item.domain === "cover") {
          const position = item.position > 0 ? 0 : 100;
          return { ...item, position, state: position ? "open" : "closed" };
        }
        const on = item.state === "on" || item.state === "open";
        return { ...item, state: on ? "off" : "on" };
      });
      renderDevices();
      return;
    }
    const open = device.state === "on" || device.state === "open";
    const service = device.domain === "cover" ? (open ? "close_cover" : "open_cover") : open ? "turn_off" : "turn_on";
    try {
      await ensureHa().call(device.domain, service, { entity_id: device.id });
      await refreshHome();
    } catch (error) {
      toast(error.message);
    }
  }

  async function changeTemp(device, step) {
    const temperature = Math.max(16, Math.min(32, (device.temperature || 24) + step));
    if (settings.homeDemo && !homeReady()) {
      devices = devices.map((item) => (item.id === device.id ? { ...item, temperature, state: "on" } : item));
      renderDevices();
      return;
    }
    if (!homeReady()) {
      toast("Simülasyon veya bağlantı kapalı.");
      return;
    }
    try {
      await ensureHa().call("climate", "set_temperature", { entity_id: device.id, temperature });
      await refreshHome();
    } catch (error) {
      toast(error.message);
    }
  }

  function speakLocal(text, mood = "neutral") {
    const message = {
      id: crypto.randomUUID(),
      role: "assistant",
      text,
      at: Date.now(),
    };
    messages.push(message);
    render();
    persist(message);
    allowEmotion = true;
    pendingEmotion = mood;
    emotion = mood;
    voice.speak(text, "chat");
  }

  async function submit(raw) {
    const text = String(raw || "").trim();
    if (!text) return;
    turn += 1;
    const token = turn;
    if (lockedMode) {
      lockedMode = "";
      face.unlock();
    }
    voice.unlock();
    interrupt();
    allowEmotion = true;
    $("text").value = "";
    delete $("text").dataset.dictated;
    const user = { id: crypto.randomUUID(), role: "user", text, at: Date.now() };
    messages.push(user);
    render();
    persist(user);

    const memory = explicitMemories(text);
    for (const fact of memory.facts) await remember(fact, true);
    if (token !== turn) return;
    let conversational = memory.facts.length ? memory.remainder : text;
    if (memory.facts.length && !conversational) {
      speakLocal(memory.facts.length === 1 ? `Tamam, şunu hatırlayacağım: ${memory.facts[0]}` : "Tamam, bunları hatırlayacağım.", "happy");
      return;
    }
    if (memory.facts.length) toast("Bunu hatırladım.");

    const intent = parseHomeIntent(conversational);
    if (intent.matched) {
      try {
        const result = await runHomeCommand({
          intent,
          settings,
          devices,
          assistant: ensureHa(),
        });
        devices = result.devices?.length ? result.devices : devices;
        if (result.demo || result.live) $("home-panel").hidden = false;
        renderDevices();
        speakLocal(result.confirm, result.ok === false ? "sad" : "happy");
      } catch (error) {
        speakLocal(`Akıllı ev komutu ulaşmadı. ${error.message}`, "sad");
      }
      if (!intent.remainder || token !== turn) return;
      conversational = intent.remainder;
    }

    if (!navigator.onLine) {
      speakLocal("Çevrimdışıyım. Bağlantı gelince yeniden dener misin?", "sad");
      return;
    }

    activity = "think";
    $("substatus").textContent = "Düşünüyorum…";
    syncFace();
    let notes = "";
    if (needsResearch(conversational)) {
      $("substatus").textContent = "Bakınıyorum…";
      notes = await research(conversational);
    }
    if (token !== turn) return;
    const memories = (await store.memories()).map((item) => item.text);
    const history = messages.filter((item) => !item.pending && item.role !== "error");
    const payload = buildMessages({ history, memories, notes });
    const cleaner = new StreamCleaner();
    const style = detectDelivery(conversational);
    let acc = "";
    let buf = "";
    const sayReady = (flush) => {
      const taken = takeSpeakable(buf, { flush });
      buf = taken.rest;
      for (const sentence of taken.sentences) {
        const clean = forSpeech(sentence);
        if (!clean || token !== turn) continue;
        allowEmotion = true;
        activity = "speak";
        syncFace();
        voice.speak(clean, style);
      }
    };
    const bubble = { id: crypto.randomUUID(), role: "assistant", text: "", at: Date.now(), pending: true };
    messages.push(bubble);
    render();
    chatAbort = new AbortController();
    const signal = chatAbort.signal;
    try {
      const provider = await streamChat({
        messages: payload,
        settings,
        signal,
        onStatus: (label) => {
          if (token === turn) $("substatus").textContent = label;
        },
        onDelta: (delta) => {
          if (token !== turn) return;
          const visible = cleaner.push(delta);
          if (!visible) return;
          acc += visible;
          buf += visible;
          setBubbleText(bubble, acc);
          sayReady(false);
        },
      });
      if (token !== turn) return;
      const fin = cleaner.finish();
      if (fin.rest) {
        acc += fin.rest;
        buf += fin.rest;
      }
      const cleaned = sanitizeFinal(acc);
      acc = cleaned.spoken.trim();
      if (!acc) throw new Error("Yanıt boş geldi.");
      setBubbleText(bubble, acc);
      sayReady(true);
      pendingEmotion = fin.emotion || cleaned.emotion || guessEmotion(acc);
      emotion = pendingEmotion;
      lastProvider = provider?.label || "";
      const sources = sourceLabels(notes);
      bubble.pending = false;
      bubble.text = acc;
      bubble.via = lastProvider;
      bubble.source = sources.length ? `Kaynak: ${sources.join(", ")}` : "";
      render();
      persist(bubble);
      $("substatus").textContent = settings.handsFree ? "Eller serbest açık" : "";
      for (const fact of [...fin.memories, ...cleaned.memories]) {
        toastAsk(`Şunu hatırlamamı ister misin? ${fact}`, () => remember(fact));
      }
    } catch (error) {
      if (token !== turn) {
        if (bubble.pending && !bubble.text.trim()) messages = messages.filter((item) => item !== bubble);
        else bubble.pending = false;
        render();
        return;
      }
      if (error?.name === "AbortError") {
        if (bubble.text.trim()) {
          bubble.pending = false;
          persist(bubble);
        } else messages = messages.filter((item) => item !== bubble);
        render();
        return;
      }
      const apology = "Şu an modele ulaşamadım. Biraz sonra yeniden dene; yazışma duruyor.";
      if (bubble.text.trim()) {
        bubble.pending = false;
        bubble.text = `${sanitizeFinal(bubble.text).spoken}\n\nYanıt yarım kaldı.`;
        persist(bubble);
      } else {
        messages = messages.filter((item) => item !== bubble);
        messages.push({
          id: crypto.randomUUID(),
          role: "error",
          text: apology,
          at: Date.now(),
          retry: text,
        });
      }
      render();
      activity = "idle";
      emotion = "sad";
      emotionUntil = Date.now() + 3000;
      $("substatus").textContent = "Bağlantı kurulamadı.";
      syncFace();
    }
  }

  function fillSettings() {
    $("opt-hands").checked = settings.handsFree;
    $("opt-rate").value = settings.rate;
    $("opt-pitch").value = settings.pitch;
    $("opt-base").value = settings.customBase;
    $("opt-model").value = settings.customModel;
    $("opt-key").value = settings.customKey;
    $("opt-home").checked = settings.homeEnabled;
    $("opt-demo").checked = settings.homeDemo;
    $("opt-adapter").value = settings.homeAdapter;
    $("opt-ha-url").value = settings.haUrl;
    $("opt-ha-token").value = settings.haToken;
    fillVoices();
  }

  function fillVoices() {
    const select = $("opt-voice");
    const list = voice.voices();
    const current = select.value || settings.voiceURI;
    select.innerHTML = "";
    if (!list.length) {
      const option = doc.createElement("option");
      option.textContent = "Ses listesi henüz gelmedi";
      select.append(option);
      return;
    }
    for (const item of list) {
      const option = doc.createElement("option");
      option.value = item.voiceURI;
      option.textContent = `${item.name} (${item.lang || "?"})`;
      select.append(option);
    }
    const turkish = list.some((item) => String(item.lang || "").toLowerCase().startsWith("tr"));
    $("voice-note").textContent = turkish
      ? "Türkçe ses seçiliyse ERO onunla konuşur."
      : "Bu cihazda Türkçe ses görünmüyor. ERO yine de konuşmayı dener; Chrome ve Android’de seçenekler artar.";
    if (current && [...select.options].some((option) => option.value === current)) select.value = current;
    else if (list[0]) select.value = list[0].voiceURI;
  }

  function readSettings() {
    const previous = `${settings.haUrl}|${settings.haToken}`;
    settings = {
      ...settings,
      handsFree: $("opt-hands").checked,
      rate: Number($("opt-rate").value),
      pitch: Number($("opt-pitch").value),
      voiceURI: $("opt-voice").value || "",
      customBase: $("opt-base").value.trim(),
      customModel: $("opt-model").value.trim(),
      customKey: $("opt-key").value.trim(),
      homeEnabled: $("opt-home").checked,
      homeDemo: $("opt-demo").checked,
      homeAdapter: $("opt-adapter").value,
      haUrl: $("opt-ha-url").value.trim(),
      haToken: $("opt-ha-token").value.trim(),
    };
    saveSettings(settings);
    if (`${settings.haUrl}|${settings.haToken}` !== previous) {
      ha?.close();
      ha = null;
    }
    if (settings.handsFree && !voice.listening()) beginListen(false);
    if (!settings.handsFree && voice.listening() && !pushActive) voice.stop();
    if (!settings.homeDemo && !homeReady()) devices = createDemoDevices();
    renderDevices();
    syncFace();
    $("substatus").textContent = settings.handsFree ? "Eller serbest açık" : $("substatus").textContent;
  }

  $("btn-settings").addEventListener("click", () => {
    fillSettings();
    renderMemories();
    $("settings").hidden = false;
  });
  $("btn-home").addEventListener("click", () => {
    $("home-panel").hidden = false;
    refreshHome();
  });
  doc.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      $(button.dataset.close).hidden = true;
    });
  });
  doc.querySelectorAll(".sheet").forEach((sheet) => {
    sheet.addEventListener("click", (event) => {
      if (event.target === sheet) sheet.hidden = true;
    });
  });
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      $("settings").hidden = true;
      $("home-panel").hidden = true;
    }
  });
  ["opt-hands", "opt-rate", "opt-pitch", "opt-voice", "opt-base", "opt-model", "opt-key", "opt-home", "opt-demo", "opt-adapter", "opt-ha-url", "opt-ha-token"].forEach((id) => {
    $(id).addEventListener("change", readSettings);
  });
  $("opt-ha-test").addEventListener("click", async () => {
    readSettings();
    try {
      if (settings.homeAdapter === "tuya") {
        await tuyaAdapter.test();
      } else {
        const client = createHomeAssistant({ url: settings.haUrl, token: settings.haToken });
        await client.test();
        $("ha-result").textContent = "Home Assistant yanıt verdi.";
        return;
      }
    } catch (error) {
      $("ha-result").textContent = error.message;
    }
  });
  $("memory-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = $("memory-text").value.trim();
    if (!value) return;
    await remember(value);
    $("memory-text").value = "";
  });
  $("memory-clear").addEventListener("click", async () => {
    await store.clearMemories();
    renderMemories();
  });
  $("clear-chat").addEventListener("click", async () => {
    await store.clearMessages();
    messages = [];
    render();
  });
  $("mic").addEventListener("click", async () => {
    voice.unlock();
    if (voice.isSpeaking()) {
      interrupt();
      await beginListen(true);
      return;
    }
    if (pushActive) {
      const text = $("text").value.trim();
      endListen();
      if (text) submit(text);
      return;
    }
    await beginListen(true);
  });
  $("stage").addEventListener("click", (event) => {
    if (event.target.closest("#mic")) return;
    if (voice.isSpeaking()) interrupt();
  });
  $("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("text").value.trim();
    endListen();
    submit(text);
  });

  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event;
    $("install").hidden = false;
  });
  $("install-go").addEventListener("click", async () => {
    $("install").hidden = true;
    if (!deferredInstall) return;
    deferredInstall.prompt();
    deferredInstall = null;
  });
  $("install-no").addEventListener("click", () => {
    $("install").hidden = true;
  });
  window.speechSynthesis?.addEventListener?.("voiceschanged", fillVoices);
  $("build").textContent = `ERO 1.0.0 · ${__ERO_BUILD__}`;

  if (!voice.supported()) {
    $("support").hidden = false;
    $("support").textContent = "Bu tarayıcı sesi metne çeviremiyor. Chrome veya Android'de mikrofon çalışır; yazarak da konuşabiliriz.";
  }

  store.messages().then((rows) => {
    messages = rows.filter((row) => row.role === "user" || row.role === "assistant" || row.role === "error");
    render();
  });
  fillSettings();
  renderDevices();
  syncFace();
  if (settings.handsFree) beginListen(false);

  return {
    toast,
    isSpeaking: () => voice.isSpeaking(),
    submit,
  };
}

function mergeTranscript(current, next) {
  const a = String(current || "").trim();
  const b = String(next || "").trim();
  if (!a) return b;
  if (!b) return a;
  if (b.startsWith(a) || a.startsWith(b)) return b.length >= a.length ? b : a;
  return `${a} ${b}`.trim();
}

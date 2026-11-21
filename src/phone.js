const ALIASES = {
  youtube: ["youtube"],
  ayarlar: ["settings", "ayarlar"],
  kamera: ["camera", "kamera"],
  whatsapp: ["whatsapp"],
  mesaj: ["messages", "messaging", "mesaj"],
  mesajlar: ["messages", "messaging", "mesaj"],
  telefon: ["phone", "dialer", "telefon"],
  harita: ["maps", "haritalar", "harita"],
  haritalar: ["maps", "haritalar"],
  chrome: ["chrome"],
  galeri: ["photos", "gallery", "galeri"],
  takvim: ["calendar", "takvim"],
  saat: ["clock", "saat"],
  hesap: ["calculator", "hesap"],
  muzik: ["music", "muzik", "youtube music"],
  spotify: ["spotify"],
};

const SENSITIVE = new Set(["call_contact", "send_sms", "whatsapp"]);
const DANGER = /(öde|odeme|satın al|satin al|sil\b|delete|kaldır|kaldir|uninstall|gönder|gonder|\bsend\b|transfer|satın|purchase|\bpay\b|onayla satın)/i;

let pending = null;
let armed = null;
let lastUser = "";

export function normalizeName(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreLabel(query, label) {
  const q = normalizeName(query);
  const l = normalizeName(label);
  if (!q || !l) return 0;
  if (q === l) return 100;
  const alias = ALIASES[q] || [];
  if (alias.some((item) => l === item || l.includes(item))) return 92;
  if (l.includes(q) || q.includes(l)) return 80;
  const qt = new Set(q.split(" "));
  const lt = new Set(l.split(" "));
  let shared = 0;
  for (const token of qt) if (lt.has(token)) shared += 1;
  if (shared) return 50 + shared * 10;
  return 0;
}

export function bestLabel(query, labels) {
  let best = null;
  for (const label of labels) {
    const score = scoreLabel(query, label);
    if (!best || score > best.score) best = { label, score };
  }
  return best && best.score >= 50 ? best : null;
}

export function youtubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(String(query || "").trim())}`;
}

export function youtubeWatchUrl(videoId) {
  const id = String(videoId || "").trim();
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return "";
  return `vnd.youtube:${id}`;
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function webSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(String(query || "").trim())}`;
}

export function compareVersions(left, right) {
  const parse = (value) => String(value || "").trim().replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function isYes(text) {
  const clean = normalizeName(text);
  return /^(evet|tamam|olur|onay|onayliyorum|onaylıyorum|ara|gonder|gönder|yap|hadi|kabul)\b/.test(clean);
}

export function isNo(text) {
  const clean = normalizeName(text);
  return /^(hayir|hayır|yok|iptal|vazgec|vazgeç|dur|yapma)\b/.test(clean);
}

function policyWantsConfirm(name) {
  if (!onAndroid()) return null;
  const id = name === "youtube_search" || name === "youtube_play" ? "youtube"
    : name === "remember" || name === "forget" ? "memory"
      : name;
  const data = nativeCall("policy", { name: id });
  return typeof data.confirm === "boolean" ? data.confirm : null;
}

export function needsSpokenYes(name, args = {}) {
  if (name === "send_sms" || name === "whatsapp") return true;
  if ((name === "tap" || name === "type_text") && DANGER.test(`${args.text || ""} ${args.query || ""}`)) return true;
  const policy = policyWantsConfirm(name);
  if (policy === true) return true;
  if (policy === false) return false;
  if (SENSITIVE.has(name)) return true;
  return false;
}

function confirmLine(name, args) {
  if (name === "call_contact") return `${args.name || "bu kişiyi"} aramamı onaylıyor musun?`;
  if (name === "send_sms") return `${args.name || "bu kişiye"} mesaj göndermemi onaylıyor musun?`;
  if (name === "whatsapp") return `${args.name || "bu kişiye"} WhatsApp yazmamı onaylıyor musun?`;
  if (name === "tap") return `“${args.text || "bu"}” yazısına basmamı onaylıyor musun?`;
  if (name === "type_text") return "Bu metni yazmamı onaylıyor musun?";
  return "Bunu yapmamı onaylıyor musun?";
}

export function noteUserText(text) {
  lastUser = String(text || "");
}

function nativeBridge() {
  const bridge = globalThis.EroNative;
  if (!bridge || typeof bridge.call !== "function") return null;
  return bridge;
}

export function onAndroid() {
  return Boolean(nativeBridge());
}

export function nativeCall(name, args = {}) {
  const bridge = nativeBridge();
  if (!bridge) return { ok: false, error: "Bu yalnız ERO telefon uygulamasında çalışır." };
  try {
    const raw = bridge.call(String(name), JSON.stringify(args || {}));
    const data = JSON.parse(raw || "{}");
    return data && typeof data === "object" ? data : { ok: false, error: "Köprü boş döndü." };
  } catch (error) {
    return { ok: false, error: error?.message || "Köprü yanıt vermedi." };
  }
}

async function execute(name, args) {
  if (name === "open_url") {
    const url = safeHttpUrl(args.url);
    if (!url) return { ok: false, error: "Yalnızca http ve https adresi açılır." };
    if (onAndroid()) return nativeCall("openUrl", { url });
    globalThis.open?.(url, "_blank", "noopener");
    return { ok: true, url };
  }
  if (name === "web_search") {
    const url = webSearchUrl(args.query || "");
    if (onAndroid()) return nativeCall("openUrl", { url });
    globalThis.open?.(url, "_blank", "noopener");
    return { ok: true, url };
  }
  if (name === "youtube_search") {
    const query = String(args.query || "").trim();
    if (!query) return { ok: false, error: "Ne arayacağımı söyle." };
    if (onAndroid()) return nativeCall("youtubeSearch", { query });
    const url = youtubeSearchUrl(query);
    globalThis.open?.(url, "_blank", "noopener");
    return { ok: true, url, mode: "search" };
  }
  if (name === "youtube_play") {
    const query = String(args.query || "").trim();
    if (!query) return { ok: false, error: "Hangi videoyu açayım?" };
    if (onAndroid()) return nativeCall("youtubePlay", { query });
    const url = youtubeSearchUrl(query);
    globalThis.open?.(url, "_blank", "noopener");
    return { ok: true, url, mode: "search" };
  }
  if (!onAndroid()) return { ok: false, error: "Bu yalnız ERO telefon uygulamasında çalışır." };
  const map = {
    open_app: ["openApp", { name: args.name }],
    set_alarm: ["setAlarm", { hour: Number(args.hour), minute: Number(args.minute), label: args.label || "" }],
    set_timer: ["setTimer", { seconds: Number(args.seconds), label: args.label || "" }],
    call_contact: ["callContact", { name: args.name }],
    send_sms: ["sendSms", { name: args.name, text: args.text, confirmed: true }],
    whatsapp: ["whatsapp", { name: args.name, text: args.text, confirmed: true }],
    flashlight: ["flashlight", { on: Boolean(args.on) }],
    volume: ["volume", { direction: args.direction || "up", level: args.level }],
    brightness: ["brightness", { level: args.level }],
    open_settings: ["openSettings", { panel: args.panel || "wifi" }],
    media: ["media", { action: args.action || "play" }],
    camera: ["camera", { action: args.action || "open" }],
    battery: ["battery", {}],
    notifications: ["notifications", {}],
    navigate: ["navigate", { query: args.query }],
    share: ["share", { text: args.text }],
    screen_read: ["screenText", {}],
    tap: ["tap", { text: args.text, confirmed: true }],
    scroll: ["scroll", { direction: args.direction || "down" }],
    type_text: ["typeText", { text: args.text, confirmed: true }],
    remember: ["remember", { text: args.text }],
    forget: ["forget", { text: args.text }],
    add_reminder: ["addReminder", { text: args.text }],
    nav_key: ["nav", { action: args.action || "back" }],
  };
  const pair = map[name];
  if (!pair) return { ok: false, error: "Bu aracı tanımıyorum." };
  const result = nativeCall(pair[0], pair[1]);
  if (result.ok && !result.say) {
    if (name === "open_app") result.say = `${result.label || args.name} açıldı.`;
    else if (name === "call_contact") result.say = "Arıyorum.";
    else if (name === "send_sms") result.say = "Mesaj gitti.";
    else if (name === "whatsapp") result.say = "WhatsApp açıldı.";
    else if (name === "battery" && result.level != null) result.say = `Pil yüzde ${result.level}.`;
    else result.say = "Tamam.";
  }
  return result;
}

export async function runTool(name, args = {}) {
  const now = Date.now();
  if (armed && armed.name === name && armed.until > now) {
    const result = armed.result;
    armed = null;
    return result;
  }
  if (needsSpokenYes(name, args)) {
    if (pending && pending.name === name && isYes(lastUser) && !isNo(lastUser)) {
      pending = null;
      const result = await execute(name, args);
      armed = { name, result, until: now + 8000 };
      return result;
    }
    pending = { name, args };
    return { ok: false, need_yes: true, say: confirmLine(name, args) };
  }
  return execute(name, args);
}

export async function consumeConfirmation(text) {
  noteUserText(text);
  if (!pending) return null;
  if (isNo(text)) {
    pending = null;
    return { ok: false, cancelled: true, say: "Tamam, vazgeçtim." };
  }
  if (!isYes(text)) return null;
  const job = pending;
  pending = null;
  const result = await execute(job.name, job.args);
  armed = { name: job.name, result, until: Date.now() + 8000 };
  return result;
}

export function pendingConfirmation() {
  return pending ? { ...pending } : null;
}

export function resetPhoneGates() {
  pending = null;
  armed = null;
  lastUser = "";
}

export const PHONE_TOOLS = [
  { name: "open_app", description: "Telefonda yüklü bir uygulamayı ada göre açar.", parameters: { type: "OBJECT", properties: { name: { type: "STRING", description: "Uygulama adı, Türkçe veya İngilizce" } }, required: ["name"] } },
  { name: "youtube_search", description: "YouTube uygulamasında arama açar.", parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
  { name: "youtube_play", description: "YouTube'da videoyu açar. Anahtar varsa ilk sonucu oynatır, yoksa aramayı açar.", parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
  { name: "open_url", description: "http veya https adresi açar.", parameters: { type: "OBJECT", properties: { url: { type: "STRING" } }, required: ["url"] } },
  { name: "web_search", description: "Web'de arar.", parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
  { name: "set_alarm", description: "Alarm kurar.", parameters: { type: "OBJECT", properties: { hour: { type: "INTEGER" }, minute: { type: "INTEGER" }, label: { type: "STRING" } }, required: ["hour", "minute"] } },
  { name: "set_timer", description: "Geri sayım kurar.", parameters: { type: "OBJECT", properties: { seconds: { type: "INTEGER" }, label: { type: "STRING" } }, required: ["seconds"] } },
  { name: "call_contact", description: "Kişiyi arar. Önce sesli evet gerekir.", parameters: { type: "OBJECT", properties: { name: { type: "STRING" } }, required: ["name"] } },
  { name: "send_sms", description: "SMS gönderir. Önce sesli evet gerekir.", parameters: { type: "OBJECT", properties: { name: { type: "STRING" }, text: { type: "STRING" } }, required: ["name", "text"] } },
  { name: "whatsapp", description: "WhatsApp sohbetini açar. Önce sesli evet gerekir.", parameters: { type: "OBJECT", properties: { name: { type: "STRING" }, text: { type: "STRING" } }, required: ["name", "text"] } },
  { name: "flashlight", description: "Feneri açar veya kapatır.", parameters: { type: "OBJECT", properties: { on: { type: "BOOLEAN" } }, required: ["on"] } },
  { name: "volume", description: "Medya sesini değiştirir. direction: up, down veya set.", parameters: { type: "OBJECT", properties: { direction: { type: "STRING" }, level: { type: "INTEGER" } }, required: ["direction"] } },
  { name: "brightness", description: "Parlaklığı 0 ile 100 arasında ayarlar.", parameters: { type: "OBJECT", properties: { level: { type: "INTEGER" } }, required: ["level"] } },
  { name: "open_settings", description: "Ayar panelini açar: wifi, bluetooth, sound, display, apps, accessibility, notifications, battery, wireless.", parameters: { type: "OBJECT", properties: { panel: { type: "STRING" } }, required: ["panel"] } },
  { name: "media", description: "Medya: play, pause, next, previous.", parameters: { type: "OBJECT", properties: { action: { type: "STRING" } }, required: ["action"] } },
  { name: "camera", description: "Kamerayı açar. action: open veya photo.", parameters: { type: "OBJECT", properties: { action: { type: "STRING" } } } },
  { name: "battery", description: "Pil yüzdesini söyler.", parameters: { type: "OBJECT", properties: {} } },
  { name: "notifications", description: "Son bildirimleri okur. Dinleyici kapalıysa onu söyler.", parameters: { type: "OBJECT", properties: {} } },
  { name: "navigate", description: "Haritada yol tarifi açar.", parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
  { name: "share", description: "Metni paylaşır.", parameters: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] } },
  { name: "screen_read", description: "Açık ekrandaki yazıları okur. Erişilebilirlik açık olmalı.", parameters: { type: "OBJECT", properties: {} } },
  { name: "tap", description: "Ekranda bu yazıya basar. Ödeme, silme ve gönderme için sesli evet gerekir.", parameters: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] } },
  { name: "scroll", description: "Ekranı kaydırır. direction: up veya down.", parameters: { type: "OBJECT", properties: { direction: { type: "STRING" } } } },
  { name: "type_text", description: "Odaktaki alana yazar. Gönderme ve ödeme için sesli evet gerekir.", parameters: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] } },
  { name: "nav_key", description: "action: back, home veya recents.", parameters: { type: "OBJECT", properties: { action: { type: "STRING" } }, required: ["action"] } },
  { name: "remember", description: "Kullanıcının cümlesini hafızaya yazar. Şifre ve kart saklanmaz.", parameters: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] } },
  { name: "forget", description: "Hafızadan eşleşen cümleyi siler.", parameters: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] } },
  { name: "add_reminder", description: "Hatırlatma kurar. Metinde gün ve saat olsun.", parameters: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] } },
];

export function toolDeclarations() {
  return [{ functionDeclarations: PHONE_TOOLS }];
}

export function phoneToolPrompt() {
  return `Bu Android telefonun köprüsü açık. Uygulama, YouTube, adres, arama, alarm, süre, fener, ses, parlaklık, ayar, medya, kamera, pil, bildirim, yol tarifi, paylaşım, ekran, hatırla, unut ve hatırlatma araçlarını kullan. Birkaç adım gerekiyorsa araçları sırayla çağır. Arama, mesaj, WhatsApp, ödeme, silme ve gönderme için önce sor; kullanıcı evet demeden yapma. Şifre ve kart bilgisini saklama. Yanıtın yine tek kısa cümle olsun.`;
}

export const APK_URL = "https://github.com/hakan35trt-collab/ERO-AI/releases/latest/download/ERO.apk";

export const ONBOARD_STEPS = [
  { id: "microphone", title: "Mikrofon", body: "Seni duymam ve ekran kilitliyken “ERO” deyince uyanmam için mikrofon gerekir. Sürekli dinleme bildirimi açık durur.", kind: "runtime" },
  { id: "notifications", title: "Bildirim", body: "Dinlerken üstte “ERO dinliyor” yazar. Bunu gizlemiyorum.", kind: "runtime" },
  { id: "contacts", title: "Kişiler", body: "“Annemi ara” dediğinde numarayı bulmam için. Aramadan ve mesajdan önce sesli evet isterim.", kind: "runtime" },
  { id: "phone", title: "Arama", body: "Evet dersen telefon uygulaması yerine doğrudan ararım.", kind: "runtime" },
  { id: "sms", title: "SMS", body: "Evet dersen mesajı ben gönderirim.", kind: "runtime" },
  { id: "camera", title: "Fener", body: "Fener kameranın flaşını kullanır. Fotoğrafı telefonun kamera uygulaması çeker.", kind: "runtime" },
  { id: "install", title: "Güncelleme", body: "Yeni ERO sürümü çıkınca buradan kurmam için bilinmeyen uygulamalara izin ver.", kind: "settings" },
  { id: "settings_write", title: "Parlaklık", body: "Ekran parlaklığını değiştirmem için sistem ayarını yazma izni gerekir.", kind: "settings" },
  { id: "accessibility", title: "Ekran kontrolü", body: "Açık ekrandaki yazıyı okuyup, sen söyleyince düğmeye basmam için erişilebilirlik hizmetini sen açarsın. Ödeme, silme ve gönderme yine sesli evet ister.", kind: "settings" },
  { id: "notification_listener", title: "Bildirimleri okuma", body: "Son bildirimi söylemem için bildirim erişimini sen açarsın. İstemezsen bu adımı geçebilirsin.", kind: "settings" },
  { id: "battery", title: "Pil", body: "Kilit ekranında dinlememin kesilmemesi için pil kısıtını kaldırman iyi olur. Zorunlu değil.", kind: "settings" },
];

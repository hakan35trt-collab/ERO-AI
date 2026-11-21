const ROOMS = ["salon", "mutfak", "yatak", "banyo", "koridor", "çalışma", "çocuk", "oturma", "bahçe", "garaj", "hol", "antre"];

export function createDemoDevices() {
  return [
    { id: "light.salon", name: "Salon ışığı", room: "salon", domain: "light", state: "off" },
    { id: "light.mutfak", name: "Mutfak ışığı", room: "mutfak", domain: "light", state: "off" },
    { id: "light.yatak", name: "Yatak odası ışığı", room: "yatak", domain: "light", state: "off" },
    { id: "climate.klima", name: "Klima", room: "salon", domain: "climate", state: "off", temperature: 24 },
    { id: "cover.perde", name: "Perde", room: "salon", domain: "cover", state: "closed", position: 0 },
    { id: "media_player.tv", name: "Televizyon", room: "salon", domain: "media_player", state: "off" },
    { id: "media_player.music", name: "Müzik", room: "salon", domain: "music", state: "off" },
    { id: "switch.security", name: "Güvenlik", room: "hol", domain: "security", state: "off" },
  ];
}

function cap(text) {
  if (!text) return "";
  return text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1);
}

function confirmText({ domain, action, room, temperature, position }) {
  const place = room ? `${cap(room)} ` : "";
  if (domain === "light") {
    if (!room) return action === "off" ? "Işıkları kapatıyorum." : "Işıkları açıyorum.";
    return action === "off" ? `${place}ışığını kapatıyorum.` : `${place}ışığını açıyorum.`;
  }
  if (domain === "climate") {
    if (temperature != null) return `Klimayı ${temperature} dereceye ayarlıyorum.`;
    return action === "off" ? "Klimayı kapatıyorum." : "Klimayı açıyorum.";
  }
  if (domain === "cover") {
    if (position != null && position !== 0 && position !== 100) return `Perdeyi yüzde ${position} açıyorum.`;
    return action === "off" || position === 0 ? "Perdeyi kapatıyorum." : "Perdeyi açıyorum.";
  }
  if (domain === "media_player") return action === "off" ? "Televizyonu kapatıyorum." : "Televizyonu açıyorum.";
  if (domain === "music") return action === "off" ? "Müziği kapatıyorum." : "Müziği açıyorum.";
  if (domain === "security") return action === "off" ? "Güvenliği kapatıyorum." : "Güvenliği açıyorum.";
  return "Tamam.";
}

function domainOf(text) {
  if (/(ışıkları|ışığı|ışık|lamba|lambayı|lambaları)/.test(text)) return "light";
  if (/(klima|klimayı|ısıtıcı|kombi|kombıyı)/.test(text)) return "climate";
  if (/(perde|perdeyi|perdeler|perdeleri|panjur)/.test(text)) return "cover";
  if (/(televizyon|televizyonu|\btv\b)/.test(text)) return "media_player";
  if (/(müzik|müziği)/.test(text)) return "music";
  if (/(güvenlik|güvenliği|alarm)/.test(text)) return "security";
  return null;
}

function looksLikeCommand(text) {
  const domain = domainOf(text);
  const verb = /(aç|kapat|kapa|yak|söndür|ayarla|kıs)/.test(text);
  return Boolean(domain && verb);
}

export function parseHomeIntent(text) {
  const normal = String(text || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[’‘]/g, "'")
    .replace(/(\d)\s*°/g, "$1 derece")
    .replace(/[^a-z0-9çğıöşü%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normal || /\b(nasıl|neden|niye)\b/.test(normal)) return { matched: false };

  const parts = normal.split(/\s+ve\s+/).map((part) => part.trim()).filter(Boolean);
  const commands = [];
  const others = [];
  for (const part of parts) {
    if (looksLikeCommand(part)) commands.push(part);
    else others.push(part);
  }
  if (!commands.length) return { matched: false };
  const command = commands.join(" ");
  const domain = domainOf(command);
  if (!domain) return { matched: false };

  const room = ROOMS.find((item) => command.includes(item)) || null;
  const off = /(kapat|kapa|söndür)/.test(command);
  const on = /(aç|yak)/.test(command);
  let action = off && !on ? "off" : "on";
  let temperature = null;
  let position = null;
  const temp = command.match(/(\d{1,2})\s*derece/);
  if (temp && domain === "climate") temperature = Math.max(16, Math.min(32, Number(temp[1])));
  const percent = command.match(/yüzde\s*(\d{1,3})/);
  if (percent && domain === "cover") position = Math.max(0, Math.min(100, Number(percent[1])));
  if (domain === "cover" && position == null) position = action === "off" ? 0 : 100;
  if (domain === "climate" && temperature != null) action = "on";

  const remainder = others.join(" ve ").trim();
  const intent = { matched: true, domain, action, room, temperature, position, remainder };
  intent.confirm = confirmText(intent);
  return intent;
}

export function applyIntent(devices, intent) {
  const next = devices.map((device) => ({ ...device }));
  const targets = next.filter((device) => {
    if (device.domain !== intent.domain) return false;
    if (!intent.room) return true;
    const name = `${device.name} ${device.room || ""}`.toLocaleLowerCase("tr-TR");
    return name.includes(intent.room);
  });
  if (!targets.length) {
    return { devices: next, ok: false, confirm: "Böyle bir cihaz göremedim." };
  }
  for (const device of targets) {
    if (intent.action === "on") device.state = device.domain === "cover" ? "open" : "on";
    if (intent.action === "off") device.state = device.domain === "cover" ? "closed" : "off";
    if (intent.temperature != null) {
      device.temperature = intent.temperature;
      device.state = "on";
    }
    if (intent.position != null) {
      device.position = intent.position;
      device.state = intent.position > 2 ? "open" : "closed";
    }
  }
  return { devices: next, ok: true, confirm: intent.confirm };
}

export function deviceLabel(device) {
  if (device.domain === "climate") {
    const temp = device.temperature != null ? ` · ${device.temperature}°` : "";
    return `${device.state === "on" ? "Açık" : "Kapalı"}${temp}`;
  }
  if (device.domain === "cover") {
    const pos = device.position != null ? ` · %${device.position}` : "";
    return `${device.state === "open" ? "Açık" : "Kapalı"}${pos}`;
  }
  return device.state === "on" || device.state === "open" ? "Açık" : "Kapalı";
}

function endpoint(url, suffix) {
  const base = String(url || "").trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(base)) throw new Error("Adres http veya https ile başlamalı.");
  return base + suffix;
}

async function readError(response) {
  try {
    const text = await response.text();
    return text.slice(0, 180) || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function createHomeAssistant({ url, token, onState }) {
  let socket = null;
  let authed = false;
  let msgId = 1;
  const pending = new Map();

  function headers() {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async function rest(suffix, options = {}) {
    let response;
    try {
      response = await fetch(endpoint(url, suffix), { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    } catch {
      throw new Error("Home Assistant'a ulaşılamadı. Adresi ve CORS ayarını kontrol et.");
    }
    if (!response.ok) throw new Error(await readError(response));
    if (response.status === 204) return null;
    return response.json();
  }

  function send(payload) {
    const id = msgId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, ...payload }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error("Home Assistant zaman aşımı"));
        }
      }, 8000);
    });
  }

  return {
    id: "homeassistant",
    async test() {
      return rest("/api/");
    },
    async listDevices() {
      const states = await rest("/api/states");
      return states
        .filter((item) => /^(light|switch|climate|cover|fan|media_player)\./.test(item.entity_id))
        .map((item) => ({
          id: item.entity_id,
          name: item.attributes?.friendly_name || item.entity_id,
          room: (item.attributes?.friendly_name || "").toLocaleLowerCase("tr-TR"),
          domain: item.entity_id.split(".")[0],
          state: item.state,
          temperature: item.attributes?.temperature ?? item.attributes?.current_temperature ?? null,
          position: item.attributes?.current_position ?? null,
        }));
    },
    async call(domain, service, data) {
      if (socket && socket.readyState === WebSocket.OPEN && authed) {
        return send({ type: "call_service", domain, service, service_data: data });
      }
      return rest(`/api/services/${domain}/${service}`, { method: "POST", body: JSON.stringify(data) });
    },
    connect() {
      if (!url || !token || typeof WebSocket === "undefined") return;
      const wsUrl = endpoint(url, "/api/websocket").replace(/^http/i, "ws");
      socket = new WebSocket(wsUrl);
      socket.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "auth_required") {
          socket.send(JSON.stringify({ type: "auth", access_token: token }));
          return;
        }
        if (message.type === "auth_ok") {
          authed = true;
          socket.send(JSON.stringify({ id: msgId++, type: "subscribe_events", event_type: "state_changed" }));
          return;
        }
        if (message.type === "auth_invalid") {
          authed = false;
          return;
        }
        if (message.type === "result" && pending.has(message.id)) {
          const waiter = pending.get(message.id);
          pending.delete(message.id);
          if (message.success) waiter.resolve(message.result);
          else waiter.reject(new Error(message.error?.message || "Komut reddedildi"));
          return;
        }
        if (message.type === "event" && message.event?.event_type === "state_changed" && onState) {
          onState(message.event.data);
        }
      });
    },
    close() {
      authed = false;
      socket?.close();
      socket = null;
    },
  };
}

export const tuyaAdapter = {
  id: "tuya",
  available: false,
  async test() {
    throw new Error("Tuya bağdaştırıcısı henüz bağlı değil. Arayüz hazır; bağlantı daha sonra eklenecek.");
  },
  async listDevices() {
    return [];
  },
  async call() {
    throw new Error("Tuya bağlı değil.");
  },
  connect() {},
  close() {},
};

export async function runHomeCommand({ intent, settings, devices, assistant }) {
  if (settings.homeEnabled && settings.homeAdapter === "tuya") {
    return { devices, confirm: "Tuya bağdaştırıcısı hazır, henüz bağlı değil. İstersen simülasyonu aç.", ok: false };
  }
  if (settings.homeEnabled && settings.homeAdapter === "homeassistant" && settings.haUrl && settings.haToken && assistant) {
    const service = serviceFor(intent);
    await assistant.call(service.domain, service.service, service.data);
    return { devices, confirm: intent.confirm, ok: true, live: true };
  }
  if (settings.homeDemo) {
    const applied = applyIntent(devices, intent);
    return { ...applied, live: false, demo: true };
  }
  return {
    devices,
    ok: false,
    confirm: "Bunu bir akıllı ev komutu olarak anladım. Modül hazır ama kapalı. Ayarlardan simülasyonu veya Home Assistant bağlantısını açabilirsin.",
  };
}

export function serviceFor(intent) {
  const area = intent.room ? { area_id: intent.room } : {};
  if (intent.domain === "light") {
    return {
      domain: "light",
      service: intent.action === "off" ? "turn_off" : "turn_on",
      data: intent.room ? area : {},
    };
  }
  if (intent.domain === "climate") {
    if (intent.temperature != null) {
      return { domain: "climate", service: "set_temperature", data: { ...area, temperature: intent.temperature } };
    }
    return {
      domain: "climate",
      service: intent.action === "off" ? "turn_off" : "turn_on",
      data: area,
    };
  }
  if (intent.domain === "cover") {
    if (intent.position != null && intent.position !== 0 && intent.position !== 100) {
      return { domain: "cover", service: "set_cover_position", data: { ...area, position: intent.position } };
    }
    return {
      domain: "cover",
      service: intent.action === "off" || intent.position === 0 ? "close_cover" : "open_cover",
      data: area,
    };
  }
  if (intent.domain === "music") {
    return {
      domain: "media_player",
      service: intent.action === "off" ? "media_stop" : "media_play",
      data: area,
    };
  }
  if (intent.domain === "security") {
    return {
      domain: "switch",
      service: intent.action === "off" ? "turn_off" : "turn_on",
      data: area,
    };
  }
  return {
    domain: "media_player",
    service: intent.action === "off" ? "turn_off" : "turn_on",
    data: area,
  };
}

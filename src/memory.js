export const DEFAULT_SETTINGS = {
  handsFree: false,
  rate: 1.05,
  liveVoice: false,
  pitch: 1.03,
  voiceURI: "",
  customBase: "",
  customModel: "",
  customKey: "",
  geminiKey: "",
  geminiSkipped: false,
  wakeWord: false,
  homeEnabled: false,
  homeDemo: true,
  homeAdapter: "homeassistant",
  haUrl: "",
  haToken: "",
};

const SETTINGS_KEY = "ero.settings";
const FALLBACK_MEM = "ero.memories";
const FALLBACK_MSG = "ero.messages";

function localList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB yok"));
      return;
    }
    const request = indexedDB.open("ero", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("memories")) db.createObjectStore("memories", { keyPath: "id" });
      if (!db.objectStoreNames.contains("messages")) db.createObjectStore("messages", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function bundledGeminiKey() {
  const value = import.meta.env?.VITE_GEMINI_API_KEY;
  return typeof value === "string" ? value.trim() : "";
}

export function effectiveGeminiKey(settings, bundled = bundledGeminiKey()) {
  const local = String(settings?.geminiKey || "").trim();
  return local || String(bundled || "").trim();
}

export function parseSetupKey(hash) {
  const match = String(hash || "").match(/^#key=([^&]*)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return String(match[1] || "").trim();
  }
}

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function createStore() {
  let dbPromise = null;
  const useDb = () => {
    if (!dbPromise) {
      dbPromise = openDb().catch((error) => {
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  };

  async function all(storeName, fallbackKey) {
    try {
      const db = await useDb();
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll();
      const rows = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      return rows.sort((a, b) => a.at - b.at);
    } catch {
      return localList(fallbackKey);
    }
  }

  async function put(storeName, fallbackKey, row) {
    try {
      const db = await useDb();
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(row);
      await txDone(tx);
    } catch {
      const rows = localList(fallbackKey).filter((item) => item.id !== row.id);
      rows.push(row);
      localStorage.setItem(fallbackKey, JSON.stringify(rows));
    }
  }

  async function remove(storeName, fallbackKey, id) {
    try {
      const db = await useDb();
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(id);
      await txDone(tx);
    } catch {
      localStorage.setItem(fallbackKey, JSON.stringify(localList(fallbackKey).filter((item) => item.id !== id)));
    }
  }

  async function clear(storeName, fallbackKey) {
    try {
      const db = await useDb();
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
      await txDone(tx);
    } catch {
      localStorage.removeItem(fallbackKey);
    }
  }

  return {
    memories: () => all("memories", FALLBACK_MEM),
    messages: () => all("messages", FALLBACK_MSG),
    addMemory(text) {
      const row = { id: crypto.randomUUID(), text: text.trim(), at: Date.now() };
      return put("memories", FALLBACK_MEM, row).then(() => row);
    },
    deleteMemory(id) {
      return remove("memories", FALLBACK_MEM, id);
    },
    clearMemories() {
      return clear("memories", FALLBACK_MEM);
    },
    addMessage(message) {
      return put("messages", FALLBACK_MSG, message);
    },
    clearMessages() {
      return clear("messages", FALLBACK_MSG);
    },
    async trimMessages(max = 200) {
      const rows = await all("messages", FALLBACK_MSG);
      const extra = rows.slice(0, Math.max(0, rows.length - max));
      await Promise.all(extra.map((row) => remove("messages", FALLBACK_MSG, row.id)));
    },
  };
}

const EMOTIONS = new Set(["neutral", "happy", "surprised", "sad", "curious"]);

export function normalizeSpeech(text) {
  return String(text || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9çğıöşü'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractWake(text) {
  const clean = normalizeSpeech(text);
  const match = clean.match(/^(?:hey\s+|merhaba\s+|selam\s+)?ero(?:'y[ua]|'nun)?\b\s*(.*)$/);
  if (!match) return { wake: false, rest: "" };
  return { wake: true, rest: (match[1] || "").trim() };
}

export function needsResearch(text) {
  const raw = String(text || "").trim();
  const t = raw.toLocaleLowerCase("tr-TR");
  if (!t) return false;
  if (/(şiir|şarkı|türkü|hikâye|hikaye|masal|uyku hik)/.test(t) && !/(nedir|kimdir|kim yazdı|kime ait)/.test(t)) {
    return false;
  }
  if (/(adın ne|sen kim|kimsin|nasılsın|neler yapabilir|kendini tanıt|merhaba|selam|teşekkür|günaydın|iyi geceler)/.test(t)) {
    return false;
  }
  if (/(yaz|söyle|anlat|uydur)/.test(t) && !/(nedir|kimdir|nerede|neresi|ne zaman|kaç|hangi)/.test(t)) return false;
  return /(kimdir|nedir|neresi|nerededir|nerede|ne zaman|kaç|hangi|başkent|nüfus|nüfusu|tarih|neden|niçin|hava|kaçta)/.test(t);
}

export function cleanQuery(text) {
  let t = String(text || "");
  t = t.replace(/[’‘]/g, "'");
  t = t.replace(/'(nun|nın|nin|nün|un|ın|in|ün|yu|yü|yı|yi|da|de|ta|te|dan|den)\b/gi, "");
  t = t.replace(/[?!.,:;]/g, " ");
  t = t.replace(
    /(^|[^\p{L}\p{N}])(söyler misin|anlatır mısın|verir misin|ne zaman|nerededir|kimdir|nedir|nerede|kaçtır|kaç|hangi|neden|niçin|nasıl|midir|mıdır|mudur|midür|lütfen|bana|hakkında|bilgi|acaba|ero|mi|mı|mu|mü)(?=$|[^\p{L}\p{N}])/giu,
    "$1 ",
  );
  t = t.replace(/\s+/g, " ").trim();
  return t || String(text || "").trim();
}

export function detectDelivery(userText) {
  const t = String(userText || "").toLocaleLowerCase("tr-TR");
  if (/(şarkı|türkü|söyle|nakarat)/.test(t)) return "song";
  if (/şiir/.test(t)) return "poem";
  if (/(hikâye|hikaye|masal|öykü)/.test(t)) return "story";
  return "chat";
}

export function explicitMemories(text) {
  const source = String(text || "").trim();
  const facts = [];
  let remainder = source;
  const after = remainder.match(/\b(?:hatırla|aklında tut|unutma)\s*[:,-]?\s+([^.!?\n]+)/i);
  if (after) {
    let fact = after[1].trim();
    let extra = "";
    const split = fact.search(/\s+ve\s+/i);
    if (split > 0) {
      extra = fact.slice(split).replace(/^\s+ve\s+/i, "");
      fact = fact.slice(0, split).trim();
    }
    fact = fact.replace(/[,\s]+$/g, "");
    if (fact && !/^(bunu|şunu|onu)$/i.test(fact)) facts.push(fact);
    const before = remainder.slice(0, after.index).replace(/[,\s]+$/g, "").trim();
    const afterPhrase = remainder.slice(after.index + after[0].length).trim();
    remainder = [before, extra, afterPhrase].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  const before = remainder.match(/^(.*?)[,.]?\s+\b(?:bunu|şunu)\s+hatırla\b[.!]*/i);
  if (before && before[1].trim()) {
    facts.push(before[1].trim());
    remainder = remainder.slice(before.index + before[0].length).trim();
  }
  return { facts, remainder: remainder.replace(/^[,.\s]+|[,.\s]+$/g, "") };
}

export const EMOTION_TAGS = [
  ["mutlu", "joy"],
  ["üzgün", "sad"],
  ["şaşkın", "surprised"],
  ["korkmuş", "fear"],
  ["kızgın", "angry"],
  ["düşünceli", "confused"],
  ["sakin", "calm"],
  ["utangaç", "shy"],
  ["iğrenmiş", "disgust"],
];

export function stripEmotionTags(text) {
  return String(text || "").replace(/\[(?:mutlu|üzgün|şaşkın|korkmuş|kızgın|düşünceli|sakin|utangaç|iğrenmiş)\]/gi, "");
}

export function guessEmotion(text) {
  const t = stripEmotionTags(text).toLocaleLowerCase("tr-TR");
  if (/(korktum|korkunç|korkuyor|ürktüm|korku)/.test(t)) return "fear";
  if (/(kızdım|sinir|öfke|kızgın|öfkeli)/.test(t)) return "angry";
  if (/(iğrenç|tiksin|midem bulandı)/.test(t)) return "disgust";
  if (/(utandım|utangaç|mahcup)/.test(t)) return "shy";
  if (/(sakinim|sakin ol|rahatla)/.test(t)) return "calm";
  if (/(üzgün|üzüldüm|geçmiş olsun|zor gün|maalesef|yazık)/.test(t)) return "sad";
  if (/(vay|inanılmaz|şaşırdım|gerçekten mi|olağanüstü|ciddi misin)/.test(t)) return "surprised";
  if (/(harika|sevindim|tebrik|ne güzel|güzel olmuş|haha|şarkı|şiir|mutlu)/.test(t)) return "happy";
  if (/(kararsız|anlamadım|emin değil)/.test(t)) return "confused";
  if (/\?/.test(t)) return "curious";
  return "neutral";
}

export function emotionFromText(text) {
  const raw = String(text || "").toLocaleLowerCase("tr-TR");
  for (const [tag, name] of EMOTION_TAGS) {
    if (raw.includes(`[${tag}]`)) return name;
  }
  const guess = guessEmotion(text);
  const map = {
    happy: "joy",
    sad: "sad",
    surprised: "surprised",
    fear: "fear",
    angry: "angry",
    shy: "shy",
    disgust: "disgust",
    calm: "calm",
    confused: "confused",
  };
  return map[guess] || "";
}

export function parseMeta(raw) {
  const result = { emotion: null, memories: [] };
  if (!raw) return result;
  const text = String(raw).trim();
  try {
    const data = JSON.parse(text);
    const emotion = String(data.emotion || "").toLowerCase();
    if (EMOTIONS.has(emotion)) result.emotion = emotion;
    if (Array.isArray(data.memories)) {
      result.memories = data.memories
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 1 && item.length < 180)
        .slice(0, 3);
    }
    return result;
  } catch {
    const found = text.match(/"emotion"\s*:\s*"(neutral|happy|surprised|sad|curious)"/i);
    if (found) result.emotion = found[1].toLowerCase();
    return result;
  }
}

export function sanitizeFinal(text) {
  let emotion = null;
  const memories = [];
  let spoken = String(text || "");
  spoken = spoken.replace(/<think>[\s\S]*?<\/think>/gi, "");
  spoken = spoken.replace(/<ero>([\s\S]*?)<\/ero>/gi, (_, inner) => {
    const meta = parseMeta(inner);
    if (meta.emotion) emotion = meta.emotion;
    memories.push(...meta.memories);
    return "";
  });
  spoken = spoken.replace(/```(?:json|ero)?\s*(\{[\s\S]*?\})\s*```/gi, (all, inner) => {
    const meta = parseMeta(inner);
    if (!meta.emotion && !meta.memories.length) return all;
    if (meta.emotion) emotion = meta.emotion;
    memories.push(...meta.memories);
    return "";
  });
  spoken = spoken.replace(/\n?\{[^{}]*"emotion"\s*:\s*"(neutral|happy|surprised|sad|curious)"[^{}]*\}\s*$/i, (block) => {
    const meta = parseMeta(block);
    if (meta.emotion) emotion = meta.emotion;
    memories.push(...meta.memories);
    return "";
  });
  const tagged = emotionFromText(spoken);
  spoken = stripEmotionTags(spoken);
  if (!emotion && tagged) emotion = tagged;
  spoken = spoken.replace(/\[(?:sarki|şarkı|siir|şiir|hikaye|hikâye)\]/gi, "");
  spoken = unwrapQuotes(spoken).trim();
  return { spoken, emotion, memories };
}

export function unwrapQuotes(text) {
  const t = String(text || "").trim();
  const pairs = [
    ['"', '"'],
    ["“", "”"],
    ["«", "»"],
  ];
  for (const [open, close] of pairs) {
    if (t.startsWith(open) && t.endsWith(close) && t.length > 2) return t.slice(open.length, -close.length).trim();
  }
  return String(text || "");
}

export function forSpeech(text) {
  return stripEmotionTags(text)
    .replace(/<ero>[\s\S]*?<\/ero>/gi, "")
    .replace(/\[(?:sarki|şarkı|siir|şiir|hikaye|hikâye)\]/gi, "")
    .replace(/[*_`#>]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function takeSpeakable(buffer, { flush = false } = {}) {
  const sentences = [];
  const source = String(buffer || "");
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (!".!?…\n".includes(ch)) continue;
    if (ch === "." && /\d/.test(source[i - 1] || "") && /\d/.test(source[i + 1] || "")) continue;
    const piece = source.slice(start, ch === "\n" ? i : i + 1).trim();
    if (piece.length >= 2) sentences.push(piece);
    start = i + 1;
  }
  let rest = source.slice(start);
  if (!flush && rest.length > 170) {
    const cut = rest.lastIndexOf(" ", 150);
    if (cut > 40) {
      sentences.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
  }
  if (flush && rest.trim()) {
    sentences.push(rest.trim());
    rest = "";
  }
  return { sentences, rest };
}

function isTagPrefix(value) {
  const tags = ["<think>", "</think>", "<ero>", "</ero>"];
  const lower = value.toLowerCase();
  return tags.some((tag) => tag.startsWith(lower));
}

export class StreamCleaner {
  constructor() {
    this.pending = "";
    this.mode = null;
    this.emotion = null;
    this.memories = [];
  }

  #take(raw) {
    const meta = parseMeta(raw);
    if (meta.emotion) this.emotion = meta.emotion;
    this.memories.push(...meta.memories);
  }

  push(delta) {
    this.pending += String(delta || "");
    let out = "";
    while (this.pending) {
      if (this.mode === "think") {
        const end = this.pending.toLowerCase().indexOf("</think>");
        if (end === -1) {
          if (this.pending.length > 24) this.pending = this.pending.slice(-8);
          break;
        }
        this.pending = this.pending.slice(end + 8);
        this.mode = null;
        continue;
      }
      if (this.mode === "ero") {
        const end = this.pending.toLowerCase().indexOf("</ero>");
        if (end === -1) {
          if (this.pending.length > 900) {
            this.pending = "";
            this.mode = null;
          }
          break;
        }
        this.#take(this.pending.slice(0, end));
        this.pending = this.pending.slice(end + 6);
        this.mode = null;
        continue;
      }
      const lt = this.pending.indexOf("<");
      if (lt === -1) {
        out += this.pending;
        this.pending = "";
        break;
      }
      out += this.pending.slice(0, lt);
      const rest = this.pending.slice(lt);
      const lower = rest.toLowerCase();
      if (lower.startsWith("<think>")) {
        this.mode = "think";
        this.pending = rest.slice(7);
        continue;
      }
      if (lower.startsWith("<ero>")) {
        this.mode = "ero";
        this.pending = rest.slice(5);
        continue;
      }
      if (isTagPrefix(rest) && rest.length < 8) {
        this.pending = rest;
        break;
      }
      out += "<";
      this.pending = rest.slice(1);
    }
    return out;
  }

  finish() {
    let rest = "";
    if (this.mode === "ero") this.#take(this.pending);
    else if (!this.mode) rest = this.pending;
    this.pending = "";
    this.mode = null;
    const cleaned = sanitizeFinal(rest);
    if (cleaned.emotion) this.emotion = cleaned.emotion;
    this.memories.push(...cleaned.memories);
    return { rest: cleaned.spoken, emotion: this.emotion, memories: this.memories };
  }
}

export function rankScore(voice) {
  const lang = String(voice?.lang || "").toLowerCase();
  const name = String(voice?.name || "").toLowerCase();
  let score = 0;
  if (lang.startsWith("tr")) score += 100;
  if (lang === "tr-tr") score += 20;
  if (/natural|neural|premium|enhanced|wavenet/.test(name)) score += 25;
  if (name.includes("google") && lang.startsWith("tr")) score += 50;
  return score;
}

export function visemeForChar(ch) {
  const c = String(ch || " ").toLocaleLowerCase("tr-TR");
  if ("mbp".includes(c)) return { open: 0.04, round: 0.1, smile: 0 };
  if (c === "a" || c === "â") return { open: 0.92, round: 0.05, smile: 0.05 };
  if (c === "e" || c === "é") return { open: 0.55, round: 0, smile: 0.2 };
  if (c === "ı" || c === "i" || c === "î") return { open: 0.32, round: 0, smile: 0.28 };
  if (c === "o" || c === "ô") return { open: 0.72, round: 0.85, smile: 0 };
  if (c === "ö") return { open: 0.58, round: 0.7, smile: 0 };
  if (c === "u" || c === "û") return { open: 0.38, round: 0.9, smile: 0 };
  if (c === "ü") return { open: 0.32, round: 0.75, smile: 0.05 };
  if (c === "f" || c === "v") return { open: 0.16, round: 0.1, smile: 0 };
  if (" \n\t.,!?:;…".includes(c)) return { open: 0.02, round: 0, smile: 0.05 };
  return { open: 0.26, round: 0.12, smile: 0 };
}

export const DELIVERY_TAGS = {
  song: "[sarki]",
  poem: "[siir]",
  story: "[hikaye]",
};

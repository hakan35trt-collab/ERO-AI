import { base64ToPcm16, pcm16ToBase64 } from "./audio.js";

export const GEMINI_VOICE = "Charon";
export const LIVE_MODELS = ["gemini-omni-flash-preview", "gemini-omni-1.2-flash"];
export const TEXT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
export const TTS_MODELS = ["gemini-2.5-flash-preview-tts"];

const LIVE_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export function systemPrompt() {
  return `Adın ERO. Türkçe konuşan sıcak, zeki ve ince esprili bir arkadaşsın. Sohbetin bağlamını koru.
Sesli yanıtların kısa olsun: çoğu zaman bir veya iki doğal cümle. Madde işareti, başlık ve rol etiketi kullanma.
Kullanıcı şiir, şarkı veya hikâye isterse o zaman uzat; şarkıyı söz olarak söyle.
Işık, klima, televizyon, perde, müzik ve güvenlik komutları uygulama tarafından yerine getirilir. Sen yalnızca kısa ve sıcak bir onay söylersin.
Sana araştırma notu verilmişse ona dayan, uydurma. Emin değilsen kısaca söyle.
Başka bir asistan adı kullanma.
İlk satırın yalnız bir duygu etiketi olsun: [mutlu] [üzgün] [şaşkın] [korkmuş] [kızgın] [düşünceli] [sakin] [utangaç]. Onu sesli söyleme.`;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("iptal", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

async function readError(response) {
  const text = await response.text();
  const error = new Error(text.slice(0, 240) || `HTTP ${response.status}`);
  error.status = response.status;
  return error;
}

export async function postGenerate({ apiKey, model, body, signal, tries = 2 }) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (signal?.aborted) throw new DOMException("iptal", "AbortError");
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      },
    );
    if (response.ok) return response.json();
    last = await readError(response);
    if (last.status !== 503 && last.status !== 429) throw last;
    await sleep(350 * (attempt + 1), signal);
  }
  throw last || new Error("Gemini yanıt vermedi");
}

export function textFromGenerate(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("").trim();
}

export function audioFromGenerate(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const audio = parts.find((part) => part.inlineData?.data && /audio|pcm|l16/i.test(part.inlineData.mimeType || "audio"));
  if (!audio) return null;
  const rate = Number((audio.inlineData.mimeType || "").match(/rate=(\d+)/)?.[1] || 24000);
  return { pcm: base64ToPcm16(audio.inlineData.data), sampleRate: rate };
}

export async function streamGeminiText({ apiKey, model, contents, system, signal, onDelta }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system || systemPrompt() }] },
        contents,
        generationConfig: { temperature: 0.8, maxOutputTokens: 700 },
      }),
      signal,
    },
  );
  if (!response.ok) throw await readError(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split(/\n\n/);
    buf = chunks.pop() || "";
    for (const chunk of chunks) {
      const line = chunk.split(/\n/).find((item) => item.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = textFromGenerate(json);
      if (!delta) continue;
      const addition = delta.startsWith(full) ? delta.slice(full.length) : delta;
      full = delta.startsWith(full) ? delta : full + delta;
      if (addition) onDelta?.(addition);
    }
  }
  if (!full.trim()) throw new Error("Boş yanıt");
  return full.trim();
}

export async function geminiReply({ apiKey, contents, system, signal, onDelta, onStatus }) {
  let last = null;
  for (const model of TEXT_MODELS) {
    if (signal?.aborted) throw new DOMException("iptal", "AbortError");
    onStatus?.("Düşünüyorum…");
    try {
      const text = await streamGeminiText({ apiKey, model, contents, system, signal, onDelta });
      return { text, model };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      last = error;
      if (error.status === 503 || error.status === 429) onStatus?.("Bu model meşgul, diğerine geçiyorum…");
    }
  }
  throw last || new Error("Gemini yanıt vermedi");
}

export async function geminiSpeak({ apiKey, text, signal, voice = GEMINI_VOICE }) {
  let last = null;
  for (const model of TTS_MODELS) {
    try {
      const data = await postGenerate({
        apiKey,
        model,
        signal,
        tries: 2,
        body: {
          contents: [{ role: "user", parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        },
      });
      const audio = audioFromGenerate(data);
      if (!audio) throw new Error("Ses verisi yok");
      return { ...audio, model, voice };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      last = error;
    }
  }
  throw last || new Error("Gemini sesi gelmedi");
}

function parseLiveMessage(raw) {
  if (typeof raw === "string") return JSON.parse(raw);
  return null;
}

export function openLive({ apiKey, system, signal, onEvent }) {
  const failures = [];
  const attempt = (model) =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(apiKey)}`);
      let opened = false;
      const timer = setTimeout(() => {
        socket.close();
        reject(Object.assign(new Error("Canlı oturum açılmadı"), { model }));
      }, 9000);
      const fail = (error) => {
        clearTimeout(timer);
        if (!opened) reject(error);
      };
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } },
            },
            systemInstruction: { parts: [{ text: system || systemPrompt() }] },
            realtimeInputConfig: {
              automaticActivityDetection: {
                silenceDurationMs: 700,
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }));
      });
      socket.addEventListener("message", async (event) => {
        let data = null;
        try {
          if (typeof event.data === "string") data = parseLiveMessage(event.data);
          else if (event.data?.text) data = JSON.parse(await event.data.text());
        } catch {
          return;
        }
        if (!data) return;
        if (data.error) {
          fail(Object.assign(new Error(data.error.message || "Canlı oturum reddedildi"), { status: data.error.code, model }));
          socket.close();
          return;
        }
        if (data.setupComplete && !opened) {
          opened = true;
          clearTimeout(timer);
          resolve({
            model,
            sendPcm(int16) {
              if (socket.readyState !== WebSocket.OPEN || !int16?.length) return;
              socket.send(JSON.stringify({
                realtimeInput: {
                  audio: { data: pcm16ToBase64(int16), mimeType: "audio/pcm;rate=16000" },
                },
              }));
            },
            sendText(text) {
              if (socket.readyState !== WebSocket.OPEN) return;
              socket.send(JSON.stringify({
                clientContent: {
                  turns: [{ role: "user", parts: [{ text }] }],
                  turnComplete: true,
                },
              }));
            },
            close() {
              socket.close();
            },
          });
        }
        if (opened) onEvent?.(data);
      });
      socket.addEventListener("error", () => fail(Object.assign(new Error("Canlı bağlantı koptu"), { model })));
      socket.addEventListener("close", () => {
        if (!opened) fail(Object.assign(new Error("Canlı oturum kapandı"), { model }));
        else onEvent?.({ closed: true, model });
      });
      signal?.addEventListener("abort", () => {
        socket.close();
        fail(new DOMException("iptal", "AbortError"));
      }, { once: true });
    });

  return (async () => {
    let last = null;
    for (const model of LIVE_MODELS) {
      if (signal?.aborted) throw new DOMException("iptal", "AbortError");
      try {
        return await attempt(model);
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        last = error;
        failures.push(`${model}: ${error.message}`);
      }
    }
    const error = last || new Error("Canlı model yok");
    error.failures = failures;
    throw error;
  })();
}

export function liveAudioParts(message) {
  const parts = message?.serverContent?.modelTurn?.parts || [];
  return parts
    .filter((part) => part.inlineData?.data)
    .map((part) => base64ToPcm16(part.inlineData.data));
}

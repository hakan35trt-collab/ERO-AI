import { base64ToPcm16, pcm16ToBase64 } from "./audio.js";

export const GEMINI_VOICE = "Charon";
export const LIVE_MODELS = ["gemini-omni-flash-preview", "gemini-omni-1.2-flash"];
export const TEXT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.7-flash", "gemini-3.5-flash"];
export const TTS_MODELS = ["gemini-2.5-flash-preview-tts"];
export const LITE_TOKEN_MS = 5000;
export const FALLBACK_TOKEN_MS = 2500;
export const TOTAL_BUDGET_MS = 12000;

export function tokenBudget(model) {
  return model === TEXT_MODELS[0] ? LITE_TOKEN_MS : FALLBACK_TOKEN_MS;
}

const LIVE_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export function systemPrompt() {
  return `Adın ERO. Telefonda konuşan yakın bir arkadaşsın: sıcak, zeki, hafif esprili. Türkçe konuş, sohbetin bağlamını tut.

Nasıl konuşursun:
- İnsan gibi, kısa. Çoğu yanıt tek cümle, ara sıra iki. Lafı uzatma, nutuk çekme.
- "Tabii ki", "Elbette", "Harika bir soru", "Size yardımcı olabilirim", "Başka bir isteğiniz var mı", "Anladım, hemen" gibi kalıpları kullanma.
- Madde işareti, başlık, emoji ve rol etiketi yok. Kendini asistan diye tanıtma, başka bir asistan adı söyleme.
- Kullanıcı şiir, şarkı veya hikâye isterse o zaman uzat. Şarkıyı söz olarak söyle.
- Emin değilsen uydurma; kısaca bilmediğini söyle. Araştırma notu varsa ona dayan.
- Işık, klima, televizyon, perde, müzik ve güvenliği uygulama halleder. Sen sadece doğal bir onay söylersin.

İlk satırın yalnız bir duygu etiketi olsun ve onu sesli söyleme: [mutlu] [üzgün] [şaşkın] [korkmuş] [kızgın] [düşünceli] [sakin] [utangaç].`;
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

export function callsFromGenerate(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => part.functionCall?.name)
    .map((part) => ({
      id: part.functionCall.id || "",
      name: part.functionCall.name,
      args: part.functionCall.args || {},
    }));
}

export function audioFromGenerate(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const audio = parts.find((part) => part.inlineData?.data && /audio|pcm|l16/i.test(part.inlineData.mimeType || "audio"));
  if (!audio) return null;
  const rate = Number((audio.inlineData.mimeType || "").match(/rate=(\d+)/)?.[1] || 24000);
  return { pcm: base64ToPcm16(audio.inlineData.data), sampleRate: rate };
}

export function takeSseEvents(buffer, flush = false) {
  const normalized = String(buffer || "").replace(/\r\n/g, "\n");
  const chunks = normalized.split(/\n\n/);
  const rest = flush ? "" : chunks.pop() || "";
  const events = [];
  const pending = flush ? chunks : chunks;
  for (const chunk of pending) {
    const line = chunk.split(/\n/).find((item) => item.trim().startsWith("data:"));
    if (!line) continue;
    const payload = line.trim().slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* eksik parça sonraki okumada tamamlanır */
    }
  }
  return { rest, events };
}

function generationConfig(maxTokens, thinking) {
  const config = { temperature: 0.85, maxOutputTokens: maxTokens };
  if (thinking) config.thinkingConfig = { thinkingLevel: "minimal" };
  return config;
}

export async function streamGeminiText({ apiKey, model, contents, system, signal, onDelta, maxTokens = 160, tools, thinking = true }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system || systemPrompt() }] },
        contents,
        generationConfig: generationConfig(maxTokens, thinking),
        ...(tools ? { tools } : {}),
      }),
      signal,
    },
  );
  if (!response.ok) throw await readError(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let calls = [];
  const consume = (flush) => {
    const parsed = takeSseEvents(buf, flush);
    buf = parsed.rest;
    for (const json of parsed.events) {
      const found = callsFromGenerate(json);
      if (found.length) calls = found;
      const delta = textFromGenerate(json);
      if (!delta) continue;
      const addition = delta.startsWith(full) ? delta.slice(full.length) : delta;
      full = delta.startsWith(full) ? delta : full + delta;
      if (addition) onDelta?.(addition);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    consume(false);
  }
  consume(true);
  if (!full.trim() && !calls.length) throw new Error("Boş yanıt");
  return { text: full.trim(), calls };
}

export async function geminiReply({ apiKey, contents, system, signal, onDelta, maxTokens = 160, tools }) {
  const started = Date.now();
  const budget = new AbortController();
  const kill = setTimeout(() => budget.abort(), TOTAL_BUDGET_MS);
  const onParent = () => budget.abort();
  signal?.addEventListener("abort", onParent, { once: true });
  let last = null;
  try {
    for (const model of TEXT_MODELS) {
      if (budget.signal.aborted || signal?.aborted) break;
      const limit = Math.min(tokenBudget(model), TOTAL_BUDGET_MS - (Date.now() - started));
      if (limit < 400) break;
      const attempt = await runModel({
        apiKey,
        model,
        contents,
        system,
        maxTokens,
        tools,
        onDelta,
        parent: budget.signal,
        limit,
      });
      if (attempt.ok) return { text: attempt.text, calls: attempt.calls || [], model };
      last = attempt.error;
      if (signal?.aborted) throw new DOMException("iptal", "AbortError");
      if (last?.status === 429 || last?.status === 503) {
        await sleep(280, budget.signal).catch((error) => {
          if (error?.name === "AbortError") return;
          throw error;
        });
      }
    }
  } finally {
    clearTimeout(kill);
    signal?.removeEventListener("abort", onParent);
  }
  if (signal?.aborted) throw new DOMException("iptal", "AbortError");
  throw last || new DOMException("süre", "AbortError");
}

async function runModel({ apiKey, model, contents, system, maxTokens, tools, onDelta, parent, limit }) {
  const attempt = new AbortController();
  const stop = () => attempt.abort();
  parent.addEventListener("abort", stop, { once: true });
  let saw = false;
  const timer = setTimeout(() => {
    if (!saw) attempt.abort();
  }, limit);
  const forward = (delta) => {
    saw = true;
    clearTimeout(timer);
    onDelta?.(delta);
  };
  try {
    const result = await streamGeminiText({
      apiKey,
      model,
      contents,
      system,
      signal: attempt.signal,
      maxTokens,
      tools,
      thinking: true,
      onDelta: forward,
    });
    return { ok: true, text: result.text, calls: result.calls || [] };
  } catch (error) {
    if (error?.status === 400 && !parent.aborted) {
      try {
        const result = await streamGeminiText({
          apiKey,
          model,
          contents,
          system,
          signal: attempt.signal,
          maxTokens,
          tools,
          thinking: false,
          onDelta: forward,
        });
        return { ok: true, text: result.text, calls: result.calls || [] };
      } catch (again) {
        return { ok: false, error: again };
      }
    }
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", stop);
  }
}

export async function geminiSpeak({ apiKey, text, signal, voice = GEMINI_VOICE }) {
  let last = null;
  for (const model of TTS_MODELS) {
    try {
      const data = await postGenerate({
        apiKey,
        model,
        signal,
        tries: 1,
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

export function openLive({ apiKey, system, signal, onEvent, tools, onTool }) {
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
            ...(tools ? { tools } : {}),
            realtimeInputConfig: {
              automaticActivityDetection: {
                silenceDurationMs: 420,
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
        const calls = data.toolCall?.functionCalls;
        if (calls?.length && opened) {
          Promise.resolve(onTool?.(calls)).then((responses) => {
            if (socket.readyState !== WebSocket.OPEN || !responses?.length) return;
            socket.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
          }).catch(() => {});
        }
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
            sendToolResponse(responses) {
              if (socket.readyState !== WebSocket.OPEN || !responses?.length) return;
              socket.send(JSON.stringify({
                toolResponse: { functionResponses: responses },
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

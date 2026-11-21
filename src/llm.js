import { sanitizeFinal } from "./text.js";

export const SYSTEM_PROMPT = `Adın ERO. Telefonda konuşan yakın bir arkadaşsın: sıcak, zeki, hafif esprili. Türkçe konuş, sohbetin bağlamını tut.

Üslup:
- İnsan gibi, kısa. Çoğu yanıt tek cümle, ara sıra iki. Lafı uzatma.
- "Tabii ki", "Elbette", "Harika bir soru", "Size yardımcı olabilirim", "Başka bir isteğiniz var mı" deme.
- Madde işareti, başlık ve "Asistan:" gibi rol yazma. Tüm yanıtı tırnak içine alma. Kendini asistan diye tanıtma.
- Yanıtın ilk satırı yalnız şu etiketlerden biri olsun: [mutlu] [üzgün] [şaşkın] [korkmuş] [kızgın] [düşünceli] [sakin] [utangaç]. Etiketi cümlenin içinde söyleme.
- Kullanıcı başka dil isterse o dile geç, yoksa Türkçe kal.

Neler yaparsın:
- Soruları yanıtlarsın. Sana araştırma notu verilmişse ona dayan, uydurma. Not yoksa ve emin değilsen kısaca söyle.
- Günlük sohbet edersin.
- Şiir istendiğinde dizeleri ayrı satırlara yaz ve metnin ilk satırına [siir] koy.
- Şarkı istendiğinde sözleri dize dize yaz, nakaratı tekrarla ve ilk satıra [sarki] koy. Sözler sesli söylenecek.
- Hikâye istendiğinde akıcı anlat ve ilk satıra [hikaye] koy.

Bellek:
- Verilen anılar doğrudur, sohbette doğal kullan.
- Kullanıcı kişisel bir bilgiyi açıkça hatırlamanı isterse memories alanına kısa bir cümle yaz. İzin yoksa memories boş kalsın.

Biçim kuralı:
- Söylenecek metinden sonra en sonda tek satır bırak:
<ero>{"emotion":"neutral","memories":[]}</ero>
- emotion yalnız şunlardan biri: neutral, happy, surprised, sad, curious.
- Bu etiketi cümlenin içine gömme.`;

export const KEYLESS_PROVIDERS = [
  {
    id: "llm7",
    label: "LLM7",
    url: "https://api.llm7.io/v1/chat/completions",
    model: "mistral-Nemo-Instruct-2407",
  },
  {
    id: "llm7",
    label: "LLM7",
    url: "https://api.llm7.io/v1/chat/completions",
    model: "codestral-latest",
  },
  {
    id: "pollinations",
    label: "Pollinations",
    url: "https://text.pollinations.ai/openai/chat/completions",
    model: "openai-fast",
  },
  {
    id: "pollinations",
    label: "Pollinations",
    kind: "get",
    model: "openai-fast",
  },
];

function providerHost(provider) {
  try {
    return new URL(provider.url || "https://text.pollinations.ai/").host;
  } catch {
    return provider.id || "";
  }
}

function completionsUrl(base) {
  const trimmed = String(base || "").trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("iptal", "AbortError"));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function buildMessages({ history, memories, notes }) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  if (memories?.length) {
    messages.push({
      role: "system",
      content: `Hatırlananlar:\n${memories.map((item) => `- ${item}`).join("\n")}`,
    });
  }
  if (notes) {
    messages.push({
      role: "system",
      content: `Araştırma notları:\n${notes}\nBu notlara dayan. Not yoksa ya da soru güncel bir değeri soruyorsa uydurma.`,
    });
  }
  for (const item of (history || []).filter((entry) => entry.role === "user" || entry.role === "assistant").slice(-12)) {
    messages.push({ role: item.role, content: String(item.text || "").slice(0, 2000) });
  }
  return messages;
}

async function readContent(response, onDelta) {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/event-stream")) {
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    if (!String(content).trim()) {
      const error = new Error("Boş yanıt");
      error.status = 502;
      throw error;
    }
    onDelta(String(content));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let emitted = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = json?.choices?.[0]?.delta?.content || "";
      if (delta) {
        emitted = true;
        onDelta(delta);
      }
    }
  }
  if (!emitted && buf.trim().startsWith("{")) {
    try {
      const data = JSON.parse(buf);
      const content = data?.choices?.[0]?.message?.content || "";
      if (content) {
        emitted = true;
        onDelta(content);
      }
    } catch {
      /* yoksay */
    }
  }
  if (!emitted) {
    const error = new Error("Boş yanıt");
    error.status = 502;
    throw error;
  }
}

async function postChat(provider, messages, onDelta, signal) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json;q=0.9",
  };
  if (provider.key) headers.Authorization = `Bearer ${provider.key}`;
  const response = await fetch(provider.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: true,
      temperature: 0.8,
    }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text.slice(0, 280) || `HTTP ${response.status}`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("retry-after") || 0);
    throw error;
  }
  await readContent(response, onDelta);
}

async function pollinationsGet(messages, onDelta, signal) {
  const system = messages
    .filter((item) => item.role === "system")
    .map((item) => item.content)
    .join("\n\n")
    .slice(0, 1200);
  const convo = messages
    .filter((item) => item.role !== "system")
    .slice(-6)
    .map((item) => `${item.role === "user" ? "Kullanıcı" : "ERO"}: ${item.content}`)
    .join("\n")
    .slice(0, 2500);
  const url = new URL(`https://text.pollinations.ai/${encodeURIComponent(convo)}`);
  url.searchParams.set("model", "openai-fast");
  url.searchParams.set("system", system);
  url.searchParams.set("seed", String(Date.now() % 100000));
  const response = await fetch(url, { signal, headers: { Accept: "text/plain" } });
  if (!response.ok) {
    const error = new Error((await response.text()).slice(0, 240) || `HTTP ${response.status}`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("retry-after") || 0);
    throw error;
  }
  const text = (await response.text()).trim();
  const cleaned = sanitizeFinal(text).spoken || text;
  if (!cleaned.trim()) throw new Error("Boş yanıt");
  onDelta(cleaned);
}

async function runProvider(provider, messages, onDelta, parentSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28000);
  const onAbort = () => ctrl.abort();
  parentSignal?.addEventListener("abort", onAbort);
  let emitted = false;
  try {
    const forward = (delta) => {
      emitted = true;
      onDelta(delta);
    };
    if (provider.kind === "get") await pollinationsGet(messages, forward, ctrl.signal);
    else await postChat(provider, messages, forward, ctrl.signal);
  } catch (error) {
    if (parentSignal?.aborted) throw new DOMException("iptal", "AbortError");
    if (emitted && error?.name !== "AbortError") error.partial = true;
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}

export async function streamChat({ messages, settings = {}, onDelta, signal, onStatus }) {
  const chain = [];
  if (settings.customBase && settings.customModel) {
    chain.push({
      id: "custom",
      label: "Özel",
      url: completionsUrl(settings.customBase),
      model: settings.customModel.trim(),
      key: settings.customKey?.trim() || "",
    });
  }
  chain.push(...KEYLESS_PROVIDERS);

  let lastError = null;
  const skippedHosts = new Set();
  for (const provider of chain) {
    if (signal?.aborted) throw new DOMException("iptal", "AbortError");
    const host = providerHost(provider);
    if (skippedHosts.has(host)) continue;
    const attempt = async () => {
      onStatus?.("Düşünüyorum…");
      await runProvider(provider, messages, onDelta, signal);
      return { id: provider.id, label: provider.label, model: provider.model };
    };
    try {
      return await attempt();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error?.partial) throw error;
      lastError = error;
      const quota = error?.status === 402 || error?.status === 429;
      if (quota) {
        onStatus?.("Ücretsiz hat dolu, başka yoldan deniyorum…");
        if (Number(error.retryAfter || 0) > 15) skippedHosts.add(host);
        else {
          try {
            await sleep(1200, signal);
          } catch (abort) {
            throw abort;
          }
        }
      }
    }
  }
  const failure = lastError || new Error("Yanıt alınamadı");
  failure.tried = true;
  throw failure;
}

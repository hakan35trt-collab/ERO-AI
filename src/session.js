import { createMic, createPcmPlayer, wavBase64 } from "./audio.js";
import { effectiveGeminiKey } from "./memory.js";
import { GEMINI_VOICE, geminiReply, geminiSpeak, liveAudioParts, openLive, systemPrompt } from "./gemini.js";
import { buildMessages, streamChat } from "./llm.js";
import { parseHomeIntent, runHomeCommand } from "./smarthome.js";
import { consumeConfirmation, noteUserText, onAndroid, phoneToolPrompt, runTool, toolDeclarations } from "./phone.js";
import { detectDelivery, explicitMemories, extractWake, forSpeech, guessEmotion, needsResearch, takeSpeakable } from "./text.js";
import { createVoice } from "./voice.js";

export function createConversation(deps) {
  let running = false;
  let live = null;
  let mic = null;
  let player = null;
  let voice = null;
  let abort = null;
  let hypothesis = "";
  let voiced = false;
  let silence = 0;
  let chunks = [];
  let turn = 0;
  let speaking = false;
  let busy = false;
  let muted = false;
  let liveHeard = "";

  function state(name) {
    deps.onState?.(name);
  }

  function voiceSystem(settings) {
    const extra = settings?.wakeWord ? "\nKullanıcı ERO diye seslenmeden uzun yanıt verme." : "";
    const phone = onAndroid() ? `\n${phoneToolPrompt()}` : "";
    return `${systemPrompt()}${extra}${phone}`;
  }

  async function takeYes(text, { speak = true } = {}) {
    noteUserText(text);
    const result = await consumeConfirmation(text);
    if (!result) return false;
    const line = result.say || (result.cancelled ? "Tamam, vazgeçtim." : "Tamam.");
    deps.onAssistant?.(line, { pending: false, emotion: result.ok ? "happy" : "" });
    if (speak) {
      if (live) live.sendText(`Tek kısa cümleyle söyle: ${line}`);
      else await speakGemini(line);
    }
    return true;
  }

  async function answerToolRounds(contents, conversational) {
    const token = turn;
    const delivery = detectDelivery(conversational);
    const tools = onAndroid() ? toolDeclarations() : undefined;
    let acc = "";
    let buf = "";
    let speakChain = Promise.resolve();
    const sayNow = (sentence) => {
      const line = forSpeech(sentence);
      if (!line) return;
      speakChain = speakChain.then(() => {
        if (token !== turn || !running) return undefined;
        return speakGemini(line);
      });
    };
    const pumpReady = (flush) => {
      const taken = takeSpeakable(buf, { flush });
      buf = taken.rest;
      for (const sentence of taken.sentences) sayNow(sentence);
    };
    for (let step = 0; step < 4; step += 1) {
      acc = "";
      buf = "";
      const reply = await geminiReply({
        apiKey: geminiKey(),
        contents,
        system: voiceSystem(deps.getSettings()),
        maxTokens: delivery === "chat" ? 160 : 640,
        tools,
        signal: signal(),
        onStatus: (label) => deps.onStatus?.(label),
        onDelta: (delta) => {
          acc += delta;
          buf += delta;
          deps.onAssistant?.(acc, { pending: true });
          pumpReady(false);
        },
      });
      if (reply.calls?.length) {
        const parts = [];
        let asked = false;
        for (const call of reply.calls) {
          const result = await runTool(call.name, call.args || {});
          parts.push({ functionResponse: { name: call.name, response: result } });
          if (result.need_yes && result.say) {
            asked = true;
            deps.onAssistant?.(result.say, { pending: false });
            await speakGemini(result.say);
          }
        }
        if (asked || token !== turn) return;
        contents.push({
          role: "model",
          parts: reply.calls.map((call) => ({ functionCall: { name: call.name, args: call.args || {} } })),
        });
        contents.push({ role: "user", parts });
        continue;
      }
      if (!acc) acc = reply.text;
      pumpReady(true);
      deps.onAssistant?.(acc, { pending: false, via: reply.model, emotion: guessEmotion(acc) });
      await speakChain;
      return;
    }
  }

  function geminiKey() {
    return effectiveGeminiKey(deps.getSettings());
  }

  function stopPlayback() {
    player?.stop();
    voice?.stopSpeaking();
    speaking = false;
  }

  function signal() {
    if (!abort || abort.signal.aborted) abort = new AbortController();
    return abort.signal;
  }

  async function ensurePlayer() {
    if (player) return;
    player = createPcmPlayer({
      onLevel: (level) => {
        if (level.speaking) {
          speaking = true;
          state("speak");
          deps.onAudio?.(level);
        } else if (speaking && !player?.active()) {
          speaking = false;
          deps.onUtterance?.("");
          if (running) state("listen");
        }
      },
    });
    player.setMuted?.(muted);
    await player.resume();
  }

  async function speakGemini(text) {
    const clean = forSpeech(text);
    if (!clean) return false;
    deps.onUtterance?.(clean);
    const key = geminiKey();
    if (!key) {
      await deps.speakFallback?.(clean);
      return false;
    }
    await ensurePlayer();
    speaking = true;
    state("speak");
    try {
      const audio = await geminiSpeak({ apiKey: key, text: clean, signal: signal() });
      player.play(audio.pcm);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      await deps.speakFallback?.(clean);
      return false;
    }
  }

  async function saySentences(source) {
    let buf = source;
    const taken = takeSpeakable(buf, { flush: true });
    for (const sentence of taken.sentences) {
      if (!running) return;
      await speakGemini(sentence);
    }
  }

  async function answerText(text) {
    const token = ++turn;
    const memory = explicitMemories(text);
    if (memory.facts.length) deps.onMemories?.(memory.facts);
    let conversational = memory.facts.length ? memory.remainder : text;
    if (memory.facts.length && !conversational) {
      const line = "Tamam, bunu hatırlayacağım.";
      deps.onAssistant?.(line, { pending: false, emotion: "happy" });
      await speakGemini(line);
      state("listen");
      return;
    }
    const intent = parseHomeIntent(conversational);
    if (intent.matched) {
      const result = await deps.onHome?.(intent);
      const line = result?.confirm || intent.confirm;
      deps.onAssistant?.(line, { pending: false, emotion: "happy" });
      if (live) live.sendText(line);
      else await speakGemini(line);
      if (!intent.remainder || token !== turn) {
        state("listen");
        return;
      }
      conversational = intent.remainder;
    }
    const settings = deps.getSettings();
    let notes = "";
    if (needsResearch(conversational)) {
      state("think");
      notes = await deps.research(conversational);
      if (notes) deps.onResearch?.(notes);
    }
    if (token !== turn) return;
    const history = deps.getHistory();
    const memories = await deps.getMemories();
    state("think");
    if (geminiKey()) {
      const contents = [];
      if (memories.length) contents.push({ role: "user", parts: [{ text: `Hatırlananlar:\n${memories.map((item) => `- ${item}`).join("\n")}` }] }, { role: "model", parts: [{ text: "Anıları kullanırım." }] });
      if (notes) contents.push({ role: "user", parts: [{ text: `Araştırma notları:\n${notes}` }] }, { role: "model", parts: [{ text: "Notlara dayanırım." }] });
      for (const item of history.filter((entry) => entry.role === "user" || entry.role === "assistant").slice(-12)) {
        contents.push({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: String(item.text || "").slice(0, 1500) }] });
      }
      try {
        await answerToolRounds(contents, conversational);
      } catch (error) {
        if (error?.name === "AbortError" || token !== turn) return;
        await keylessAnswer(conversational, notes, token);
      }
    } else {
      await keylessAnswer(conversational, notes, token);
    }
    state(running ? "listen" : "idle");
  }

  async function keylessAnswer(text, notes, token) {
    const history = deps.getHistory();
    const memories = await deps.getMemories();
    const messages = buildMessages({ history, memories, notes });
    let acc = "";
    let buf = "";
    const style = detectDelivery(text);
    try {
      await streamChat({
        messages,
        settings: deps.getSettings(),
        signal: signal(),
        onStatus: (label) => deps.onStatus?.(label),
        onDelta: (delta) => {
          acc += delta;
          buf += delta;
          deps.onAssistant?.(acc, { pending: true });
          const taken = takeSpeakable(buf, { flush: false });
          buf = taken.rest;
          for (const sentence of taken.sentences) deps.speakFallback?.(forSpeech(sentence), style);
        },
      });
      const taken = takeSpeakable(buf, { flush: true });
      for (const sentence of taken.sentences) deps.speakFallback?.(forSpeech(sentence), style);
      deps.onAssistant?.(acc, { pending: false, via: "yedek", emotion: guessEmotion(acc) });
    } catch (error) {
      if (error?.name === "AbortError" || token !== turn) return;
      const line = error?.status === 429 || error?.status === 402
        ? "Ücretsiz hat şu an dolu. Biraz sonra yeniden dene."
        : "Şu an yanıt veremedim. Biraz sonra yeniden dene.";
      deps.onAssistant?.(line, { pending: false, error: true });
      deps.onStatus?.(line);
      deps.speakFallback?.(line);
    }
  }

  async function finishUtterance(text) {
    if (busy) return;
    busy = true;
    let spoken = String(text || hypothesis || "").trim();
    hypothesis = "";
    voiced = false;
    silence = 0;
    if (spoken && deps.getSettings().wakeWord) {
      const woken = extractWake(spoken);
      if (!woken.wake) {
        busy = false;
        return;
      }
      spoken = woken.rest || "buradayım";
    }
    const recorded = chunks.splice(0);
    try {
    if (!spoken && recorded.length < 2) return;
    if (spoken) {
      deps.onUser?.(spoken);
      if (await takeYes(spoken)) return;
      await answerText(spoken);
      return;
    }
    const key = geminiKey();
    if (!key) {
      busy = false;
      return;
    }
    state("think");
    let heardAudio = "";
    const merged = concatPcm(recorded);
    try {
      const data = await geminiReply({
        apiKey: key,
        signal: signal(),
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: "audio/wav", data: wavBase64(merged, 16000) } },
            { text: "Bunu bir arkadaşın söyledi. Kısa, sıcak, konuşur gibi cevap ver." },
          ],
        }],
        onDelta: (delta) => {
          heardAudio = `${heardAudio}${delta}`;
          deps.onAssistant?.(heardAudio, { pending: true });
        },
      });
      deps.onAssistant?.(data.text, { pending: false, via: data.model, emotion: guessEmotion(data.text) });
      await saySentences(data.text);
    } catch (error) {
      if (error?.name !== "AbortError") deps.onStatus?.("Seni duyamadım. Tekrar söyler misin?");
    }
    if (running) state("listen");
    } finally {
      busy = false;
    }
  }

  function onMic(frame) {
    if (!running) return;
    const loud = frame.rms > 0.045;
    if (speaking || player?.active()) {
      if (loud && frame.rms > 0.12) {
        stopPlayback();
        if (live) live.sendPcm(frame.pcm16);
      }
      return;
    }
    if (live) {
      live.sendPcm(frame.pcm16);
      deps.onLevel?.(frame.rms);
      return;
    }
    if (loud) {
      voiced = true;
      silence = 0;
      if (chunks.length < 80) chunks.push(frame.pcm16);
      deps.onLevel?.(frame.rms);
      return;
    }
    if (!voiced) return;
    silence += (frame.samples.length / frame.sampleRate) * 1000;
    if (silence >= 420) finishUtterance(hypothesis);
  }

  function handleLive(message) {
    if (message.closed) {
      deps.onStatus?.("Canlı bağlantı kapandı. Yeniden başlatabilirsin.");
      return;
    }
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) stopPlayback();
    for (const pcm of liveAudioParts(message)) {
      speaking = true;
      state("speak");
      player.play(pcm);
    }
    const heardText = content.inputTranscription?.text;
    if (heardText) {
      if (!liveHeard || heardText.startsWith(liveHeard)) liveHeard = heardText;
      else if (!liveHeard.startsWith(heardText)) liveHeard += heardText;
      noteUserText(liveHeard);
      deps.onUser?.(liveHeard, { partial: true });
    }
    if (content.turnComplete && liveHeard) {
      const said = liveHeard;
      liveHeard = "";
      const intent = parseHomeIntent(said);
      if (intent.matched) deps.onHome?.(intent);
      deps.onUser?.(said, { partial: false });
      takeYes(said, { speak: false });
    }
    const said = content.outputTranscription?.text;
    if (said) {
      deps.onAssistant?.(said, { pending: !content.turnComplete, via: live?.model, emotion: guessEmotion(said) });
      deps.onUtterance?.(said);
    }
    if (content.turnComplete) {
      speaking = false;
      if (running) state("listen");
    }
  }

  async function start() {
    if (running) return true;
    running = true;
    abort = new AbortController();
    player = createPcmPlayer({
      onLevel: (level) => {
        if (level.speaking) {
          speaking = true;
          state("speak");
          deps.onAudio?.(level);
        } else if (speaking && !player.active()) {
          speaking = false;
          deps.onUtterance?.("");
          if (running) state("listen");
        }
      },
    });
    player.setMuted?.(muted);
    await player.resume();
    const settings = deps.getSettings();
    if (geminiKey()) {
      try {
        live = await openLive({
          apiKey: geminiKey(),
          system: voiceSystem(settings),
          tools: onAndroid() ? toolDeclarations() : undefined,
          signal: abort.signal,
          onEvent: handleLive,
          onTool: async (calls) => {
            const responses = [];
            for (const call of calls) {
              const result = await runTool(call.name, call.args || {});
              if (result.need_yes && result.say) deps.onAssistant?.(result.say, { pending: false });
              responses.push({ id: call.id || "", name: call.name, response: result });
            }
            return responses;
          },
        });
        deps.onStatus?.(`Canlı konuşma açık · ${live.model} · ${GEMINI_VOICE}`);
      } catch {
        live = null;
        deps.onStatus?.("Canlı ses açılamadı. Cümle bitince Gemini yanıtlayacak.");
      }
    }
    if (!live && !geminiKey()) {
      voice = createVoice({
        getSettings: deps.getSettings,
        onInterim: (text) => {
          hypothesis = text;
          deps.onPartialUser?.(text);
        },
        onFinal: (text) => {
          hypothesis = text;
          finishUtterance(text);
        },
        onSpeakStart: () => state("speak"),
        onSpeakEnd: () => {
          if (running) state("listen");
        },
        onError: (error) => deps.onStatus?.(error.message),
      });
      await voice.start({ handsFree: true });
    }
    if (live || geminiKey()) {
      mic = createMic({ onFrame: onMic });
      try {
        await mic.start();
      } catch {
        running = false;
        deps.onStatus?.("Mikrofon izni olmadan konuşamam.");
        stop();
        return false;
      }
    } else if (!voice) {
      running = false;
      deps.onStatus?.("Mikrofon izni olmadan konuşamam.");
      return false;
    }
    state("listen");
    try { globalThis.EroNative?.call?.("pauseListening", "{}"); } catch { /* tarayıcı */ }
    return true;
  }

  function stop() {
    running = false;
    turn += 1;
    abort?.abort();
    stopPlayback();
    live?.close();
    mic?.stop();
    voice?.stop();
    player?.close();
    live = null;
    mic = null;
    voice = null;
    player = null;
    hypothesis = "";
    voiced = false;
    chunks = [];
    state("idle");
    try { globalThis.EroNative?.call?.("resumeListening", "{}"); } catch { /* tarayıcı */ }
  }

  return {
    start,
    stop,
    ask: (text) => {
      const clean = String(text || "").trim();
      if (!clean) return null;
      noteUserText(clean);
      deps.onUser?.(clean, { partial: false });
      return (async () => {
        if (await takeYes(clean)) return null;
        if (live) {
          live.sendText(clean);
          const intent = parseHomeIntent(clean);
          if (intent.matched) deps.onHome?.(intent);
          return null;
        }
        return answerText(clean);
      })();
    },
    active: () => running,
    setMuted(value) {
      muted = Boolean(value);
      player?.setMuted?.(muted);
    },
    liveModel: () => live?.model || "",
  };
}

function concatPcm(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Int16Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

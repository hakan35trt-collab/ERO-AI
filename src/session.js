import { createMic, createPcmPlayer, wavBase64 } from "./audio.js";
import { GEMINI_VOICE, geminiReply, geminiSpeak, liveAudioParts, openLive, systemPrompt } from "./gemini.js";
import { buildMessages, streamChat } from "./llm.js";
import { parseHomeIntent, runHomeCommand } from "./smarthome.js";
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
    const key = deps.getSettings().geminiKey;
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
      if (live) live.sendText(`Kısa ve sıcak söyle: ${line}`);
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
    if (token !== turn || !running) return;
    const history = deps.getHistory();
    const memories = await deps.getMemories();
    state("think");
    if (settings.geminiKey) {
      const contents = [];
      if (memories.length) contents.push({ role: "user", parts: [{ text: `Hatırlananlar:\n${memories.map((item) => `- ${item}`).join("\n")}` }] }, { role: "model", parts: [{ text: "Anıları kullanırım." }] });
      if (notes) contents.push({ role: "user", parts: [{ text: `Araştırma notları:\n${notes}` }] }, { role: "model", parts: [{ text: "Notlara dayanırım." }] });
      for (const item of history.filter((entry) => entry.role === "user" || entry.role === "assistant").slice(-12)) {
        contents.push({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: String(item.text || "").slice(0, 1500) }] });
      }
      let acc = "";
      let buf = "";
      const queued = [];
      const pumpReady = async (flush) => {
        const taken = takeSpeakable(buf, { flush });
        buf = taken.rest;
        for (const sentence of taken.sentences) queued.push(forSpeech(sentence));
      };
      try {
        const reply = await geminiReply({
          apiKey: settings.geminiKey,
          contents,
          system: systemPrompt(),
        signal: signal(),
        onStatus: (label) => deps.onStatus?.(label),
        onDelta: (delta) => {
          acc += delta;
          buf += delta;
            deps.onAssistant?.(acc, { pending: true });
            pumpReady(false);
          },
        });
        if (!acc) acc = reply.text;
        await pumpReady(true);
        deps.onAssistant?.(acc, { pending: false, via: reply.model, emotion: guessEmotion(acc) });
        for (const sentence of queued) {
          if (token !== turn || !running) return;
          await speakGemini(sentence);
        }
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
      await answerText(spoken);
      return;
    }
    const key = deps.getSettings().geminiKey;
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
            { text: "Bu kayıttaki Türkçe cümleyi duy ve ERO olarak kısa, sıcak bir yanıt yaz. Yalnızca söylenecek yanıtı yaz." },
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
    if (silence >= 700) finishUtterance(hypothesis);
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
      deps.onUser?.(liveHeard, { partial: true });
    }
    if (content.turnComplete && liveHeard) {
      const intent = parseHomeIntent(liveHeard);
      if (intent.matched) deps.onHome?.(intent);
      deps.onUser?.(liveHeard, { partial: false });
      liveHeard = "";
    }
    const said = content.outputTranscription?.text;
    if (said) deps.onAssistant?.(said, { pending: !content.turnComplete, via: live?.model, emotion: guessEmotion(said) });
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
          if (running) state("listen");
        }
      },
    });
    player.setMuted?.(muted);
    await player.resume();
    const settings = deps.getSettings();
    if (settings.geminiKey) {
      try {
        live = await openLive({
          apiKey: settings.geminiKey,
          system: `${systemPrompt()}\nSesin sıcak bir erkek arkadaş. Kısa konuş.${settings.wakeWord ? "\nKullanıcı ERO diye seslenmeden uzun yanıt verme." : ""}`,
          signal: abort.signal,
          onEvent: handleLive,
        });
        deps.onStatus?.(`Canlı konuşma açık · ${live.model} · ${GEMINI_VOICE}`);
      } catch {
        live = null;
        deps.onStatus?.("Canlı ses açılamadı. Cümle bitince Gemini yanıtlayacak.");
      }
    }
    if (!live && !settings.geminiKey) {
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
    if (live || settings.geminiKey) {
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
  }

  return {
    start,
    stop,
    ask: (text) => {
      const clean = String(text || "").trim();
      if (!clean) return null;
      deps.onUser?.(clean, { partial: false });
      if (live) {
        live.sendText(clean);
        const intent = parseHomeIntent(clean);
        if (intent.matched) deps.onHome?.(intent);
        return null;
      }
      return answerText(clean);
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

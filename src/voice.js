import { rankScore, visemeForChar } from "./text.js";

const SONG_PITCH = [1.12, 1.0, 1.2, 0.94, 1.16, 1.05, 1.24, 0.98];

export function rankVoices(voices) {
  return [...voices].sort((a, b) => rankScore(b) - rankScore(a));
}

export function createVoice({ getSettings, onFinal, onInterim, onVolume, onViseme, onSpeakStart, onSpeakEnd, onError }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let wantListen = false;
  let handsFree = false;
  let audio = null;
  let raf = 0;
  const queue = [];
  let pumping = false;
  let speaking = false;
  let epoch = 0;
  let songStep = 0;
  let currentText = "";
  let keepAlive = 0;

  function supported() {
    return Boolean(Recognition);
  }

  function unlock() {
    if (!window.speechSynthesis) return;
    try {
      window.speechSynthesis.resume();
    } catch {
      /* yoksay */
    }
  }

  function voices() {
    if (!window.speechSynthesis) return [];
    return rankVoices(window.speechSynthesis.getVoices());
  }

  function pickVoice() {
    const list = voices();
    const chosen = getSettings().voiceURI;
    return list.find((voice) => voice.voiceURI === chosen) || list[0] || null;
  }

  async function start(options = {}) {
    handsFree = Boolean(options.handsFree);
    wantListen = true;
    if (!Recognition) {
      onError?.({ code: "unsupported", message: "Bu tarayıcı konuşmayı yazıya çeviremiyor." });
      return false;
    }
    startLevel();
    if (!recognition) {
      recognition = new Recognition();
      recognition.lang = "tr-TR";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        let interim = "";
        let finalText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0]?.transcript || "";
          if (event.results[i].isFinal) finalText += piece;
          else interim += piece;
        }
        if (interim.trim()) onInterim?.(interim.trim());
        if (finalText.trim()) onFinal?.(finalText.trim());
      };
      recognition.onerror = (event) => {
        const code = event.error || "error";
        if (code === "aborted" || code === "no-speech") return;
        onError?.({ code, message: messageFor(code) });
        if (code === "not-allowed" || code === "service-not-allowed") wantListen = false;
      };
      recognition.onend = () => {
        if (!wantListen) return;
        setTimeout(() => {
          if (!wantListen || !recognition) return;
          try {
            recognition.start();
          } catch {
            /* zaten açık */
          }
        }, 280);
      };
    }
    try {
      recognition.start();
    } catch {
      /* zaten dinliyor */
    }
    return true;
  }

  function stop() {
    wantListen = false;
    handsFree = false;
    try {
      recognition?.stop();
    } catch {
      /* yoksay */
    }
    stopLevel();
    onVolume?.(0);
  }

  function listening() {
    return wantListen;
  }

  async function startLevel() {
    if (audio || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      const context = new AudioContext();
      if (context.state === "suspended") await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      audio = { stream, context, analyser, data };
      const tick = () => {
        if (!audio) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const x = (value - 128) / 128;
          sum += x * x;
        }
        onVolume?.(Math.min(1, Math.sqrt(sum / data.length) * 3.4));
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      onVolume?.(0);
    }
  }

  function stopLevel() {
    cancelAnimationFrame(raf);
    audio?.stream.getTracks().forEach((track) => track.stop());
    audio?.context.close().catch(() => {});
    audio = null;
  }

  function speak(text, style = "chat") {
    const clean = String(text || "").trim();
    if (!clean) return;
    const settings = getSettings();
    let rate = Number(settings.rate) || 1;
    let pitch = Number(settings.pitch) || 1;
    let gap = 50;
    if (style === "song") {
      pitch *= SONG_PITCH[songStep % SONG_PITCH.length];
      songStep += 1;
      rate *= 0.92;
      gap = 170;
    } else if (style === "poem") {
      rate *= 0.88;
      pitch *= 0.98;
      gap = 240;
    } else if (style === "story") {
      rate *= 0.97;
      gap = 90;
    }
    queue.push({
      text: clean,
      rate: Math.min(1.35, Math.max(0.7, rate)),
      pitch: Math.min(1.6, Math.max(0.7, pitch)),
      gap,
    });
    pump();
  }

  function pump() {
    if (pumping || !queue.length) {
      if (!pumping && speaking && !queue.length) {
        speaking = false;
        currentText = "";
        onViseme?.(null);
        onSpeakEnd?.();
        stopKeepAlive();
      }
      return;
    }
    pumping = true;
    const item = queue.shift();
    const token = epoch;
    currentText = item.text;
    if (!window.speechSynthesis) {
      simulate(item, token);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = "tr-TR";
    utterance.rate = item.rate;
    utterance.pitch = item.pitch;
    utterance.volume = 1;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    let started = false;
    let settled = false;
    let visemeTimer = 0;
    const finish = () => {
      if (settled || token !== epoch) return;
      settled = true;
      clearInterval(visemeTimer);
      pumping = false;
      setTimeout(() => {
        if (token !== epoch) return;
        pump();
      }, item.gap);
    };
    utterance.onstart = () => {
      if (token !== epoch || settled) return;
      started = true;
      speaking = true;
      onSpeakStart?.(item.text);
      startKeepAlive();
      let index = 0;
      visemeTimer = setInterval(() => {
        if (token !== epoch) return;
        onViseme?.(visemeForChar(item.text[index] || " "));
        index = (index + 1) % item.text.length;
      }, 75);
    };
    utterance.onboundary = (event) => {
      if (typeof event.charIndex === "number") onViseme?.(visemeForChar(item.text[event.charIndex] || " "));
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
    setTimeout(() => {
      if (token !== epoch || started || settled) return;
      settled = true;
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* yoksay */
      }
      simulate(item, token);
    }, 1600);
  }

  function simulate(item, token) {
    speaking = true;
    onSpeakStart?.(item.text);
    let index = 0;
    const timer = setInterval(() => {
      if (token !== epoch) {
        clearInterval(timer);
        return;
      }
      onViseme?.(visemeForChar(item.text[index] || " "));
      index += 1;
      if (index >= item.text.length) {
        clearInterval(timer);
        pumping = false;
        setTimeout(() => {
          if (token !== epoch) return;
          pump();
        }, item.gap);
      }
    }, 62);
  }

  function startKeepAlive() {
    if (keepAlive || !window.speechSynthesis) return;
    keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
    }, 8000);
  }

  function stopKeepAlive() {
    clearInterval(keepAlive);
    keepAlive = 0;
  }

  function stopSpeaking() {
    epoch += 1;
    queue.length = 0;
    pumping = false;
    speaking = false;
    currentText = "";
    songStep = 0;
    stopKeepAlive();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* yoksay */
    }
    onViseme?.(null);
    onSpeakEnd?.();
  }

  function lastSpoken() {
    return currentText;
  }

  return {
    supported,
    unlock,
    voices,
    start,
    stop,
    listening,
    speak,
    stopSpeaking,
    isSpeaking: () => speaking,
    lastSpoken,
  };
}

function messageFor(code) {
  if (code === "not-allowed" || code === "service-not-allowed") return "Mikrofon izni verilmedi.";
  if (code === "network") return "Ses tanıma servisine ulaşılamadı. Chrome veya Android bağlantısı gerekir.";
  if (code === "language-not-supported") return "Bu tarayıcı tr-TR tanımayı desteklemiyor.";
  if (code === "audio-capture") return "Mikrofon bulunamadı.";
  return "Mikrofon durdu.";
}

export function isEcho(heard, spoken) {
  const h = heard.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
  const s = spoken.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
  if (!h || !s) return false;
  if (h.length > 10 && s.includes(h)) return true;
  if (s.length > 12 && h.includes(s.slice(0, Math.min(40, s.length)))) return true;
  return false;
}

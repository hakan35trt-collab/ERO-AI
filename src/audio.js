export function rmsOf(samples) {
  let sum = 0;
  const list = samples || [];
  for (let i = 0; i < list.length; i++) sum += list[i] * list[i];
  return list.length ? Math.sqrt(sum / list.length) : 0;
}

export function floatToPcm16(float32, inRate, outRate = 16000) {
  const input = float32;
  const ratio = Math.max(1, inRate / outRate);
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const sample = Math.max(-1, Math.min(1, sum / (end - start)));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}

export function pcm16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function wavBase64(int16, rate = 16000) {
  const bytes = int16.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, bytes, true);
  let offset = 44;
  for (let i = 0; i < int16.length; i += 1) {
    view.setInt16(offset, int16[i], true);
    offset += 2;
  }
  return pcm16ToBase64(new Int16Array(buffer));
}

export function base64ToPcm16(value) {
  const binary = atob(value || "");
  const even = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(even);
  for (let i = 0; i < even; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export function createMic({ onFrame } = {}) {
  let context = null;
  let stream = null;
  let processor = null;
  let mute = null;

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    context = new AudioContext();
    if (context.state === "suspended") await context.resume();
    const source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    mute = context.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(channel);
      onFrame?.({
        samples: copy,
        rms: rmsOf(copy),
        sampleRate: context.sampleRate,
        pcm16: floatToPcm16(copy, context.sampleRate, 16000),
      });
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    return true;
  }

  function stop() {
    processor?.disconnect();
    mute?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    context?.close().catch(() => {});
    processor = null;
    mute = null;
    stream = null;
    context = null;
  }

  return { start, stop };
}

export function createPcmPlayer({ sampleRate = 24000, onLevel } = {}) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const context = new AudioCtx();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const gain = context.createGain();
  gain.connect(context.destination);
  const wave = new Uint8Array(analyser.fftSize);
  const freq = new Uint8Array(analyser.frequencyBinCount);
  const playing = new Set();
  let next = 0;
  let raf = 0;

  const tick = () => {
    analyser.getByteTimeDomainData(wave);
    analyser.getByteFrequencyData(freq);
    let sum = 0;
    for (const value of wave) {
      const x = (value - 128) / 128;
      sum += x * x;
    }
    let weighted = 0;
    let energy = 0;
    for (let i = 0; i < freq.length; i++) {
      weighted += i * freq[i];
      energy += freq[i];
    }
    onLevel?.({
      rms: Math.sqrt(sum / wave.length),
      centroid: energy ? weighted / energy / freq.length : 0,
      speaking: playing.size > 0 || context.currentTime < next - 0.05,
    });
    raf = requestAnimationFrame(tick);
  };

  async function resume() {
    if (context.state === "suspended") await context.resume();
    if (!raf) tick();
  }

  function play(int16) {
    if (!int16?.length) return;
    const buffer = context.createBuffer(1, int16.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.connect(analyser);
    const when = Math.max(context.currentTime + 0.02, next);
    source.start(when);
    next = when + buffer.duration;
    playing.add(source);
    source.onended = () => playing.delete(source);
  }

  function stop() {
    for (const source of playing) {
      try {
        source.stop();
      } catch {
        /* yoksay */
      }
    }
    playing.clear();
    next = 0;
  }

  function close() {
    stop();
    cancelAnimationFrame(raf);
    context.close().catch(() => {});
  }

  function active() {
    return playing.size > 0 || context.currentTime < next - 0.05;
  }

  function setMuted(value) {
    gain.gain.value = value ? 0 : 1;
  }

  return { resume, play, stop, close, active, setMuted, context };
}

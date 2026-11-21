export const AVATAR_SIZE = { width: 864, height: 1152 };

const MOUTH = ["a", "e", "i", "o", "u"];

export function resolveViseme(name) {
  if (name === "fv") return "u";
  if (name === "ltd") return "e";
  if (name === "s") return "i";
  if (MOUTH.includes(name)) return name;
  return null;
}

export function visemeFromAudio({ rms = 0, centroid = 0 } = {}) {
  if (rms < 0.035) return "rest";
  if (rms < 0.07 && centroid < 0.32) return "mbp";
  if (centroid > 0.72) return "i";
  if (centroid > 0.58) return rms > 0.16 ? "e" : "s";
  if (centroid < 0.22) return rms > 0.16 ? "u" : "mbp";
  if (centroid < 0.36 && rms > 0.12) return "o";
  if (rms > 0.2) return "a";
  if (centroid > 0.45) return "fv";
  return "ltd";
}

export function visemeFromChar(ch) {
  const c = String(ch || " ").toLocaleLowerCase("tr-TR");
  if ("mbp".includes(c)) return "mbp";
  if (c === "f" || c === "v") return "fv";
  if ("ltdnç".includes(c)) return "ltd";
  if ("szşj".includes(c)) return "s";
  if (c === "a" || c === "â") return "a";
  if (c === "e" || c === "é") return "e";
  if (c === "i" || c === "ı" || c === "î") return "i";
  if (c === "o" || c === "ö" || c === "ô") return "o";
  if (c === "u" || c === "ü" || c === "û") return "u";
  if (" \n\t.,!?:;…".includes(c)) return "rest";
  return "e";
}

export function visemeFromShape(shape) {
  if (!shape || typeof shape !== "object") return "rest";
  if (shape.open < 0.08) return "rest";
  if (shape.round > 0.72 && shape.open < 0.5) return "u";
  if (shape.round > 0.55) return "o";
  if (shape.open > 0.75) return "a";
  if (shape.smile > 0.18 && shape.open < 0.42) return "i";
  if (shape.open < 0.18) return "mbp";
  return "e";
}

function rootUrl(base) {
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${root}avatar/`;
}

export function createAvatar(canvas, { base = import.meta.env?.BASE_URL || "./" } = {}) {
  const ctx = canvas.getContext("2d");
  const images = new Map();
  let manifest = null;
  let mode = "idle";
  let viseme = "rest";
  let shown = "rest";
  let blend = 1;
  let blink = 0;
  let wink = 0;
  let nextBlink = performance.now() + 2200;
  let level = 0;
  let emotion = "";
  let emotionUntil = 0;
  let running = true;
  const fadeMs = 180;
  const life = {
    glance: "",
    glanceUntil: 0,
    nextGlance: performance.now() + 1800,
    brow: "",
    browUntil: 0,
    nextBrow: performance.now() + 3200,
    head: "",
    headUntil: 0,
    nextHead: performance.now() + 2600,
  };
  const layers = {
    head: { prev: "", next: "", at: 0 },
    emotion: { prev: "", next: "", at: 0 },
    eyes: { prev: "", next: "", at: 0 },
    brow: { prev: "", next: "", at: 0 },
  };

  function collectFiles(value, files) {
    if (!value || typeof value !== "object") return;
    if (typeof value.file === "string") files.add(value.file);
    for (const child of Object.values(value)) collectFiles(child, files);
  }

  async function loadImage(file) {
    const image = new Image();
    image.decoding = "async";
    image.src = `${rootUrl(base)}${file}`;
    await image.decode().catch(() => {});
    images.set(file, image);
  }

  const ready = (async () => {
    const response = await fetch(`${rootUrl(base)}manifest.json`);
    manifest = await response.json();
    const files = new Set([manifest.base]);
    collectFiles(manifest, files);
    await Promise.all([...files].map(loadImage));
  })();

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  function retarget(slot, want, now) {
    const next = want || "";
    if (slot.next === next) return;
    slot.prev = slot.next;
    slot.next = next;
    slot.at = now;
  }

  function layerAlpha(slot, which, now) {
    const t = Math.min(1, Math.max(0, (now - slot.at) / fadeMs));
    if (which === "next") return slot.next ? t : 0;
    if (!slot.prev || slot.prev === slot.next) return 0;
    return 1 - t;
  }

  function drawImage(file, x, y, width, height) {
    const image = images.get(file);
    if (!image?.naturalWidth) return;
    ctx.drawImage(image, x, y, width, height);
  }

  function hold(now, key, choices, gap) {
    if (now < life[key === "glance" ? "nextGlance" : key === "brow" ? "nextBrow" : "nextHead"]) return;
    const pick = choices[Math.floor(Math.random() * choices.length)];
    const until = now + 650 + Math.random() * 700;
    if (key === "glance") {
      life.glance = pick;
      life.glanceUntil = until;
      life.nextGlance = until + gap + Math.random() * gap;
    } else if (key === "brow") {
      life.brow = pick;
      life.browUntil = until;
      life.nextBrow = until + gap + Math.random() * gap;
    } else {
      life.head = pick;
      life.headUntil = until;
      life.nextHead = until + gap + Math.random() * gap;
    }
  }

  function frame(now) {
    if (!running) return;
    resize();
    if (mode === "speak") {
      blend += (1 - blend) * 0.38;
      if (blend > 0.94) {
        shown = viseme;
        blend = 1;
      }
    } else {
      viseme = "rest";
      shown = "rest";
      blend = 1;
    }
    const showEmotion = Boolean(emotion) && (mode === "speak" || now < emotionUntil);
    if (mode === "listen") {
      retarget(layers.head, Math.floor(now / 900) % 2 === 0 ? "down" : "", now);
      retarget(layers.brow, "raise", now);
      retarget(layers.eyes, "", now);
      retarget(layers.emotion, "", now);
    } else if (mode === "think") {
      retarget(layers.head, "", now);
      retarget(layers.eyes, "up", now);
      retarget(layers.brow, "frown", now);
      retarget(layers.emotion, "confused", now);
    } else if (showEmotion) {
      retarget(layers.head, "", now);
      retarget(layers.eyes, "", now);
      retarget(layers.brow, "", now);
      retarget(layers.emotion, emotion, now);
    } else {
      hold(now, "glance", ["left", "right", "up", "down", ""], 1400);
      hold(now, "brow", ["raise", ""], 2800);
      hold(now, "head", ["left", "right", "up", "down", "tilt", ""], 1800);
      if (now > life.glanceUntil) life.glance = "";
      if (now > life.browUntil) life.brow = "";
      if (now > life.headUntil) life.head = "";
      retarget(layers.eyes, life.glance, now);
      retarget(layers.brow, life.brow, now);
      retarget(layers.head, life.head, now);
      retarget(layers.emotion, "", now);
    }
    if (now > nextBlink) {
      if (mode === "idle" && !showEmotion && Math.random() < 0.16) wink = 1;
      else blink = 1;
      nextBlink = now + 2000 + Math.random() * 4000;
    }
    if (blink > 0) blink = Math.max(0, blink - 0.08);
    if (wink > 0) wink = Math.max(0, wink - 0.05);

    const width = manifest?.width || AVATAR_SIZE.width;
    const height = manifest?.height || AVATAR_SIZE.height;
    const breath = 1 + Math.sin(now / 1700) * 0.012;
    const fit = Math.min(canvas.width / width, canvas.height / height) * 0.96 * breath;
    const drawW = width * fit;
    const drawH = height * fit;
    const sway = Math.sin(now / 2100) * 2.2 * fit;
    const originX = (canvas.width - drawW) / 2 + sway;
    const originY = (canvas.height - drawH) / 2 + Math.sin(now / 1700) * fit * 3;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!manifest) {
      requestAnimationFrame(frame);
      return;
    }
    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(fit, fit);
    drawImage(manifest.base, 0, 0, width, height);
    const paintPatch = (spec, alpha) => {
      if (!spec?.file || alpha < 0.03) return;
      const image = images.get(spec.file);
      if (!image?.naturalWidth) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(image, spec.x, spec.y, spec.w, spec.h);
      ctx.globalAlpha = 1;
    };
    const paintLayer = (slot, group) => {
      paintPatch(group?.[slot.prev], layerAlpha(slot, "prev", now));
      paintPatch(group?.[slot.next], layerAlpha(slot, "next", now));
    };
    paintLayer(layers.head, manifest.head);
    paintLayer(layers.emotion, manifest.emotions);
    paintLayer(layers.eyes, manifest.eyes);
    paintLayer(layers.brow, manifest.brows);
    const paintMouth = (name, alpha) => {
      const key = resolveViseme(name);
      paintPatch(key ? manifest.mouth?.[key] : null, alpha);
    };
    if (mode === "speak") {
      paintMouth(shown, 0.35 + blend * 0.65);
      if (shown !== viseme) paintMouth(viseme, 1 - blend);
    }
    const winkPatch = manifest.brows?.wink;
    if (winkPatch && wink > 0.04) paintPatch(winkPatch, Math.min(1, wink * 1.4));
    if (manifest.eyes?.blink && blink > 0.04) paintPatch(manifest.eyes.blink, Math.min(1, blink * 1.35));
    ctx.globalCompositeOperation = "destination-in";
    const fade = ctx.createRadialGradient(width * 0.5, height * 0.46, width * 0.2, width * 0.5, height * 0.48, width * 0.58);
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(0.72, "rgba(0,0,0,1)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(-40, -40, width + 80, height + 80);
    ctx.restore();
    if (mode === "listen") {
      ctx.strokeStyle = `rgba(46, 230, 214, ${0.28 + Math.min(1, level) * 0.6})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2, originY + drawH * 0.9, drawW * 0.22, 8 + level * 16, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    ready,
    setMode(next) {
      const name = next || "idle";
      mode = name === "happy" ? "idle" : name === "surprised" ? "idle" : name;
      if (next === "happy") this.setEmotion("joy");
      if (next === "surprised") this.setEmotion("surprised");
    },
    setEmotion(next) {
      const map = { happy: "joy", curious: "confused", think: "confused", neutral: "" };
      emotion = map[next] ?? next ?? "";
      if (!emotion) return;
      emotionUntil = performance.now() + 5200;
    },
    setViseme(next) {
      const name = typeof next === "object" ? visemeFromShape(next) : (next || "rest");
      if (name === viseme) return;
      shown = viseme;
      viseme = name;
      blend = 0.2;
    },
    setLevel(value) {
      level = Math.max(0, Math.min(1, value || 0));
    },
    setAudio({ rms, centroid } = {}) {
      level = rms || 0;
      if (mode === "speak") this.setViseme(visemeFromAudio({ rms, centroid }));
    },
    destroy() {
      running = false;
      observer.disconnect();
    },
  };
}

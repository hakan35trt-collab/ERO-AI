export function createWave(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  let mode = "idle";
  let level = 0.08;
  let target = 0.08;
  let alive = true;
  let tick = 0;
  const bars = 56;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.floor((rect.width || 360) * dpr));
    const height = Math.max(2, Math.floor((rect.height || 480) * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function amp() {
    if (mode === "speak") return 0.55 + level * 0.45;
    if (mode === "listen") return 0.22 + level * 0.78;
    if (mode === "think") return 0.34 + Math.sin(tick * 0.08) * 0.08;
    return 0.1 + Math.sin(tick * 0.02) * 0.03;
  }

  function draw() {
    if (!alive) return;
    resize();
    tick += 1;
    level += (target - level) * (mode === "speak" ? 0.28 : 0.14);
    if (mode === "speak") target = 0.42 + Math.abs(Math.sin(tick * 0.19)) * 0.5;
    if (mode === "idle") target += (0.1 - target) * 0.04;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.46;
    const energy = amp();
    ctx.clearRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, Math.min(w, h) * 0.46);
    glow.addColorStop(0, mode === "think" ? "rgba(255, 211, 90, 0.16)" : "rgba(46, 230, 214, 0.22)");
    glow.addColorStop(1, "rgba(5, 8, 16, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const radius = Math.min(w, h) * (0.16 + energy * 0.05);
    const core = ctx.createRadialGradient(cx, cy - radius * 0.2, radius * 0.1, cx, cy, radius);
    if (mode === "think") {
      core.addColorStop(0, "#fff4c8");
      core.addColorStop(0.45, "#ffd35a");
      core.addColorStop(1, "rgba(255, 180, 60, 0.05)");
    } else if (mode === "listen") {
      core.addColorStop(0, "#e8fffb");
      core.addColorStop(0.4, "#4aa8ff");
      core.addColorStop(1, "rgba(74, 168, 255, 0.05)");
    } else {
      core.addColorStop(0, "#f4fffd");
      core.addColorStop(0.42, "#2ee6d6");
      core.addColorStop(1, "rgba(46, 230, 214, 0.04)");
    }
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = mode === "think" ? "rgba(255, 211, 90, 0.85)" : "rgba(46, 230, 214, 0.9)";
    ctx.lineWidth = Math.max(2, w * 0.004);
    ctx.beginPath();
    const spin = mode === "think" ? tick * 0.06 : tick * 0.01;
    ctx.arc(cx, cy, radius * 1.28, spin, spin + (mode === "think" ? 1.4 : Math.PI * 1.7));
    ctx.stroke();

    const span = Math.min(w * 0.78, 640);
    const left = cx - span / 2;
    const base = cy + radius * 1.7;
    for (let i = 0; i < bars; i += 1) {
      const t = i / (bars - 1);
      const wave = Math.sin(t * Math.PI * 4 + tick * (mode === "speak" ? 0.28 : 0.08));
      const listen = mode === "listen" ? Math.sin(t * 18 + tick * 0.2) : 0;
      let height = (0.18 + energy) * (0.35 + 0.65 * Math.abs(wave));
      if (mode === "idle") height *= 0.28;
      if (mode === "think") height = 0.22 + Math.abs(Math.sin(tick * 0.12 + i * 0.4)) * 0.18;
      if (mode === "listen") height = 0.2 + energy * (0.45 + 0.55 * Math.abs(listen));
      const bh = height * Math.min(h * 0.22, 140);
      const bw = span / bars * 0.62;
      ctx.fillStyle = mode === "think" ? "rgba(255, 211, 90, 0.85)" : "rgba(46, 230, 214, 0.92)";
      ctx.fillRect(left + t * span, base - bh, bw, bh);
    }

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
  canvas.dataset.mode = mode;

  return {
    setMode(name) {
      mode = name === "listen" || name === "think" || name === "speak" ? name : "idle";
      canvas.dataset.mode = mode;
      if (mode === "listen") target = Math.max(target, 0.35);
      if (mode === "think") target = 0.3;
      if (mode === "speak") target = 0.7;
      if (mode === "idle") target = 0.1;
    },
    setLevel(value) {
      const next = Math.max(0, Math.min(1, Number(value) || 0));
      if (mode === "listen" || mode === "speak") target = next;
    },
    setAudio(frame) {
      const rms = Number(frame?.rms || 0);
      if (rms) target = Math.max(0.15, Math.min(1, rms * 4));
    },
    setEmotion() {},
    setViseme() {},
    setUtterance(text) {
      if (text) target = Math.max(target, 0.66);
    },
    destroy() {
      alive = false;
    },
  };
}

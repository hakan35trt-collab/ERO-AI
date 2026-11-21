const PRESETS = {
  idle: { eye: 1, brow: 0.05, browAsym: 0, smile: 0.12, open: 0.02, round: 0, glow: 0.28, tilt: 0, gazeX: 0, gazeY: 0, speed: 1, scan: 0, squint: 0 },
  listen: { eye: 1.14, brow: 0.28, browAsym: 0, smile: 0.08, open: 0.08, round: 0.05, glow: 0.78, tilt: -0.03, gazeX: 0, gazeY: 0, speed: 1.7, scan: 0, squint: 0 },
  think: { eye: 0.78, brow: -0.28, browAsym: 0.15, smile: 0, open: 0.01, round: 0, glow: 0.42, tilt: 0.05, gazeX: 0.45, gazeY: -0.62, speed: 2.3, scan: 1, squint: 0.08 },
  speak: { eye: 1, brow: 0.12, browAsym: 0, smile: 0.18, open: 0.2, round: 0.1, glow: 0.6, tilt: 0, gazeX: 0, gazeY: 0.04, speed: 1.25, scan: 0, squint: 0.05 },
  happy: { eye: 0.92, brow: 0.34, browAsym: 0, smile: 0.9, open: 0.16, round: 0, glow: 0.82, tilt: -0.04, gazeX: 0.08, gazeY: 0.12, speed: 1.35, scan: 0, squint: 0.42 },
  surprised: { eye: 1.34, brow: 0.85, browAsym: 0, smile: 0.02, open: 0.78, round: 0.9, glow: 1, tilt: -0.02, gazeX: 0, gazeY: -0.08, speed: 2.1, scan: 0, squint: 0 },
  sad: { eye: 0.84, brow: 0.22, browAsym: 0, smile: -0.72, open: 0.02, round: 0.05, glow: 0.16, tilt: 0.07, gazeX: -0.12, gazeY: 0.48, speed: 0.65, scan: 0, squint: 0.12 },
  curious: { eye: 1.16, brow: 0.15, browAsym: 0.95, smile: 0.22, open: 0.06, round: 0.08, glow: 0.5, tilt: -0.07, gazeX: 0.58, gazeY: -0.12, speed: 1.15, scan: 0, squint: 0 },
};

const FIELDS = Object.keys(PRESETS.idle);

export function createFace(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  let mode = "idle";
  let locked = false;
  let volume = 0;
  let viseme = null;
  const current = { ...PRESETS.idle };
  let blink = 1;
  let blinkAt = performance.now() + 1600;
  let blinking = 0;
  let gaze = { x: 0, y: 0 };
  let gazeTarget = { x: 0, y: 0 };
  let gazeAt = performance.now() + 900;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let running = true;
  let last = performance.now();

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
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

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const preset = PRESETS[mode] || PRESETS.idle;
    const k = 1 - Math.exp(-dt * (reduced ? 4 : 7));
    for (const field of FIELDS) current[field] += (preset[field] - current[field]) * k;

    if (mode === "idle" && !locked && now > gazeAt) {
      gazeTarget = { x: (Math.random() - 0.5) * 0.7, y: (Math.random() - 0.5) * 0.4 };
      gazeAt = now + 1400 + Math.random() * 2200;
    }
    if (mode !== "idle") gazeTarget = { x: preset.gazeX, y: preset.gazeY };
    gaze.x += (gazeTarget.x - gaze.x) * k;
    gaze.y += (gazeTarget.y - gaze.y) * k;

    if (!blinking && now > blinkAt && mode !== "surprised") {
      blinking = now;
    }
    if (blinking) {
      const t = now - blinking;
      blink = t < 80 ? 1 - t / 80 : t < 190 ? (t - 80) / 110 : 1;
      if (t > 200) {
        blinking = 0;
        blink = 1;
        blinkAt = now + (mode === "listen" ? 3400 : 2200) + Math.random() * 2800;
      }
    }

    let mouth = {
      open: current.open,
      round: current.round,
      smile: current.smile,
    };
    if (mode === "speak") {
      const auto = viseme || autoViseme(now);
      mouth = {
        open: auto.open,
        round: auto.round,
        smile: current.smile * 0.65 + (auto.smile || 0) * 0.35,
      };
    }

    draw(ctx, canvas, {
      ...current,
      gazeX: gaze.x,
      gazeY: gaze.y,
      blink,
      mouth,
      volume: mode === "listen" ? Math.max(volume, reduced ? 0.15 : 0.12 + Math.sin(now / 280) * 0.08) : volume * 0.2,
      time: now / 1000,
      reduced,
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setMode(next) {
      if (!locked && PRESETS[next]) mode = next;
    },
    lockMode(next) {
      if (PRESETS[next]) {
        locked = true;
        mode = next;
      }
    },
    unlock() {
      locked = false;
    },
    setVolume(value) {
      volume = Math.max(0, Math.min(1, value || 0));
    },
    setViseme(value) {
      viseme = value;
    },
    destroy() {
      running = false;
      observer.disconnect();
    },
  };
}

function autoViseme(now) {
  const shapes = [
    { open: 0.18, round: 0.05, smile: 0.1 },
    { open: 0.72, round: 0.1, smile: 0.05 },
    { open: 0.28, round: 0.4, smile: 0 },
    { open: 0.84, round: 0.7, smile: 0 },
    { open: 0.36, round: 0, smile: 0.2 },
  ];
  return shapes[Math.floor(now / 140) % shapes.length];
}

function draw(ctx, canvas, p) {
  const w = 400;
  const h = 520;
  const scale = Math.min(canvas.width / w, canvas.height / h);
  ctx.setTransform(scale, 0, 0, scale, (canvas.width - w * scale) / 2, (canvas.height - h * scale) / 2);
  ctx.clearRect(-20, -20, w + 40, h + 40);

  const t = p.reduced ? 0 : p.time;
  const breathe = 1 + Math.sin(t * 1.5) * 0.012;
  const cx = 200;
  const cy = 236 + Math.sin(t * 1.5) * 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.tilt * 0.08 + Math.sin(t * 0.7) * 0.01);
  ctx.scale(breathe * 1.16, breathe * 1.16);

  const glow = ctx.createRadialGradient(0, -10, 20, 0, 10, 188);
  glow.addColorStop(0, `rgba(46, 230, 214, ${0.28 + p.glow * 0.38 + p.volume * 0.25})`);
  glow.addColorStop(0.55, `rgba(20, 90, 110, ${0.08 + p.glow * 0.08})`);
  glow.addColorStop(1, "rgba(46, 230, 214, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 8, 190, 0, Math.PI * 2);
  ctx.fill();

  drawOrbits(ctx, t, p.speed, p.volume);
  drawShoulders(ctx);
  drawEar(ctx, -92, 8);
  drawEar(ctx, 92, 8);
  drawHead(ctx, p, t);
  ctx.restore();
}

function drawOrbits(ctx, t, speed, volume) {
  const rings = [
    { rx: 158, ry: 58, rot: t * 0.35 * speed, color: "rgba(46, 230, 214, 0.85)", width: 1.6, phase: 0 },
    { rx: 176, ry: 84, rot: -t * 0.22 * speed + 0.8, color: "rgba(150, 255, 242, 0.32)", width: 1.15, phase: 1.4 },
    { rx: 132, ry: 102, rot: t * 0.15 * speed + 2.1, color: "rgba(90, 170, 190, 0.28)", width: 1, phase: 2.4 },
  ];
  for (const ring of rings) {
    ctx.save();
    ctx.rotate(ring.rot);
    ctx.beginPath();
    ctx.ellipse(0, 6, ring.rx, ring.ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = ring.width;
    ctx.stroke();
    const a = t * (1.4 + speed) + ring.phase;
    const x = Math.cos(a) * ring.rx;
    const y = 6 + Math.sin(a) * ring.ry;
    ctx.beginPath();
    ctx.arc(x, y, 2.4 + volume * 1.6, 0, Math.PI * 2);
    ctx.fillStyle = "#e7fffb";
    ctx.shadowColor = "#2ee6d6";
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();
  }
  if (volume > 0.08) {
    ctx.beginPath();
    ctx.arc(0, 6, 112 + volume * 36, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(46, 230, 214, ${0.15 + volume * 0.35})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawShoulders(ctx) {
  ctx.beginPath();
  ctx.ellipse(0, 168, 132, 46, 0, Math.PI, 0);
  const g = ctx.createLinearGradient(0, 130, 0, 190);
  g.addColorStop(0, "rgba(18, 48, 58, 0.95)");
  g.addColorStop(1, "rgba(8, 16, 24, 0)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-34, 78);
  ctx.quadraticCurveTo(-46, 130, -28, 162);
  ctx.lineTo(28, 162);
  ctx.quadraticCurveTo(46, 130, 34, 78);
  ctx.closePath();
  const neck = ctx.createLinearGradient(0, 70, 0, 160);
  neck.addColorStop(0, "#14323c");
  neck.addColorStop(1, "#0b1c24");
  ctx.fillStyle = neck;
  ctx.fill();
}

function drawEar(ctx, x, y) {
  ctx.beginPath();
  ctx.ellipse(x, y, 14, 22, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#102833";
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(120, 240, 226, 0.45)";
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y + 2, 6, 12, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(180, 255, 244, 0.25)";
  ctx.stroke();
}

function facePath(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, -112);
  ctx.bezierCurveTo(70, -112, 92, -62, 84, -8);
  ctx.bezierCurveTo(78, 48, 58, 86, 28, 108);
  ctx.quadraticCurveTo(0, 122, -28, 108);
  ctx.bezierCurveTo(-58, 86, -78, 48, -84, -8);
  ctx.bezierCurveTo(-92, -62, -70, -112, 0, -112);
  ctx.closePath();
}

function drawHead(ctx, p, t) {
  ctx.save();
  facePath(ctx);
  const skin = ctx.createLinearGradient(-80, -120, 70, 120);
  skin.addColorStop(0, "#3c8498");
  skin.addColorStop(0.42, "#1b5160");
  skin.addColorStop(0.75, "#123844");
  skin.addColorStop(1, "#0c2430");
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = `rgba(170, 255, 244, ${0.35 + p.glow * 0.35})`;
  ctx.stroke();
  ctx.clip();

  const cheek = ctx.createRadialGradient(-46, 28, 4, -46, 36, 36);
  cheek.addColorStop(0, `rgba(70, 230, 214, ${0.05 + Math.max(0, p.smile) * 0.16})`);
  cheek.addColorStop(1, "rgba(70, 230, 214, 0)");
  ctx.fillStyle = cheek;
  ctx.fillRect(-120, -20, 80, 80);
  const cheekR = ctx.createRadialGradient(46, 28, 4, 46, 36, 36);
  cheekR.addColorStop(0, `rgba(70, 230, 214, ${0.05 + Math.max(0, p.smile) * 0.16})`);
  cheekR.addColorStop(1, "rgba(70, 230, 214, 0)");
  ctx.fillStyle = cheekR;
  ctx.fillRect(10, -20, 90, 80);

  const shade = ctx.createLinearGradient(-90, 0, 90, 40);
  shade.addColorStop(0, "rgba(180, 255, 248, 0.08)");
  shade.addColorStop(0.5, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, "rgba(0, 10, 16, 0.18)");
  ctx.fillStyle = shade;
  ctx.fillRect(-120, -140, 240, 280);

  if (p.scan > 0.05) {
    const y = -100 + ((t * 70) % 210);
    const scan = ctx.createLinearGradient(0, y - 10, 0, y + 10);
    scan.addColorStop(0, "rgba(140, 255, 240, 0)");
    scan.addColorStop(0.5, `rgba(160, 255, 245, ${0.18 * p.scan})`);
    scan.addColorStop(1, "rgba(140, 255, 240, 0)");
    ctx.fillStyle = scan;
    ctx.fillRect(-100, y - 12, 200, 24);
  }
  ctx.restore();

  drawCrown(ctx, p);
  drawBrow(ctx, -34, -58, p.brow + p.browAsym, -0.15);
  drawBrow(ctx, 34, -58, p.brow - p.browAsym * 0.2, 0.15);
  const eyeOpen = Math.max(0.06, p.eye * p.blink * (1 - p.squint * 0.45));
  drawEye(ctx, -34, -24, eyeOpen, p.gazeX, p.gazeY, p.smile);
  drawEye(ctx, 34, -24, eyeOpen, p.gazeX, p.gazeY, p.smile);
  drawNose(ctx);
  drawMouth(ctx, p.mouth);
}

function drawCrown(ctx, p) {
  ctx.beginPath();
  ctx.moveTo(-74, -36);
  ctx.bezierCurveTo(-86, -96, -40, -128, 0, -126);
  ctx.bezierCurveTo(40, -128, 86, -96, 74, -36);
  ctx.quadraticCurveTo(0, -18, -74, -36);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -130, 0, -20);
  g.addColorStop(0, "#07141c");
  g.addColorStop(1, "#102833");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgba(150, 255, 244, ${0.55 + p.glow * 0.3})`;
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = "#2ee6d6";
  ctx.shadowBlur = 12 + p.glow * 8;
  ctx.beginPath();
  ctx.moveTo(0, -104);
  ctx.lineTo(7, -94);
  ctx.lineTo(0, -84);
  ctx.lineTo(-7, -94);
  ctx.closePath();
  ctx.fillStyle = "#e9fffb";
  ctx.fill();
  ctx.restore();
}

function drawBrow(ctx, x, y, raise, tilt) {
  ctx.save();
  ctx.translate(x, y - raise * 10);
  ctx.rotate(tilt - raise * 0.08);
  ctx.beginPath();
  ctx.moveTo(-18, 4);
  ctx.quadraticCurveTo(0, -6, 18, 2);
  ctx.strokeStyle = "rgba(214, 255, 248, 0.8)";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

function drawEye(ctx, x, y, open, gazeX, gazeY, smile) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(smile * 0.08 * (x > 0 ? -1 : 1));
  ctx.beginPath();
  ctx.ellipse(0, 0, 26, Math.max(1.3, 16 * open), 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#e7fffb";
  ctx.fillRect(-30, -30, 60, 60);
  const ix = gazeX * 7;
  const iy = gazeY * 5;
  const iris = ctx.createRadialGradient(ix - 3, iy - 4, 1, ix, iy, 12);
  iris.addColorStop(0, "#f4fffd");
  iris.addColorStop(0.35, "#3dffe8");
  iris.addColorStop(0.72, "#128a82");
  iris.addColorStop(1, "#084540");
  ctx.beginPath();
  ctx.arc(ix, iy, 11.5, 0, Math.PI * 2);
  ctx.fillStyle = iris;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ix, iy, 4.6, 0, Math.PI * 2);
  ctx.fillStyle = "#041016";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ix - 3.6, iy - 3.4, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.ellipse(x, y, 26, Math.max(1.3, 16 * open), 0, Math.PI * 1.04, Math.PI * 1.96);
  ctx.strokeStyle = "rgba(214, 255, 248, 0.9)";
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 24, Math.max(1, 15 * open), 0, 0.12 * Math.PI, 0.88 * Math.PI);
  ctx.strokeStyle = "rgba(90, 180, 176, 0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawNose(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.quadraticCurveTo(10, 22, 0, 32);
  ctx.strokeStyle = "rgba(190, 245, 236, 0.28)";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-8, 30);
  ctx.quadraticCurveTo(-2, 36, 0, 32);
  ctx.moveTo(8, 30);
  ctx.quadraticCurveTo(2, 36, 0, 32);
  ctx.strokeStyle = "rgba(190, 245, 236, 0.2)";
  ctx.stroke();
}

function drawMouth(ctx, mouth) {
  const smile = mouth.smile;
  const open = Math.max(0, mouth.open);
  const round = mouth.round;
  const y = 62;
  const w = 38 - round * 12;
  ctx.beginPath();
  ctx.moveTo(-w, y);
  ctx.quadraticCurveTo(0, y + 10 + smile * 16, w, y);
  ctx.quadraticCurveTo(0, y + 12 + open * 34 - smile * 4, -w, y);
  ctx.closePath();
  const lip = ctx.createLinearGradient(0, y - 4, 0, y + 28);
  lip.addColorStop(0, "#1c6d72");
  lip.addColorStop(0.45, "#0c3036");
  lip.addColorStop(1, "#062026");
  ctx.fillStyle = open > 0.08 ? "#061018" : lip;
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = `rgba(170, 255, 244, ${0.45 + open * 0.4})`;
  ctx.stroke();
  if (open > 0.35) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.55, y + 2);
    ctx.quadraticCurveTo(0, y + 1, w * 0.55, y + 2);
    ctx.strokeStyle = "rgba(230, 255, 252, 0.55)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-w + 2, y);
  ctx.quadraticCurveTo(0, y - 4 + smile * 6, w - 2, y);
  ctx.strokeStyle = "rgba(220, 255, 250, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("public/avatar");
const rawDir = path.join(root, "raw");
const previewDir = path.resolve("tmp-avatar-preview");

const RAW = {
  base: "base.jpg",
  a: "viseme-a.jpg",
  e: "viseme-e.jpg",
  i: "viseme-i.jpg",
  o: "viseme-o.jpg",
  u: "viseme-u.jpg",
  blink: "expr-blink.jpg",
  happy: "expr-happy.jpg",
  surprised: "expr-surprised.jpg",
  think: "expr-thinking.jpg",
};

function readRaw(name) {
  const file = path.join(rawDir, RAW[name]);
  if (!fs.existsSync(file)) throw new Error(`Eksik kare: public/avatar/raw/${RAW[name]}`);
  return file;
}

async function loadRgb(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function downsample(src, factor) {
  const width = Math.floor(src.width / factor);
  const height = Math.floor(src.height / factor);
  const data = new Uint8Array(width * height);
  const { channels } = src;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let yy = 0; yy < factor; yy++) {
        for (let xx = 0; xx < factor; xx++) {
          const index = ((y * factor + yy) * src.width + (x * factor + xx)) * channels;
          sum += src.data[index] * 0.3 + src.data[index + 1] * 0.59 + src.data[index + 2] * 0.11;
          count += 1;
        }
      }
      data[y * width + x] = sum / count;
    }
  }
  return { data, width, height };
}

function sad(base, frame, dx, dy, mask) {
  let sum = 0;
  let count = 0;
  const { width, height, data: a } = base;
  const b = frame.data;
  for (let y = 0; y < height; y++) {
    const sy = y + dy;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const sx = x + dx;
      if (sx < 0 || sx >= width) continue;
      sum += Math.abs(a[y * width + x] - b[sy * width + sx]);
      count += 1;
    }
  }
  return count > 40 ? sum / count : 1e9;
}

function bestShift(base, frame, mask, range, step) {
  let best = { dx: 0, dy: 0, score: Infinity };
  for (let dy = -range; dy <= range; dy += step) {
    for (let dx = -range; dx <= range; dx += step) {
      const score = sad(base, frame, dx, dy, mask);
      if (score < best.score) best = { dx, dy, score };
    }
  }
  return best;
}

function refineShift(base, frame, mask, guess) {
  const next = bestShift(base, frame, mask, 3, 1);
  const around = { dx: guess.dx, dy: guess.dy, score: Infinity };
  for (let dy = guess.dy - 2; dy <= guess.dy + 2; dy++) {
    for (let dx = guess.dx - 2; dx <= guess.dx + 2; dx++) {
      const score = sad(base, frame, dx, dy, mask);
      if (score < around.score) around.dx = dx, around.dy = dy, around.score = score;
    }
  }
  return around.score <= next.score ? around : next;
}

function jacketMask(small) {
  const mask = new Uint8Array(small.width * small.height);
  const y0 = Math.floor(small.height * 0.72);
  const y1 = Math.floor(small.height * 0.92);
  const x0 = Math.floor(small.width * 0.28);
  const x1 = Math.floor(small.width * 0.78);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (small.data[y * small.width + x] > 26) mask[y * small.width + x] = 1;
    }
  }
  return mask;
}

function skinBox(src) {
  let minX = src.width;
  let minY = src.height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  const step = 2;
  for (let y = 0; y < src.height * 0.72; y += step) {
    for (let x = 0; x < src.width; x += step) {
      const index = (y * src.width + x) * src.channels;
      const r = src.data[index];
      const g = src.data[index + 1];
      const b = src.data[index + 2];
      if (r > 95 && g > 48 && b > 32 && r > g + 10 && r > b + 12) {
        count += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count < 80) return { x: src.width * 0.3, y: src.height * 0.18, w: src.width * 0.4, h: src.height * 0.42 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function warp(src, dx, dy) {
  const { width, height, channels, data } = src;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = y + dy;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x++) {
      const sx = x + dx;
      if (sx < 0 || sx >= width) continue;
      const from = (sy * width + sx) * channels;
      const to = (y * width + x) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = 255;
    }
  }
  return out;
}

function ellipsePatch(rgba, width, height, cx, cy, rx, ry, feather = 0.2, side = "") {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const x0 = Math.max(0, Math.floor(cx - rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const x1 = Math.min(width - 1, Math.ceil(cx + rx));
  const y1 = Math.min(height - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const distance = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (distance >= 1 || (side === "left" && x > cx) || (side === "right" && x < cx)) {
        rgba[(y * width + x) * 4 + 3] = 0;
        continue;
      }
      const edge = distance <= 1 - feather ? 1 : (1 - distance) / feather;
      rgba[(y * width + x) * 4 + 3] = Math.round(255 * edge);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const cropW = Math.max(1, maxX - minX + 1);
  const cropH = Math.max(1, maxY - minY + 1);
  const crop = Buffer.alloc(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const from = ((y + minY) * width + (x + minX)) * 4;
      const to = (y * cropW + x) * 4;
      crop[to] = rgba[from];
      crop[to + 1] = rgba[from + 1];
      crop[to + 2] = rgba[from + 2];
      crop[to + 3] = rgba[from + 3];
    }
  }
  return { crop, x: minX, y: minY, w: cropW, h: cropH };
}

function mouthEllipse(baseRgba, frames, width, height, skin) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;
  const y0 = Math.floor(skin.y + skin.h * 0.55);
  const y1 = Math.min(height - 1, Math.floor(skin.y + skin.h * 1.18));
  const x0 = Math.floor(skin.x + skin.w * 0.18);
  const x1 = Math.floor(skin.x + skin.w * 0.82);
  for (const frame of frames) {
    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        const index = (y * width + x) * 4;
        const diff = Math.abs(baseRgba[index] - frame[index])
          + Math.abs(baseRgba[index + 1] - frame[index + 1])
          + Math.abs(baseRgba[index + 2] - frame[index + 2]);
        if (diff < 80) continue;
        hits += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (hits < 30) {
    return {
      cx: skin.x + skin.w / 2,
      cy: skin.y + skin.h * 0.78,
      rx: skin.w * 0.28,
      ry: skin.h * 0.16,
    };
  }
  const padX = 22;
  const padY = 18;
  minX = Math.max(0, minX - padX);
  maxX = Math.min(width - 1, maxX + padX);
  minY = Math.max(0, minY - padY);
  maxY = Math.min(height - 1, maxY + padY);
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    rx: Math.max(70, (maxX - minX) / 2),
    ry: Math.max(48, (maxY - minY) / 2),
  };
}

function eyeEllipse(skin) {
  const cx = skin.x + skin.w * 0.5;
  const cy = skin.y + skin.h * 0.33;
  return {
    cx,
    cy,
    rx: skin.w * 0.48,
    ry: skin.h * 0.145,
    brow: { x: cx, y: cy - skin.h * 0.08, rx: skin.w * 0.5, ry: skin.h * 0.07 },
  };
}

async function writePatch(patch, file) {
  await sharp(patch.crop, { raw: { width: patch.w, height: patch.h, channels: 4 } }).png().toFile(file);
}

const factor = 4;
const baseFile = readRaw("base");
const base = await loadRgb(baseFile);
const smallBase = downsample(base, factor);
const jacket = jacketMask(smallBase);
const skin = skinBox(base);
const eyes = eyeEllipse(skin);
const mouthNames = ["a", "e", "i", "o", "u"];
const aligned = {};
const shifts = {};

for (const name of [...mouthNames, "blink", "happy", "surprised", "think"]) {
  const frame = await loadRgb(readRaw(name));
  if (frame.width !== base.width || frame.height !== base.height) {
    throw new Error(`${RAW[name]} boyutu ${base.width}x${base.height} olmalı`);
  }
  const small = downsample(frame, factor);
  const coarse = bestShift(smallBase, small, jacket, 16, 2);
  const fine = refineShift(smallBase, small, jacket, coarse);
  let dx = fine.dx * factor;
  let dy = fine.dy * factor;
  if (Math.abs(dx) < 4) dx = 0;
  if (Math.abs(dy) < 4) dy = 0;
  shifts[name] = { dx, dy, score: Number(fine.score.toFixed(2)) };
  aligned[name] = warp(frame, dx, dy);
}

const mouth = mouthEllipse(warp(base, 0, 0), mouthNames.map((name) => aligned[name]), base.width, base.height, skin);
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(previewDir, { recursive: true });
fs.copyFileSync(baseFile, path.join(root, "base.jpg"));

const manifest = {
  width: base.width,
  height: base.height,
  base: "base.jpg",
  mouth: {},
  alias: { fv: "u", ltd: "e", s: "i" },
  closed: ["rest", "mbp"],
  eyes: {},
  expressions: {},
  replace: "Ham kareler public/avatar/raw içindedir, hepsi aynı kadrajda 864x1152 JPG. Değiştirince node scripts/generate-avatar.mjs çalıştır. Ağız ve göz yamaları ile bu manifest yeniden yazılır; uygulama kodu değişmez.",
};

for (const name of mouthNames) {
  const patch = ellipsePatch(Buffer.from(aligned[name]), base.width, base.height, mouth.cx, mouth.cy, mouth.rx, mouth.ry);
  const file = `mouth-${name}.png`;
  await writePatch(patch, path.join(root, file));
  manifest.mouth[name] = { file, x: patch.x, y: patch.y, w: patch.w, h: patch.h };
  await sharp(path.join(root, "base.jpg"))
    .composite([{ input: path.join(root, file), left: patch.x, top: patch.y }])
    .jpeg({ quality: 80 })
    .toFile(path.join(previewDir, `mouth-${name}.jpg`));
}

const blinkSmall = downsample({ data: aligned.blink, width: base.width, height: base.height, channels: 4 }, factor);
const brow = new Uint8Array(blinkSmall.width * blinkSmall.height);
const browCx = eyes.brow.x / factor;
const browCy = eyes.brow.y / factor;
const browRx = eyes.brow.rx / factor;
const browRy = eyes.brow.ry / factor;
for (let y = 0; y < blinkSmall.height; y++) {
  for (let x = 0; x < blinkSmall.width; x++) {
    if (Math.hypot((x - browCx) / browRx, (y - browCy) / browRy) <= 1) brow[y * blinkSmall.width + x] = 1;
  }
}
const local = bestShift(smallBase, blinkSmall, brow, 6, 1);
const unshifted = sad(smallBase, blinkSmall, 0, 0, brow);
const localDx = local.score < unshifted - 4 ? local.dx * factor : 0;
const localDy = local.score < unshifted - 4 ? local.dy * factor : 0;
const blinkWarped = warp({ data: aligned.blink, width: base.width, height: base.height, channels: 4 }, localDx, localDy);
const blinkPatch = ellipsePatch(blinkWarped, base.width, base.height, eyes.cx, eyes.cy, eyes.rx, eyes.ry, 0.12);
await writePatch(blinkPatch, path.join(root, "eyes-blink.png"));
manifest.eyes.blink = {
  file: "eyes-blink.png",
  x: blinkPatch.x,
  y: blinkPatch.y,
  w: blinkPatch.w,
  h: blinkPatch.h,
  align: { dx: localDx, dy: localDy, score: Number(local.score.toFixed(2)) },
};
await sharp(path.join(root, "base.jpg"))
  .composite([{ input: path.join(root, "eyes-blink.png"), left: blinkPatch.x, top: blinkPatch.y }])
  .jpeg({ quality: 80 })
  .toFile(path.join(previewDir, "blink.jpg"));

for (const name of ["happy", "surprised", "think"]) {
  const file = `expr-${name}.jpg`;
  fs.copyFileSync(readRaw(name), path.join(root, file));
  manifest.expressions[name] = {
    file,
    drawX: -shifts[name].dx,
    drawY: -shifts[name].dy,
    score: shifts[name].score,
  };
}

function mirrorInPlace(src, width, height, cx, cy, rx, ry) {
  const out = Buffer.from(src);
  const x0 = Math.max(0, Math.floor(cx - rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const x1 = Math.min(width - 1, Math.ceil(cx + rx));
  const y1 = Math.min(height - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot((x - cx) / rx, (y - cy) / ry) > 1) continue;
      const sx = Math.max(0, Math.min(width - 1, Math.round(cx * 2 - x)));
      const from = (y * width + sx) * 4;
      const to = (y * width + x) * 4;
      out[to] = src[from];
      out[to + 1] = src[from + 1];
      out[to + 2] = src[from + 2];
      out[to + 3] = src[from + 3];
    }
  }
  return out;
}

async function alignRaw(fileName) {
  const frame = await loadRgb(path.join(rawDir, fileName));
  if (frame.width !== base.width || frame.height !== base.height) {
    throw new Error(`${fileName} ${base.width}x${base.height} olmalı`);
  }
  const small = downsample(frame, factor);
  const coarse = bestShift(smallBase, small, jacket, 16, 2);
  const fine = refineShift(smallBase, small, jacket, coarse);
  let dx = fine.dx * factor;
  let dy = fine.dy * factor;
  if (Math.abs(dx) < 4) dx = 0;
  if (Math.abs(dy) < 4) dy = 0;
  return { rgba: warp(frame, dx, dy), dx, dy, score: Number(fine.score.toFixed(2)) };
}

async function savePatch(group, key, rgba, box, file, feather = 0.16, side = "") {
  const patch = ellipsePatch(Buffer.from(rgba), base.width, base.height, box.cx, box.cy, box.rx, box.ry, feather, side);
  await writePatch(patch, path.join(root, file));
  group[key] = { file, x: patch.x, y: patch.y, w: patch.w, h: patch.h };
  return patch;
}

const face = {
  cx: skin.x + skin.w * 0.5,
  cy: skin.y + skin.h * 0.4,
  rx: skin.w * 0.78,
  ry: skin.h * 0.64,
};
const gaze = {
  cx: eyes.cx,
  cy: eyes.cy + eyes.ry * 0.12,
  rx: eyes.rx * 0.92,
  ry: eyes.ry * 0.62,
};
const browBox = {
  cx: eyes.cx,
  cy: eyes.cy - eyes.ry * 0.78,
  rx: eyes.rx,
  ry: eyes.ry * 0.48,
};
manifest.emotions = {};
manifest.brows = {};
manifest.head = {};
manifest.generated = {
  "eye-left": "eye-right karesindeki göz bölgesi yatay aynalandı. Ceket ve ERO yazısı taban kareden gelir.",
  "head-right": "head-left yüz bölgesi yatay aynalanıp tabana oturtuldu. ERO yazısı aynalanmaz.",
};

const gazeFiles = { right: "eye-right.jpg", up: "eye-up.jpg", down: "eye-down.jpg" };
for (const [key, fileName] of Object.entries(gazeFiles)) {
  const alignedFrame = await alignRaw(fileName);
  await savePatch(manifest.eyes, key, alignedFrame.rgba, gaze, `eyes-${key}.png`, 0.14);
}
const rightGaze = await alignRaw("eye-right.jpg");
const mirroredGaze = mirrorInPlace(rightGaze.rgba, base.width, base.height, gaze.cx, gaze.cy, gaze.rx, gaze.ry);
const leftPatch = await savePatch(manifest.eyes, "left", mirroredGaze, gaze, "eyes-left.png", 0.14);
await sharp(path.join(root, "base.jpg"))
  .composite([{ input: path.join(root, "eyes-left.png"), left: leftPatch.x, top: leftPatch.y }])
  .jpeg({ quality: 86 })
  .toFile(path.join(rawDir, "eye-left.jpg"));
await sharp(path.join(root, "base.jpg"))
  .composite([{ input: path.join(root, "eyes-left.png"), left: leftPatch.x, top: leftPatch.y }])
  .jpeg({ quality: 80 })
  .toFile(path.join(previewDir, "eye-left.jpg"));

for (const [key, fileName] of Object.entries({ raise: "brow-raise.jpg", frown: "brow-frown.jpg", one: "brow-one.jpg" })) {
  const alignedFrame = await alignRaw(fileName);
  await savePatch(manifest.brows, key, alignedFrame.rgba, browBox, `brow-${key}.png`, 0.18);
}
const wink = await alignRaw("wink.jpg");
const baseRgba = warp(base, 0, 0);
let leftDiff = 0;
let rightDiff = 0;
for (let y = Math.floor(gaze.cy - gaze.ry); y <= gaze.cy + gaze.ry; y += 2) {
  for (let x = Math.floor(gaze.cx - gaze.rx); x <= gaze.cx + gaze.rx; x += 2) {
    if (Math.hypot((x - gaze.cx) / gaze.rx, (y - gaze.cy) / gaze.ry) > 1) continue;
    const index = (y * base.width + x) * 4;
    const diff = Math.abs(baseRgba[index] - wink.rgba[index]) + Math.abs(baseRgba[index + 1] - wink.rgba[index + 1]) + Math.abs(baseRgba[index + 2] - wink.rgba[index + 2]);
    if (x < gaze.cx) leftDiff += diff;
    else rightDiff += diff;
  }
}
const winkSide = leftDiff >= rightDiff ? "left" : "right";
await savePatch(manifest.brows, "wink", wink.rgba, gaze, "wink.png", 0.16, winkSide);
manifest.brows.wink.side = winkSide === "left" ? "izleyici-sol" : "izleyici-sağ";

const headFiles = { left: "head-left.jpg", up: "head-up.jpg", down: "head-down.jpg", tilt: "head-tilt.jpg" };
for (const [key, fileName] of Object.entries(headFiles)) {
  const alignedFrame = await alignRaw(fileName);
  await savePatch(manifest.head, key, alignedFrame.rgba, face, `head-${key}.png`, 0.2);
}
const headLeft = await alignRaw("head-left.jpg");
const mirroredHead = mirrorInPlace(headLeft.rgba, base.width, base.height, face.cx, face.cy, face.rx, face.ry);
const rightHead = await savePatch(manifest.head, "right", mirroredHead, face, "head-right.png", 0.2);
await sharp(path.join(root, "base.jpg"))
  .composite([{ input: path.join(root, "head-right.png"), left: rightHead.x, top: rightHead.y }])
  .jpeg({ quality: 86 })
  .toFile(path.join(rawDir, "head-right.jpg"));
await sharp(path.join(root, "base.jpg"))
  .composite([{ input: path.join(root, "head-right.png"), left: rightHead.x, top: rightHead.y }])
  .jpeg({ quality: 80 })
  .toFile(path.join(previewDir, "head-right.jpg"));

const emotionFiles = {
  joy: "emo-joy.jpg",
  sad: "emo-sad.jpg",
  fear: "emo-fear.jpg",
  angry: "emo-angry.jpg",
  confused: "emo-confused.jpg",
  disgust: "emo-disgust.jpg",
  calm: "emo-calm.jpg",
  shy: "emo-shy.jpg",
  happy: "expr-happy.jpg",
  surprised: "expr-surprised.jpg",
  think: "expr-thinking.jpg",
};
for (const [key, fileName] of Object.entries(emotionFiles)) {
  const alignedFrame = await alignRaw(fileName);
  await savePatch(manifest.emotions, key, alignedFrame.rgba, face, `emo-${key}.png`, 0.18);
}

manifest.detect = {
  skin,
  mouth,
  face,
  gaze,
  brow: browBox,
  eyes: { cx: eyes.cx, cy: eyes.cy, rx: eyes.rx, ry: eyes.ry },
  shifts,
};
fs.writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ skin, mouth, eyes: manifest.detect.eyes, shifts, blink: manifest.eyes.blink }, null, 2));

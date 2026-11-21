import { createSpring, deform, emptyPose, springTo } from "./face-rig.js";
import { lifeTargets } from "./face-life.js";
import { buildTrack, estimateSpeechMs, mixSpeech, poseForViseme, poseFromAudio, sampleTrack } from "./lipsync.js";
import { visemeFromAudio, visemeFromShape } from "./viseme.js";

const SKIN_VS = `
attribute vec2 aPos;
attribute vec2 aUv;
uniform vec2 uOrigin;
uniform vec2 uScale;
uniform vec2 uView;
varying vec2 vUv;
void main() {
  vec2 screen = aPos * uScale + uOrigin;
  vec2 clip = (screen / uView) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUv = aUv;
}`;

const SKIN_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() {
  vec4 color = texture2D(uTex, vec2(vUv.x, 1.0 - vUv.y));
  vec2 p = vUv - vec2(0.5, 0.46);
  float r = length(p / vec2(0.55, 0.5));
  float alpha = smoothstep(1.04, 0.74, r);
  gl_FragColor = vec4(color.rgb, alpha);
}`;

const MOUTH_VS = `
attribute vec2 aPos;
attribute float aUpper;
attribute float aAlong;
uniform vec2 uOrigin;
uniform vec2 uScale;
uniform vec2 uView;
varying float vUpper;
varying float vAlong;
void main() {
  vec2 screen = aPos * uScale + uOrigin;
  vec2 clip = (screen / uView) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUpper = aUpper;
  vAlong = aAlong;
}`;

const MOUTH_FS = `
precision mediump float;
varying float vUpper;
varying float vAlong;
uniform sampler2D uTeeth;
uniform float uSmile;
uniform float uOpen;
void main() {
  float row = mix(0.75, 0.25, clamp(uSmile, 0.0, 1.0));
  vec3 teeth = texture2D(uTeeth, vec2(clamp(vAlong, 0.0, 1.0), row)).rgb;
  vec3 cavity = vec3(0.09, 0.025, 0.03);
  vec3 color = mix(cavity, teeth, smoothstep(0.35, 0.85, vUpper));
  float fade = smoothstep(0.05, 0.2, uOpen);
  gl_FragColor = vec4(color, fade);
}`;

function rootUrl(base) {
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${root}avatar/`;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function program(gl, vs, fs) {
  const item = gl.createProgram();
  gl.attachShader(item, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(item, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(item);
  if (!gl.getProgramParameter(item, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(item));
  return item;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(url));
    image.src = url;
  });
}

function texture(gl, image) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  return tex;
}

export async function createRigAvatar(canvas, { base = "./", rig, image, teeth } = {}) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true });
  if (!gl || !rig?.landmarks || rig.landmarks.length < 478) throw new Error("webgl yok");
  const skin = program(gl, SKIN_VS, SKIN_FS);
  const mouth = program(gl, MOUTH_VS, MOUTH_FS);
  const faceTex = texture(gl, image);
  const teethTex = texture(gl, teeth);
  const posBuffer = gl.createBuffer();
  const uvBuffer = gl.createBuffer();
  const mesh = deform(rig, emptyPose());
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.uv, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.DYNAMIC_DRAW);
  const index = (list) => {
    const buffer = gl.createBuffer();
    const data = new Uint16Array(list);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buffer, count: data.length };
  };
  const faceList = [];
  const hullList = [];
  const skinSrc = rig.skin || [];
  for (let i = 0; i < skinSrc.length; i += 3) {
    const tri = skinSrc.slice(i, i + 3);
    (tri.some((vertex) => vertex >= rig.landmarks.length) ? hullList : faceList).push(...tri);
  }
  const skinDraw = index(faceList);
  const hullPos = new Float32Array(hullList.length * 2);
  const hullUv = new Float32Array(hullList.length * 2);
  const hullPosBuf = gl.createBuffer();
  const hullUvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, hullPosBuf);
  gl.bufferData(gl.ARRAY_BUFFER, hullPos, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, hullUvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, hullUv, gl.DYNAMIC_DRAW);
  const mouthCover = index(rig.mouthCover || []);
  const mouthBuffer = gl.createBuffer();
  const mouthUpper = gl.createBuffer();
  const mouthAlong = gl.createBuffer();
  const mouthLoop = rig.mouth || [];
  const slit = ((rig.landmarks[13]?.[1] || 0) + (rig.landmarks[14]?.[1] || 0)) / 2;

  let mode = "idle";
  let emotion = "";
  let emotionUntil = 0;
  let running = true;
  let last = performance.now();
  let utterance = "";
  let track = [];
  let trackStart = 0;
  let audio = { rms: 0, centroid: 0, low: 0, mid: 0, high: 0, speaking: false };
  const heard = { rms: 0, centroid: 0, low: 0, mid: 0, high: 0, speaking: false };
  let saccadeX = 0;
  let saccadeY = 0;
  let nextSaccade = performance.now() + 900;
  let blink = 0;
  let blinkUntil = 0;
  let nextBlink = performance.now() + 1800;
  const mix = createSpring(0);
  const springs = {};
  for (const key of Object.keys(emptyPose())) springs[key] = createSpring(key === "breath" ? 0.5 : 0);
  const omega = {
    jawOpen: 14, mouthWide: 12, lipRound: 12, lipPress: 14, upperLipRaise: 12, lowerLipFunnel: 12,
    cheekRaise: 7, gazeX: 10, gazeY: 10, yaw: 5, pitch: 5, roll: 5, breath: 3,
    lidLeft: 26, lidRight: 26,
    browInnerLeft: 9, browInnerRight: 9, browOuterLeft: 9, browOuterRight: 9,
  };

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

  const lipLoop = rig.groups?.outerLip || [];
  const backPos = gl.createBuffer();
  const backUv = gl.createBuffer();

  function drawBacking(posed, origin, scale) {
    if (lipLoop.length < 3) return;
    const coords = [];
    const uvs = [];
    const points = lipLoop.map((index) => ({
      x: posed.pos[index * 2],
      y: posed.pos[index * 2 + 1],
      u: posed.uv[index * 2],
      v: posed.uv[index * 2 + 1],
    }));
    const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const push = (point, scaleOut) => {
      coords.push(cx + (point.x - cx) * scaleOut, cy + (point.y - cy) * scaleOut);
      uvs.push(point.u, point.v);
    };
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      push({ x: cx, y: cy, u: points[0].u, v: points[0].v }, 1);
      push(a, 1.35);
      push(b, 1.35);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, backPos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(coords), gl.DYNAMIC_DRAW);
    const p = gl.getAttribLocation(skin, "aPos");
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, backUv);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.DYNAMIC_DRAW);
    const uv = gl.getAttribLocation(skin, "aUv");
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(skin, "uOrigin"), origin[0], origin[1]);
    gl.uniform2f(gl.getUniformLocation(skin, "uScale"), scale, scale);
    gl.uniform2f(gl.getUniformLocation(skin, "uView"), canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, coords.length / 2);
  }

  function drawMouth(posed, origin, scale) {
    if (!mouthLoop.length || posed.jawOpen < 0.04) return;
    const coords = [];
    const upper = [];
    const along = [];
    let minX = Infinity;
    let maxX = -Infinity;
    const points = mouthLoop.map((index) => {
      const x = posed.pos[index * 2];
      const y = posed.pos[index * 2 + 1];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      return { x, y, upper: rig.landmarks[index][1] <= slit ? 1 : 0 };
    });
    const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const span = Math.max(1, maxX - minX);
    const push = (x, y, up, t) => {
      coords.push(x, y);
      upper.push(up);
      along.push(t);
    };
    const pad = 1.12;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      push(cx, cy, 0.15, 0.5);
      push(cx + (a.x - cx) * pad, cy + (a.y - cy) * pad, a.upper, (a.x - minX) / span);
      push(cx + (b.x - cx) * pad, cy + (b.y - cy) * pad, b.upper, (b.x - minX) / span);
    }
    gl.useProgram(mouth);
    gl.bindBuffer(gl.ARRAY_BUFFER, mouthBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(coords), gl.DYNAMIC_DRAW);
    const p = gl.getAttribLocation(mouth, "aPos");
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mouthUpper);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(upper), gl.DYNAMIC_DRAW);
    const u = gl.getAttribLocation(mouth, "aUpper");
    gl.enableVertexAttribArray(u);
    gl.vertexAttribPointer(u, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mouthAlong);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(along), gl.DYNAMIC_DRAW);
    const al = gl.getAttribLocation(mouth, "aAlong");
    gl.enableVertexAttribArray(al);
    gl.vertexAttribPointer(al, 1, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(mouth, "uOrigin"), origin[0], origin[1]);
    gl.uniform2f(gl.getUniformLocation(mouth, "uScale"), scale, scale);
    gl.uniform2f(gl.getUniformLocation(mouth, "uView"), canvas.width, canvas.height);
    gl.uniform1f(gl.getUniformLocation(mouth, "uSmile"), Math.max(0, Math.min(1, posed.mouthWide || 0)));
    gl.uniform1f(gl.getUniformLocation(mouth, "uOpen"), posed.jawOpen || 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, teethTex);
    gl.uniform1i(gl.getUniformLocation(mouth, "uTeeth"), 1);
    gl.drawArrays(gl.TRIANGLES, 0, coords.length / 2);
  }

  function drawPart(draw, origin, scale) {
    if (!draw.count) return;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, draw.buffer);
    gl.uniform2f(gl.getUniformLocation(skin, "uOrigin"), origin[0], origin[1]);
    gl.uniform2f(gl.getUniformLocation(skin, "uScale"), scale, scale);
    gl.uniform2f(gl.getUniformLocation(skin, "uView"), canvas.width, canvas.height);
    gl.drawElements(gl.TRIANGLES, draw.count, gl.UNSIGNED_SHORT, 0);
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    resize();
    if (now > nextBlink) {
      blink = 1;
      blinkUntil = now + 120;
      nextBlink = now + 2400 + Math.random() * 3800;
    }
    if (blink > 0 && now > blinkUntil) blink = 0;
    if (mode === "idle" && now > nextSaccade) {
      saccadeX = (Math.random() - 0.5) * 0.36;
      saccadeY = (Math.random() - 0.5) * 0.22;
      nextSaccade = now + 1600 + Math.random() * 2400;
    }
    if (!emotion || (mode === "idle" && emotionUntil && now > emotionUntil)) {
      if (mode === "idle") emotion = "";
    }
    springTo(mix, emotion ? 1 : 0, dt, 8);
    const elapsed = now - trackStart;
    const textPose = track.length ? sampleTrack(track, elapsed) : null;
    const rise = 1 - Math.exp(-dt / 0.04);
    const fall = 1 - Math.exp(-dt / 0.11);
    const follow = (current, target) => current + (target - current) * (target > current ? rise : fall);
    heard.rms = follow(heard.rms, audio.rms || 0);
    heard.centroid = follow(heard.centroid, audio.centroid || 0);
    heard.low = follow(heard.low, audio.low || 0);
    heard.mid = follow(heard.mid, audio.mid || 0);
    heard.high = follow(heard.high, audio.high || 0);
    heard.speaking = Boolean(audio.speaking) && heard.rms > 0.02;
    const audioPose = poseFromAudio(heard);
    const speech = textPose ? mixSpeech(audioPose, textPose, { hasText: true, speaking: mode === "speak" && (audio.speaking || elapsed < estimateSpeechMs(utterance)) }) : (mode === "speak" ? audioPose : null);
    const target = lifeTargets({
      mode,
      emotion,
      emotionMix: mix.value,
      speech,
      time: now,
      saccadeX,
      saccadeY,
      blink,
    });
    const current = {};
    for (const key of Object.keys(springs)) current[key] = springTo(springs[key], target[key] || 0, dt, omega[key] || 10);
    const posed = deform(rig, current);
    const fit = Math.min(canvas.width / rig.width, canvas.height / rig.height) * 0.96 * (1 + Math.sin(now / 1700) * 0.008);
    const origin = [(canvas.width - rig.width * fit) / 2, (canvas.height - rig.height * fit) / 2];
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, posed.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, posed.uv);
    gl.useProgram(skin);
    for (let unit = 2; unit < 6; unit++) gl.disableVertexAttribArray(unit);
    const loc = gl.getAttribLocation(skin, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    const uvLoc = gl.getAttribLocation(skin, "aUv");
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, faceTex);
    gl.uniform1i(gl.getUniformLocation(skin, "uTex"), 0);
    for (let i = 0; i < hullList.length; i++) {
      const vertex = hullList[i] * 2;
      hullPos[i * 2] = posed.pos[vertex];
      hullPos[i * 2 + 1] = posed.pos[vertex + 1];
      hullUv[i * 2] = posed.uv[vertex];
      hullUv[i * 2 + 1] = posed.uv[vertex + 1];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, hullPosBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, hullPos);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, hullUvBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, hullUv);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(skin, "uOrigin"), origin[0], origin[1]);
    gl.uniform2f(gl.getUniformLocation(skin, "uScale"), fit, fit);
    gl.uniform2f(gl.getUniformLocation(skin, "uView"), canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, hullList.length);
    drawBacking(posed, origin, fit);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
    drawPart(mouthCover, origin, fit);
    drawPart(skinDraw, origin, fit);
    if (current.jawOpen > 0.14) drawMouth({ ...posed, jawOpen: current.jawOpen, mouthWide: current.mouthWide }, origin, fit);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    kind: "rig",
    ready: Promise.resolve(),
    setMode(next) {
      const name = next || "idle";
      mode = name === "happy" || name === "surprised" ? "idle" : name;
      if (next === "happy") this.setEmotion("joy");
      if (next === "surprised") this.setEmotion("surprised");
      if (name !== "speak") audio.speaking = false;
    },
    setEmotion(next) {
      const map = { happy: "joy", curious: "confused", think: "confused", neutral: "" };
      emotion = map[next] ?? next ?? "";
      if (emotion) emotionUntil = performance.now() + 5600;
    },
    setUtterance(text) {
      const clean = String(text || "").trim();
      if (!clean) {
        utterance = "";
        track = [];
        return;
      }
      if (clean === utterance) return;
      const extend = utterance && clean.startsWith(utterance);
      utterance = clean;
      track = buildTrack(clean);
      if (!extend) trackStart = performance.now();
    },
    setViseme(next) {
      const name = typeof next === "object" ? visemeFromShape(next) : (next || "rest");
      if (!track.length && mode === "speak") {
        const pose = poseForViseme(name === "rest" || name === "mbp" ? "mbp" : name);
        audio = { ...audio, rms: 0.02 + (pose.jawOpen || 0) * 0.2, centroid: pose.mouthWide > 0.4 ? 0.7 : pose.lipRound > 0.5 ? 0.2 : 0.4, speaking: true };
      }
    },
    setLevel(value) {
      audio = { ...audio, rms: Math.max(0, Math.min(1, value || 0)) };
    },
    setAudio(level = {}) {
      audio = {
        rms: level.rms || 0,
        centroid: level.centroid || 0,
        low: level.low || 0,
        mid: level.mid || 0,
        high: level.high || 0,
        speaking: Boolean(level.speaking),
      };
      if (mode === "speak" && !track.length) {
        const name = visemeFromAudio(audio);
        track = [];
        void name;
      }
    },
    destroy() {
      running = false;
      observer.disconnect();
    },
  };
}

export async function loadRigAvatar(canvas, base) {
  const root = rootUrl(base);
  const response = await fetch(`${root}rig.json`);
  if (!response.ok) throw new Error("rig yok");
  const rig = await response.json();
  const [image, teeth] = await Promise.all([
    loadImage(`${root}base.jpg`),
    loadImage(`${root}teeth.png`),
  ]);
  try {
    return await createRigAvatar(canvas, { base, rig, image, teeth });
  } catch (error) {
    canvas.getContext("webgl")?.getExtension?.("WEBGL_lose_context")?.loseContext?.();
    throw error;
  }
}

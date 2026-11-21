import { visemeFromChar } from "./viseme.js";

const POSES = {
  rest: { jawOpen: 0, mouthWide: 0, lipRound: 0, lipPress: 0.08, upperLipRaise: 0, lowerLipFunnel: 0 },
  a: { jawOpen: 0.68, mouthWide: 0.22, lipRound: 0, lipPress: 0, upperLipRaise: 0.12, lowerLipFunnel: 0 },
  e: { jawOpen: 0.34, mouthWide: 0.48, lipRound: 0.04, lipPress: 0, upperLipRaise: 0.06, lowerLipFunnel: 0 },
  i: { jawOpen: 0.16, mouthWide: 0.58, lipRound: 0, lipPress: 0, upperLipRaise: 0.05, lowerLipFunnel: 0 },
  o: { jawOpen: 0.42, mouthWide: 0.02, lipRound: 0.7, lipPress: 0, upperLipRaise: 0, lowerLipFunnel: 0.06 },
  u: { jawOpen: 0.22, mouthWide: -0.04, lipRound: 0.82, lipPress: 0, upperLipRaise: 0, lowerLipFunnel: 0.1 },
  mbp: { jawOpen: 0.02, mouthWide: 0, lipRound: 0, lipPress: 0.96, upperLipRaise: 0, lowerLipFunnel: 0 },
  fv: { jawOpen: 0.12, mouthWide: 0.04, lipRound: 0.16, lipPress: 0.1, upperLipRaise: 0.34, lowerLipFunnel: 0.86 },
  ltd: { jawOpen: 0.24, mouthWide: 0.12, lipRound: 0.04, lipPress: 0.08, upperLipRaise: 0.04, lowerLipFunnel: 0 },
  s: { jawOpen: 0.16, mouthWide: 0.36, lipRound: 0, lipPress: 0.18, upperLipRaise: 0.05, lowerLipFunnel: 0.05 },
};

const VISEME_POSE = {
  a: "a",
  e: "e",
  i: "i",
  o: "o",
  u: "u",
  mbp: "mbp",
  fv: "fv",
  ltd: "ltd",
  s: "s",
  rest: "rest",
};

export function poseForViseme(name) {
  return { ...POSES[VISEME_POSE[name] || "rest"] };
}

function weightFor(ch) {
  const name = visemeFromChar(ch);
  if (name === "rest") return 0.28;
  if ("aeiou".includes(name)) return 1.15;
  if (name === "mbp" || name === "fv") return 0.7;
  return 0.62;
}

export function estimateSpeechMs(text) {
  const clean = String(text || "");
  return Math.max(700, [...clean].reduce((sum, ch) => sum + weightFor(ch) * 78, 0));
}

export function buildTrack(text, durationMs = estimateSpeechMs(text)) {
  const chars = [...String(text || "")];
  if (!chars.length) return [];
  const weights = chars.map(weightFor);
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = 0;
  return chars.map((ch, index) => {
    const dur = (weights[index] / total) * durationMs;
    const span = {
      t0: cursor,
      t1: cursor + dur,
      pose: poseForViseme(visemeFromChar(ch)),
    };
    cursor += dur;
    return span;
  });
}

function lerp(a, b, t) {
  const out = {};
  for (const key of Object.keys(POSES.rest)) out[key] = a[key] + (b[key] - a[key]) * t;
  return out;
}

export function sampleTrack(track, timeMs, leadMs = 60) {
  if (!track?.length) return poseForViseme("rest");
  let index = track.findIndex((span) => timeMs < span.t1);
  if (index < 0) index = track.length - 1;
  const current = track[index];
  const next = track[index + 1];
  if (next && next.t0 - timeMs < leadMs) {
    const blend = 1 - Math.max(0, next.t0 - timeMs) / leadMs;
    return lerp(current.pose, next.pose, blend * 0.7);
  }
  const prev = track[index - 1];
  if (prev && timeMs - current.t0 < leadMs) {
    const blend = (timeMs - current.t0) / leadMs;
    return lerp(prev.pose, current.pose, 0.35 + blend * 0.65);
  }
  return { ...current.pose };
}

export function poseFromAudio({ rms = 0, centroid = 0, low = 0, mid = 0, high = 0 } = {}) {
  const jawOpen = clamp((rms - 0.025) / 0.22);
  const bright = Math.max(centroid, high * 0.8);
  const dark = Math.max(low, 1 - centroid);
  return {
    jawOpen,
    mouthWide: clamp((bright - 0.42) * 1.5) * Math.max(jawOpen, 0.2),
    lipRound: clamp((dark - 0.45) * 1.6) * (mid > high ? jawOpen : jawOpen * 0.45),
    lipPress: jawOpen < 0.08 ? clamp(0.35 + (0.3 - centroid)) : clamp((0.25 - centroid) * (1 - jawOpen)),
    upperLipRaise: high > 0.35 && jawOpen < 0.4 ? 0.25 : 0,
    lowerLipFunnel: high > 0.4 && jawOpen < 0.35 ? 0.35 : 0,
  };
}

export function mixSpeech(audioPose, textPose, { hasText = false, speaking = false } = {}) {
  if (!hasText) return { ...audioPose };
  if (!speaking) return { ...textPose };
  const heard = clamp(audioPose.jawOpen);
  if (heard < 0.05) return { ...textPose, jawOpen: textPose.jawOpen * 0.82 };
  const jawOpen = clamp(heard * 0.74 + textPose.jawOpen * 0.32);
  return {
    jawOpen,
    mouthWide: textPose.mouthWide * (0.62 + 0.38 * jawOpen),
    lipRound: textPose.lipRound * 0.82 + audioPose.lipRound * 0.18,
    lipPress: textPose.lipPress * (1 - jawOpen * 0.85),
    upperLipRaise: textPose.upperLipRaise,
    lowerLipFunnel: textPose.lowerLipFunnel,
  };
}

function clamp(value) {
  return Math.max(0, Math.min(1, value || 0));
}

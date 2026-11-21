import { emptyPose } from "./face-rig.js";

export const EMOTION_PRESETS = {
  joy: { mouthWide: 0.48, cheekRaise: 0.42, browOuterLeft: 0.22, browOuterRight: 0.22, lidLeft: 0.08, lidRight: 0.08, jawOpen: 0.03 },
  sad: { browInnerLeft: 0.58, browInnerRight: 0.58, mouthWide: -0.3, lidLeft: 0.24, lidRight: 0.24, cheekRaise: -0.05 },
  surprised: { jawOpen: 0.46, browInnerLeft: 0.82, browInnerRight: 0.82, browOuterLeft: 0.7, browOuterRight: 0.7, lidLeft: -0.08, lidRight: -0.08 },
  fear: { browInnerLeft: 0.72, browInnerRight: 0.72, browOuterLeft: 0.35, browOuterRight: 0.35, jawOpen: 0.24, mouthWide: 0.18, lidLeft: -0.1, lidRight: -0.1 },
  angry: { browInnerLeft: -0.78, browInnerRight: -0.78, browOuterLeft: -0.12, browOuterRight: -0.12, lidLeft: 0.3, lidRight: 0.3, lipPress: 0.28, mouthWide: -0.12 },
  confused: { browInnerLeft: 0.42, browOuterRight: -0.38, browOuterLeft: 0.2, gazeX: 0.32, gazeY: 0.22, mouthWide: -0.04 },
  calm: { lidLeft: 0.16, lidRight: 0.16, mouthWide: 0.1, cheekRaise: 0.1 },
  shy: { gazeX: 0.24, gazeY: -0.46, mouthWide: 0.18, cheekRaise: 0.32, lidLeft: 0.22, lidRight: 0.28 },
  disgust: { mouthWide: -0.22, upperLipRaise: 0.48, browInnerLeft: -0.32, browInnerRight: -0.32, lipPress: 0.15 },
};

const ALIAS = { happy: "joy", curious: "confused", think: "confused", neutral: "" };

export function emotionPreset(name) {
  const key = ALIAS[name] ?? name;
  return EMOTION_PRESETS[key] ? { ...EMOTION_PRESETS[key] } : null;
}

function noise(t) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const h = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return h(i) * (1 - u) + h(i + 1) * u;
}

export function lifeTargets({
  mode = "idle",
  emotion = "",
  emotionMix = 0,
  speech = null,
  time = 0,
  saccadeX = 0,
  saccadeY = 0,
  blink = 0,
} = {}) {
  const t = time * 0.001;
  const preset = emotionPreset(emotion) || {};
  const mix = emotion && mode !== "think" ? emotionMix : mode === "think" ? Math.max(emotionMix, 0.35) : 0;
  const breath = 0.5 + 0.5 * Math.sin(t * 1.25);
  let yaw = (noise(t * 0.11) - 0.5) * 0.04;
  let pitch = (noise(t * 0.09 + 4) - 0.5) * 0.028 + (breath - 0.5) * 0.02;
  let roll = (noise(t * 0.08 + 8) - 0.5) * 0.022;
  let gazeX = saccadeX + (noise(t * 0.28 + 2) - 0.5) * 0.012;
  let gazeY = saccadeY + (noise(t * 0.24 + 6) - 0.5) * 0.01;
  let browInnerLeft = (noise(t * 0.08 + 1) - 0.5) * 0.06;
  let browInnerRight = (noise(t * 0.08 + 2) - 0.5) * 0.06;
  let browOuterLeft = 0;
  let browOuterRight = 0;
  let lidLeft = 0;
  let lidRight = 0;

  if (mode === "listen") {
    pitch += Math.sin(t * 1.35) * 0.028;
    browOuterLeft = 0.36;
    browOuterRight = 0.36;
    browInnerLeft = 0.18;
    browInnerRight = 0.18;
    gazeX *= 0.25;
    gazeY *= 0.25;
  } else if (mode === "think") {
    gazeX = 0.46;
    gazeY = 0.62;
    yaw = 0.05;
    pitch = -0.03;
    browInnerLeft = -0.32;
    browInnerRight = -0.26;
    browOuterLeft = 0.12;
  }

  const add = (key, value) => (preset[key] || 0) * mix + (value || 0);
  yaw = add("yaw", yaw);
  pitch = add("pitch", pitch);
  roll = add("roll", roll);
  gazeX = add("gazeX", gazeX);
  gazeY = add("gazeY", gazeY);
  browInnerLeft = add("browInnerLeft", browInnerLeft);
  browInnerRight = add("browInnerRight", browInnerRight);
  browOuterLeft = add("browOuterLeft", browOuterLeft);
  browOuterRight = add("browOuterRight", browOuterRight);
  lidLeft = add("lidLeft", lidLeft);
  lidRight = add("lidRight", lidRight);
  if (blink > 0) {
    lidLeft = Math.max(lidLeft, blink);
    lidRight = Math.max(lidRight, blink * 0.96);
  }

  const talking = mode === "speak" && speech;
  const mouth = talking ? speech : {};
  const pose = emptyPose();
  pose.jawOpen = talking ? mouth.jawOpen || 0 : (preset.jawOpen || 0) * mix;
  pose.mouthWide = talking ? (mouth.mouthWide || 0) + (preset.mouthWide || 0) * mix * 0.4 : (preset.mouthWide || 0) * mix;
  pose.lipRound = talking ? mouth.lipRound || 0 : (preset.lipRound || 0) * mix;
  pose.lipPress = talking ? mouth.lipPress || 0 : (preset.lipPress || 0) * mix;
  pose.upperLipRaise = talking ? mouth.upperLipRaise || 0 : (preset.upperLipRaise || 0) * mix;
  pose.lowerLipFunnel = talking ? mouth.lowerLipFunnel || 0 : (preset.lowerLipFunnel || 0) * mix;
  pose.cheekRaise = (preset.cheekRaise || 0) * (talking ? Math.max(mix, 0.45) : mix);
  pose.browInnerLeft = browInnerLeft;
  pose.browInnerRight = browInnerRight;
  pose.browOuterLeft = browOuterLeft;
  pose.browOuterRight = browOuterRight;
  pose.lidLeft = lidLeft;
  pose.lidRight = lidRight;
  pose.gazeX = gazeX;
  pose.gazeY = gazeY;
  pose.yaw = yaw;
  pose.pitch = pitch;
  pose.roll = roll;
  pose.breath = breath;
  return pose;
}

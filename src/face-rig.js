const DEG8 = 0.14;

export function createSpring(value = 0) {
  return { value, velocity: 0 };
}

export function springTo(state, target, dt, omega = 12) {
  const step = Math.min(0.05, Math.max(0, dt || 0));
  const accel = omega * omega * (target - state.value) - 2 * omega * state.velocity;
  state.velocity += accel * step;
  state.value += state.velocity * step;
  return state.value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value || 0));
}

function add(pos, indices, dx, dy, scale = 1) {
  for (const index of indices || []) {
    pos[index * 2] += dx * scale;
    pos[index * 2 + 1] += dy * scale;
  }
}

function mean(pos, indices, axis) {
  let sum = 0;
  const list = indices || [];
  for (const index of list) sum += pos[index * 2 + axis];
  return list.length ? sum / list.length : 0;
}

export function emptyPose() {
  return {
    jawOpen: 0,
    mouthWide: 0,
    lipRound: 0,
    lipPress: 0,
    upperLipRaise: 0,
    lowerLipFunnel: 0,
    cheekRaise: 0,
    browInnerLeft: 0,
    browInnerRight: 0,
    browOuterLeft: 0,
    browOuterRight: 0,
    lidLeft: 0,
    lidRight: 0,
    gazeX: 0,
    gazeY: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    breath: 0.5,
  };
}

export function deform(rig, params = {}) {
  const pose = { ...emptyPose(), ...params };
  const width = rig.width;
  const height = rig.height;
  const count = rig.landmarks.length + rig.anchors.length;
  const rest = new Float32Array(count * 2);
  const pos = new Float32Array(count * 2);
  const uv = new Float32Array(count * 2);
  const depth = new Float32Array(count);
  const influence = rig.influence;
  for (let i = 0; i < rig.landmarks.length; i++) {
    const point = rig.landmarks[i];
    rest[i * 2] = point[0] * width;
    rest[i * 2 + 1] = point[1] * height;
    uv[i * 2] = point[0];
    uv[i * 2 + 1] = point[1];
    depth[i] = point[2];
  }
  for (let i = 0; i < rig.anchors.length; i++) {
    const index = rig.landmarks.length + i;
    const anchor = rig.anchors[i];
    rest[index * 2] = anchor[0] * width;
    rest[index * 2 + 1] = anchor[1] * height;
    uv[index * 2] = anchor[0];
    uv[index * 2 + 1] = anchor[1];
    depth[index] = anchor[2] || 0;
  }
  pos.set(rest);
  const groups = rig.groups || {};
  const jaw = pose.jawOpen;
  const drop = jaw * height * 0.03;
  const weights = new Map();
  const weight = (indices, value) => {
    for (const index of indices || []) weights.set(index, Math.max(weights.get(index) || 0, value));
  };
  weight(groups.lipLower, 1);
  weight(groups.lowerLip, 0.92);
  weight(groups.chin, 0.48);
  weight(groups.cornerLeft, 0.32);
  weight(groups.cornerRight, 0.32);
  for (const [index, value] of weights) pos[index * 2 + 1] += drop * value;

  const mouthX = (mean(rest, groups.cornerLeft, 0) + mean(rest, groups.cornerRight, 0)) * 0.5 || width * 0.5;
  const wide = pose.mouthWide;
  for (const index of groups.cornerLeft || []) {
    pos[index * 2] -= wide * width * 0.014;
    pos[index * 2 + 1] -= wide * height * 0.004;
  }
  for (const index of groups.cornerRight || []) {
    pos[index * 2] += wide * width * 0.014;
    pos[index * 2 + 1] -= wide * height * 0.004;
  }
  for (const index of [...(groups.upperLip || []), ...(groups.lowerLip || [])]) {
    pos[index * 2] += Math.sign(rest[index * 2] - mouthX) * wide * width * 0.006;
  }

  const round = pose.lipRound;
  for (const index of [...(groups.upperLip || []), ...(groups.lowerLip || []), ...(groups.cornerLeft || []), ...(groups.cornerRight || [])]) {
    pos[index * 2] += (mouthX - rest[index * 2]) * round * 0.28;
  }
  const press = pose.lipPress;
  for (const index of groups.upperLip || []) pos[index * 2 + 1] += press * height * 0.007;
  for (const index of groups.lowerLip || []) pos[index * 2 + 1] -= press * height * 0.009;
  for (const index of groups.upperLip || []) pos[index * 2 + 1] -= pose.upperLipRaise * height * 0.012;
  for (const index of [14, 17, 87, 84, 314, 181]) {
    if (index < count) pos[index * 2 + 1] -= pose.lowerLipFunnel * height * 0.014;
  }

  const cheek = pose.cheekRaise * height * 0.01;
  for (const index of groups.cheekLeft || []) {
    pos[index * 2] -= pose.cheekRaise * width * 0.006;
    pos[index * 2 + 1] -= cheek;
  }
  for (const index of groups.cheekRight || []) {
    pos[index * 2] += pose.cheekRaise * width * 0.006;
    pos[index * 2 + 1] -= cheek;
  }

  const brow = height * 0.014;
  add(pos, groups.browInnerLeft, 0, -pose.browInnerLeft * brow);
  add(pos, groups.browInnerRight, 0, -pose.browInnerRight * brow);
  add(pos, groups.browOuterLeft, 0, -pose.browOuterLeft * brow);
  add(pos, groups.browOuterRight, 0, -pose.browOuterRight * brow);

  const closeLid = (upper, lower, amount) => {
    const open = Math.max(2, mean(rest, lower, 1) - mean(rest, upper, 1));
    const shut = clamp(amount, -0.25, 1);
    for (const index of upper || []) pos[index * 2 + 1] += shut * open * 0.86;
    for (const index of lower || []) pos[index * 2 + 1] -= shut * open * 0.2;
  };
  closeLid(groups.lidUpperLeft, groups.lidLowerLeft, pose.lidLeft);
  closeLid(groups.lidUpperRight, groups.lidLowerRight, pose.lidRight);

  const look = (indices, outer, inner) => {
    const eyeW = Math.abs(rest[outer * 2] - rest[inner * 2]) || width * 0.08;
    const dx = clamp(pose.gazeX, -1, 1) * eyeW * 0.16;
    const dy = -clamp(pose.gazeY, -1, 1) * eyeW * 0.12;
    add(pos, indices, dx, dy);
  };
  look(groups.irisLeft, 33, 133);
  look(groups.irisRight, 263, 362);
  const slideEye = (center, outer, inner) => {
    const cx = rest[center * 2];
    const cy = rest[center * 2 + 1];
    const rad = Math.max(6, Math.abs(rest[outer * 2] - rest[inner * 2]) * 0.34);
    const du = clamp(pose.gazeX, -1, 1) * 0.02;
    const dv = -clamp(pose.gazeY, -1, 1) * 0.016;
    for (let i = 0; i < rig.landmarks.length; i++) {
      const dx = rest[i * 2] - cx;
      const dy = rest[i * 2 + 1] - cy;
      const dist = Math.hypot(dx, dy);
      if (dist >= rad) continue;
      const falloff = 1 - dist / rad;
      uv[i * 2] += du * falloff;
      uv[i * 2 + 1] += dv * falloff;
    }
  };
  if (groups.irisLeft?.[0] != null) slideEye(groups.irisLeft[0], 33, 133);
  if (groups.irisRight?.[0] != null) slideEye(groups.irisRight[0], 263, 362);

  const nose = groups.nose ?? 1;
  const noseX = rest[nose * 2];
  const noseY = rest[nose * 2 + 1];
  const noseZ = depth[nose] || 0;
  const yaw = clamp(pose.yaw, -DEG8, DEG8);
  const pitch = clamp(pose.pitch, -DEG8, DEG8);
  const roll = clamp(pose.roll, -DEG8, DEG8);
  const breath = (pose.breath - 0.5) * height * 0.005;
  for (let i = 0; i < count; i++) {
    const inf = influence[i] || 0;
    if (inf < 0.001) continue;
    const z = (noseZ - depth[i]) * inf;
    pos[i * 2] += Math.sin(yaw) * z * width * 0.9;
    pos[i * 2 + 1] += Math.sin(pitch) * z * height * 0.45 - breath * inf;
    const dx = pos[i * 2] - noseX;
    const dy = pos[i * 2 + 1] - noseY;
    const ang = roll * inf;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    pos[i * 2] = noseX + dx * cos - dy * sin;
    pos[i * 2 + 1] = noseY + dx * sin + dy * cos;
  }
  return { pos, uv, rest };
}

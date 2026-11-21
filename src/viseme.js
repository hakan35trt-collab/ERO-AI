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
  if ("mbp".includes(c) && c !== " ") return "mbp";
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

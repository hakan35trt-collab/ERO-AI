import { createCanvasAvatar } from "./avatar-canvas.js";
import { loadRigAvatar } from "./avatar-gl.js";

export { resolveViseme, visemeFromAudio, visemeFromChar, visemeFromShape } from "./viseme.js";

export const AVATAR_SIZE = { width: 864, height: 1152 };

export function createAvatar(canvas, options = {}) {
  const base = options.base || import.meta.env?.BASE_URL || "./";
  let impl = null;
  const queue = [];
  const ready = loadRigAvatar(canvas, base).then((avatar) => {
    impl = avatar;
  }).catch(() => {
    impl = createCanvasAvatar(canvas, { base });
    return impl.ready;
  }).then(() => {
    for (const [name, args] of queue) impl?.[name]?.(...args);
    queue.length = 0;
  });
  const call = (name) => (...args) => {
    if (impl?.[name]) impl[name](...args);
    else queue.push([name, args]);
  };
  return {
    ready,
    kind: () => impl?.kind || "frames",
    setMode: call("setMode"),
    setEmotion: call("setEmotion"),
    setUtterance: call("setUtterance"),
    setViseme: call("setViseme"),
    setLevel: call("setLevel"),
    setAudio: call("setAudio"),
    destroy: call("destroy"),
  };
}

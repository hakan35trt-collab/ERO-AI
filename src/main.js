import "@fontsource/outfit/latin-400.css";
import "@fontsource/outfit/latin-ext-400.css";
import "@fontsource/outfit/latin-500.css";
import "@fontsource/outfit/latin-ext-500.css";
import "@fontsource/outfit/latin-600.css";
import "@fontsource/outfit/latin-ext-600.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-ext-400.css";
import "./styles.css";
import { mount } from "./app.js";

const speaking = { current: false };
const app = mount(document, {
  onSpeaking(value) {
    speaking.current = value;
  },
});

const params = new URLSearchParams(location.search);
const splash = document.querySelector("#splash");
if (splash) {
  const close = () => {
    splash.classList.add("leave");
    setTimeout(() => splash.remove(), 520);
  };
  if (params.has("ifade")) splash.remove();
  else if (params.get("splash") === "1") splash.addEventListener("click", close);
  else {
    splash.addEventListener("click", close);
    setTimeout(close, 1680);
  }
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  let controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    location.reload();
  });

  const base = import.meta.env.BASE_URL || "./";
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).then((registration) => {
    const ready = () => {
      if (registration.waiting && navigator.serviceWorker.controller) offer(registration);
    };
    ready();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) offer(registration);
      });
    });
    const check = () => registration.update().catch(() => {});
    check();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    setInterval(check, 60 * 1000);
  }).catch(() => {});
}

function offer(registration) {
  const go = () => {
    app.toast("Yeni ERO sürümü hazır. Yenileniyor…");
    setTimeout(() => registration.waiting?.postMessage({ type: "ero-skip-waiting" }), 700);
  };
  if (!speaking.current) {
    go();
    return;
  }
  app.toast("Yeni sürüm konuşma bitince yüklenecek.");
  const wait = () => {
    if (!speaking.current) go();
    else setTimeout(wait, 500);
  };
  wait();
}

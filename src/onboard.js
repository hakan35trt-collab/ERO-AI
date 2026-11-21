import { APK_URL, ONBOARD_STEPS, compareVersions, nativeCall, onAndroid } from "./phone.js";

const DONE_KEY = "ero.onboarded";

export function startAndroidShell(doc, { toast, ask } = {}) {
  const link = doc.querySelector("#apk-link");
  if (link) link.href = APK_URL;
  if (!onAndroid()) return;

  const listenRow = doc.querySelector("#listen-row");
  const listen = doc.querySelector("#set-listen");
  const check = doc.querySelector("#apk-check");
  if (listenRow) listenRow.hidden = false;
  if (check) check.hidden = false;

  const state = nativeCall("permissionState");
  if (listen) listen.checked = Boolean(state.listening);
  listen?.addEventListener("change", () => {
    nativeCall(listen.checked ? "startListening" : "stopListening");
    toast?.(listen.checked ? "Ekran kilitliyken ERO dinliyor." : "Arka plan dinlemesi kapandı.");
  });
  check?.addEventListener("click", () => offerUpdate(doc, toast, true));

  window.eroWake = (text) => {
    const line = String(text || "").trim();
    if (!line) return;
    ask?.(line);
  };
  window.eroUpdate = (info) => showUpdate(doc, toast, info);

  if (!localStorage.getItem(DONE_KEY)) startOnboarding(doc, toast);
  else offerUpdate(doc, toast, false);
}

function startOnboarding(doc, toast) {
  const root = doc.querySelector("#onboard");
  const title = doc.querySelector("#onboard-title");
  const body = doc.querySelector("#onboard-body");
  const kicker = doc.querySelector("#onboard-kicker");
  const allow = doc.querySelector("#onboard-allow");
  const next = doc.querySelector("#onboard-next");
  if (!root || !allow || !next) return;
  let index = -1;
  const show = () => {
    index += 1;
    const step = ONBOARD_STEPS[index];
    if (!step) {
      localStorage.setItem(DONE_KEY, "1");
      root.hidden = true;
      nativeCall("startListening");
      const box = doc.querySelector("#set-listen");
      if (box) box.checked = true;
      toast?.("Hazırım. ERO de, sonra ne istediğini söyle.");
      return;
    }
    kicker.textContent = `${index + 1} / ${ONBOARD_STEPS.length}`;
    title.textContent = step.title;
    body.textContent = step.body;
    allow.textContent = step.kind === "settings" ? "Ayarları aç" : "İzin ver";
    next.textContent = index === ONBOARD_STEPS.length - 1 ? "Bitir" : "Geç";
    root.hidden = false;
  };
  allow.onclick = () => {
    nativeCall("requestPermission", { id: ONBOARD_STEPS[index]?.id || "" });
  };
  next.onclick = () => show();
  show();
}

function offerUpdate(doc, toast, manual) {
  const info = nativeCall("checkUpdate");
  if (!info?.newer) {
    if (manual) toast?.("ERO güncel.");
    return;
  }
  showUpdate(doc, toast, info);
}

function showUpdate(doc, toast, info) {
  if (!info?.newer) return;
  const current = info.current || "";
  const remote = info.version || "";
  if (current && remote && compareVersions(remote, current) <= 0) return;
  const root = doc.querySelector("#onboard");
  const title = doc.querySelector("#onboard-title");
  const body = doc.querySelector("#onboard-body");
  const allow = doc.querySelector("#onboard-allow");
  const next = doc.querySelector("#onboard-next");
  if (!root || !title || !body || !allow || !next) {
    toast?.(`Yeni ERO sürümü var: ${remote}`);
    return;
  }
  doc.querySelector("#onboard-kicker").textContent = "Güncelleme";
  title.textContent = `ERO ${remote} hazır.`;
  body.textContent = "Yeni sürümü indirip kurayım mı? Konuşma ve yüz aynı kalır.";
  allow.textContent = "İndir ve kur";
  next.textContent = "Sonra";
  allow.onclick = () => {
    allow.disabled = true;
    toast?.("APK indiriliyor…");
    const result = nativeCall("installUpdate");
    allow.disabled = false;
    if (!result?.ok) toast?.(result?.error || "Kurulum açılmadı.");
  };
  next.onclick = () => {
    root.hidden = true;
  };
  root.hidden = false;
}

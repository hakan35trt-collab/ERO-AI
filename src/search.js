import { cleanQuery } from "./text.js";

const WEATHER = {
  0: "açık",
  1: "çoğunlukla açık",
  2: "parçalı bulutlu",
  3: "kapalı",
  45: "sisli",
  48: "kırağılı sis",
  51: "hafif çisenti",
  61: "yağmurlu",
  63: "yağmurlu",
  65: "şiddetli yağmur",
  71: "karlı",
  80: "sağanak",
  95: "gök gürültülü",
};

async function getJson(url, ms = 3500) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function cityFrom(question) {
  const t = question.toLocaleLowerCase("tr-TR");
  const before = t.match(/([a-zçğıöşü]{3,})(?:'(?:da|de|ta|te))?\s+hava/);
  const after = t.match(/hava(?:\s+durumu)?(?:\s+\w+){0,3}\s+([a-zçğıöşü]{3,})/);
  const stop = new Set(["bugün", "yarın", "şimdi", "bana", "lütfen", "nasıl", "nasil", "bir", "acaba", "ero", "dışarı", "disari"]);
  for (const candidate of [before?.[1], after?.[1]]) {
    if (candidate && !stop.has(candidate)) return candidate;
  }
  return "";
}

async function weatherNote(question) {
  if (!/hava/.test(question.toLocaleLowerCase("tr-TR"))) return "";
  const city = cityFrom(question);
  if (!city) return "Güncel hava için şehir belirtilmedi. Kullanıcıya hangi şehir olduğunu sor ve sayı uydurma.";
  const geo = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=tr&format=json`,
  );
  const place = geo?.results?.[0];
  if (!place) return `Hava için "${city}" konumu bulunamadı.`;
  const forecast = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`,
  );
  const current = forecast?.current;
  if (!current) return "";
  const sky = WEATHER[current.weather_code] || "değişken";
  return `Kaynak: Open-Meteo\nYer: ${place.name}\nŞu an: ${current.temperature_2m}°C, hissedilen ${current.apparent_temperature}°C, ${sky}, rüzgar ${current.wind_speed_10m} km/s.`;
}

async function wikiNote(query) {
  if (!query) return "";
  const search = await getJson(
    `https://tr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=2&utf8=1&format=json&origin=*`,
  );
  const hit = search?.query?.search?.[0];
  if (!hit) return "";
  const summary = await getJson(`https://tr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`);
  const extract = summary?.extract || stripHtml(hit.snippet);
  if (!extract) return "";
  return `Kaynak: Vikipedi\nBaşlık: ${summary?.title || hit.title}\nÖzet: ${extract.slice(0, 750)}`;
}

async function ddgNote(query) {
  if (!query) return "";
  const data = await getJson(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&kl=tr-tr`,
    2500,
  );
  const abstract = data?.AbstractText || data?.Answer || "";
  if (!abstract) return "";
  const heading = data.Heading ? `Başlık: ${data.Heading}\n` : "";
  return `Kaynak: DuckDuckGo\n${heading}Özet: ${String(abstract).slice(0, 500)}`;
}

export const KOCAELI = { latitude: 40.8533, longitude: 29.8815, name: "Kocaeli" };

export async function localForecast({ latitude, longitude, name }) {
  const forecast = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`,
  );
  const current = forecast?.current;
  if (!current) return null;
  return {
    name,
    temp: Math.round(current.temperature_2m),
    sky: WEATHER[current.weather_code] || "değişken",
  };
}

export async function research(question) {
  const work = (async () => {
    const weather = await weatherNote(question);
    const query = cleanQuery(question);
    const [wiki, ddg] = await Promise.all([wikiNote(query), ddgNote(query)]);
    return [weather, wiki, ddg].filter(Boolean).join("\n\n");
  })();
  const cap = new Promise((resolve) => setTimeout(() => resolve(""), 1500));
  return Promise.race([work.catch(() => ""), cap]);
}

export function sourceLabels(notes) {
  const labels = [];
  if (/Vikipedi/.test(notes)) labels.push("Vikipedi");
  if (/DuckDuckGo/.test(notes)) labels.push("DuckDuckGo");
  if (/Open-Meteo/.test(notes)) labels.push("Open-Meteo");
  return labels;
}

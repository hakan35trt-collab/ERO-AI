import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mark = fs.readFileSync(path.join(root, "public/ero-mark.svg"));
const mask = fs.readFileSync(path.join(root, "public/ero-mask.svg"));
const dir = path.join(root, "public/icons");
fs.mkdirSync(dir, { recursive: true });

const sizes = [16, 32, 48, 72, 96, 128, 144, 152, 180, 192, 384, 512];

for (const size of sizes) {
  await sharp(mark, { density: 384 }).resize(size, size).png().toFile(path.join(dir, `icon-${size}.png`));
}

for (const size of [192, 512]) {
  await sharp(mask, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(path.join(dir, `maskable-${size}.png`));
}

await sharp(mark, { density: 384 }).resize(180, 180).png().toFile(path.join(dir, "apple-touch-icon.png"));

const manifest = {
  id: "./",
  name: "ERO",
  short_name: "ERO",
  description: "Türkçe konuşan kişisel yapay zekâ asistanı",
  lang: "tr",
  dir: "ltr",
  start_url: "./",
  scope: "./",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#05070e",
  theme_color: "#05070e",
  categories: ["utilities", "entertainment"],
  icons: [
    { src: "icons/icon-72.png", sizes: "72x72", type: "image/png", purpose: "any" },
    { src: "icons/icon-96.png", sizes: "96x96", type: "image/png", purpose: "any" },
    { src: "icons/icon-128.png", sizes: "128x128", type: "image/png", purpose: "any" },
    { src: "icons/icon-144.png", sizes: "144x144", type: "image/png", purpose: "any" },
    { src: "icons/icon-152.png", sizes: "152x152", type: "image/png", purpose: "any" },
    { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "icons/icon-384.png", sizes: "384x384", type: "image/png", purpose: "any" },
    { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

fs.writeFileSync(path.join(root, "public/manifest.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("ERO ikonları hazır");

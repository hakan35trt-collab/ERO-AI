# ERO

ERO, Türkçe konuşan kişisel bir sesli asistan. Telefonda eller serbest sohbet eder; ortadaki portre konuşurken ağız ve gözleriyle eşlik eder. Ana ekrana kurulabilen bir PWA’dır.

## Yerelde çalıştırma

```bash
npm install
npm test
npm run dev
```

Uygulama [http://127.0.0.1:8731](http://127.0.0.1:8731) adresinde açılır.

```bash
npm run build
npm run preview
```

## Android’e kurma

1. Siteyi **Chrome** ile aç.
2. “ERO’yu ana ekrana ekle” bandına dokun veya Chrome menüsünden **Yükle** / **Ana ekrana ekle**’yi seç.
3. Ana ekrandaki ERO simgesinden aç.
4. İlk açılışta ücretsiz Gemini anahtarını yapıştır. Anahtar yalnızca bu tarayıcının `localStorage` alanına yazılır.

iPhone’da Safari’nin Paylaş menüsünden **Ana Ekrana Ekle** kullanılır. Canlı mikrofon orada sınırlıdır; yazarak da konuşabilirsin.

## Güncelleme

Kurulu uygulama yeni sürümü kendi alır. Hizmet çalışanı sayfa açılınca, sekme öne gelince ve yaklaşık her dakika denetler. Yeni dosyalar iner inmez bekleyen çalışan hemen devralır ve sayfa yenilenir. ERO o sırada konuşuyorsa cümle bitsin diye kısa bir süre bekler.

## GitHub Pages

Canlı adres: [https://hakan35trt-collab.github.io/ERO-AI/](https://hakan35trt-collab.github.io/ERO-AI/)

Her `main` push’u `.github/workflows/pages.yml` ile test eder, derler ve yayınlar. Üretim kökü `/ERO-AI/`dir. Pages kaynağı **Settings → Pages → Source: GitHub Actions** olmalıdır.

## Konuşma

Bir kez **Konuşmayı başlat**’a dokun. ERO dinlemeye devam eder; her turda mikrofona yeniden basılmaz. Sustuğunda (yaklaşık 700 ms) sıra ona geçer. **Durdur** veya güç düğmesi dinlemeyi keser. Konuşurken mikrofon durur; sesin belirgin biçimde yüksekse sözünü keser. Canlı Gemini hattında sunucunun kendi ses etkinliği algısı ve kesme desteği kullanılır, mikrofon yankı engellemeyle açık kalır.

Ayarlardaki **Yalnızca “ERO” deyince uyan** kapalı başlar. Açılırsa yedek hatta cümle “ERO” ile başlamalıdır.

Klavyeden de yazılır. Sohbet balonları sohbet sekmesindedir.

## Ses hattı

Anahtar [Google AI Studio](https://aistudio.google.com/apikey) üzerinden alınır. Depoya, iş akışına veya bir sunucuya hiç yazılmaz. Ayarlar ekranındaki alan da aynı yerel depoya gider.

1. **Canlı konuşma:** tarayıcıdan Gemini Live WebSocket. Modeller sırayla `gemini-omni-flash-preview`, sonra `gemini-omni-1.2-flash`. Ses **Charon** (sıcak erkek). Giriş 16 kHz PCM, çıkış 24 kHz PCM. Sessizlik eşiği 700 ms.
2. Canlı hat açılmazsa: mikrofon + yerel sessizlik algısı, metin için `gemini-3.5-flash-lite` (503/429 olursa yeniden dener, sonra `gemini-3.8-flash`), ses için `gemini-2.5-flash-preview-tts` ve yine Charon. Cümle cümle okunur.
3. Anahtar yoksa veya Gemini de susarsa: LLM7, sonra Pollinations. Bu yolda ses, cihazın `speechSynthesis` motorudur. Bu son çaredir.

## Portre

Ortadaki yüz, `public/avatar/` altındaki fotoğraf kareleridir. Hepsi aynı kadrajda **864×1152** JPG.

Ham kareler `public/avatar/raw/`:

| Dosya | Ne |
| --- | --- |
| `base.jpg` | Kapalı ağız, düz bakış. Dinlenme ve M/B/P bunu kullanır. |
| `viseme-a.jpg` | Geniş “a” |
| `viseme-e.jpg` | Hafif açık “e”. L/T/D de buna bağlanır. |
| `viseme-i.jpg` | Dişler, dar “i”. S de buna bağlanır. |
| `viseme-o.jpg` | Yuvarlak “o” |
| `viseme-u.jpg` | Büzük “u”. F/V de buna bağlanır. |
| `expr-blink.jpg` | Gözler kapalı |
| `expr-happy.jpg` | Gülümseme |
| `expr-surprised.jpg` | Şaşırma |
| `expr-thinking.jpg` | Yukarı-yana bakış |

`node scripts/generate-avatar.mjs` ceket logosuna göre küçük kaymayı ölçer. Ağız, göz, kaş, duygu ve baş kareleri tüylü elips olarak tabanın üzerine oturur; ERO yazısı tabanda kalır ve aynalanmaz. `eye-left` gelen dosyadan değil, `eye-right` göz bölgesinin yatay aynasından üretilir. `head-right` de `head-left` yüzünün aynasıdır. Duygu etiketleri `[mutlu]` `[üzgün]` `[şaşkın]` `[korkmuş]` `[kızgın]` `[düşünceli]` `[sakin]` `[utangaç]` yanıtın başında durur, ekranda ve seste silinir. Boşta bakış, kırpma, kaş ve küçük baş hareketi 180 ms’de erir. Dinlerken baş iner ve kaş kalkar. Düşünürken göz yukarı, şaşkın yüz ve çatık kaş gelir. Dosya adları `public/avatar/manifest.json` içindedir. Ham kareyi değiştirip betiği yeniden çalıştırmak yeter.

Portre nefes alır gibi hafifçe büyür ve birkaç piksel yana sallanır. Arkada neon halka ve ufuk çizgisi vardır.

## Bellek, araştırma, ev

“Bunu hatırla” bu cihaza yazılır. Anılar katmanlar sekmesindedir. Güncel sorularda Türkçe Vikipedi, DuckDuckGo ve Open-Meteo notları modele gider. Hava kartı konumdan, olmazsa Kocaeli’nden dolar.

Alt şerit demo cihazlardır: Işıklar, Klima, TV, Müzik, Güvenlik. “Işıkları aç”, “klimayı 22 dereceye ayarla”, “müziği aç” gibi cümleler de aynı listeyi değiştirir. Gerçek ev için Ayarlar’dan Home Assistant adresi ve jetonu yazılır. Tarayıcı başka bir adrese gittiği için Home Assistant’ta şu kök gerekir:

```yaml
http:
  cors_allowed_origins:
    - https://hakan35trt-collab.github.io
```

Yerelde `http://127.0.0.1:8731` de eklenir. Tuya bağdaştırıcısı aynı arayüzde durur ve henüz bağlı değildir.

## Sınırlamalar

- Canlı modeller ve Charon sesi, yapıştırılan anahtarın o an erişebildiği modellere bağlıdır. Yüksek talep 503 olursa sıradaki modele geçilir. Anahtar olmadan bu hat denemez.
- Canlı Türkçe kalitesi modele göre değişir. Olmazsa cümle cümle Gemini sesi, o da olmazsa cihazın kendi sesi devreye girer.
- Anahtarsız LLM7 ve Pollinations paylaşımlı kotadadır; ilk yanıttan sonra bir süre “hat dolu” diyebilir.
- Konuşmayı yazıya dökmek, Gemini canlı hattı dışında Chrome ve Android’e bağlıdır.
- Düşünme karesinde baş hafif kaymış olabilir. Tam kare erimesi bunu gizlemez; ağız ve göz yamaları taban portreye oturur.
- Demo cihazlar sayfa yenilenince sıfırlanır. Anılar ve anahtar yalnız bu tarayıcıdadır.
- Home Assistant için CORS şarttır. Tuya kapalıdır.

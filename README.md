# ERO

ERO, Türkçe konuşan kişisel bir sesli asistan. Telefonda eller serbest sohbet eder. Ortada neon bir ses dalgası bekler, dinler, düşünür ve konuşur. Portre dosyaları depoda durur ama sayfa onları yüklemez. Ana ekrana kurulabilen bir PWA’dır.

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
4. Site bir anahtarla derlendiyse ERO onu kendisi kullanır. İstersen Ayarlar’dan kendi anahtarını yazarsın; o, yerleşik anahtarın önüne geçer ve yalnız bu telefonda kalır. Derlemede anahtar yoksa ilk açılışta istenir.

iPhone’da Safari’nin Paylaş menüsünden **Ana Ekrana Ekle** kullanılır. Canlı mikrofon orada sınırlıdır; yazarak da konuşabilirsin.

## Android APK

Paket `com.ero.ai`, uygulama adı ERO. `android/` Jetpack Compose kabuğudur. Ortada mevcut portre bir WebView’de durur. Anahtar ekranı yoktur; `GEMINI_API_KEY` derlemeye gömülür. Model sessizce değişir, kullanıcıya teknik hata gösterilmez. Ses ekranında hassasiyet, cihaz destekliyorsa gürültü bastırma ve deneysel ses izi vardır. Komut, görev, hafıza ve güvenlik ekranları telefonda durur. Hatırlatma tam saat izni varsa kurcalanır, yoksa sistem yaklaşık haber verir. Ekran analizi erişilebilirlik açıkken görüntü, yazı tanıma ve modele bakmayı dener. Wi-Fi ve Bluetooth radyo anahtarı değil, ayar panelidir. SMS ve WhatsApp göndermek her zaman sesli onay ister. Önce paketin içindeki derlemeyi açar. `version.json` sayfadaki sürümden yeniyse [GitHub Pages](https://hakan35trt-collab.github.io/ERO-AI/) adresine geçer.

İndirme: [ERO.apk](https://github.com/hakan35trt-collab/ERO-AI/releases/latest/download/ERO.apk). Ayarlar’daki **APK indir** de aynı adrese gider.

Kurmak için APK’yı telefona al, dosyadan aç ve bilinmeyen uygulamalara izin ver. Play Store gerekmez. Yeni bir imza anahtarına geçilirse eski kurulum önce kaldırılır.

`.github/workflows/android.yml` her `main` push’unda APK’yı derler ve `v1.0.<çalıştırma>` ile `latest` etiketli sürümlere `ERO.apk` olarak koyar. İmza her sürümde aynı anahtarla atılır. Günlükte parola veya anahtar değeri basılmaz.

| Sır | Ne |
| --- | --- |
| `ERO_KEYSTORE_BASE64`, `ERO_KEYSTORE_PASSWORD`, `ERO_KEY_ALIAS`, `ERO_KEY_PASSWORD` | Dördü birden doluysa yayın bu anahtarı kullanır |
| `ERO_SIGNING_PASSPHRASE` | İsteğe bağlı. Doluysa şifreli imza paketinin parolası budur ve `GEMINI_API_KEY` türevinin önüne geçer |
| `GEMINI_API_KEY` | Web derlemesiyle aynı anahtar. Dört imza sırrı ve `ERO_SIGNING_PASSPHRASE` boşsa paket parolası bundan ve sabit bir tuzdan türetilir |
| `YOUTUBE_API_KEY` | İsteğe bağlı. Yoksa YouTube aramayı açar, ilk videoyu seçemez |

Dört imza sırrı yoksa iş akışı `signing-key` ön sürümündeki `signing.enc` dosyasını indirir. Bu dosya AES-256-CBC ve PBKDF2 (210000 tur) ile şifrelidir. İçinde anahtar deposu ve rastgele parolalar vardır. Dosya yoksa bir kez üretilir ve aynı sürüme yüklenir. Çözülemezse derleme durur; ikinci bir anahtar üretilmez.

`GEMINI_API_KEY` değiştirilirse, paket o anahtardan türetildiyse bir sonraki imza açılmaz. Anahtarı döndürmeden önce `ERO_SIGNING_PASSPHRASE` sırını koy. Bu sır, türev parolanın önüne geçer. Paket zaten eski anahtarla yazıldıysa, o parolayı bu sırra koymadan API anahtarını değiştirmek imzayı bozar. `signing-key` sürümünü silmek yeni bir sertifika üretir; kurulu uygulama o APK’nın üstüne yazılamaz, bir kez kaldırılır.

Açılışta GitHub’daki son sürüme bakılır. Daha yeniyse Türkçe bir soru çıkar, APK inder ve kurulum ekranı açılır.

## Güncelleme

Kurulu uygulama yeni sürümü kendi alır. Hizmet çalışanı sayfa açılınca, sekme öne gelince ve yaklaşık her dakika denetler. Yeni dosyalar iner inmez bekleyen çalışan hemen devralır ve sayfa yenilenir. ERO o sırada konuşuyorsa cümle bitsin diye kısa bir süre bekler.

## GitHub Pages

Canlı adres: [https://hakan35trt-collab.github.io/ERO-AI/](https://hakan35trt-collab.github.io/ERO-AI/)

Her `main` push’u `.github/workflows/pages.yml` ile test eder, derler ve yayınlar. Üretim kökü `/ERO-AI/`dir. Pages kaynağı **Settings → Pages → Source: GitHub Actions** olmalıdır.

## Konuşma

Bir kez **Konuşmayı başlat**’a dokun. ERO dinlemeye devam eder; her turda mikrofona yeniden basılmaz. Sustuğunda (yaklaşık 420 ms) sıra ona geçer. **Durdur** veya güç düğmesi dinlemeyi keser. Konuşurken mikrofon durur; sesin belirgin biçimde yüksekse sözünü keser. Canlı Gemini hattında sunucunun kendi ses etkinliği algısı ve kesme desteği kullanılır, mikrofon yankı engellemeyle açık kalır.

Ayarlardaki **Yalnızca “ERO” deyince uyan** kapalı başlar. Açılırsa yedek hatta cümle “ERO” ile başlamalıdır.

Klavyeden de yazılır. Sohbet balonları sohbet sekmesindedir.

## Gemini anahtarı

Anahtar depoya yazılmaz. GitHub’da **Settings → Secrets and variables → Actions** altına `GEMINI_API_KEY` eklenir. `.github/workflows/pages.yml` derleme adımında bunu `VITE_GEMINI_API_KEY` olarak verir. Gizli değer günlükte basılmaz. Sır boşsa derleme yine biter ve ilk açılıştaki anahtar ekranı durur. Sır eklendikten sonra iş akışını yeniden çalıştırmak veya `main`’e yeni bir push, anahtarlı sürümü yayınlar.

Yerleşik anahtar, sayfanın herkese açık paketinin içine gömülür. Telefonda `localStorage` boşsa ERO onu kullanır. Ayarlar’daki alan doluysa o kullanılır. Tek seferlik kurulum bağlantısı `#key=` ile biter: anahtar telefona yazılır ve adres çubuğundan silinir. Bağlantıyı kimseyle paylaşma.

## Ses hattı

Anahtar [Google AI Studio](https://aistudio.google.com/apikey) üzerinden alınır. El ile yapıştırılan kopya yalnız bu tarayıcının `localStorage` alanındadır.

1. **Canlı konuşma:** tarayıcıdan Gemini Live WebSocket. Modeller sırayla `gemini-omni-flash-preview`, sonra `gemini-omni-1.2-flash`. Ses **Charon** (sıcak erkek). Giriş 16 kHz PCM, çıkış 24 kHz PCM. Sessizlik eşiği 700 ms.
2. Canlı hat açılmazsa: mikrofon + yerel sessizlik algısı, metin için `gemini-3.5-flash-lite` (503/429 olursa yeniden dener, sonra `gemini-3.8-flash`), ses için `gemini-2.5-flash-preview-tts` ve yine Charon. Cümle cümle okunur.
3. Anahtar yoksa veya Gemini de susarsa: LLM7, sonra Pollinations. Bu yolda ses, cihazın `speechSynthesis` motorudur. Bu son çaredir.

## Portre

Açık sayfa yüzü yüklemez; ortadaki tuval ses dalgasıdır. Yüz dosyaları durur: `public/avatar/base.jpg` üzerine gerilmiş bir 2.5D kafestir. `scripts/generate-rig.py` MediaPipe Face Landmarker ile 478 noktayı ve üçgenleri `public/avatar/rig.json` dosyasına yazar. Saç, boyun, ceket ve kenar için ek düğümler vardır; ceket ve ERO yazısı oynamaz. Tarayıcı bu ağı WebGL ile her karede yay gibi yumuşatarak eğer. Çene açılınca ağız boşluğu ve `viseme-a` / `viseme-i` diş şeridi görünür. Göz bebeği bakışla kayar, göz kapağı üstünü örter. Eski kareler WebGL açılmazsa yedek olarak durur. Çözünürlük en fazla 2 katına çıkar.

Duygu etiketleri `[mutlu]` `[üzgün]` `[şaşkın]` `[korkmuş]` `[kızgın]` `[düşünceli]` `[sakin]` `[utangaç]` yaklaşık yarım saniyede karışır ve konuşmanın üstüne biner. Boşta nefes, küçük baş salınımı, bakış sıçraması ve kırpma vardır. Dinlerken baş sallanır ve kaşlar kalkar. Düşünürken bakış yukarı ve yana kayar.

Ham kareler `public/avatar/raw/` altındadır ve WebGL yedeği için durur. Hepsi **864×1152** JPG.

Ham dosyalar:

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

Kafesi yeniden üretmek için `python3 scripts/generate-rig.py` yeter. Yedek yamalar `node scripts/generate-avatar.mjs` ile gelir. `eye-left` ve `head-right` aynalanmış halleriyle durur; ERO yazısı okunur kalır.

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
- Yüz kafesi fotoğrafı eğer; gerçek kas modeli değildir. Çok açık ağızda dudak kenarı biraz gerilebilir.
- Yerleşik Gemini anahtarı sitenin paketinde durur. Gören herkes onu okuyabilir. Kendi kotanı paylaşmak istemezsen Ayarlar’dan boş bırakma, sır kullanma.
- Demo cihazlar sayfa yenilenince sıfırlanır. Anılar ve anahtar yalnız bu tarayıcıdadır.
- Home Assistant için CORS şarttır. Tuya kapalıdır.

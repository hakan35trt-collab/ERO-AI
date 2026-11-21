# ERO

ERO, Türkçe konuşan kişisel bir sesli asistan. Ekranın ortasında yaşayan bir yüz var: bekler, dinler, düşünür, konuşur; sohbetin duygusuna göre mutlu, şaşkın, üzgün ya da meraklı olabilir. Telefona kurulabilen bir PWA’dır, masaüstünde de açılır. Anahtar girmeden çalışır.

## Yerelde çalıştırma

```bash
npm install
npm test
npm run dev
```

Uygulama [http://127.0.0.1:8731](http://127.0.0.1:8731) adresinde açılır.

Üretim derlemesi ve hizmet çalışanıyla önizleme:

```bash
npm run build
npm run preview
```

## Android’e kurma

1. Siteyi **Chrome** ile aç.
2. “ERO’yu ana ekrana ekle” bandına dokun veya Chrome menüsünden **Yükle** / **Ana ekrana ekle**’yi seç.
3. Ana ekrandaki ERO simgesinden aç. Adres çubuğu kaybolur, tam ekran uygulama gibi durur.
4. Mikrofon iznini ver. Konuşmazsan alttaki kutudan da yazabilirsin.

iPhone’da Safari’nin Paylaş menüsünden **Ana Ekrana Ekle** kullanılır. Konuşmayı yazıya çevirme iOS’ta çoğu zaman yoktur; yazarak sohbet edebilirsin.

## Güncelleme

Kurulu uygulama yeni sürümü kendi alır. Hizmet çalışanı sayfa açılınca ve yaklaşık her 30 dakikada bir denetler. Yeni sürüm hazır olunca “Yeni ERO sürümü hazır. Yenileniyor…” bildirimi çıkar ve sayfa kendiliğinden yenilenir. ERO o sırada konuşuyorsa cümle bitsin diye kısa bir süre bekler.

## GitHub’a taşıyıp Pages’te yayınlama

Canlı adres: [https://hakan35trt-collab.github.io/ERO-AI/](https://hakan35trt-collab.github.io/ERO-AI/)

Kaynak `hakan35trt-collab/ERO-AI` deposunun `main` dalındadır. Her push `.github/workflows/pages.yml` ile test eder, derler ve GitHub Pages’e çıkar. Üretim derlemesinin kökü `/ERO-AI/`dir: Vite `base`, bildirim dosyasının `start_url` ve `scope` değerleri, hizmet çalışanının kapsamı ve ikon yolları bu alt yola göredir. Depo adı değişirse `vite.config.js` içindeki `pagesBase` aynı adla güncellenmelidir.

Pages kaynağı **Settings → Pages → Build and deployment → Source: GitHub Actions** olmalıdır. İlk yayında bu seçili değilse oradan seç.

İlk yayın bir iki dakika sürebilir. Sonraki `main` push’ları aynı akışla kendiliğinden güncellenir. Kurulu telefon uygulaması bir sonraki açılışta yeni sürümü indirir.

## Konuşma

- Mikrofon düğmesi dinler. Ara vermen cümleyi gönderir; düğmeye yeniden basmak da gönderir.
- ERO yanıtı cümle cümle, akış geldikçe seslendirmeye başlar.
- Yüze veya düğmeye dokunmak sözünü keser. Eller serbest modda konuşman da keser.
- Ayarlar’dan **Eller serbest** açılırsa “ERO” deyince dinlemeye geçer. Yalnızca “ERO” dersen “Efendim?” der.
- Şiir, şarkı ve hikâye isteyebilirsin. Şarkı sözlerini perdeyi değiştirerek okur; bu bir melodi motoru değil, konuşma sesiyle okunan bir söyleyiştir.
- Ayarlar’dan Türkçe ses, hız ve perde seçilir.

Ses tanıma **Chrome ve Android** üzerinde çalışır. Firefox masaüstünde ve iOS Safari’de mikrofon tanıması çoğu zaman yoktur. Konuşma sesi de cihazda yüklü Türkçe sese bağlıdır.

## Model

Anahtar gerekmez. İstek sırası `src/llm.js` içindeki sağlayıcı listesindedir; değiştirmek için tek bakılacak yer orası.

1. Ayarlara yapıştırılmış OpenAI uyumlu adres, model ve isteğe bağlı anahtar.
2. LLM7 (`mistral-Nemo-Instruct-2407`, olmazsa `codestral-latest`) — anahtarsız.
3. Pollinations (`openai-fast`) — anahtarsız, akış ya da düz metin.

Biri kota, 402 veya boş yanıt verirse sonrakine geçer. Ücretsiz hatlar paylaşılır: Pollinations yaklaşık 45 saniyede bir istek kabul eder, LLM7’nin anonim kotası vardır. Daha hızlı ve dengeli yanıt için Ayarlar’a Groq, OpenRouter veya Gemini’nin OpenAI uyumlu adresini ve kendi anahtarını yazabilirsin. Anahtar yalnızca bu tarayıcıda durur.

## Bellek ve araştırma

“Kedimin adı Misket, bunu hatırla” gibi cümleler bu cihaza yazılır. Model bir anı önerirse ERO sormadan kaydetmez; bildirimden onaylarsın. Ayarlar’dan anılar görülebilir, eklenebilir, silinebilir. Son sohbet de cihazda kalır.

Güncel ya da ansiklopedik sorularda ERO, anahtarsız olarak Türkçe Vikipedi, DuckDuckGo anlık yanıtı ve hava için Open-Meteo’ya bakar. Notları modele verir ve balonda kaynağı gösterir. Uydurmaması söylenir; ücretsiz model yine de yanılabilir.

## Akıllı ev

Modül hazırdır ve **kapalı** başlar. “Işıkları aç”, “mutfak ışığını kapat”, “klimayı 22 dereceye ayarla”, “perdeleri yüzde 40 aç”, “televizyonu kapat” gibi cümleler ayrıştırılır.

- **Simülasyon:** Ayarlar’dan açılınca komutlar ekrandaki cihazları değiştirir. Ev panosundan da dokunulabilir.
- **Home Assistant:** Bağdaştırıcıyı seç, adres (`http://192.168.1.20:8123`) ve uzun ömürlü token’ı yaz, bağlantıyı etkinleştir. REST ile servis çağrılır; WebSocket açılırsa durum olayları da dinlenir. Tarayıcı başka bir adrese istek attığı için Home Assistant yapılandırmasına bu sitenin adresi eklenmelidir:

  ```yaml
  http:
    cors_allowed_origins:
      - https://<kullanıcı>.github.io
  ```

  Yerel denemede `http://127.0.0.1:8731` de listeye girer. “Bağlantıyı dene” düğmesi `/api/` ucunu kontrol eder.
- **Tuya:** Aynı arayüzü kullanan bir taslak var. Yöntemler bilinçli olarak “henüz bağlı değil” der; ileride doldurulacak.

## Sınırlamalar

- Konuşmayı yazıya çevirmek Chrome / Android’e bağlıdır ve Google’ın tanıma servisine ağ ister.
- Türkçe ses yoksa cihaz varsayılan sesle okur.
- Ücretsiz modeller yavaşlayabilir, kota dolduğunda kısa süre susabilir veya üslubu kaçırabilir.
- Hava dışında anlık haber, döviz ve maç sonucu bağlanmadı; ERO bunları uydurmamalı, bilmediğini söylemeli.
- Akıllı ev gerçek eve bağlı değildir. Home Assistant için yukarıdaki CORS ayarı şarttır. Tuya kapalıdır.
- Anılar ve sohbet bu tarayıcının deposundadır. Başka telefona geçmez.

package com.ero.ai

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Looper
import android.provider.AlarmClock
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Settings
import android.telephony.SmsManager
import android.view.KeyEvent
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PhoneActions(private val activity: MainActivity) {
    fun run(name: String, args: JSONObject): JSONObject {
        return when (name) {
            "ping" -> JSONObject().put("ok", true).put("version", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE)
            "permissionState" -> permissionState()
            "requestPermission" -> requestPermission(args.optString("id"))
            "startListening" -> startListening()
            "stopListening" -> stopListening()
            "pauseListening" -> controlListen(EroListenService.ACTION_PAUSE)
            "resumeListening" -> controlListen(EroListenService.ACTION_RESUME)
            "checkUpdate" -> checkUpdate()
            "installUpdate" -> installUpdate()
            "openApp" -> openApp(args.optString("name"))
            "youtubeSearch" -> youtubeSearch(args.optString("query"))
            "youtubePlay" -> youtubePlay(args.optString("query"))
            "openUrl" -> openUrl(args.optString("url"))
            "setAlarm" -> setAlarm(args.optInt("hour", -1), args.optInt("minute", -1), args.optString("label"))
            "setTimer" -> setTimer(args.optInt("seconds", 0), args.optString("label"))
            "callContact" -> callContact(args.optString("name"))
            "sendSms" -> sendSms(args.optString("name"), args.optString("text"))
            "whatsapp" -> whatsapp(args.optString("name"), args.optString("text"))
            "flashlight" -> flashlight(args.optBoolean("on"))
            "volume" -> volume(args.optString("direction"), args.optInt("level", -1))
            "brightness" -> brightness(args.optInt("level", -1))
            "openSettings" -> openSettings(args.optString("panel"))
            "media" -> media(args.optString("action"))
            "camera" -> camera()
            "battery" -> battery()
            "notifications" -> EroNotificationService.snapshot()
            "navigate" -> navigate(args.optString("query"))
            "share" -> share(args.optString("text"))
            "screenText" -> screen { it.readScreen() }
            "tap" -> screen { it.tap(args.optString("text")) }
            "scroll" -> screen { it.scroll(args.optString("direction", "down")) }
            "typeText" -> screen { it.typeText(args.optString("text")) }
            "nav" -> screen { it.global(args.optString("action", "back")) }
            else -> JSONObject().put("ok", false).put("error", "Bu komutu tanımıyorum.")
        }
    }

    private fun screen(block: (EroAccessibilityService) -> JSONObject): JSONObject {
        val service = EroAccessibilityService.instance
            ?: return JSONObject().put("ok", false).put("error", "Erişilebilirlik kapalı. Ayarlardan ERO’yu aç.")
        return block(service)
    }

    private fun permissionState(): JSONObject {
        return JSONObject()
            .put("ok", true)
            .put("microphone", granted(Manifest.permission.RECORD_AUDIO))
            .put("notifications", if (Build.VERSION.SDK_INT >= 33) granted(Manifest.permission.POST_NOTIFICATIONS) else true)
            .put("contacts", granted(Manifest.permission.READ_CONTACTS))
            .put("phone", granted(Manifest.permission.CALL_PHONE))
            .put("sms", granted(Manifest.permission.SEND_SMS))
            .put("camera", granted(Manifest.permission.CAMERA))
            .put("settings_write", Settings.System.canWrite(activity))
            .put("accessibility", EroAccessibilityService.instance != null)
            .put("notification_listener", EroNotificationService.instance != null)
            .put("install", if (Build.VERSION.SDK_INT >= 26) activity.packageManager.canRequestPackageInstalls() else true)
            .put("listening", listenRunning())
            .put("version", BuildConfig.VERSION_NAME)
    }

    private fun granted(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestPermission(id: String): JSONObject {
        when (id) {
            "microphone" -> ask(Manifest.permission.RECORD_AUDIO)
            "notifications" -> if (Build.VERSION.SDK_INT >= 33) ask(Manifest.permission.POST_NOTIFICATIONS)
            "contacts" -> ask(Manifest.permission.READ_CONTACTS)
            "phone" -> ask(Manifest.permission.CALL_PHONE)
            "sms" -> ask(Manifest.permission.SEND_SMS)
            "camera" -> ask(Manifest.permission.CAMERA)
            "install" -> ui {
                if (Build.VERSION.SDK_INT >= 26) {
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                }
            }
            "settings_write" -> ui {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:${activity.packageName}")))
            }
            "accessibility" -> ui { activity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            "notification_listener" -> ui { activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
            "battery" -> ui {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${activity.packageName}"))
                activity.startActivity(intent)
            }
        }
        return JSONObject().put("ok", true).put("asked", id)
    }

    private fun ask(permission: String) {
        ui { activity.requestPermissions(arrayOf(permission), 41) }
    }

    private fun startListening(): JSONObject {
        if (!granted(Manifest.permission.RECORD_AUDIO)) {
            return JSONObject().put("ok", false).put("error", "Mikrofon izni yok.")
        }
        val intent = Intent(activity, EroListenService::class.java)
        ContextCompat.startForegroundService(activity, intent)
        return JSONObject().put("ok", true)
    }

    private fun stopListening(): JSONObject {
        activity.startService(Intent(activity, EroListenService::class.java).setAction(EroListenService.ACTION_STOP))
        return JSONObject().put("ok", true)
    }

    private fun controlListen(action: String): JSONObject {
        activity.startService(Intent(activity, EroListenService::class.java).setAction(action))
        return JSONObject().put("ok", true)
    }

    private fun listenRunning(): Boolean = EroListenService.active

    private fun checkUpdate(): JSONObject {
        return try {
            val body = JSONObject(MainActivity.httpGet(BuildConfig.RELEASES_URL))
            val tag = body.optString("tag_name")
            val notes = body.optString("body")
            val fromNotes = Regex("version:\\s*([0-9.]+)").find(notes)?.groupValues?.getOrNull(1)
            val fromTag = tag.removePrefix("v").takeIf { it.firstOrNull()?.isDigit() == true }
            val version = fromNotes ?: fromTag ?: ""
            val asset = body.optJSONArray("assets")
            var url = ""
            if (asset != null) {
                for (i in 0 until asset.length()) {
                    val item = asset.optJSONObject(i) ?: continue
                    if (item.optString("name") == "ERO.apk") url = item.optString("browser_download_url")
                }
            }
            val newer = version.isNotBlank() && compare(version, BuildConfig.VERSION_NAME) > 0
            JSONObject()
                .put("ok", true)
                .put("newer", newer)
                .put("version", version)
                .put("current", BuildConfig.VERSION_NAME)
                .put("url", url)
                .put("notes", notes.take(280))
        } catch (error: Exception) {
            JSONObject().put("ok", false).put("newer", false).put("error", "Sürüm denetlenemedi.")
        }
    }

    private fun installUpdate(): JSONObject {
        val info = checkUpdate()
        val url = info.optString("url")
        if (url.isBlank()) return JSONObject().put("ok", false).put("error", "APK bağlantısı yok.")
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            ui {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            }
            return JSONObject().put("ok", false).put("error", "Kurulum iznini aç, sonra yeniden dene.")
        }
        val file = File(activity.cacheDir, "ERO-update.apk")
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.setRequestProperty("User-Agent", "ERO")
        connection.inputStream.use { input -> FileOutputStream(file).use { output -> input.copyTo(output) } }
        val uri = FileProvider.getUriForFile(activity, "com.ero.ai.fileprovider", file)
        ui {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(intent)
        }
        return JSONObject().put("ok", true).put("say", "Kurulum ekranı açıldı.")
    }

    private fun openApp(name: String): JSONObject {
        val key = norm(name)
        if (key == "ayarlar" || key == "settings") return openSettings("apps").put("label", "Ayarlar")
        if (key == "kamera" || key == "camera") return camera().put("label", "Kamera")
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = activity.packageManager.queryIntentActivities(intent, 0)
        var bestScore = 0
        var best: android.content.pm.ResolveInfo? = null
        for (info in apps) {
            val label = info.loadLabel(activity.packageManager)?.toString().orEmpty()
            val score = score(key, label)
            if (score > bestScore) {
                bestScore = score
                best = info
            }
        }
        val info = best?.activityInfo
        if (info == null || bestScore < 50) return JSONObject().put("ok", false).put("error", "Bu adlı uygulama yok.")
        val launch = activity.packageManager.getLaunchIntentForPackage(info.packageName)
            ?: return JSONObject().put("ok", false).put("error", "Uygulama açılmadı.")
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ui { activity.startActivity(launch) }
        val label = best?.loadLabel(activity.packageManager)?.toString().orEmpty()
        return JSONObject().put("ok", true).put("label", label).put("package", info.packageName)
    }

    private fun youtubeSearch(query: String): JSONObject {
        if (query.isBlank()) return JSONObject().put("ok", false).put("error", "Ne arayacağımı söyle.")
        val uri = Uri.parse("https://www.youtube.com/results?search_query=${Uri.encode(query)}")
        val intent = Intent(Intent.ACTION_VIEW, uri).setPackage("com.google.android.youtube")
        return launch(intent, fallback = Intent(Intent.ACTION_VIEW, uri)).put("mode", "search").put("say", "YouTube araması açıldı.")
    }

    private fun youtubePlay(query: String): JSONObject {
        if (query.isBlank()) return JSONObject().put("ok", false).put("error", "Hangi videoyu açayım?")
        val key = BuildConfig.YOUTUBE_API_KEY
        if (key.isNotBlank()) {
            try {
                val url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${Uri.encode(query)}&key=$key"
                val json = JSONObject(MainActivity.httpGet(url))
                val id = json.optJSONArray("items")?.optJSONObject(0)?.optJSONObject("id")?.optString("videoId").orEmpty()
                if (id.isNotBlank()) {
                    val watch = Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube:$id"))
                    return launch(watch).put("mode", "play").put("videoId", id).put("say", "Videoyu açtım.")
                }
            } catch (_: Exception) {
                // Arama niyetine düş.
            }
        }
        return youtubeSearch(query).put("mode", "search").put("say", "YouTube anahtarı olmadığı için aramayı açtım.")
    }

    private fun openUrl(url: String): JSONObject {
        val uri = try {
            Uri.parse(url)
        } catch (_: Exception) {
            return JSONObject().put("ok", false).put("error", "Adres geçersiz.")
        }
        if (uri.scheme != "http" && uri.scheme != "https") {
            return JSONObject().put("ok", false).put("error", "Yalnızca http ve https adresi açılır.")
        }
        return launch(Intent(Intent.ACTION_VIEW, uri))
    }

    private fun setAlarm(hour: Int, minute: Int, label: String): JSONObject {
        if (hour !in 0..23 || minute !in 0..59) return JSONObject().put("ok", false).put("error", "Saati net söyle.")
        val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(AlarmClock.EXTRA_HOUR, hour)
            putExtra(AlarmClock.EXTRA_MINUTES, minute)
            putExtra(AlarmClock.EXTRA_MESSAGE, label)
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        }
        return launch(intent).put("say", "Alarm $hour:${minute.toString().padStart(2, '0')} için kuruldu.")
    }

    private fun setTimer(seconds: Int, label: String): JSONObject {
        if (seconds <= 0) return JSONObject().put("ok", false).put("error", "Süreyi saniye olarak söyle.")
        val intent = Intent(AlarmClock.ACTION_SET_TIMER).apply {
            putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            putExtra(AlarmClock.EXTRA_MESSAGE, label.ifBlank { "ERO" })
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        }
        return launch(intent).put("say", "Süre başladı.")
    }

    private fun callContact(name: String): JSONObject {
        if (!granted(Manifest.permission.CALL_PHONE)) return JSONObject().put("ok", false).put("error", "Arama izni yok.")
        val match = findContact(name) ?: return JSONObject().put("ok", false).put("error", "Kişiyi bulamadım.")
        if (!match.optBoolean("ok") || match.optBoolean("ambiguous")) return match
        val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:${match.getString("number")}"))
        return launch(intent).put("say", "${match.getString("name")} aranıyor.")
    }

    private fun sendSms(name: String, text: String): JSONObject {
        if (!granted(Manifest.permission.SEND_SMS)) return JSONObject().put("ok", false).put("error", "SMS izni yok.")
        if (text.isBlank()) return JSONObject().put("ok", false).put("error", "Mesaj boş.")
        val match = findContact(name) ?: return JSONObject().put("ok", false).put("error", "Kişiyi bulamadım.")
        if (!match.optBoolean("ok") || match.optBoolean("ambiguous")) return match
        val sms = (if (Build.VERSION.SDK_INT >= 31) activity.getSystemService(SmsManager::class.java) else SmsManager.getDefault())
            ?: return JSONObject().put("ok", false).put("error", "SMS servisi yok.")
        sms.sendTextMessage(match.getString("number"), null, text, null, null)
        return JSONObject().put("ok", true).put("say", "Mesaj gitti.")
    }

    private fun whatsapp(name: String, text: String): JSONObject {
        val match = findContact(name) ?: return JSONObject().put("ok", false).put("error", "Kişiyi bulamadım.")
        if (!match.optBoolean("ok") || match.optBoolean("ambiguous")) return match
        val digits = match.getString("number").filter { it.isDigit() }
        val uri = Uri.parse("https://wa.me/$digits?text=${Uri.encode(text)}")
        val intent = Intent(Intent.ACTION_VIEW, uri).setPackage("com.whatsapp")
        return launch(intent, fallback = Intent(Intent.ACTION_VIEW, uri)).put("say", "WhatsApp açıldı.")
    }

    private fun findContact(name: String): JSONObject? {
        if (!granted(Manifest.permission.READ_CONTACTS)) {
            return JSONObject().put("ok", false).put("error", "Kişi izni yok.")
        }
        val cursor = activity.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER,
            ),
            null,
            null,
            null,
        ) ?: return null
        var bestScore = 0
        var second = 0
        var bestName = ""
        var bestNumber = ""
        cursor.use {
            val nameIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
            val numberIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
            while (it.moveToNext()) {
                val label = it.getString(nameIndex).orEmpty()
                val score = score(norm(name), label)
                if (score > bestScore) {
                    second = bestScore
                    bestScore = score
                    bestName = label
                    bestNumber = it.getString(numberIndex).orEmpty()
                } else if (score > second) {
                    second = score
                }
            }
        }
        if (bestScore < 50) return null
        if (second >= bestScore - 5 && second >= 50) {
            return JSONObject().put("ok", false).put("ambiguous", true).put("error", "Birden fazla kişi benziyor. Tam adını söyle.")
        }
        return JSONObject().put("ok", true).put("ambiguous", false).put("name", bestName).put("number", bestNumber)
    }

    private fun flashlight(on: Boolean): JSONObject {
        if (!granted(Manifest.permission.CAMERA)) return JSONObject().put("ok", false).put("error", "Fener için kamera izni yok.")
        val manager = activity.getSystemService(CameraManager::class.java)
        val id = manager.cameraIdList.firstOrNull { cameraId ->
            manager.getCameraCharacteristics(cameraId).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
        } ?: return JSONObject().put("ok", false).put("error", "Flaş yok.")
        manager.setTorchMode(id, on)
        return JSONObject().put("ok", true).put("say", if (on) "Fener açık." else "Fener kapalı.")
    }

    private fun volume(direction: String, level: Int): JSONObject {
        val audio = activity.getSystemService(AudioManager::class.java)
        when (direction) {
            "down" -> audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
            "set" -> {
                val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                val value = ((level.coerceIn(0, 100) / 100.0) * max).toInt()
                audio.setStreamVolume(AudioManager.STREAM_MUSIC, value, AudioManager.FLAG_SHOW_UI)
            }
            else -> audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
        }
        return JSONObject().put("ok", true).put("say", "Ses ayarlandı.")
    }

    private fun brightness(level: Int): JSONObject {
        if (!Settings.System.canWrite(activity)) return JSONObject().put("ok", false).put("error", "Parlaklık izni yok.")
        if (level !in 0..100) return JSONObject().put("ok", false).put("error", "Parlaklığı 0 ile 100 arasında söyle.")
        Settings.System.putInt(activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
        Settings.System.putInt(activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS, (level / 100.0 * 255).toInt())
        return JSONObject().put("ok", true).put("say", "Parlaklık yüzde $level.")
    }

    private fun openSettings(panel: String): JSONObject {
        val action = when (panel) {
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "sound" -> Settings.ACTION_SOUND_SETTINGS
            "display" -> Settings.ACTION_DISPLAY_SETTINGS
            "apps" -> Settings.ACTION_APPLICATION_SETTINGS
            "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
            "notifications" -> Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
            "battery" -> Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS
            "wireless" -> Settings.ACTION_WIRELESS_SETTINGS
            else -> Settings.ACTION_WIFI_SETTINGS
        }
        return launch(Intent(action)).put("say", "Ayarlar açıldı.")
    }

    private fun media(action: String): JSONObject {
        val code = when (action) {
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else -> KeyEvent.KEYCODE_MEDIA_PLAY
        }
        val audio = activity.getSystemService(AudioManager::class.java)
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
        return JSONObject().put("ok", true).put("say", "Medya komutu gitti.")
    }

    private fun camera(): JSONObject {
        val intent = Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
        return launch(intent).put("say", "Kamera açıldı.")
    }

    private fun battery(): JSONObject {
        val manager = activity.getSystemService(BatteryManager::class.java)
        val level = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val sticky = activity.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val status = sticky?.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        return JSONObject().put("ok", true).put("level", level).put("charging", charging).put("say", "Pil yüzde $level.")
    }

    private fun navigate(query: String): JSONObject {
        if (query.isBlank()) return JSONObject().put("ok", false).put("error", "Nereye gideyim?")
        val maps = Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=${Uri.encode(query)}")).setPackage("com.google.android.apps.maps")
        val geo = Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=${Uri.encode(query)}"))
        return launch(maps, fallback = geo).put("say", "Yol tarifi açıldı.")
    }

    private fun share(text: String): JSONObject {
        if (text.isBlank()) return JSONObject().put("ok", false).put("error", "Paylaşılacak metin yok.")
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        val chooser = Intent.createChooser(send, "Paylaş")
        return launch(chooser).put("say", "Paylaşım açıldı.")
    }

    private fun launch(intent: Intent, fallback: Intent? = null): JSONObject {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            ui { activity.startActivity(intent) }
            JSONObject().put("ok", true)
        } catch (_: Exception) {
            if (fallback == null) return JSONObject().put("ok", false).put("error", "Açılamadı.")
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                ui { activity.startActivity(fallback) }
                JSONObject().put("ok", true)
            } catch (error: Exception) {
                JSONObject().put("ok", false).put("error", error.message ?: "Açılamadı.")
            }
        }
    }

    private fun ui(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
            return
        }
        val latch = CountDownLatch(1)
        var thrown: Exception? = null
        activity.runOnUiThread {
            try {
                block()
            } catch (error: Exception) {
                thrown = error
            } finally {
                latch.countDown()
            }
        }
        latch.await(4, TimeUnit.SECONDS)
        thrown?.let { throw it }
    }

    private fun norm(value: String): String {
        return value.lowercase(Locale("tr", "TR"))
            .replace('ı', 'i')
            .replace("ş", "s")
            .replace("ğ", "g")
            .replace("ü", "u")
            .replace("ö", "o")
            .replace("ç", "c")
            .replace(Regex("[^a-z0-9 ]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun score(query: String, label: String): Int {
        val q = norm(query)
        val l = norm(label)
        if (q.isBlank() || l.isBlank()) return 0
        if (q == l) return 100
        val alias = ALIASES[q].orEmpty()
        if (alias.any { l == it || l.contains(it) }) return 92
        if (l.contains(q) || q.contains(l)) return 80
        val shared = q.split(" ").count { token -> l.split(" ").contains(token) }
        return if (shared > 0) 50 + shared * 10 else 0
    }

    private fun compare(left: String, right: String): Int {
        val a = left.removePrefix("v").split(".").map { it.toIntOrNull() ?: 0 }
        val b = right.removePrefix("v").split(".").map { it.toIntOrNull() ?: 0 }
        val length = maxOf(a.size, b.size)
        for (i in 0 until length) {
            val diff = (a.getOrElse(i) { 0 }) - (b.getOrElse(i) { 0 })
            if (diff != 0) return if (diff > 0) 1 else -1
        }
        return 0
    }

    companion object {
        private val ALIASES = mapOf(
            "youtube" to listOf("youtube"),
            "ayarlar" to listOf("settings", "ayarlar"),
            "kamera" to listOf("camera", "kamera"),
            "whatsapp" to listOf("whatsapp"),
            "mesaj" to listOf("messages", "messaging", "mesaj"),
            "mesajlar" to listOf("messages", "messaging", "mesaj"),
            "telefon" to listOf("phone", "dialer", "telefon"),
            "harita" to listOf("maps", "haritalar", "harita"),
            "haritalar" to listOf("maps", "haritalar"),
            "chrome" to listOf("chrome"),
            "galeri" to listOf("photos", "gallery", "galeri"),
            "takvim" to listOf("calendar", "takvim"),
            "saat" to listOf("clock", "saat"),
            "spotify" to listOf("spotify"),
        )
    }
}

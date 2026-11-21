package com.ero.ai

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.provider.CalendarContract
import android.provider.Settings
import androidx.core.content.ContextCompat
import java.util.TimeZone
import org.json.JSONObject

data class CommandSpec(
    val id: String,
    val title: String,
    val fallbackConfirm: Boolean,
    val floor: Boolean,
)

data class DeskResult(val say: String, val needYes: Boolean, val name: String, val args: JSONObject)

object CommandDesk {
    val specs = listOf(
        CommandSpec("open_app", "Uygulama aç", false, false),
        CommandSpec("youtube", "YouTube", false, false),
        CommandSpec("bluetooth", "Bluetooth paneli", false, false),
        CommandSpec("wifi", "Wi-Fi paneli", false, false),
        CommandSpec("notifications", "Bildirimleri oku", false, false),
        CommandSpec("screen", "Ekranı analiz et", false, false),
        CommandSpec("battery", "Pil", false, false),
        CommandSpec("volume", "Ses", false, false),
        CommandSpec("flashlight", "Fener", false, false),
        CommandSpec("brightness", "Parlaklık", true, false),
        CommandSpec("navigate", "Navigasyon", false, false),
        CommandSpec("draft", "Mesaj yaz, gönderme", false, false),
        CommandSpec("call_contact", "Ara", true, false),
        CommandSpec("send_sms", "SMS gönder", true, true),
        CommandSpec("whatsapp", "WhatsApp gönder", true, true),
        CommandSpec("tap", "Ekrana bas", true, false),
        CommandSpec("night", "Gece modu", true, false),
        CommandSpec("reminder", "Hatırlatma", false, false),
        CommandSpec("memory", "Hatırla / unut", false, false),
    )

    fun confirm(context: android.content.Context, id: String): Boolean {
        val spec = specs.firstOrNull { it.id == id } ?: return true
        if (spec.floor) return true
        return EroStore.confirmFor(context, id, spec.fallbackConfirm)
    }

    fun setConfirm(context: android.content.Context, id: String, value: Boolean) {
        val spec = specs.firstOrNull { it.id == id } ?: return
        if (spec.floor) return
        EroStore.setConfirm(context, id, value)
    }

    fun perform(activity: MainActivity, name: String, args: JSONObject, confirmed: Boolean = false): DeskResult {
        val id = policyId(name, args)
        val danger = dangerous(args)
        val must = (id == "send_sms" || id == "whatsapp" || danger) || confirm(activity, id)
        if (must && !confirmed) {
            return DeskResult(question(name, args), true, name, args)
        }
        val say = execute(activity, name, args)
        EroStore.addLog(activity, name, say)
        return DeskResult(say, false, name, args)
    }

    private fun policyId(name: String, args: JSONObject): String {
        return when (name) {
            "youtube_search", "youtube_play" -> "youtube"
            "open_settings" -> if (args.optString("panel").contains("bluetooth")) "bluetooth" else "wifi"
            "remember", "forget" -> "memory"
            else -> name
        }
    }

    private fun execute(activity: MainActivity, name: String, args: JSONObject): String {
        val actions = PhoneActions(activity)
        return when (name) {
            "open_app" -> spoken(actions.run("openApp", args), "${args.optString("name")} açıldı.")
            "youtube_search", "youtube_play" -> spoken(actions.run(if (name.endsWith("play")) "youtubePlay" else "youtubeSearch", args), "YouTube açıldı.")
            "bluetooth" -> spoken(actions.run("openSettings", JSONObject().put("panel", "bluetooth")), "Bluetooth paneli açıldı.")
            "wifi" -> spoken(actions.run("openSettings", JSONObject().put("panel", "wifi")), "Wi-Fi paneli açıldı.")
            "notifications" -> notifications(actions)
            "screen" -> "Ekrana bakıyorum."
            "battery" -> spoken(actions.run("battery", JSONObject()), "Pili aldım.")
            "volume" -> spoken(actions.run("volume", JSONObject().put("direction", "set").put("level", number(args, "level"))), "Sesi ayarladım.")
            "flashlight" -> spoken(actions.run("flashlight", JSONObject().put("on", args.optString("on") != "false" && args.optBoolean("on", true))), "Feneri değiştirdim.")
            "brightness" -> spoken(actions.run("brightness", JSONObject().put("level", number(args, "level"))), "Parlaklığı ayarladım.")
            "navigate" -> spoken(actions.run("navigate", args), "Yol tarifi açıldı.")
            "draft" -> draft(activity, args.optString("text"))
            "call_contact" -> spoken(actions.run("callContact", args), "Arıyorum.")
            "send_sms" -> spoken(actions.run("sendSms", args.put("confirmed", true)), "Mesaj gitti.")
            "whatsapp" -> spoken(actions.run("whatsapp", args.put("confirmed", true)), "WhatsApp taslağı açıldı.")
            "tap" -> spoken(actions.run("tap", args.put("confirmed", true)), "Bastım.")
            "night" -> night(activity)
            "reminder" -> remind(activity, args.optString("text"))
            "remember" -> EroStore.addMemory(activity, args.optString("text"))
            "forget" -> EroStore.forget(activity, args.optString("text"))
            "calendar" -> calendar(activity, args.optString("title"), args.optLong("at"))
            else -> spoken(actions.run(name, args), "Tamam.")
        }
    }

    fun spoken(result: JSONObject, fallback: String): String {
        if (!result.optBoolean("ok")) return result.optString("error").ifBlank { result.optString("say").ifBlank { "Bunu yapamadım." } }
        val say = result.optString("say")
        if (say.isNotBlank()) return say
        if (result.has("level")) return "Pil yüzde ${result.optInt("level")}."
        val label = result.optString("label")
        if (label.isNotBlank()) return "$label açıldı."
        return fallback
    }

    private fun notifications(actions: PhoneActions): String {
        val result = actions.run("notifications", JSONObject())
        if (!result.optBoolean("ok")) return result.optString("error").ifBlank { "Bildirimleri okuyamadım." }
        val items = result.optJSONArray("items") ?: return "Yeni bildirim yok."
        if (items.length() == 0) return "Yeni bildirim yok."
        return buildString {
            append("Son bildirimler: ")
            for (i in 0 until items.length().coerceAtMost(3)) {
                val item = items.optJSONObject(i)
                if (i > 0) append(". ")
                append(item?.optString("title").orEmpty())
                val text = item?.optString("text").orEmpty()
                if (text.isNotBlank()) append(", ").append(text)
            }
        }
    }

    private fun draft(activity: MainActivity, text: String): String {
        if (text.isBlank()) return "Ne yazacağımı söyle."
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")).putExtra("sms_body", text)
        activity.startActivity(intent)
        return "Taslağı açtım, göndermedim."
    }

    private fun remind(activity: MainActivity, text: String): String {
        val at = Reminders.parse(text) ?: return "Günü ve saati söyle. Örnek: yarın 10:00 araç muayenesi."
        val title = text.replace(Regex("(?i)yarın|yarin|bugün|bugun|saat"), " ")
            .replace(Regex("\\d{1,2}:\\d{2}|\\d{1,2}"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .ifBlank { "Hatırlatma" }
        val task = EroStore.addTask(activity, title, at)
        val exact = Reminders.schedule(activity, task)
        val whenLabel = Reminders.label(at)
        return if (exact) "$whenLabel için hatırlatmayı kurdum: $title."
        else "$whenLabel için kurdum ama tam saat izni yok. Sistem yaklaşık haber verecek: $title."
    }

    private fun night(activity: MainActivity): String {
        val notes = mutableListOf<String>()
        val audio = activity.getSystemService(AudioManager::class.java)
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, (max * 0.2f).toInt(), 0)
        notes.add("Sesi kıstım.")
        if (Settings.System.canWrite(activity)) {
            Settings.System.putInt(activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 40)
            notes.add("Parlaklığı düşürdüm.")
        } else notes.add("Parlaklık için ayar yazma izni yok.")
        val manager = activity.getSystemService(NotificationManager::class.java)
        if (manager.isNotificationPolicyAccessGranted) {
            manager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
            notes.add("Rahatsız etmeyi açtım.")
        } else {
            activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
            notes.add("Rahatsız etme izni yok, izin ekranını açtım.")
        }
        val next = activity.getSystemService(AlarmManager::class.java).nextAlarmClock
        notes.add(if (next == null) "Kurulu bir alarm görünmüyor." else "Sıradaki alarm duruyor.")
        return notes.joinToString(" ")
    }

    private fun calendar(activity: MainActivity, title: String, at: Long): String {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.WRITE_CALENDAR) != PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR), 42)
            return "Takvim izni olmadan etkinlik yazamam."
        }
        return try {
        val cursor = activity.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            arrayOf(CalendarContract.Calendars._ID),
            null,
            null,
            null,
        )
        val id = cursor?.use { if (it.moveToFirst()) it.getLong(0) else -1L } ?: -1L
        if (id < 0) return "Bu telefonda yazılacak bir takvim yok."
        val values = ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, id)
            put(CalendarContract.Events.TITLE, title.ifBlank { "ERO" })
            put(CalendarContract.Events.DTSTART, at)
            put(CalendarContract.Events.DTEND, at + 60 * 60 * 1000)
            put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
        }
        val uri = activity.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)
        if (uri == null) "Takvime yazamadım." else "Takvime ekledim."
        } catch (_: Exception) {
            "Takvime yazamadım."
        }
    }

    private fun number(args: JSONObject, key: String): Int {
        if (args.has(key)) {
            val raw = args.opt(key)
            return when (raw) {
                is Number -> raw.toInt()
                else -> raw?.toString()?.filter { it.isDigit() }?.toIntOrNull() ?: -1
            }
        }
        return -1
    }

    private fun question(name: String, args: JSONObject): String {
        return when (name) {
            "call_contact" -> "${args.optString("name", "bu kişiyi")} aramamı onaylıyor musun?"
            "send_sms", "whatsapp" -> "Bu mesajı göndermemi onaylıyor musun?"
            "night" -> "Gece moduna almamı onaylıyor musun?"
            "brightness" -> "Parlaklığı değiştirmemi onaylıyor musun?"
            "tap" -> "Ekranda buna basmamı onaylıyor musun?"
            else -> "Bunu yapmamı onaylıyor musun?"
        }
    }

    private fun dangerous(args: JSONObject): Boolean {
        val text = "${args.optString("text")} ${args.optString("query")} ${args.optString("title")}"
        return Regex("öde|odeme|satın al|satin al|sil\\b|delete|transfer|purchase|\\bpay\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)
    }
}

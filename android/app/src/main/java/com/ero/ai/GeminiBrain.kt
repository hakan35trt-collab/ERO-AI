package com.ero.ai

import android.graphics.Bitmap
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

data class BrainCall(val name: String, val args: JSONObject)
data class BrainReply(val text: String, val calls: List<BrainCall>)

object GeminiBrain {
    private val models = listOf("gemini-3.5-flash-lite", "gemini-3.8-flash")
    private const val fallback = "Şu an cevap veremedim. Biraz sonra yeniden dene."

    suspend fun reply(history: List<Pair<String, String>>, user: String, note: String = ""): BrainReply = withContext(Dispatchers.IO) {
        val key = BuildConfig.GEMINI_API_KEY
        if (key.isBlank()) return@withContext BrainReply(fallback, emptyList())
        for (model in models) {
            val parsed = ask(model, key, history, user, note)
            if (parsed != null) return@withContext parsed
        }
        BrainReply(fallback, emptyList())
    }

    suspend fun look(bitmap: Bitmap): String? = withContext(Dispatchers.IO) {
        val key = BuildConfig.GEMINI_API_KEY
        if (key.isBlank()) return@withContext null
        val bytes = ByteArrayOutputStream()
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 60, bytes)) return@withContext null
        val image = JSONObject().put(
            "inlineData",
            JSONObject().put("mimeType", "image/jpeg").put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)),
        )
        val body = JSONObject().put(
            "contents",
            JSONArray().put(
                JSONObject().put(
                    "parts",
                    JSONArray()
                        .put(JSONObject().put("text", "Bu telefon ekranını kısa ve sade Türkçe anlat."))
                        .put(image),
                ),
            ),
        )
        for (model in models) {
            val raw = post(model, key, body) ?: continue
            val text = raw.optJSONArray("candidates")
                ?.optJSONObject(0)
                ?.optJSONObject("content")
                ?.optJSONArray("parts")
                ?.optJSONObject(0)
                ?.optString("text")
                .orEmpty()
                .trim()
            if (text.isNotBlank()) return@withContext text
        }
        null
    }

    suspend fun speakPcm(text: String): ByteArray? = withContext(Dispatchers.IO) {
        val key = BuildConfig.GEMINI_API_KEY
        if (key.isBlank() || text.isBlank()) return@withContext null
        val body = JSONObject()
            .put("contents", JSONArray().put(JSONObject().put("parts", JSONArray().put(JSONObject().put("text", text)))))
            .put(
                "generationConfig",
                JSONObject()
                    .put("responseModalities", JSONArray().put("AUDIO"))
                    .put(
                        "speechConfig",
                        JSONObject().put(
                            "voiceConfig",
                            JSONObject().put("prebuiltVoiceConfig", JSONObject().put("voiceName", "Charon")),
                        ),
                    ),
            )
        val raw = post("gemini-2.5-flash-preview-tts", key, body) ?: return@withContext null
        val inline = raw.optJSONArray("candidates")
            ?.optJSONObject(0)
            ?.optJSONObject("content")
            ?.optJSONArray("parts")
            ?.optJSONObject(0)
            ?.optJSONObject("inlineData")
        val mime = inline?.optString("mimeType").orEmpty().lowercase()
        val data = inline?.optString("data").orEmpty()
        if (data.isBlank() || !(mime.contains("pcm") || mime.contains("l16") || mime.contains("raw"))) null else decode(data)
    }

    private fun ask(model: String, key: String, history: List<Pair<String, String>>, user: String, note: String): BrainReply? {
        val contents = JSONArray()
        for ((role, text) in history.takeLast(8)) {
            contents.put(
                JSONObject()
                    .put("role", if (role == "user") "user" else "model")
                    .put("parts", JSONArray().put(JSONObject().put("text", text))),
            )
        }
        contents.put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", user))))
        val body = JSONObject()
            .put(
                "systemInstruction",
                JSONObject().put(
                    "parts",
                    JSONArray().put(
                        JSONObject().put(
                            "text",
                            "Sen ERO'sun. Kısa, sıcak, günlük Türkçe konuş. Robot kalıpları kullanma. " +
                                "Uygulama, YouTube, bildirim, ekran, pil, ses, fener, parlaklık, yol, taslak mesaj, arama, SMS, WhatsApp, gece modu, hatırlatma ve hatırla araçlarını kullan. " +
                                "SMS, WhatsApp ve ödeme için önce sor. Model adı veya hata kodu söyleme. " +
                                note.take(1200),
                        ),
                    ),
                ),
            )
            .put("contents", contents)
            .put("tools", JSONArray().put(JSONObject().put("functionDeclarations", toolList())))
        val raw = post(model, key, body) ?: return null
        val parts = raw.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
            ?: return null
        var text = ""
        val calls = mutableListOf<BrainCall>()
        for (i in 0 until parts.length()) {
            val part = parts.optJSONObject(i) ?: continue
            if (part.has("text")) text += part.optString("text")
            val call = part.optJSONObject("functionCall") ?: continue
            val name = call.optString("name")
            if (name.isBlank()) continue
            calls.add(BrainCall(name, call.optJSONObject("args") ?: JSONObject()))
        }
        if (text.isBlank() && calls.isEmpty()) return null
        return BrainReply(text.trim(), calls)
    }

    private fun toolList(): JSONArray {
        val tools = JSONArray()
        fun add(name: String, description: String, arg: String) {
            tools.put(
                JSONObject()
                    .put("name", name)
                    .put("description", description)
                    .put(
                        "parameters",
                        JSONObject()
                            .put("type", "OBJECT")
                            .put("properties", JSONObject().put(arg, JSONObject().put("type", "STRING")))
                            .put("required", JSONArray().put(arg)),
                    ),
            )
        }
        add("open_app", "Yüklü uygulamayı açar.", "name")
        add("youtube_play", "YouTube'da arar.", "query")
        add("notifications", "Son bildirimleri okur.", "note")
        add("screen", "Ekranı analiz eder.", "note")
        add("battery", "Pil durumunu söyler.", "note")
        add("volume", "Sesi ayarlar. level 0-100.", "level")
        add("flashlight", "Feneri açar veya kapatır. on true veya false.", "on")
        add("brightness", "Parlaklığı 0-100 ayarlar.", "level")
        add("navigate", "Yol tarifi açar.", "query")
        add("draft", "Mesajı yazar ama göndermez.", "text")
        add("call_contact", "Kişiyi arar.", "name")
        add("send_sms", "SMS gönderir.", "text")
        add("whatsapp", "WhatsApp taslağı açar.", "text")
        add("night", "Gece moduna hazırlar.", "note")
        add("reminder", "Hatırlatma kurar.", "text")
        add("remember", "Bir şeyi hafızaya yazar.", "text")
        add("forget", "Hafızadan siler.", "text")
        add("bluetooth", "Bluetooth panelini açar.", "note")
        add("wifi", "Wi-Fi panelini açar.", "note")
        return tools
    }

    private fun post(model: String, key: String, body: JSONObject): JSONObject? {
        return try {
            val connection = (URL("https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent?key=$key").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 12000
                readTimeout = 20000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val raw = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (connection.responseCode !in 200..299 || raw.isBlank()) null else JSONObject(raw)
        } catch (_: Exception) {
            null
        }
    }

    private fun decode(data: String): ByteArray? {
        return try {
            android.util.Base64.decode(data, android.util.Base64.DEFAULT)
        } catch (_: Exception) {
            null
        }
    }
}

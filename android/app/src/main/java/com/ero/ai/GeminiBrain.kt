package com.ero.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class BrainReply(val text: String, val appName: String?)

object GeminiBrain {
    private val models = listOf("gemini-3.5-flash-lite", "gemini-3.8-flash")
    private const val fallback = "Şu an cevap veremedim. Biraz sonra yeniden dene."

    suspend fun reply(history: List<Pair<String, String>>, user: String): BrainReply = withContext(Dispatchers.IO) {
        val key = BuildConfig.GEMINI_API_KEY
        if (key.isBlank()) return@withContext BrainReply(fallback, null)
        for (model in models) {
            val parsed = ask(model, key, history, user)
            if (parsed != null) return@withContext parsed
        }
        BrainReply(fallback, null)
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

    private fun ask(model: String, key: String, history: List<Pair<String, String>>, user: String): BrainReply? {
        val contents = JSONArray()
        for ((role, text) in history.takeLast(8)) {
            contents.put(
                JSONObject()
                    .put("role", if (role == "user") "user" else "model")
                    .put("parts", JSONArray().put(JSONObject().put("text", text))),
            )
        }
        contents.put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", user))))
        val openApp = JSONObject()
            .put("name", "open_app")
            .put("description", "Telefonda yüklü bir uygulamayı açar.")
            .put(
                "parameters",
                JSONObject()
                    .put("type", "OBJECT")
                    .put("properties", JSONObject().put("name", JSONObject().put("type", "STRING").put("description", "Uygulama adı")))
                    .put("required", JSONArray().put("name")),
            )
        val body = JSONObject()
            .put(
                "systemInstruction",
                JSONObject().put(
                    "parts",
                    JSONArray().put(
                        JSONObject().put(
                            "text",
                            "Sen ERO'sun. Kısa, sıcak, günlük Türkçe konuş. Robot kalıpları kullanma. " +
                                "Kullanıcı bir uygulama açmak isterse open_app çağır. " +
                                "Model adı, hata kodu veya teknik ayrıntı söyleme.",
                        ),
                    ),
                ),
            )
            .put("contents", contents)
            .put("tools", JSONArray().put(JSONObject().put("functionDeclarations", JSONArray().put(openApp))))
        val raw = post(model, key, body) ?: return null
        val parts = raw.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
            ?: return null
        var text = ""
        var app: String? = null
        for (i in 0 until parts.length()) {
            val part = parts.optJSONObject(i) ?: continue
            if (part.has("text")) text += part.optString("text")
            val call = part.optJSONObject("functionCall")
            if (call?.optString("name") == "open_app") {
                app = call.optJSONObject("args")?.optString("name").orEmpty().ifBlank { null }
            }
        }
        if (text.isBlank() && app == null) return null
        return BrainReply(text.trim(), app)
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

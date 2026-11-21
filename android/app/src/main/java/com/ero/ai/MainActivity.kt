package com.ero.ai

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    lateinit var webView: WebView
    lateinit var speech: EroSpeech

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        EroBus.activity = this
        speech = EroSpeech(this).also { it.start() }
        setContent { EroShell(this, speech) }
        deliverWake(intent)
    }

    fun loadShell(web: WebView) {
        lifecycleScope.launch {
            val remote = withTimeoutOrNull(1400) { remoteIsNewer() } == true
            val base = if (remote) BuildConfig.PAGES_URL else "file:///android_asset/www/index.html"
            val join = if (base.contains("?")) "&" else "?"
            web.loadUrl("${base}${join}shell=1&splash=0")
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deliverWake(intent)
    }

    override fun onResume() {
        super.onResume()
        EroBus.activity = this
    }

    override fun onDestroy() {
        if (EroBus.activity == this) EroBus.activity = null
        speech.shutdown()
        super.onDestroy()
    }

    fun deliverWake(text: String) {
        val quoted = JSONObject.quote(text)
        val web = EroBus.web ?: return
        web.post { web.evaluateJavascript("window.eroWake && window.eroWake($quoted)", null) }
    }

    private fun deliverWake(intent: Intent?) {
        val text = intent?.getStringExtra(EroListenService.EXTRA_UTTERANCE).orEmpty()
        if (text.isBlank()) return
        deliverWake(text)
    }

    private suspend fun remoteIsNewer(): Boolean = withContext(Dispatchers.IO) {
        try {
            val local = assets.open("www/version.json").bufferedReader().use { JSONObject(it.readText()) }
            val remote = JSONObject(httpGet("${BuildConfig.PAGES_URL}version.json"))
            remote.optString("built") > local.optString("built")
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        fun httpGet(url: String): String {
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                setRequestProperty("User-Agent", "ERO")
                setRequestProperty("Accept", "application/json")
            }
            return connection.inputStream.bufferedReader().use { it.readText() }
        }
    }
}

object EroBus {
    var activity: MainActivity? = null
    var web: WebView? = null
    var listeningPaused: Boolean = false
}

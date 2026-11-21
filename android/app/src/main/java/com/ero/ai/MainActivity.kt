package com.ero.ai

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
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
        private set

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        webView = WebView(this)
        setContentView(webView)
        EroBus.activity = this
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.grant(request.resources) }
            }
        }
        webView.addJavascriptInterface(EroBridge(this), "EroNative")
        lifecycleScope.launch {
            val remote = withTimeoutOrNull(1400) { remoteIsNewer() } == true
            val url = if (remote) BuildConfig.PAGES_URL else "file:///android_asset/www/index.html"
            webView.loadUrl(url)
            deliverWake(intent)
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
        super.onDestroy()
    }

    fun deliverWake(text: String) {
        val quoted = JSONObject.quote(text)
        webView.post {
            webView.evaluateJavascript("window.eroWake && window.eroWake($quoted)", null)
        }
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
    var listeningPaused: Boolean = false
}

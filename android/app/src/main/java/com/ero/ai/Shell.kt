package com.ero.ai

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.webkit.WebView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import org.json.JSONObject

private val ink = Color(0xFF05070E)
private val glow = Color(0xFF2EE6D6)
private val blue = Color(0xFF4AA8FF)
private val card = Color(0xFF101A2C)

enum class ShellPage { Home, Write, Apps, Voice }

class ShellModel : ViewModel() {
    var page by mutableStateOf(ShellPage.Home)
    var status by mutableStateOf("Hazırım.")
    var level by mutableStateOf(0f)
    var draft by mutableStateOf("")
    var appName by mutableStateOf("")
    var sensitivity by mutableStateOf(0.65f)
    var verify by mutableStateOf(false)
    var busy by mutableStateOf(false)
    val lines = mutableStateListOf<String>()

    fun bind(activity: MainActivity) {
        sensitivity = VoicePrefs.sensitivity(activity)
        verify = VoicePrefs.verify(activity)
    }

    fun ask(activity: MainActivity, speech: EroSpeech, text: String) {
        val clean = text.trim()
        if (clean.isBlank() || busy) return
        busy = true
        lines.add("Sen: $clean")
        status = "Bir saniye."
        viewModelScope.launch {
            val history = lines.map { line ->
                if (line.startsWith("Sen: ")) "user" to line.removePrefix("Sen: ")
                else "model" to line.removePrefix("ERO: ")
            }
            val reply = GeminiBrain.reply(history.dropLast(1), clean)
            var say = reply.text
            if (!reply.appName.isNullOrBlank()) {
                val opened = PhoneActions(activity).run("openApp", JSONObject().put("name", reply.appName))
                say = if (opened.optBoolean("ok")) "${opened.optString("label", reply.appName)} açıldı."
                else "Bu uygulamayı bulamadım."
            }
            if (say.isBlank()) say = "Tamam."
            lines.add("ERO: $say")
            status = say
            speech.speak(say)
            busy = false
        }
    }

    fun talk(activity: MainActivity, speech: EroSpeech) {
        if (busy) return
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            status = "Mikrofon izni olmadan konuşamam."
            return
        }
        busy = true
        speech.stopSpeaking()
        status = "Dinliyorum."
        viewModelScope.launch {
            if (verify && VoicePrefs.print(activity) != null) {
                val clip = speech.sample(1400)
                val score = VoicePrint.similarity(VoicePrefs.print(activity)!!, VoicePrint.fingerprint(clip))
                status = if (score < 0.62f) {
                    "Ses izi uyuşmadı. Doğrulama deneysel, yine de dinliyorum."
                } else {
                    "Sesini aldım. Komutu söyle."
                }
            }
            val heard = speech.hear(sensitivity) { level = it }
            level = 0f
            if (heard.isBlank()) {
                status = "Seni duyamadım. Hassasiyeti artırabilirsin."
                busy = false
                return@launch
            }
            busy = false
            ask(activity, speech, heard)
        }
    }

    fun openNamed(activity: MainActivity, speech: EroSpeech) {
        val name = appName.trim()
        if (name.isBlank()) {
            status = "Hangi uygulamayı açayım?"
            return
        }
        val opened = PhoneActions(activity).run("openApp", JSONObject().put("name", name))
        val say = if (opened.optBoolean("ok")) "${opened.optString("label", name)} açıldı." else "Bu uygulamayı bulamadım."
        status = say
        lines.add("ERO: $say")
        viewModelScope.launch { speech.speak(say) }
    }

    fun enroll(activity: MainActivity, speech: EroSpeech) {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            status = "Mikrofon izni olmadan sesini kaydedemem."
            return
        }
        busy = true
        status = "İki saniye konuş."
        viewModelScope.launch {
            val clip = speech.sample(2000)
            if (VoicePrint.rms(clip) < 0.01f) {
                status = "Sesin gelmedi. Daha yakından dene."
                busy = false
                return@launch
            }
            VoicePrefs.setPrint(activity, VoicePrint.fingerprint(clip))
            verify = true
            VoicePrefs.setVerify(activity, true)
            status = "Ses izi kaydedildi. Bu ölçüm deneysel."
            busy = false
        }
    }
}

@Composable
fun EroShell(activity: MainActivity, speech: EroSpeech, model: ShellModel = viewModel()) {
    LaunchedEffect(Unit) { model.bind(activity) }
    val mic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        model.status = if (granted) "Mikrofon açık." else "Mikrofon izni olmadan konuşamam."
    }
    MaterialTheme(colorScheme = darkColorScheme(primary = glow, background = ink, surface = card)) {
        Column(
            Modifier.fillMaxSize().background(ink).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("ERO", color = glow, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Row {
                    TextButton(onClick = { model.page = ShellPage.Home }) { Text("Ana") }
                    TextButton(onClick = { model.page = ShellPage.Voice }) { Text("Ses") }
                }
            }
            when (model.page) {
                ShellPage.Home -> Home(activity)
                ShellPage.Write -> Writer(model, speech, activity)
                ShellPage.Apps -> Apps(model, speech, activity)
                ShellPage.Voice -> VoicePage(model, speech, activity)
            }
            Text(model.status, color = Color(0xFFE8FBFF), fontSize = 16.sp)
            LinearProgressIndicator(progress = model.level, modifier = Modifier.fillMaxWidth(), color = blue, trackColor = card)
            if (model.page == ShellPage.Home) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Big("Dinle", Modifier.weight(1f)) {
                        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                            mic.launch(Manifest.permission.RECORD_AUDIO)
                        } else {
                            val running = EroListenService.active
                            if (running) PhoneActions(activity).run("stopListening", JSONObject())
                            else PhoneActions(activity).run("startListening", JSONObject())
                            model.status = if (running) "Dinleme kapandı." else "Ekran kilitliyken ERO de."
                        }
                    }
                    Big("Konuş", Modifier.weight(1f)) {
                        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) mic.launch(Manifest.permission.RECORD_AUDIO)
                        else model.talk(activity, speech)
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Big("Yaz", Modifier.weight(1f)) { model.page = ShellPage.Write }
                    Big("Uygulama aç", Modifier.weight(1f)) { model.page = ShellPage.Apps }
                }
            }
        }
    }
}

@Composable
private fun ColumnScope.Home(activity: MainActivity) {
    AndroidView(
        modifier = Modifier.fillMaxWidth().weight(1f, fill = false).height(280.dp),
        factory = { activity.prepareWeb(WebView(activity)) },
    )
}

@Composable
private fun ColumnScope.Writer(model: ShellModel, speech: EroSpeech, activity: MainActivity) {
    LazyColumn(Modifier.weight(1f, fill = false).height(280.dp)) {
        items(model.lines) { line -> Text(line, color = Color(0xFFE8FBFF), modifier = Modifier.padding(bottom = 6.dp)) }
    }
    OutlinedTextField(model.draft, { model.draft = it }, modifier = Modifier.fillMaxWidth(), label = { Text("ERO'ya yaz") })
    Big("Gönder", Modifier.fillMaxWidth()) {
        val text = model.draft
        model.draft = ""
        model.ask(activity, speech, text)
    }
}

@Composable
private fun Apps(model: ShellModel, speech: EroSpeech, activity: MainActivity) {
    Text("Yüklü bir uygulamanın adını söyle.", color = Color(0xFF8FB4C4))
    OutlinedTextField(model.appName, { model.appName = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Uygulama") })
    Big("Aç", Modifier.fillMaxWidth()) { model.openNamed(activity, speech) }
}

@Composable
private fun VoicePage(model: ShellModel, speech: EroSpeech, activity: MainActivity) {
    Text("Hassasiyet", color = glow)
    Slider(model.sensitivity, {
        model.sensitivity = it
        VoicePrefs.setSensitivity(activity, it)
    })
    Text("Yüksek hassasiyet kısık sesi de alır. Gürültü bastırma, cihaz destekliyorsa mikrofon oturumunda açılır.", color = Color(0xFF8FB4C4))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Deneysel ses izi", color = Color(0xFFE8FBFF), modifier = Modifier.weight(1f))
        Switch(model.verify, {
            model.verify = it
            VoicePrefs.setVerify(activity, it)
        })
    }
    Text("Bu bir kilit değil. Emin değilse ERO bunu söyler ve yine de dinler.", color = Color(0xFF8FB4C4))
    Big("Sesimi kaydet", Modifier.fillMaxWidth()) { model.enroll(activity, speech) }
}

@Composable
private fun Big(label: String, modifier: Modifier, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = modifier.height(56.dp),
        shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF143044), contentColor = glow),
    ) { Text(label, fontSize = 16.sp) }
}

@SuppressLint("SetJavaScriptEnabled")
fun MainActivity.prepareWeb(web: WebView): WebView {
    EroBus.web?.let { existing ->
        (existing.parent as? android.view.ViewGroup)?.removeView(existing)
        return existing
    }
    webView = web
    EroBus.web = web
    val settings = web.settings
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.mediaPlaybackRequiresUserGesture = false
    settings.allowFileAccess = true
    web.webViewClient = android.webkit.WebViewClient()
    web.webChromeClient = object : android.webkit.WebChromeClient() {
        override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
            runOnUiThread { request.grant(request.resources) }
        }
    }
    web.addJavascriptInterface(EroBridge(this), "EroNative")
    loadShell(web)
    return web
}

package com.ero.ai

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.webkit.WebView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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

enum class ShellPage { Home, Write, Apps, Voice, Commands, Tasks, Memory, Safety }

class ShellModel : ViewModel() {
    var page by mutableStateOf(ShellPage.Home)
    var status by mutableStateOf("Hazırım.")
    var level by mutableStateOf(0f)
    var draft by mutableStateOf("")
    var taskDraft by mutableStateOf("")
    var memoryDraft by mutableStateOf("")
    var appName by mutableStateOf("")
    var sensitivity by mutableStateOf(0.65f)
    var verify by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var revision by mutableStateOf(0)
    var pending by mutableStateOf<DeskResult?>(null)
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
            EroStore.addTurn(activity, "user", clean)
            val waiting = pending
            if (waiting != null && isNo(clean)) {
                pending = null
                finish(activity, speech, "Tamam, vazgeçtim.")
                return@launch
            }
            if (waiting != null && isYes(clean)) {
                pending = null
                finish(activity, speech, resolve(activity, waiting, true))
                return@launch
            }
            val history = lines.map { line ->
                if (line.startsWith("Sen: ")) "user" to line.removePrefix("Sen: ")
                else "model" to line.removePrefix("ERO: ")
            }
            val reply = GeminiBrain.reply(history.dropLast(1), clean, contextNote(activity))
            val call = reply.calls.firstOrNull()
            val say = if (call == null) reply.text.ifBlank { "Tamam." }
            else resolve(activity, DeskResult("", false, call.name, call.args), false)
            finish(activity, speech, say)
        }
    }

    fun command(activity: MainActivity, speech: EroSpeech, name: String, args: JSONObject = JSONObject()) {
        if (busy) return
        busy = true
        status = "Bir saniye."
        viewModelScope.launch {
            finish(activity, speech, resolve(activity, DeskResult("", false, name, args), false))
        }
    }

    private fun contextNote(activity: MainActivity): String {
        val memories = EroStore.memories(activity).take(8).joinToString("; ") { it.text }
        val tasks = EroStore.openTasks(activity).take(8).joinToString("; ") { "${Reminders.label(it.at)} ${it.title}" }
        return "Hatırlananlar: $memories. Açık görevler: $tasks."
    }

    private suspend fun resolve(activity: MainActivity, job: DeskResult, confirmed: Boolean): String {
        if (job.name == "screen") {
            if (!confirmed && CommandDesk.confirm(activity, "screen")) {
                pending = job
                return "Ekrana bakmamı onaylıyor musun?"
            }
            val say = ScreenLook.analyze(activity)
            EroStore.addLog(activity, "screen", say)
            return say
        }
        val result = CommandDesk.perform(activity, job.name, job.args, confirmed)
        if (result.needYes) pending = result
        return result.say
    }

    private suspend fun finish(activity: MainActivity, speech: EroSpeech, say: String) {
        val line = say.ifBlank { "Tamam." }
        lines.add("ERO: $line")
        EroStore.addTurn(activity, "model", line)
        status = line
        revision += 1
        busy = false
        speech.speak(line)
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
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    TextButton(onClick = { model.page = ShellPage.Home }) { Text("Ana") }
                    TextButton(onClick = { model.page = ShellPage.Commands }) { Text("Komut") }
                    TextButton(onClick = { model.page = ShellPage.Tasks }) { Text("Görev") }
                    TextButton(onClick = { model.page = ShellPage.Memory }) { Text("Hafıza") }
                    TextButton(onClick = { model.page = ShellPage.Safety }) { Text("Güvenlik") }
                    TextButton(onClick = { model.page = ShellPage.Voice }) { Text("Ses") }
                }
            }
            when (model.page) {
                ShellPage.Home -> Home(activity)
                ShellPage.Write -> Writer(model, speech, activity)
                ShellPage.Apps -> Apps(model, speech, activity)
                ShellPage.Voice -> VoicePage(model, speech, activity)
                ShellPage.Commands -> CommandsPage(model, speech, activity)
                ShellPage.Tasks -> TasksPage(model, speech, activity)
                ShellPage.Memory -> MemoryPage(model)
                ShellPage.Safety -> SafetyPage(activity, model.revision)
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
private fun ColumnScope.CommandsPage(model: ShellModel, speech: EroSpeech, activity: MainActivity) {
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Hangisi doğrudan, hangisi onayla çalışsın.", color = Color(0xFF8FB4C4))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Big("YouTube", Modifier.weight(1f)) { model.command(activity, speech, "youtube_play", JSONObject().put("query", "müzik")) }
            Big("Bildirim", Modifier.weight(1f)) { model.command(activity, speech, "notifications") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Big("Ekran", Modifier.weight(1f)) { model.command(activity, speech, "screen") }
            Big("Pil", Modifier.weight(1f)) { model.command(activity, speech, "battery") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Big("Fener", Modifier.weight(1f)) { model.command(activity, speech, "flashlight", JSONObject().put("on", "true")) }
            Big("Gece", Modifier.weight(1f)) { model.command(activity, speech, "night") }
        }
        val tick = model.revision
        CommandDesk.specs.forEach { spec ->
            val confirm = if (tick >= 0) CommandDesk.confirm(activity, spec.id) else true
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(spec.title, color = Color(0xFFE8FBFF), modifier = Modifier.weight(1f))
                if (spec.floor) Text("Her zaman onay", color = glow)
                else Switch(confirm, {
                    CommandDesk.setConfirm(activity, spec.id, it)
                    model.revision += 1
                })
            }
        }
    }
}

@Composable
private fun ColumnScope.TasksPage(model: ShellModel, speech: EroSpeech, activity: MainActivity) {
    Text("Örnek: yarın 10:00 araç muayenesi", color = Color(0xFF8FB4C4))
    OutlinedTextField(model.taskDraft, { model.taskDraft = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Hatırlatma") })
    Big("Kur", Modifier.fillMaxWidth()) {
        val text = model.taskDraft
        model.taskDraft = ""
        model.command(activity, speech, "reminder", JSONObject().put("text", text))
    }
    val tick = model.revision
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
        if (tick >= 0) EroStore.tasks(activity).forEach { task ->
            Text(
                "${if (task.done) "Bitti" else "Açık"} · ${Reminders.label(task.at)} · ${task.title}",
                color = Color(0xFFE8FBFF),
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }
    }
}

@Composable
private fun ColumnScope.MemoryPage(model: ShellModel) {
    val activity = androidx.compose.ui.platform.LocalContext.current
    OutlinedTextField(model.memoryDraft, { model.memoryDraft = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Bunu hatırla") })
    Big("Kaydet", Modifier.fillMaxWidth()) {
        model.status = EroStore.addMemory(activity, model.memoryDraft)
        model.memoryDraft = ""
        model.revision += 1
    }
    val tick = model.revision
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
        if (tick >= 0) EroStore.memories(activity).forEach { row ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(row.text, color = Color(0xFFE8FBFF), modifier = Modifier.weight(1f))
                TextButton(onClick = {
                    EroStore.deleteMemory(activity, row.id)
                    model.revision += 1
                }) { Text("Sil") }
            }
        }
    }
}

@Composable
private fun ColumnScope.SafetyPage(activity: MainActivity, revision: Int) {
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("İzinler", color = glow, fontWeight = FontWeight.Bold)
        val state = PhoneActions(activity).run("permissionState", JSONObject())
        listOf(
            "microphone" to "Mikrofon",
            "notifications" to "Bildirim",
            "contacts" to "Kişiler",
            "phone" to "Arama",
            "sms" to "SMS",
            "camera" to "Kamera",
            "settings_write" to "Parlaklık yazma",
            "accessibility" to "Erişilebilirlik",
            "notification_listener" to "Bildirim okuma",
            "install" to "Kurulum",
        ).forEach { (id, title) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("$title: ${if (state.optBoolean(id)) "açık" else "kapalı"}", color = Color(0xFFE8FBFF), modifier = Modifier.weight(1f))
                TextButton(onClick = { PhoneActions(activity).run("requestPermission", JSONObject().put("id", id)) }) { Text("İzin") }
            }
        }
        Text("SMS ve WhatsApp gönderme her zaman sesli onay ister. Ödeme, silme ve para aktarma da öyle.", color = Color(0xFF8FB4C4))
        Text("Eylem günlüğü", color = glow, fontWeight = FontWeight.Bold)
        if (revision >= 0) {
            EroStore.logs(activity).forEach { row ->
                Text("${row.action}: ${row.detail}", color = Color(0xFFE8FBFF))
            }
        }
    }
}

private fun isYes(text: String): Boolean {
    return Regex("^(evet|tamam|olur|onay|ara|gonder|gönder|yap|hadi|kabul)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text.trim())
}

private fun isNo(text: String): Boolean {
    return Regex("^(hayir|hayır|yok|iptal|vazgec|vazgeç|dur|yapma)\\b", RegexOption.IGNORE_CASE).containsMatchIn(text.trim())
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

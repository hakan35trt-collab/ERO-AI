package com.ero.ai

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

class EroSpeech(private val context: Context) {
    private var tts: TextToSpeech? = null
    private var track: AudioTrack? = null
    private var recognizer: SpeechRecognizer? = null

    fun start() {
        if (tts != null) return
        tts = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) tts?.language = Locale("tr", "TR")
        }
    }

    fun stopSpeaking() {
        tts?.stop()
        track?.pause()
        track?.flush()
        track = null
    }

    suspend fun speak(text: String) {
        stopSpeaking()
        val pcm = GeminiBrain.speakPcm(text)
        if (pcm != null && pcm.size > 100) {
            play(pcm)
            return
        }
        suspendCancellableCoroutine { cont ->
            val engine = tts
            if (engine == null) {
                cont.resume(Unit)
                return@suspendCancellableCoroutine
            }
            engine.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) = Unit
                override fun onDone(utteranceId: String?) { if (cont.isActive) cont.resume(Unit) }
                override fun onError(utteranceId: String?) { if (cont.isActive) cont.resume(Unit) }
            })
            val params = Bundle()
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, "ero")
        }
    }

    fun shutdown() {
        stopSpeaking()
        tts?.shutdown()
        tts = null
        recognizer?.destroy()
        recognizer = null
    }

    @SuppressLint("MissingPermission")
    suspend fun hear(sensitivity: Float, onLevel: (Float) -> Unit): String {
        val threshold = (1f - sensitivity.coerceIn(0.15f, 1f)) * 0.045f
        val heard = waitForVoice(threshold, onLevel)
        if (!heard) return ""
        return recognize(sensitivity, onLevel)
    }

    @SuppressLint("MissingPermission")
    fun sample(ms: Int): ShortArray {
        val rate = 16000
        val size = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val record = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size.coerceAtLeast(rate))
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            return ShortArray(0)
        }
        enableQuiet(record.audioSessionId)
        val frames = rate * ms / 1000
        val out = ShortArray(frames)
        record.startRecording()
        var filled = 0
        while (filled < frames) {
            val n = record.read(out, filled, frames - filled)
            if (n <= 0) break
            filled += n
        }
        record.stop()
        record.release()
        return if (filled == frames) out else out.copyOf(filled)
    }

    @SuppressLint("MissingPermission")
    private fun waitForVoice(threshold: Float, onLevel: (Float) -> Unit): Boolean {
        val clip = sample(2400)
        if (clip.isEmpty()) return true
        val window = 1600
        var peak = 0f
        var offset = 0
        while (offset + window <= clip.size) {
            val level = VoicePrint.rms(clip.copyOfRange(offset, offset + window))
            if (level > peak) peak = level
            onLevel(level.coerceIn(0f, 1f))
            if (level >= threshold) return true
            offset += window
        }
        onLevel(peak.coerceIn(0f, 1f))
        return peak >= threshold * 0.65f
    }

    private suspend fun recognize(sensitivity: Float, onLevel: (Float) -> Unit): String {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) return ""
        val silence = (1100 - sensitivity * 700).toLong().coerceIn(350, 1100)
        return suspendCancellableCoroutine { cont ->
            val engine = SpeechRecognizer.createSpeechRecognizer(context)
            recognizer = engine
            engine.setRecognitionListener(object : RecognitionListener {
                private var peak = 0f
                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) {
                    val level = (rmsdB / 10f).coerceIn(0f, 1f)
                    if (level > peak) peak = level
                    onLevel(level)
                }
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onError(error: Int) {
                    engine.destroy()
                    if (cont.isActive) cont.resume("")
                }
                override fun onResults(results: Bundle?) {
                    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                    val gate = (1f - sensitivity) * 0.35f
                    engine.destroy()
                    if (cont.isActive) cont.resume(if (peak < gate) "" else text.trim())
                }
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "tr-TR")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, silence)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, silence / 2)
            }
            cont.invokeOnCancellation { engine.destroy() }
            try {
                engine.startListening(intent)
            } catch (_: Exception) {
                engine.destroy()
                if (cont.isActive) cont.resume("")
            }
        }
    }

    private fun play(pcm: ByteArray) {
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(24000)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setBufferSizeInBytes(pcm.size.coerceAtLeast(24000))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        this.track = track
        track.play()
        track.write(pcm, 0, pcm.size)
    }

    private fun enableQuiet(session: Int) {
        try {
            val echo = android.media.audiofx.AcousticEchoCanceler.create(session)
            if (echo != null) echo.enabled = true
            val noise = android.media.audiofx.NoiseSuppressor.create(session)
            if (noise != null) noise.enabled = true
        } catch (_: Exception) {
        }
    }
}

package com.ero.ai

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.NotificationCompat

class EroListenService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var running = false
    private var armedUntil = 0L
    private var lastCommandAt = 0L
    private var lastDelivered = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopListening()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_PAUSE -> {
                EroBus.listeningPaused = true
                main.post { recognizer?.stopListening() }
            }
            ACTION_RESUME -> {
                EroBus.listeningPaused = false
                main.post { listen() }
            }
            else -> {
                startInForeground()
                running = true
                active = true
                EroBus.listeningPaused = false
                main.post { listen() }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        active = false
        stopListening()
        super.onDestroy()
    }

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL, "ERO", NotificationManager.IMPORTANCE_LOW)
            manager.createNotificationChannel(channel)
        }
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, EroListenService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val open = PendingIntent.getActivity(
            this,
            2,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(getString(R.string.listening))
            .setContentText(getString(R.string.listening_sub))
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(0, getString(R.string.stop), stop)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun listen() {
        if (!running || EroBus.listeningPaused) return
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this)
            recognizer?.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onError(error: Int) {
                    main.postDelayed({ listen() }, 700)
                }
                override fun onResults(results: Bundle?) = handle(results)
                override fun onPartialResults(partialResults: Bundle?) = handle(partialResults)
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "tr-TR")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        }
        try {
            recognizer?.startListening(intent)
        } catch (_: Exception) {
            main.postDelayed({ listen() }, 1000)
        }
    }

    private fun handle(bundle: Bundle?) {
        val text = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
        val clean = text.lowercase(java.util.Locale("tr", "TR")).trim()
        if (clean.isBlank()) return
        if (clean.contains("ero dur") || clean.contains("ero kapat")) {
            val stop = Intent(this, EroListenService::class.java).setAction(ACTION_STOP)
            startService(stop)
            return
        }
        val now = System.currentTimeMillis()
        if (clean == "ero" || clean == "hey ero") {
            armedUntil = now + 6000
            val open = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            startActivity(open)
            return
        }
        val match = Regex("(?:^|\\s)ero(?:\\s+(.+))?$").find(clean)
        val command = when {
            match != null -> match.groupValues.getOrNull(1).orEmpty().trim()
            now < armedUntil -> clean
            else -> ""
        }
        if (command.isBlank() || command == "dur" || command == "kapat") return
        if (command == lastDelivered && now - lastCommandAt < 4000) return
        lastDelivered = command
        lastCommandAt = now
        armedUntil = 0
        val open = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra(EXTRA_UTTERANCE, command)
        }
        startActivity(open)
        EroBus.activity?.deliverWake(command)
        main.post { recognizer?.stopListening() }
        main.postDelayed({ listen() }, 1500)
    }

    private fun stopListening() {
        running = false
        main.post {
            recognizer?.destroy()
            recognizer = null
        }
    }

    companion object {
        const val ACTION_STOP = "com.ero.ai.STOP_LISTEN"
        const val ACTION_PAUSE = "com.ero.ai.PAUSE_LISTEN"
        const val ACTION_RESUME = "com.ero.ai.RESUME_LISTEN"
        const val EXTRA_UTTERANCE = "utterance"
        var active: Boolean = false
        private const val CHANNEL = "ero-listen"
        private const val NOTIFICATION_ID = 35
    }
}

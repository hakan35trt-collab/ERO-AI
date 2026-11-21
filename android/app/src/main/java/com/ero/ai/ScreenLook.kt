package com.ero.ai

import android.graphics.Bitmap
import android.os.Build
import android.view.Display
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray

object ScreenLook {
    suspend fun analyze(activity: MainActivity): String {
        val service = EroAccessibilityService.instance
            ?: return "Erişilebilirlik kapalı. Ayarlardan ERO'yu aç."
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return "Bu Android sürümü ekran görüntüsü vermiyor. ${readable(service.readScreen())}"
        }
        val shot = capture(activity, service) ?: return "Ekran görüntüsü alınamadı. ${readable(service.readScreen())}"
        val ocr = readText(shot)
        val vision = GeminiBrain.look(shot)
        return when {
            !vision.isNullOrBlank() -> vision
            ocr.isNotBlank() -> "Görüntüyü modele gönderemedim. Okuduğum metin: $ocr"
            else -> "Ekranda okunacak bir yazı bulamadım."
        }
    }

    private suspend fun capture(activity: MainActivity, service: EroAccessibilityService): Bitmap? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
        return suspendCancellableCoroutine { cont ->
            service.takeScreenshot(
                Display.DEFAULT_DISPLAY,
                androidx.core.content.ContextCompat.getMainExecutor(activity),
                object : android.accessibilityservice.AccessibilityService.TakeScreenshotCallback {
                    override fun onSuccess(result: android.accessibilityservice.AccessibilityService.ScreenshotResult) {
                        val hardware = Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)
                        result.hardwareBuffer.close()
                        val soft = hardware?.copy(Bitmap.Config.ARGB_8888, false)
                        hardware?.recycle()
                        if (cont.isActive) cont.resume(soft)
                    }

                    override fun onFailure(errorCode: Int) {
                        if (cont.isActive) cont.resume(null)
                    }
                },
            )
        }
    }

    private suspend fun readText(bitmap: Bitmap): String = suspendCancellableCoroutine { cont ->
        val image = InputImage.fromBitmap(bitmap, 0)
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            .process(image)
            .addOnSuccessListener { if (cont.isActive) cont.resume(it.text.trim()) }
            .addOnFailureListener { if (cont.isActive) cont.resume("") }
    }

    private fun readable(data: org.json.JSONObject): String {
        val lines = data.optJSONArray("text") ?: JSONArray()
        val text = buildString {
            for (i in 0 until lines.length()) {
                if (i > 0) append(' ')
                append(lines.optString(i))
            }
        }.trim()
        return if (text.isBlank()) "Ekranda okunacak yazı yok." else "Ekrandaki yazı: $text"
    }
}

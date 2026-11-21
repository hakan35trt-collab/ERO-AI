package com.ero.ai

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.math.sqrt

object VoicePrint {
    const val BANDS = 16

    fun rms(samples: ShortArray): Float {
        if (samples.isEmpty()) return 0f
        var sum = 0.0
        for (sample in samples) {
            val v = sample / 32768.0
            sum += v * v
        }
        return sqrt(sum / samples.size).toFloat()
    }

    fun fingerprint(samples: ShortArray): FloatArray {
        val bands = FloatArray(BANDS)
        val width = 512
        var frames = 0
        var offset = 0
        while (offset + width <= samples.size) {
            for (band in 0 until BANDS) {
                val bin = 2 + band * 3
                var real = 0.0
                var imag = 0.0
                for (i in 0 until width) {
                    val angle = 2.0 * PI * bin * i / width
                    val sample = samples[offset + i] / 32768.0
                    real += sample * cos(angle)
                    imag -= sample * sin(angle)
                }
                bands[band] += hypot(real, imag).toFloat()
            }
            frames++
            offset += width
        }
        if (frames == 0) return bands
        var energy = 0.0
        for (i in bands.indices) {
            bands[i] = bands[i] / frames
            energy += bands[i] * bands[i]
        }
        val scale = sqrt(energy).toFloat().coerceAtLeast(0.0001f)
        for (i in bands.indices) bands[i] = bands[i] / scale
        return bands
    }

    fun similarity(a: FloatArray, b: FloatArray): Float {
        if (a.size != b.size || a.isEmpty()) return 0f
        var dot = 0.0
        for (i in a.indices) dot += a[i] * b[i]
        return dot.toFloat().coerceIn(0f, 1f)
    }
}

package com.ero.ai

import android.content.Context

object VoicePrefs {
    private const val file = "ero_voice"

    fun sensitivity(context: Context): Float =
        context.getSharedPreferences(file, Context.MODE_PRIVATE).getFloat("sensitivity", 0.65f)

    fun setSensitivity(context: Context, value: Float) {
        context.getSharedPreferences(file, Context.MODE_PRIVATE).edit()
            .putFloat("sensitivity", value.coerceIn(0.15f, 1f)).apply()
    }

    fun verify(context: Context): Boolean =
        context.getSharedPreferences(file, Context.MODE_PRIVATE).getBoolean("verify", false)

    fun setVerify(context: Context, on: Boolean) {
        context.getSharedPreferences(file, Context.MODE_PRIVATE).edit().putBoolean("verify", on).apply()
    }

    fun print(context: Context): FloatArray? {
        val raw = context.getSharedPreferences(file, Context.MODE_PRIVATE).getString("print", null) ?: return null
        val parts = raw.split(",").mapNotNull { it.toFloatOrNull() }
        return if (parts.size == VoicePrint.BANDS) parts.toFloatArray() else null
    }

    fun setPrint(context: Context, value: FloatArray?) {
        val editor = context.getSharedPreferences(file, Context.MODE_PRIVATE).edit()
        if (value == null) editor.remove("print") else editor.putString("print", value.joinToString(","))
        editor.apply()
    }
}

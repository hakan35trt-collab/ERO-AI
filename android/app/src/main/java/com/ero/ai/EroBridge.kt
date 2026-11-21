package com.ero.ai

import android.webkit.JavascriptInterface
import org.json.JSONObject

class EroBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun call(name: String, argsJson: String): String {
        return try {
            val args = JSONObject(if (argsJson.isNullOrBlank()) "{}" else argsJson)
            PhoneActions(activity).run(name, args).toString()
        } catch (error: Exception) {
            JSONObject().put("ok", false).put("error", error.message ?: "Köprü hata verdi.").toString()
        }
    }
}

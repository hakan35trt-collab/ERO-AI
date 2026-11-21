package com.ero.ai

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

class EroNotificationService : NotificationListenerService() {
    override fun onListenerConnected() {
        instance = this
        refresh()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        refresh()
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        refresh()
    }

    override fun onDestroy() {
        if (instance == this) instance = null
        super.onDestroy()
    }

    private fun refresh() {
        val next = mutableListOf<JSONObject>()
        for (item in activeNotifications.orEmpty().takeLast(8)) {
            val extras = item.notification.extras
            next.add(
                JSONObject()
                    .put("app", item.packageName)
                    .put("title", extras?.getCharSequence("android.title")?.toString().orEmpty())
                    .put("text", extras?.getCharSequence("android.text")?.toString().orEmpty()),
            )
        }
        recent = next
    }

    companion object {
        var instance: EroNotificationService? = null
        var recent: List<JSONObject> = emptyList()

        fun snapshot(): JSONObject {
            if (instance == null) {
                return JSONObject().put("ok", false).put("error", "Bildirim erişimi kapalı.")
            }
            val items = JSONArray()
            recent.takeLast(8).forEach { items.put(it) }
            return JSONObject().put("ok", true).put("items", items)
        }
    }
}

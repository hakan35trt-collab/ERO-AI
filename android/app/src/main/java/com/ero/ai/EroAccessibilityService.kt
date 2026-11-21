package com.ero.ai

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

class EroAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        instance = this
    }

    override fun onDestroy() {
        if (instance == this) instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: android.view.accessibility.AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    fun readScreen(): JSONObject {
        val lines = JSONArray()
        val root = rootInActiveWindow
        if (root != null) collect(root, lines, 0)
        return JSONObject().put("ok", true).put("text", lines)
    }

    fun tap(query: String): JSONObject {
        val root = rootInActiveWindow ?: return closed()
        val node = find(root, query, 0) ?: return JSONObject().put("ok", false).put("error", "Ekranda bu yazıyı bulamadım.")
        val target = clickable(node) ?: node
        val done = target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        return JSONObject().put("ok", done).put("text", query)
    }

    fun scroll(direction: String): JSONObject {
        val root = rootInActiveWindow ?: return closed()
        val forward = direction != "up"
        val node = findScrollable(root, 0) ?: root
        val action = if (forward) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        val done = node.performAction(action)
        return JSONObject().put("ok", done)
    }

    fun typeText(value: String): JSONObject {
        val root = rootInActiveWindow ?: return closed()
        val node = findEditable(root, 0) ?: return JSONObject().put("ok", false).put("error", "Yazılacak alan yok.")
        node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val bundle = Bundle()
        bundle.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
        val done = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, bundle)
        return JSONObject().put("ok", done)
    }

    fun global(action: String): JSONObject {
        val code = when (action) {
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            else -> GLOBAL_ACTION_BACK
        }
        return JSONObject().put("ok", performGlobalAction(code))
    }

    private fun closed() = JSONObject().put("ok", false).put("error", "Ekran okunamıyor.")

    private fun collect(node: AccessibilityNodeInfo, lines: JSONArray, depth: Int) {
        if (depth > 30 || lines.length() >= 80) return
        val text = node.text?.toString()?.trim().orEmpty()
        val desc = node.contentDescription?.toString()?.trim().orEmpty()
        val line = if (text.isNotBlank()) text else desc
        if (line.isNotBlank()) lines.put(line)
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collect(child, lines, depth + 1)
        }
    }

    private fun find(node: AccessibilityNodeInfo, query: String, depth: Int): AccessibilityNodeInfo? {
        if (depth > 30) return null
        val hay = "${node.text ?: ""} ${node.contentDescription ?: ""}"
        if (hay.contains(query, ignoreCase = true)) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = find(child, query, depth + 1)
            if (found != null) return found
        }
        return null
    }

    private fun findScrollable(node: AccessibilityNodeInfo, depth: Int): AccessibilityNodeInfo? {
        if (depth > 30) return null
        if (node.isScrollable) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findScrollable(child, depth + 1)
            if (found != null) return found
        }
        return null
    }

    private fun findEditable(node: AccessibilityNodeInfo, depth: Int): AccessibilityNodeInfo? {
        if (depth > 30) return null
        if (node.isEditable || node.isFocused) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findEditable(child, depth + 1)
            if (found != null) return found
        }
        return null
    }

    private fun clickable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        var guard = 0
        while (current != null && guard < 6) {
            if (current.isClickable) return current
            current = current.parent
            guard += 1
        }
        return null
    }

    companion object {
        var instance: EroAccessibilityService? = null
    }
}

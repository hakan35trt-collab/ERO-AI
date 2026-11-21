package com.ero.ai

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

object Reminders {
    fun parse(text: String, now: Calendar = Calendar.getInstance()): Long? {
        val clean = text.lowercase(Locale("tr", "TR"))
        val clock = Regex("(\\d{1,2})(?::(\\d{2}))?").find(clean) ?: return null
        val hour = clock.groupValues[1].toIntOrNull() ?: return null
        val minute = clock.groupValues[2].toIntOrNull() ?: 0
        if (hour !in 0..23 || minute !in 0..59) return null
        val whenAt = now.clone() as Calendar
        when {
            clean.contains("yarın") || clean.contains("yarin") -> whenAt.add(Calendar.DAY_OF_YEAR, 1)
            clean.contains("bugün") || clean.contains("bugun") -> Unit
        }
        whenAt.set(Calendar.HOUR_OF_DAY, hour)
        whenAt.set(Calendar.MINUTE, minute)
        whenAt.set(Calendar.SECOND, 0)
        whenAt.set(Calendar.MILLISECOND, 0)
        if (whenAt.timeInMillis <= now.timeInMillis && !clean.contains("yarın") && !clean.contains("yarin")) {
            whenAt.add(Calendar.DAY_OF_YEAR, 1)
        }
        return whenAt.timeInMillis
    }

    fun schedule(context: Context, task: TaskRow): Boolean {
        val manager = context.getSystemService(AlarmManager::class.java)
        val pending = pending(context, task)
        val exact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) manager.canScheduleExactAlarms() else true
        if (exact) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, task.at, pending)
        else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, task.at, pending)
        return exact
    }

    fun restore(context: Context) {
        for (task in EroStore.openTasks(context)) {
            if (task.at > System.currentTimeMillis()) schedule(context, task)
        }
    }

    fun label(at: Long): String {
        return SimpleDateFormat("d MMM HH:mm", Locale("tr", "TR")).format(at)
    }

    private fun pending(context: Context, task: TaskRow): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java)
            .putExtra("title", task.title)
            .putExtra("id", task.id)
        return PendingIntent.getBroadcast(
            context,
            task.id.toInt(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val title = intent.getStringExtra("title").orEmpty().ifBlank { "Hatırlatma" }
        val notification = NotificationCompat.Builder(context, "ero-reminder")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("ERO")
            .setContentText(title)
            .setAutoCancel(true)
            .build()
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify((System.currentTimeMillis() % 100000).toInt(), notification)
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) Reminders.restore(context)
    }
}

package com.ero.ai

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Update

@Entity(tableName = "memories")
data class MemoryRow(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val text: String,
    val at: Long,
)

@Entity(tableName = "tasks")
data class TaskRow(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val at: Long,
    val done: Boolean,
)

@Entity(tableName = "logs")
data class LogRow(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val action: String,
    val detail: String,
    val at: Long,
)

@Entity(tableName = "policies")
data class PolicyRow(
    @PrimaryKey val id: String,
    val confirm: Boolean,
)

@Entity(tableName = "turns")
data class TurnRow(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val role: String,
    val text: String,
    val at: Long,
)

@Dao
interface EroDao {
    @Insert fun insertMemory(row: MemoryRow): Long
    @Query("SELECT * FROM memories ORDER BY at DESC") fun memories(): List<MemoryRow>
    @Query("DELETE FROM memories WHERE id = :id") fun deleteMemory(id: Long)
    @Query("DELETE FROM memories WHERE text LIKE '%' || :query || '%'") fun forget(query: String)

    @Insert fun insertTask(row: TaskRow): Long
    @Query("SELECT * FROM tasks ORDER BY at ASC") fun tasks(): List<TaskRow>
    @Update fun updateTask(row: TaskRow)
    @Query("SELECT * FROM tasks WHERE done = 0") fun openTasks(): List<TaskRow>

    @Insert fun insertLog(row: LogRow)
    @Query("SELECT * FROM logs ORDER BY at DESC LIMIT 40") fun logs(): List<LogRow>

    @Insert(onConflict = OnConflictStrategy.REPLACE) fun insertPolicy(row: PolicyRow)
    @Query("SELECT * FROM policies WHERE id = :id LIMIT 1") fun policy(id: String): PolicyRow?
    @Query("SELECT * FROM policies") fun policies(): List<PolicyRow>

    @Insert fun insertTurn(row: TurnRow)
    @Query("SELECT * FROM turns ORDER BY at DESC LIMIT 30") fun turns(): List<TurnRow>
}

@Database(
    entities = [MemoryRow::class, TaskRow::class, LogRow::class, PolicyRow::class, TurnRow::class],
    version = 1,
    exportSchema = false,
)
abstract class EroDatabase : RoomDatabase() {
    abstract fun dao(): EroDao
}

class EroApp : Application() {
    override fun onCreate() {
        super.onCreate()
        EroStore.init(this)
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel("ero-reminder", "ERO hatırlatma", NotificationManager.IMPORTANCE_HIGH),
        )
    }
}

object EroStore {
    private lateinit var database: EroDatabase

    fun init(context: Context) {
        if (::database.isInitialized) return
        database = Room.databaseBuilder(context.applicationContext, EroDatabase::class.java, "ero.db")
            .allowMainThreadQueries()
            .build()
    }

    private fun dao(context: Context): EroDao {
        init(context)
        return database.dao()
    }

    fun memories(context: Context) = dao(context).memories()
    fun tasks(context: Context) = dao(context).tasks()
    fun logs(context: Context) = dao(context).logs()
    fun turns(context: Context) = dao(context).turns()
    fun policies(context: Context) = dao(context).policies()

    fun addMemory(context: Context, text: String): String {
        if (sensitive(text)) return "Şifre ve kart bilgisini saklamam."
        val clean = text.trim()
        dao(context).insertMemory(MemoryRow(text = clean, at = System.currentTimeMillis()))
        addLog(context, "remember", clean)
        return "Bunu hatırlayacağım."
    }

    fun forget(context: Context, query: String): String {
        dao(context).forget(query.trim())
        addLog(context, "forget", query.trim())
        return "Bunu unuttum."
    }

    fun deleteMemory(context: Context, id: Long) {
        dao(context).deleteMemory(id)
    }

    fun addTask(context: Context, title: String, at: Long): TaskRow {
        val id = dao(context).insertTask(TaskRow(title = title, at = at, done = false))
        return TaskRow(id = id, title = title, at = at, done = false)
    }

    fun markDone(context: Context, row: TaskRow) {
        dao(context).updateTask(row.copy(done = true))
    }

    fun openTasks(context: Context) = dao(context).openTasks()

    fun addLog(context: Context, action: String, detail: String) {
        dao(context).insertLog(LogRow(action = action, detail = detail.take(240), at = System.currentTimeMillis()))
    }

    fun addTurn(context: Context, role: String, text: String) {
        dao(context).insertTurn(TurnRow(role = role, text = text.take(500), at = System.currentTimeMillis()))
    }

    fun confirmFor(context: Context, id: String, fallback: Boolean): Boolean {
        return dao(context).policy(id)?.confirm ?: fallback
    }

    fun setConfirm(context: Context, id: String, confirm: Boolean) {
        dao(context).insertPolicy(PolicyRow(id, confirm))
    }

    private fun sensitive(text: String): Boolean {
        return Regex("şifre|sifre|parola|kart numar|cvv|iban|password", RegexOption.IGNORE_CASE).containsMatchIn(text)
    }
}

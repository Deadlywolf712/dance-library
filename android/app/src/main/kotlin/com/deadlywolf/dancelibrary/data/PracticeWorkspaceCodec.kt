package com.deadlywolf.dancelibrary.data

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser

/** Explicit JSON codec keeps unknown extension metadata and unknown lesson paths. */
internal object PracticeWorkspaceCodec {
    private val workspaceKeys = setOf("version", "queue", "segments", "completed", "reflections")
    private val segmentKeys = setOf("id", "path", "title", "start", "end", "speed", "createdAt")
    private val reflectionKeys = setOf("text", "updatedAt")

    fun decodeString(raw: String?): PracticeWorkspace = if (raw == null) PracticeWorkspace() else {
        val element = try { JsonParser.parseString(raw) } catch (_: Exception) { invalid("Practice data is not valid JSON.") }
        decode(element)
    }

    fun decode(element: JsonElement): PracticeWorkspace {
        val root = element.objectValue("practiceData")
        if (root.number("version") != 1.0) invalid("Unsupported practiceData version. Keep the original backup.")
        val queue = root.array("queue").map { it.stringValue("queue path").also(::requirePath) }
        if (queue.size > MAX_WORKSPACE_ITEMS || queue.distinct().size != queue.size) invalid("Invalid or oversized practice queue.")
        val segments = root.array("segments").map { readSegment(it.objectValue("segment")) }
        if (segments.size > MAX_WORKSPACE_ITEMS || segments.map { it.id }.distinct().size != segments.size) invalid("Invalid or oversized practice segments.")
        val completed = root.get("completed")?.objectValue("completed")?.entrySet()?.associateTo(linkedMapOf()) { (path, value) ->
            requirePath(path)
            path to value.timestampValue("completion timestamp")
        } ?: invalid("Missing completion data.")
        val reflections = if (root.has("reflections")) root.getAsJsonObjectChecked("reflections").entrySet().associateTo(linkedMapOf()) { (path, value) ->
            requirePath(path)
            path to readReflection(value.objectValue("reflection"))
        } else emptyMap()
        return PracticeWorkspace(queue, segments, completed, reflections, extras(root, workspaceKeys), root.has("reflections"))
    }

    fun encode(workspace: PracticeWorkspace): JsonObject = workspace.extra.deepCopy().apply {
        addProperty("version", 1)
        add("queue", JsonArray().apply { workspace.queue.forEach(::add) })
        add("segments", JsonArray().apply { workspace.segments.forEach { add(encodeSegment(it)) } })
        add("completed", JsonObject().apply { workspace.completed.forEach { (path, value) -> addProperty(path, value) } })
        if (workspace.hasReflections || workspace.reflections.isNotEmpty()) {
            add("reflections", JsonObject().apply { workspace.reflections.forEach { (path, value) -> add(path, encodeReflection(value)) } })
        } else remove("reflections")
    }

    fun validated(workspace: PracticeWorkspace): PracticeWorkspace = decode(encode(workspace))

    fun merge(local: PracticeWorkspace, incoming: PracticeWorkspace): PracticeWorkspace {
        validated(local); validated(incoming)
        val queue = (local.queue + incoming.queue).distinct()
        val segments = local.segments.associateByTo(linkedMapOf()) { it.id }
        incoming.segments.forEach { added ->
            val old = segments[added.id]
            segments[added.id] = if (old == null) added.copy(extra = added.extra.deepCopy()) else {
                val winner = if (added.createdAt > old.createdAt) added else old
                winner.copy(extra = mergeExtras(old.extra, added.extra))
            }
        }
        val completed = local.completed.toMutableMap()
        incoming.completed.forEach { (path, time) -> completed[path] = maxOf(completed[path] ?: 0, time) }
        val reflections = local.reflections.toMutableMap()
        incoming.reflections.forEach { (path, added) ->
            val old = reflections[path]
            reflections[path] = if (old == null) added.copy(extra = added.extra.deepCopy()) else {
                val winner = if (added.updatedAt > old.updatedAt) added else old
                winner.copy(extra = mergeExtras(old.extra, added.extra))
            }
        }
        return validated(PracticeWorkspace(queue, segments.values.toList(), completed, reflections,
            mergeExtras(local.extra, incoming.extra), local.hasReflections || incoming.hasReflections))
    }

    fun scoped(workspace: PracticeWorkspace, paths: Set<String>?): PracticeWorkspace = if (paths == null) workspace else workspace.copy(
        queue = workspace.queue.filter { it in paths }, segments = workspace.segments.filter { it.path in paths },
        completed = workspace.completed.filterKeys { it in paths }, reflections = workspace.reflections.filterKeys { it in paths },
        // Opaque root metadata has no reliable lesson ownership; retain it only in full backups.
        extra = JsonObject(),
    )

    fun encodeReflection(value: PracticeReflection): JsonObject = value.extra.deepCopy().apply {
        addProperty("text", value.text); addProperty("updatedAt", value.updatedAt)
    }

    fun readReflection(value: JsonObject): PracticeReflection {
        val text = value.string("text")
        if (text.length > MAX_REFLECTION_LENGTH) invalid("Reflection exceeds $MAX_REFLECTION_LENGTH characters.")
        return PracticeReflection(text, value.get("updatedAt")?.timestampValue("reflection timestamp") ?: invalid("Missing reflection timestamp."), extras(value, reflectionKeys))
    }

    private fun readSegment(value: JsonObject): PracticeSegment {
        val id = value.string("id").also(::requirePath)
        val path = value.string("path").also(::requirePath)
        val title = value.string("title")
        val start = value.number("start")
        val end = value.number("end")
        val speed = value.number("speed")
        if (title.length > 120 || start < 0 || end <= start || speed !in 0.25..2.0) invalid("Invalid saved practice segment.")
        return PracticeSegment(id, path, title, start, end, speed,
            value.get("createdAt")?.timestampValue("segment timestamp") ?: invalid("Missing segment timestamp."), extras(value, segmentKeys))
    }

    private fun encodeSegment(value: PracticeSegment): JsonObject = value.extra.deepCopy().apply {
        addProperty("id", value.id); addProperty("path", value.path); addProperty("title", value.title)
        addProperty("start", value.start); addProperty("end", value.end); addProperty("speed", value.speed); addProperty("createdAt", value.createdAt)
    }

    fun mergeExtras(local: JsonObject, incoming: JsonObject): JsonObject = incoming.deepCopy().apply {
        local.entrySet().forEach { (name, value) -> add(name, value.deepCopy()) }
    }

    fun extras(root: JsonObject, known: Set<String>): JsonObject = JsonObject().apply {
        root.entrySet().filter { it.key !in known }.forEach { (name, value) -> add(name, value.deepCopy()) }
    }

    private fun JsonObject.array(key: String): JsonArray = get(key)?.takeIf { it.isJsonArray }?.asJsonArray ?: invalid("Invalid $key array.")
    private fun JsonObject.getAsJsonObjectChecked(key: String): JsonObject = get(key)?.objectValue(key) ?: invalid("Missing $key.")
    private fun JsonElement.objectValue(name: String): JsonObject = takeIf { it.isJsonObject }?.asJsonObject ?: invalid("Invalid $name object.")
    private fun JsonObject.string(key: String): String = get(key)?.stringValue(key) ?: invalid("Missing $key.")
    private fun JsonElement.stringValue(name: String): String = takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString ?: invalid("Invalid $name string.")
    private fun JsonObject.number(key: String): Double {
        val value = get(key) ?: invalid("Missing $key.")
        if (!value.isJsonPrimitive || !value.asJsonPrimitive.isNumber) invalid("Invalid $key number.")
        return value.asDouble.takeIf { it.isFinite() } ?: invalid("Invalid $key number.")
    }
    internal fun JsonElement.timestampValue(name: String): Long {
        if (!isJsonPrimitive || !asJsonPrimitive.isNumber) invalid("Invalid $name.")
        return try { asBigDecimal.longValueExact().takeIf { it >= 0L } ?: invalid("Invalid $name.") }
        catch (_: ArithmeticException) { invalid("$name must be a nonnegative whole millisecond timestamp within Android's supported range.") }
        catch (_: NumberFormatException) { invalid("Invalid $name.") }
    }
    private fun requirePath(value: String) { if (value.isBlank()) invalid("A practice path or id cannot be blank.") }
    private fun invalid(message: String): Nothing = throw BackupFormatException(message)
}

package com.deadlywolf.dancelibrary.data

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.TypeAdapter
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonWriter

/** Gson's JsonObject adapter rejects JSON null despite a nullable Kotlin field. */
internal class NullableBookmarkMetadataAdapter : TypeAdapter<JsonObject>() {
    private val elements = Gson().getAdapter(JsonElement::class.java)

    override fun read(reader: JsonReader): JsonObject? {
        val value = elements.read(reader)
        if (value == null || value.isJsonNull) return null
        if (!value.isJsonObject) throw JsonParseException("Bookmark metadata must be an object or null.")
        return value.asJsonObject
    }

    override fun write(writer: JsonWriter, value: JsonObject?) {
        elements.write(writer, value)
    }
}

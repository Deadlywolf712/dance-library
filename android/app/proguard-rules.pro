# Gson reads the bundled catalog into these data classes.
-keepattributes Signature
-keep class com.deadlywolf.dancelibrary.model.** { *; }

# Gson instantiates this field adapter through its @JsonAdapter annotation.
-keep class com.deadlywolf.dancelibrary.data.NullableBookmarkMetadataAdapter { *; }

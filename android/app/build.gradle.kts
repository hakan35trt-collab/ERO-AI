plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val versionCodeProp = (findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
val versionNameProp = (findProperty("versionName") as String?) ?: "1.0.0"

android {
    namespace = "com.ero.ai"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ero.ai"
        minSdk = 26
        targetSdk = 35
        versionCode = versionCodeProp
        versionName = versionNameProp
        val youtube = (System.getenv("YOUTUBE_API_KEY") ?: "").filter { it.isLetterOrDigit() || it == '-' || it == '_' }
        buildConfigField("String", "YOUTUBE_API_KEY", "\"$youtube\"")
        buildConfigField("String", "PAGES_URL", "\"https://hakan35trt-collab.github.io/ERO-AI/\"")
        buildConfigField("String", "RELEASES_URL", "\"https://api.github.com/repos/hakan35trt-collab/ERO-AI/releases/latest\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    signingConfigs {
        create("release") {
            val store = System.getenv("ERO_KEYSTORE_FILE")
            if (!store.isNullOrBlank()) {
                storeFile = file(store)
                storePassword = System.getenv("ERO_KEYSTORE_PASSWORD") ?: ""
                keyAlias = System.getenv("ERO_KEY_ALIAS") ?: ""
                keyPassword = System.getenv("ERO_KEY_PASSWORD") ?: ""
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            val releaseSigning = signingConfigs.getByName("release")
            signingConfig = if (releaseSigning.storeFile?.exists() == true) {
                releaseSigning
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}

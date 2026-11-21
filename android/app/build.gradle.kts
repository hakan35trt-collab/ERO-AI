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
        val gemini = (System.getenv("GEMINI_API_KEY") ?: "").filter { it.isLetterOrDigit() || it == '-' || it == '_' }
        buildConfigField("String", "YOUTUBE_API_KEY", "\"$youtube\"")
        buildConfigField("String", "GEMINI_API_KEY", "\"$gemini\"")
        buildConfigField("String", "PAGES_URL", "\"https://hakan35trt-collab.github.io/ERO-AI/\"")
        buildConfigField("String", "RELEASES_URL", "\"https://api.github.com/repos/hakan35trt-collab/ERO-AI/releases/latest\"")
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.15"
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
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}

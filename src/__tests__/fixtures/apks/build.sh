#!/usr/bin/env bash
# Rebuilds the fixture APKs with aapt (Ubuntu packages: aapt, android-sdk-platform-23).
# The output is committed so the tests do not need aapt.
set -euo pipefail

ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

build_apk() {
  local name="$1"
  aapt package -f -M "$WORK_DIR/$name/AndroidManifest.xml" -S "$WORK_DIR/$name/res" \
    -I "$ANDROID_JAR" -F "$OUT_DIR/$name.apk"
}

# Debug build, label written directly in the manifest, no string resources
mkdir -p "$WORK_DIR/debug-literal/res"
cat > "$WORK_DIR/debug-literal/AndroidManifest.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.shop.debug"
    android:versionCode="12"
    android:versionName="1.2.0-debug">
    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />
    <application android:label="My Shop Debug" android:debuggable="true" />
</manifest>
XML
build_apk debug-literal

# Release build, label is a string resource with a Turkish translation
mkdir -p "$WORK_DIR/release-resource/res/values" "$WORK_DIR/release-resource/res/values-tr"
cat > "$WORK_DIR/release-resource/AndroidManifest.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.shop"
    android:versionCode="12"
    android:versionName="1.2.0">
    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />
    <application android:label="@string/app_name" />
</manifest>
XML
cat > "$WORK_DIR/release-resource/res/values/strings.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="unused_first">Unused</string>
    <string name="app_name">My Shop</string>
</resources>
XML
cat > "$WORK_DIR/release-resource/res/values-tr/strings.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Dükkanım</string>
</resources>
XML
build_apk release-resource

# No label and no <uses-sdk>
mkdir -p "$WORK_DIR/no-label/res"
cat > "$WORK_DIR/no-label/AndroidManifest.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.bare"
    android:versionCode="3"
    android:versionName="0.3">
    <application />
</manifest>
XML
build_apk no-label

# A valid ZIP that is not an APK: no AndroidManifest.xml
mkdir -p "$WORK_DIR/not-an-apk"
printf 'hello' > "$WORK_DIR/not-an-apk/readme.txt"
(cd "$WORK_DIR/not-an-apk" && rm -f "$OUT_DIR/no-manifest.apk" && zip -q -X "$OUT_DIR/no-manifest.apk" readme.txt)

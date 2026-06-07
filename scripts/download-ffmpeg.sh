#!/bin/bash
# Download static ffmpeg builds for bundling.
# Run once before `npm run dist`.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$ROOT/build/vendor"

mkdir -p "$BUILD_DIR"

# macOS arm64
if [ ! -f "$BUILD_DIR/ffmpeg-mac-arm64" ]; then
  echo "Downloading ffmpeg for macOS arm64..."
  curl -L "https://www.osxexperts.net/ffmpeg7arm.zip" -o /tmp/ffmpeg-mac.zip
  unzip -o /tmp/ffmpeg-mac.zip -d /tmp/ffmpeg-mac
  cp /tmp/ffmpeg-mac/ffmpeg "$BUILD_DIR/ffmpeg-mac-arm64"
  chmod +x "$BUILD_DIR/ffmpeg-mac-arm64"
  rm -rf /tmp/ffmpeg-mac /tmp/ffmpeg-mac.zip
  echo "Done: ffmpeg-mac-arm64"
fi

# macOS x64
if [ ! -f "$BUILD_DIR/ffmpeg-mac-x64" ]; then
  echo "Downloading ffmpeg for macOS x64..."
  curl -L "https://evermeet.cx/ffmpeg/ffmpeg-7.1.1.zip" -o /tmp/ffmpeg-mac-x64.zip
  unzip -o /tmp/ffmpeg-mac-x64.zip -d /tmp/ffmpeg-mac-x64
  cp /tmp/ffmpeg-mac-x64/ffmpeg "$BUILD_DIR/ffmpeg-mac-x64"
  chmod +x "$BUILD_DIR/ffmpeg-mac-x64"
  rm -rf /tmp/ffmpeg-mac-x64 /tmp/ffmpeg-mac-x64.zip
  echo "Done: ffmpeg-mac-x64"
fi

# Windows x64
if [ ! -f "$BUILD_DIR/ffmpeg-win-x64.exe" ]; then
  echo "Downloading ffmpeg for Windows x64..."
  curl -L "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -o /tmp/ffmpeg-win.zip
  unzip -o /tmp/ffmpeg-win.zip -d /tmp/ffmpeg-win
  find /tmp/ffmpeg-win -name "ffmpeg.exe" -exec cp {} "$BUILD_DIR/ffmpeg-win-x64.exe" \;
  rm -rf /tmp/ffmpeg-win /tmp/ffmpeg-win.zip
  echo "Done: ffmpeg-win-x64.exe"
fi

echo "All ffmpeg binaries downloaded to $BUILD_DIR"
ls -lh "$BUILD_DIR/"

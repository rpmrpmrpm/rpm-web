#!/usr/bin/env bash
#
# Builds the media module for the browser: FFmpeg's libraries, Chromaprint and native/, compiled to
# WebAssembly. The versions are pinned in scripts/tool-versions.txt.
#
#   scripts/build-media.sh           configures and builds what has changed
#   scripts/build-media.sh --clean   builds FFmpeg and Chromaprint again from their source
#
# Options: --work DIR (default .build) holds the compiler, the downloads and the build trees.
#
# Writes public/media/rpm-media.js and rpm-media.wasm.
#
# The build is LGPL 2.1 or later: no --enable-gpl, --enable-version3 or --enable-nonfree. The script
# reads the licence configure settled on and stops if it is anything else.
#
# FFmpeg's command-line tool needs threads, and the browser build has none, so only the libraries are
# built. native/rpm_media.c does what the tool does for a stream copy.
#
# Chromaprint is built with FFmpeg's own FFT and without its internal resampler, because
# native/rpm_chroma.cpp reads through the reader that fpcalc reads through. That reader does the
# resampling, with FFmpeg.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=tool-versions.txt
source "$SCRIPT_DIR/tool-versions.txt"

WORK="$REPO_ROOT/.build"
CLEAN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --work) WORK="$2"; shift 2 ;;
    --clean) CLEAN=1; shift ;;
    *) echo "build-media: unknown option $1" >&2; exit 1 ;;
  esac
done
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"

JOBS="$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu)"
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# --- Emscripten -------------------------------------------------------------------------------
if [ ! -d "$WORK/emsdk" ]; then
  git clone -q --depth 1 https://github.com/emscripten-core/emsdk.git "$WORK/emsdk"
fi
(cd "$WORK/emsdk" && ./emsdk install "$EMSCRIPTEN_VERSION" >/dev/null && ./emsdk activate "$EMSCRIPTEN_VERSION" >/dev/null)
# shellcheck disable=SC1091
source "$WORK/emsdk/emsdk_env.sh" >/dev/null 2>&1

# --- FFmpeg source ----------------------------------------------------------------------------
SRC="$WORK/src"
ARCHIVE="$SRC/ffmpeg-$FFMPEG_VERSION.tar.xz"
mkdir -p "$SRC"
if [ ! -f "$ARCHIVE" ]; then
  echo "build-media: downloading FFmpeg $FFMPEG_VERSION"
  curl -fsSL --retry 3 -o "$ARCHIVE.part" "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
  mv "$ARCHIVE.part" "$ARCHIVE"
fi
GOT="$(sha256 "$ARCHIVE")"
if [ "$GOT" != "$FFMPEG_SHA256" ]; then
  echo "build-media: the archive has sha256 $GOT, tool-versions.txt pins $FFMPEG_SHA256" >&2
  exit 1
fi

CHROMA_ARCHIVE="$SRC/chromaprint-$CHROMAPRINT_VERSION.tar.gz"
if [ ! -f "$CHROMA_ARCHIVE" ]; then
  echo "build-media: downloading Chromaprint $CHROMAPRINT_VERSION"
  curl -fsSL --retry 3 -o "$CHROMA_ARCHIVE.part" \
    "https://github.com/acoustid/chromaprint/releases/download/v$CHROMAPRINT_VERSION/chromaprint-$CHROMAPRINT_VERSION.tar.gz"
  mv "$CHROMA_ARCHIVE.part" "$CHROMA_ARCHIVE"
fi
GOT="$(sha256 "$CHROMA_ARCHIVE")"
if [ "$GOT" != "$CHROMAPRINT_SHA256" ]; then
  echo "build-media: the archive has sha256 $GOT, tool-versions.txt pins $CHROMAPRINT_SHA256" >&2
  exit 1
fi

# --- FFmpeg libraries -------------------------------------------------------------------------
BUILD="$WORK/ffmpeg-wasm"
PREFIX="$BUILD/prefix"
TREE="$BUILD/ffmpeg-$FFMPEG_VERSION"
[ "$CLEAN" = 1 ] && rm -rf "$BUILD"

# The containers the store holds, by the muxer ffmpeg chooses for each extension. The decoders cover
# what those containers carry. The two encoders are for the 128 rendition (AAC) and for playback
# output (FLAC).
DEMUXERS=aac,ac3,aiff,asf,eac3,flac,mov,mp3,ogg,wav,wv
MUXERS=adts,aiff,asf,flac,ipod,mp3,mp4,oga,ogg,opus,wav,wv
DECODERS=aac,aac_fixed,aac_latm,ac3,ac3_fixed,adpcm_ima_wav,adpcm_ms,alac,eac3,flac,mp1,mp1float,mp2,mp2float,mp3,mp3float
DECODERS=$DECODERS,opus,pcm_alaw,pcm_f32be,pcm_f32le,pcm_f64be,pcm_f64le,pcm_mulaw,pcm_s16be,pcm_s16le,pcm_s24be,pcm_s24le
DECODERS=$DECODERS,pcm_s32be,pcm_s32le,pcm_s8,pcm_u8,vorbis,wavpack,wmalossless,wmapro,wmav1,wmav2
ENCODERS=aac,flac
PARSERS=aac,aac_latm,ac3,flac,mpegaudio,opus,vorbis
BSFS=aac_adtstoasc

if [ ! -f "$PREFIX/lib/libavformat.a" ]; then
  mkdir -p "$BUILD"
  rm -rf "$TREE" "$PREFIX"
  tar -xJf "$ARCHIVE" -C "$BUILD"
  cd "$TREE"
  echo "build-media: configuring FFmpeg $FFMPEG_VERSION"
  emconfigure ./configure \
    --prefix="$PREFIX" \
    --target-os=none --arch=x86_32 --enable-cross-compile \
    --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc --ar=emar --ranlib=emranlib --nm=emnm \
    --disable-asm --disable-inline-asm --disable-x86asm --disable-runtime-cpudetect --disable-stripping \
    --disable-autodetect --disable-debug --disable-doc --disable-programs \
    --disable-pthreads --disable-w32threads --disable-os2threads \
    --disable-network --disable-avdevice --disable-avfilter --disable-swscale \
    --disable-everything \
    --enable-avformat --enable-avcodec --enable-swresample \
    --enable-protocol=file \
    --enable-zlib \
    --enable-demuxer="$DEMUXERS" \
    --enable-muxer="$MUXERS" \
    --enable-decoder="$DECODERS" \
    --enable-encoder="$ENCODERS" \
    --enable-parser="$PARSERS" \
    --enable-bsf="$BSFS" \
    --extra-cflags="-O3 -msimd128 -sUSE_ZLIB=1" \
    --extra-ldflags="-sUSE_ZLIB=1" \
    > "$BUILD/configure.log"

  # The licence is read from what configure wrote, not assumed from the flags above.
  LICENSE_LINE="$(grep -E '^#define FFMPEG_LICENSE ' config.h)"
  if [ "$LICENSE_LINE" != '#define FFMPEG_LICENSE "LGPL version 2.1 or later"' ]; then
    echo "build-media: configure settled on $LICENSE_LINE, not LGPL 2.1 or later" >&2
    exit 1
  fi

  echo "build-media: building FFmpeg"
  emmake make -j"$JOBS" >"$BUILD/make.log" 2>&1
  emmake make install >>"$BUILD/make.log" 2>&1
fi

# --- Chromaprint -------------------------------------------------------------------------------
CHROMA="$BUILD/chromaprint-$CHROMAPRINT_VERSION"
CHROMA_FLAGS=(-O3 -msimd128 -std=c++14 -DHAVE_CONFIG_H -DCHROMAPRINT_NODLL -I"$CHROMA" -I"$CHROMA/src" -I"$PREFIX/include")

if [ ! -f "$PREFIX/lib/libchromaprint.a" ]; then
  echo "build-media: building Chromaprint $CHROMAPRINT_VERSION"
  rm -rf "$CHROMA"
  tar -xzf "$CHROMA_ARCHIVE" -C "$BUILD"
  cat > "$CHROMA/config.h" <<'CONFIG'
#define HAVE_ROUND 1
#define HAVE_LRINTF 1
#define USE_SWRESAMPLE 1
#define USE_AVTX 1
CONFIG

  mkdir -p "$CHROMA/objects"
  for name in audio_processor chroma chroma_resampler chroma_filter spectrum fft fingerprinter image_builder \
              simhash silence_remover fingerprint_calculator fingerprint_compressor fingerprint_decompressor \
              fingerprinter_configuration fingerprint_matcher utils/base64 fft_lib_avtx chromaprint; do
    em++ "${CHROMA_FLAGS[@]}" -c "$CHROMA/src/$name.cpp" -o "$CHROMA/objects/$(basename "$name").o"
  done
  rm -f "$PREFIX/lib/libchromaprint.a"
  emar rcs "$PREFIX/lib/libchromaprint.a" "$CHROMA"/objects/*.o
fi

# --- The module -------------------------------------------------------------------------------
OUT="$REPO_ROOT/public/media"
mkdir -p "$OUT"
echo "build-media: compiling and linking"
emcc -O3 -msimd128 -sUSE_ZLIB=1 -I"$PREFIX/include" -c "$REPO_ROOT/native/rpm_media.c" -o "$BUILD/rpm_media.o"
em++ "${CHROMA_FLAGS[@]}" -I"$REPO_ROOT/native" -c "$REPO_ROOT/native/rpm_chroma.cpp" -o "$BUILD/rpm_chroma.o"
em++ -O3 -msimd128 -sUSE_ZLIB=1 \
  -L"$PREFIX/lib" \
  "$BUILD/rpm_media.o" "$BUILD/rpm_chroma.o" \
  -lchromaprint -lavformat -lavcodec -lswresample -lavutil \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createRpmMedia \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=1048576 \
  -sFORCE_FILESYSTEM=1 -lworkerfs.js -lnodefs.js \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_rpm_canonical,_rpm_last_error,_rm_open,_rm_duration,_rm_seek,_rm_read_pcm,_rm_close,_rm_encode,_rm_output_open,_rm_output_write,_rm_output_cut,_rm_output_drop,_rm_output_data,_rm_output_size,_rm_output_clear,_rm_output_close,_rm_fingerprint,_rm_fingerprint_text,_rm_fingerprint_raw,_rm_fingerprint_frames,_rm_fingerprint_seconds,_rm_fingerprint_close \
  -sEXPORTED_RUNTIME_METHODS=FS,ccall,cwrap,UTF8ToString,stringToNewUTF8,WORKERFS,NODEFS,HEAPU8,HEAPF32,HEAP32 \
  -o "$OUT/rpm-media.js"

ls -l "$OUT"

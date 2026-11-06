#!/usr/bin/env bash
#
# Adds the playback test page to the built site, at /proof/index.html. It needs the test albums, which
# proof/make-tracks.mjs writes with the native ffmpeg. The page reads the media module from /media.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$REPO_ROOT/dist/proof"
cp "$REPO_ROOT"/proof/index.html "$REPO_ROOT"/proof/proof.js "$REPO_ROOT"/proof/chain.js \
   "$REPO_ROOT"/proof/media-worker.js "$REPO_ROOT/dist/proof/"
cp -R "$REPO_ROOT/proof/tracks" "$REPO_ROOT/dist/proof/"

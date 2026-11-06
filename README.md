# rpm for the web

The web app of [rpm](https://rpmrpmrpm.com), a music player for your own music. You sign in, import
your music into your cloud library, and listen to it in a browser. It works on computers and phones.

## Build and run

You need Node.js 22 or later.

```
npm install
npm run media      # builds FFmpeg for the browser, once; it takes a few minutes
npm run dev
```

To reach the rpm API, make a developer key at
[rpmrpmrpm.com/developer](https://rpmrpmrpm.com/developer) and set `RPM_APP_KEY` in your environment
before `npm run dev`. The key stays in the dev server and never reaches the page. Without a key, the
pages that need the API say so.

Icons use Font Awesome Pro where `../rpm-fonts-pro` is checked out, and Font Awesome Free otherwise.

## Tests

```
npm test                # the logic
npm run check           # the types
npm run test:media      # the audio: hash parity and the joins between tracks
```

`npm run test:media` compares with the ffmpeg of the desktop app. It reads it from
`../rpm-desktop/RPM.Desktop/NativeLibs/tools/<rid>/`, or from `RPM_FFMPEG`.

## Licence

The code is under the [Mozilla Public License 2.0](LICENSE). FFmpeg is under the LGPL 2.1 or later,
and `scripts/build-media.sh` builds it from its published source. The name and logo of rpm are not
covered by the code licence: see [TRADEMARKS.md](TRADEMARKS.md).

# rpm-web

Notes for AI coding assistants (and people) working in this repo. Read CONTRIBUTING.md first; its
rules on UI text, comments and commit sign-off apply to every change.

## This repo

The web app of rpm: TypeScript and Svelte, with FFmpeg compiled to WebAssembly for audio. It talks to
the rpm API, as the phone apps do, and shares no code with them.

- Install: `npm install`. Build the media module once: `npm run media`.
- Run: `npm run dev`. Set `RPM_APP_KEY` to your developer key to reach the API.
- Test: `npm test` for the logic, `npm run test:media` for the audio, `npm run check` for the types.

## How the audio works

- `native/rpm_media.c` is FFmpeg's libraries with a small interface. It runs in a worker.
- The canonical copy (`rpm_canonical`) must give the same bytes as the desktop app's ffmpeg command,
  because the hash is the key of the blob in the store. `test/parity` proves this. Do not change
  that function without running it.
- The queue plays as one continuous stream into one `<audio>` element. Tracks are joined on samples
  and written as FLAC in fragmented MP4. A locked iPhone cannot start a new track, so nothing here
  may depend on starting one.

## Comments

Comments are read by contributors who have not seen the history of the code, and many of them do
not have English as a first language. Write for them.

- Say what the code does and why, as it is now. Keep warnings about traps.
- No history: no dates, no names, no quotes from a conversation, no "used to", "was", "until", and
  no notes about code that has been removed. That belongs in the commit message.
- Plain international English: short sentences, common words, no idioms. Use British spelling
  (colour, centre, catalogue, licence, behaviour). No em-dashes.
- Keep identifiers as they are. Use the code's own names for things.

## Do not

- Do not put UI text in the code. Add it to `strings.json` in the `rpm` repo and call `text('Key')`.
- Do not edit generated files (they say so in their first lines). Change the generator or its input.
- Do not add secrets, API keys or personal data to the repo. The bundle is public.
- Do not treat a failed call as an empty result. An error is not nothing.

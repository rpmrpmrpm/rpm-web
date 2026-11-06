// The key under which an album's cover is stored. It is derived, never assigned: the computer that
// uploads a cover and the phone that asks for it compute the same string. So the normalisation is a
// contract with every other rpm app. Changing it orphans every cover already stored.

import type { CloudTrack } from '../api/wire';

const blank = (value: string | null | undefined) => !value || value.trim().length === 0;
const normalize = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

// The first sixteen bytes of the SHA-256, as lower-case hex.
async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash).subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function coverKey(albumArtist: string | null | undefined, album: string | null | undefined): Promise<string> {
  return digest(`${normalize(albumArtist)}|${normalize(album)}`);
}

// A tag that is present but blank is not an album artist, so this is not ??.
export function coverKeyForTrack(
  albumArtist: string | null | undefined,
  artist: string | null | undefined,
  album: string | null | undefined,
): Promise<string> {
  return coverKey(blank(albumArtist) ? artist : albumArtist, album);
}

// Every key a whole record could be stored under, in the order found. It reads every track, because
// the tags of a record are not always the same on all of them: a cover is uploaded under the tags of
// whichever track the uploader held, so it can be stored under a form only the ninth track knows.
export async function coverSpellings(tracks: readonly CloudTrack[]): Promise<string[]> {
  const seen = new Set<string>();
  for (const track of tracks) {
    seen.add(await coverKeyForTrack(track.tags?.albumArtist, track.artist, track.album));
    seen.add(await coverKey(track.artist, track.album));
  }
  return [...seen];
}

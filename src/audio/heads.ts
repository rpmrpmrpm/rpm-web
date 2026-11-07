// The opening seconds of tracks, so that a key press has something to play before anything is signed. Asked for
// by the album or the queue, in one call for each fifty tracks, when they are about to be wanted. A clip is about
// 36 KB. They are held in memory, and the oldest go first.

import type { CloudClient } from '../api/cloud';

// The server's own limit. It refuses a longer list whole.
const MOST_AT_ONCE = 50;
const MOST_HELD = 200;

const bytesOf = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

export class HeadClips {
  private readonly clips = new Map<string, Uint8Array>();
  private readonly asked = new Set<string>();

  constructor(private readonly cloud: Pick<CloudClient, 'headClips'>) {}

  held(rpmId: string): Uint8Array | null {
    return this.clips.get(rpmId) ?? null;
  }

  private async read(rpmIds: string[]) {
    try {
      for (const { rpmId, audio } of await this.cloud.headClips(rpmIds)) {
        if (!audio) continue;
        this.clips.set(rpmId, bytesOf(audio));
        if (this.clips.size > MOST_HELD) this.clips.delete(this.clips.keys().next().value!);
      }
    } catch {
      // A track with no clip plays the ordinary way. These can be asked for again.
      for (const rpmId of rpmIds) this.asked.delete(rpmId);
    }
  }

  // Each track is asked about once, whether or not it had a clip: the store has been told to make one.
  warm(rpmIds: readonly string[]) {
    const wanted = rpmIds.filter((rpmId) => !this.asked.has(rpmId) && !this.clips.has(rpmId)).slice(0, MOST_AT_ONCE);
    if (!wanted.length) return;
    for (const rpmId of wanted) this.asked.add(rpmId);
    void this.read(wanted);
  }
}

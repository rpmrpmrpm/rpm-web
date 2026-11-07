// Recognise for tracks already in the cloud. The recogniser was made for files on this computer: it reads a
// fingerprint and a clip from a File. A cloud track has no file here, so each row is given a stand-in File,
// and the media below fetches the track's audio the first time the recogniser asks for it. The audio is
// fetched once per track, kept only for the run, and never stored.

import type { CloudClient } from '../api/cloud';
import type { CloudTrack } from '../api/wire';
import type { ImportMedia } from './media';

// The store's original copy, not a smaller rendition: a fingerprint read from a re-encoded copy can miss.
const ORIGINAL = 0;

export class CloudAudio implements Pick<ImportMedia, 'fingerprint' | 'clip'> {
  private readonly tracks = new Map<File, CloudTrack>();
  private readonly fetched = new Map<File, Promise<File>>();

  constructor(
    private readonly cloud: Pick<CloudClient, 'stream'>,
    private readonly media: Pick<ImportMedia, 'fingerprint' | 'clip'>,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  // A stand-in file for a track, named as the track's own file is named.
  standIn(track: CloudTrack): File {
    const name = track.relativePath?.split('/').pop() || `${track.title ?? track.rpmId}`;
    const file = new File([], name);
    this.tracks.set(file, track);
    return file;
  }

  private audio(standIn: File): Promise<File> {
    let held = this.fetched.get(standIn);
    if (!held) {
      const track = this.tracks.get(standIn);
      if (!track) return Promise.resolve(standIn);
      held = (async () => {
        const stream = await this.cloud.stream(track.rpmId, ORIGINAL);
        const answer = await this.fetcher(stream.url);
        if (!answer.ok) throw new Error('The audio could not be fetched.');
        return new File([await answer.blob()], standIn.name);
      })();
      held.catch(() => this.fetched.delete(standIn));
      this.fetched.set(standIn, held);
    }
    return held;
  }

  async fingerprint(file: File) {
    return this.media.fingerprint(await this.audio(file));
  }

  async clip(file: File, kilobits: number, start: number, seconds: number) {
    return this.media.clip(await this.audio(file), kilobits, start, seconds);
  }

  // The audio of a finished run is let go.
  forget() {
    this.fetched.clear();
    this.tracks.clear();
  }
}

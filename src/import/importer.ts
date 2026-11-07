// The upload sequence for one track, and the run over a queue. It follows CloudSyncService.Upload and
// RpmCloudClient.UploadAsync on the desktop. A track counts as imported when cloud/upload/complete has
// answered, and not before.

import { ApiError, type Api } from '../api/http';
import type { CloudQuota } from '../api/wire';
import { readQuota } from '../api/wire';
import { coverKeyForTrack, discKeyForTrack } from '../library/art-key';
import type { ImportMedia } from './media';
import { relativePath } from './naming';
import type { ImportQueue, ImportRow } from './queue';

const FREE_KILOBITS = 128;
const HEAD_KILOBITS = 96;
const HEAD_SECONDS = 3;
const HEAD_RATE = -1;
const MAX_COVER_BYTES = 12 * 1024 * 1024;
const TRIES = 3;

interface InitAnswer {
  status: 'upload' | 'challenge';
  sidecarUrl: string;
  blobUrl?: string;
  checksumSha256?: string;
  challengeId?: string;
  nonce?: string;
  ranges?: { offset: number; length: number }[];
}

export interface PutOptions {
  contentType: string;
  checksum?: string;
  onProgress?: (fraction: number) => void;
}

export interface Transfers {
  put(url: string, body: Uint8Array, options: PutOptions): Promise<void>;
}

// A PUT to a presigned address, with progress, which fetch cannot report for an upload.
export const browserTransfers: Transfers = {
  put(url, body, options) {
    return new Promise((done, fail) => {
      const request = new XMLHttpRequest();
      request.open('PUT', url);
      request.setRequestHeader('Content-Type', options.contentType);
      if (options.checksum) request.setRequestHeader('x-amz-checksum-sha256', options.checksum);
      request.upload.onprogress = (event) => options.onProgress?.(event.lengthComputable ? event.loaded / event.total : 0);
      request.onload = () => (request.status < 300 ? done() : fail(new ApiError(request.status, 'The store refused the upload.')));
      request.onerror = () => fail(new ApiError(0, 'The upload was interrupted.'));
      request.send(body as BufferSource);
    });
  },
};

// A failure that the same bytes would meet again, as CloudFailure.Classify decides from ffmpeg's words.
// Anything not recognised is not permanent: wrongly giving up loses a track, wrongly retrying costs a try.
export function classify(said: string): { key: string; permanent: boolean } {
  if (/Rematrix is needed|not enough information to do it|Invalid channel layout|channel layout is not supported/i.test(said)) {
    return { key: 'Cloud_FailChannels', permanent: true };
  }
  if (/Invalid data found|Error while decoding|could not find codec parameters|Decoder not found|Unknown decoder/i.test(said)) {
    return { key: 'Cloud_FailUnreadable', permanent: true };
  }
  if (/Could not find tag for codec|Could not write header|Output file does not contain/i.test(said)) {
    return { key: 'Cloud_FailTranscode', permanent: true };
  }
  return { key: 'Cloud_FailUnknown', permanent: false };
}

export class QuotaFull extends Error {}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 over the nonce and then the bytes of the range. Only someone who holds the file can answer,
// which is what stops the shared store from handing out music for knowing a hash.
export async function answerChallenge(bytes: Uint8Array, nonce: Uint8Array, ranges: readonly { offset: number; length: number }[]): Promise<string[]> {
  const answers: string[] = [];
  for (const { offset, length } of ranges) {
    if (offset < 0 || length <= 0 || offset + length > bytes.length) throw new Error('The range is outside the file.');
    const joined = new Uint8Array(nonce.length + length);
    joined.set(nonce);
    joined.set(bytes.subarray(offset, offset + length), nonce.length);
    answers.push(hex(await crypto.subtle.digest('SHA-256', joined)));
  }
  return answers;
}

export const base64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// The private half of a track: its tags, its art and its id. The names are TagSidecar's, because a
// desktop reads this to rebuild the file. A field with no value is left out, as the desktop does.
export function buildSidecar(row: ImportRow, rpmId: string, path: string, art: { bytes: Uint8Array; mime: string } | null) {
  const sidecar: Record<string, unknown> = { Version: 5, RelativePath: path, Extension: row.extension };
  for (const [field, value] of Object.entries(row.tags)) {
    if (value !== null && value !== undefined && value !== '' && value !== 0) sidecar[field] = value;
  }
  sidecar.RpmId = rpmId;
  if (art) {
    sidecar.Art = base64(art.bytes);
    sidecar.ArtMime = art.mime;
  }
  return sidecar;
}

// The catalogue fields of a track. complete writes these to the account's row.
export function catalogueTags(row: ImportRow) {
  const tags = row.tags;
  return {
    durationSeconds: tags.DurationSeconds ?? 0,
    trackNumber: tags.TrackNumber ?? 0,
    trackCount: tags.TrackCount ?? 0,
    discNumber: tags.DiscNumber ?? 0,
    discCount: tags.DiscCount ?? 0,
    year: tags.Year ?? 0,
    genre: tags.Genre ?? null,
    albumArtist: tags.AlbumArtist ?? null,
    extension: row.extension,
    channels: tags.Channels ?? 0,
    sampleRate: tags.SampleRate ?? 0,
    bitsPerSample: tags.BitsPerSample ?? 0,
    bitrateKbps: tags.BitrateKbps ?? 0,
    codecDescription: tags.CodecDescription ?? null,
    work: tags.Work ?? null,
    movementName: tags.MovementName ?? null,
    movementNumber: tags.MovementNumber ?? 0,
    composer: tags.Composers ?? null,
  };
}

// Only the types the server will sign for.
export const normalizeMime = (mime: string): string => (mime === 'image/png' || mime === 'image/webp' ? mime : 'image/jpeg');

export interface Holdings {
  // The id the account already stores this audio under, if any.
  idOf(sha256: string): string | undefined;
}

export class Importer {
  running = false;
  stopped = false;
  private quota: CloudQuota | null = null;
  private readonly coversDone = new Set<string>();
  private readonly discsDone = new Set<string>();

  constructor(
    private readonly api: Api,
    private readonly media: ImportMedia,
    private readonly transfers: Transfers,
    private readonly holdings: Holdings,
    private readonly queue: ImportQueue,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  private note(row: ImportRow, state: ImportRow['state'], note: string | null = null) {
    row.state = state;
    row.note = note;
    this.queue.changed();
  }

  private post<T>(path: string, body: unknown, read: (raw: unknown) => T = (raw) => raw as T): Promise<T> {
    return this.api.json(path, read, { method: 'POST', body });
  }

  // A valid GUID in the file's own tags is kept, so a file that came from a desktop stays the same track.
  private idFor(row: ImportRow): string {
    const own = row.tags.RpmId;
    return own && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(own) ? own.toLowerCase() : this.newId();
  }

  async coverOf(row: ImportRow): Promise<{ bytes: Uint8Array; mime: string } | null> {
    if (row.cover) return row.cover;
    if (row.hasArt) {
      const embedded = await this.media.art(row.file);
      if (embedded) return embedded;
    }
    const folder = row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : '';
    const file = this.queue.covers.get(folder);
    return file ? { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || 'image/jpeg' } : null;
  }

  // The album's cover, once per album per run. Best effort: a sleeve that will not upload never fails a
  // track that did.
  private async uploadCover(row: ImportRow, cover: { bytes: Uint8Array; mime: string } | null) {
    try {
      const key = await coverKeyForTrack(row.tags.AlbumArtist, row.tags.Artist, row.tags.Album);
      if (this.coversDone.has(key) || !cover || cover.bytes.length > MAX_COVER_BYTES) return;
      this.coversDone.add(key);
      const mime = normalizeMime(cover.mime);
      const slot = await this.post<{ url: string }>(`cloud/art/${key}?contentType=${encodeURIComponent(mime)}`, undefined);
      await this.transfers.put(slot.url, cover.bytes, { contentType: mime });
    } catch {
      // Best effort.
    }
  }

  // The disc label, by the same rules as the cover, under its own key.
  private async uploadDisc(row: ImportRow) {
    const disc = row.disc;
    if (!disc || disc.bytes.length > MAX_COVER_BYTES) return;
    try {
      const key = await discKeyForTrack(row.tags.AlbumArtist, row.tags.Artist, row.tags.Album);
      if (this.discsDone.has(key)) return;
      this.discsDone.add(key);
      const mime = normalizeMime(disc.mime);
      const slot = await this.post<{ url: string }>(`cloud/art/${key}?contentType=${encodeURIComponent(mime)}`, undefined);
      await this.transfers.put(slot.url, disc.bytes, { contentType: mime });
    } catch {
      // Best effort.
    }
  }

  private async sendRendition(rpmId: string, rate: number, bytes: Uint8Array) {
    const slot = await this.api.json(`cloud/rendition/${rpmId}/upload?rate=${rate}`, (raw) => raw as { url: string });
    await this.transfers.put(slot.url, bytes, { contentType: 'audio/mp4' });
    await this.api.call(`cloud/rendition/${rpmId}?rate=${rate}`, { method: 'POST' });
  }

  // The head clip and the 128 rung. The uploader makes these because it is not billed by the second. A
  // failure undoes nothing: the track is in the cloud, and the server's want list covers it.
  private async makeRenditions(row: ImportRow, rpmId: string) {
    try {
      const { head, rendition } = await this.media.renditions(row.file, FREE_KILOBITS, HEAD_KILOBITS, HEAD_SECONDS);
      await this.sendRendition(rpmId, HEAD_RATE, head);
      await this.sendRendition(rpmId, FREE_KILOBITS, rendition);
    } catch {
      // Best effort.
    }
  }

  // Levelling needs a measurement, and an account with no desktop has nothing else to make one. It is
  // written to the catalogue, so every app plays the track at the same level.
  private async measureLoudness(row: ImportRow, rpmId: string) {
    try {
      const reading = await this.media.loudness(row.file);
      if (reading) await this.post('cloud/catalog/tags', { items: [{ rpmId, tags: { loudnessLufs: reading.lufs, truePeak: reading.truePeak } }] });
    } catch {
      // Best effort. The track plays unlevelled until something measures it.
    }
  }

  private async importRow(row: ImportRow) {
    this.note(row, 'working', 'Web_ImportStagePreparing');
    const { bytes, sha256 } = await this.media.canonical(row.file, row.extension);

    if (this.quota && !this.quota.unlimited && this.quota.usedBytes + bytes.length > this.quota.quotaBytes) {
      throw new QuotaFull();
    }

    // The account may already hold this audio, from a desktop or an earlier run. Storing it again would
    // show the song twice on every screen and charge for it twice.
    const known = this.holdings.idOf(sha256);
    if (known) {
      const verdict = await this.post<{ files: { rpmId: string; ok: boolean }[] }>('cloud/verify', { rpmIds: [known] });
      if (verdict.files.some((file) => file.rpmId === known && file.ok)) {
        // A cover picked here is news even when the audio is not.
        if (row.cover) await this.uploadCover(row, row.cover);
        await this.uploadDisc(row);
        this.note(row, 'known', 'Web_ImportAlreadyThere');
        return;
      }
    }

    const rpmId = this.idFor(row);
    const path = relativePath(row.tags, row.file.name, row.extension);
    const cover = await this.coverOf(row);
    const sidecar = buildSidecar(row, rpmId, path, row.hasArt || row.cover ? cover : null);

    this.note(row, 'working', 'Web_ImportStageUploading');
    const init = await this.post<InitAnswer>('cloud/upload/init', {
      rpmId,
      sha256,
      canonicalSize: bytes.length,
      originalSize: row.file.size,
      extension: row.extension,
      title: row.tags.Title ?? null,
      artist: row.tags.Artist ?? null,
      album: row.tags.Album ?? null,
      relativePath: path,
    });

    await this.transfers.put(init.sidecarUrl, new TextEncoder().encode(JSON.stringify(sidecar)), { contentType: 'application/json' });

    if (init.status === 'challenge') {
      if (!init.challengeId || !init.nonce || !init.ranges) throw new Error('The upload challenge arrived incomplete.');
      const nonce = Uint8Array.from(atob(init.nonce), (c) => c.charCodeAt(0));
      await this.post('cloud/upload/prove', { challengeId: init.challengeId, answers: await answerChallenge(bytes, nonce, init.ranges) });
    } else {
      await this.transfers.put(init.blobUrl!, bytes, { contentType: 'application/octet-stream', checksum: init.checksumSha256 });
    }

    this.quota = await this.post('cloud/upload/complete', {
      rpmId,
      sha256,
      relativePath: path,
      title: row.tags.Title ?? null,
      artist: row.tags.Artist ?? null,
      album: row.tags.Album ?? null,
      tags: catalogueTags(row),
    }, readQuota);

    // From here the track is in the cloud, and nothing below can undo that.
    this.note(row, 'done');
    await this.uploadCover(row, cover);
    await this.uploadDisc(row);
    await this.makeRenditions(row, rpmId);
    await this.measureLoudness(row, rpmId);
  }

  private async withTries(row: ImportRow) {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.importRow(row);
        return;
      } catch (error) {
        if (error instanceof QuotaFull) throw error;
        if (error instanceof ApiError && (error.status === 402 || error.status === 413 || error.status === 507)) throw new QuotaFull();

        const { key, permanent } = classify(error instanceof Error ? error.message : String(error));
        if (permanent || attempt >= TRIES) {
          this.note(row, 'failed', key);
          return;
        }
      }
    }
  }

  // Works through the rows, a few at a time. Quota full stops the whole run: a track that does not fit
  // means the account has reached its limit.
  async run(rows: readonly ImportRow[], atOnce: number): Promise<'done' | 'full' | 'stopped'> {
    this.running = true;
    this.stopped = false;
    this.coversDone.clear();
    this.discsDone.clear();
    let full = false;

    for (const row of rows) this.note(row, 'waiting');

    try {
      this.quota = await this.api.json('cloud/quota', readQuota);
    } catch {
      this.quota = null;
    }

    const pending = [...rows];
    const lane = async () => {
      while (pending.length > 0 && !full && !this.stopped) {
        const row = pending.shift()!;
        try {
          await this.withTries(row);
        } catch {
          full = true;
          this.note(row, 'failed', 'Rpm_Error_StorageFull');
        }
      }
    };
    await Promise.all(Array.from({ length: atOnce }, lane));

    for (const row of pending) this.note(row, 'ready');
    this.running = false;
    return full ? 'full' : this.stopped ? 'stopped' : 'done';
  }

  stop() {
    this.stopped = true;
  }
}

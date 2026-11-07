// The playback chain: tracks go in, one continuous stream of FLAC in fragmented MP4 comes out. It runs
// in a worker in the browser and in Node in the tests, which is why it is plain JavaScript.
//
// The stream is continuous because the queue never starts a new track. A locked iPhone cannot call
// play(), so the next track is written into the stream that is already playing.

import { Equalizer } from './equalizer.js';

export const STREAM_RATE = 44100;

// A head clip is AAC in MP4, whatever the track it opens.
const HEAD_NAME = 'head.m4a';

// The two spellings of the same codec. Safari accepts only the first, Chrome and Firefox the second.
export const STREAM_TYPES = ['audio/mp4; codecs="fLaC"', 'audio/mp4; codecs="flac"'];

const SEEK_SET = 0;
const SEEK_CUR = 1;
const SEEK_END = 2;
const SOURCE_SIZE = 3;

// A source of bytes that keeps its own position, as FFmpeg's reader expects.
class PositionedSource {
  position = 0;

  seek(offset, whence) {
    if (whence === SOURCE_SIZE) return this.size;
    if (whence === SEEK_SET) this.position = offset;
    else if (whence === SEEK_CUR) this.position += offset;
    else if (whence === SEEK_END) this.position = this.size + offset;
    else return -1;
    return this.position;
  }
}

export class MemorySource extends PositionedSource {
  constructor(bytes) {
    super();
    this.bytes = bytes;
    this.size = bytes.length;
  }

  read(view) {
    const part = this.bytes.subarray(this.position, this.position + view.length);
    view.set(part);
    this.position += part.length;
    return part.length;
  }
}

// A File, read in a worker. FileReaderSync reads only the part asked for, so a large file is never
// held in memory.
export class FileSource extends PositionedSource {
  constructor(file) {
    super();
    this.file = file;
    this.size = file.size;
    this.reader = new FileReaderSync();
  }

  read(view) {
    const part = this.file.slice(this.position, this.position + view.length);
    const bytes = new Uint8Array(this.reader.readAsArrayBuffer(part));
    view.set(bytes);
    this.position += bytes.length;
    return bytes.length;
  }
}

// A URL read by range in a worker. The request blocks the worker and nothing else. Blocks are kept so
// the small reads and seeks of a demuxer do not each cost a request.
export class UrlSource extends PositionedSource {
  static BLOCK = 256 * 1024;
  static BLOCKS_KEPT = 16;

  blocks = new Map();

  constructor(url) {
    super();
    this.url = url;
    const first = this.block(0);
    this.size = first.total;
  }

  block(index) {
    const known = this.blocks.get(index);
    if (known) return known;

    // A server that answers without ranges sent everything in the first answer. This is a live
    // transcode, which ends when the encode ends.
    if (this.whole) return this.whole;

    const start = index * UrlSource.BLOCK;
    const request = new XMLHttpRequest();
    request.open('GET', this.url, false);
    request.responseType = 'arraybuffer';
    request.setRequestHeader('Range', `bytes=${start}-${start + UrlSource.BLOCK - 1}`);
    request.send();
    if (request.status !== 206 && request.status !== 200) throw new Error(`HTTP ${request.status}`);

    const range = request.getResponseHeader('Content-Range');
    const bytes = new Uint8Array(request.response);
    const block = { bytes, total: range ? Number(range.split('/')[1]) : bytes.length };

    if (!range) {
      this.whole = block;
      return block;
    }

    if (this.blocks.size >= UrlSource.BLOCKS_KEPT) this.blocks.delete(this.blocks.keys().next().value);
    this.blocks.set(index, block);
    return block;
  }

  read(view) {
    if (this.position >= this.size) return 0;
    const index = this.whole ? 0 : Math.floor(this.position / UrlSource.BLOCK);
    const offset = this.position - index * (this.whole ? 0 : UrlSource.BLOCK);
    const part = this.block(index).bytes.subarray(offset, offset + view.length);
    view.set(part);
    this.position += part.length;
    return part.length;
  }
}

// What the module's reader calls. Sources are held by number, because a number is what C can keep.
class SourceTable {
  sources = new Map();
  next = 1;

  add(source) {
    const id = this.next++;
    this.sources.set(id, source);
    return id;
  }

  remove(id) {
    this.sources.delete(id);
  }

  // A failure is an answer to C. An exception must not pass through compiled code.
  read(id, view) {
    try {
      return this.sources.get(id).read(view);
    } catch {
      return -1;
    }
  }

  seek(id, offset, whence) {
    return this.sources.get(id).seek(offset, whence);
  }
}

export class Chain {
  // track: { id, name, source or makeSource, gain, startAt, head }. gain is the levelling, as a factor.
  // startAt is where to begin, in seconds, for a track that is opened again after a failure. head is the
  // bytes of the track's head clip, which plays while the real source is on its way: source or makeSource
  // may then come later, through join.
  queue = [];
  current = null;
  framesWritten = 0;
  // Where each track starts in the stream: { id, name, at, offset, duration }. Stream time at is track
  // time offset.
  boundaries = [];
  // Tracks that could not be played: { id, name, said, at }. at is how far into the track it got.
  failures = [];

  constructor(media) {
    this.equalizer = new Equalizer(STREAM_RATE);
    this.media = media;
    this.table = new SourceTable();
    media.rmSources = this.table;
    this.output = media._rm_output_open(STREAM_RATE);
    if (!this.output) throw new Error(this.lastError());
  }

  lastError() {
    return this.media.UTF8ToString(this.media._rpm_last_error());
  }

  add(track) {
    this.queue.push(track);
  }

  // Bytes made since the last call: the init segment first, then whole fragments.
  take() {
    const { media, output } = this;
    const size = media._rm_output_size(output);
    const pointer = media._rm_output_data(output);
    const bytes = media.HEAPU8.slice(pointer, pointer + size);
    media._rm_output_clear(output);
    return bytes;
  }

  // A source and a decoder for it. Null when it cannot be read, with the failure written down.
  openDecoder(track, name, makeSource, at) {
    const { media } = this;
    let sourceId;
    try {
      // A remote track is only touched when it is reached, not when it joins the queue.
      sourceId = this.table.add(makeSource());
    } catch (error) {
      this.failures.push({ id: track.id, name: track.name, said: String(error), at });
      return null;
    }
    const text = media.stringToNewUTF8(name);
    const decoder = media._rm_open(sourceId, text, STREAM_RATE);
    media._free(text);
    if (!decoder) {
      this.failures.push({ id: track.id, name: track.name, said: this.lastError(), at });
      this.table.remove(sourceId);
      return null;
    }
    return { sourceId, decoder };
  }

  open(track) {
    const onHead = !!track.head && !track.startAt;
    const opened = onHead
      ? this.openDecoder(track, HEAD_NAME, () => new MemorySource(track.head), 0)
      : this.openDecoder(track, track.name, () => track.source ?? track.makeSource(), track.startAt ?? 0);
    if (!opened) return null;
    if (track.startAt) this.media._rm_seek(opened.decoder, track.startAt);
    return { ...track, ...opened, onHead, offset: track.startAt ?? 0, framesRead: 0 };
  }

  // Says where the rest of a track comes from, once it has been signed. Stale for a track already gone.
  join(id, makeSource) {
    const entry = this.current?.id === id ? this.current : this.queue.find((track) => track.id === id);
    if (entry) entry.makeSource = makeSource;
  }

  // The head clip ran dry. The real source takes over, and what the clip actually played is discarded from it,
  // so the join falls on the same sample of the same recording. Decoded and dropped, not sought: a seek lands on
  // a packet, and these two sources do not share any.
  joinBehind(pointer, chunk) {
    const { media, current } = this;
    if (!current.source && !current.makeSource) return 'waiting';

    media._rm_close(current.decoder);
    this.table.remove(current.sourceId);
    const played = current.framesRead / STREAM_RATE;
    const opened = this.openDecoder(current, current.name, () => current.source ?? current.makeSource(), played);
    if (!opened) {
      this.current = null;
      return 'failed';
    }
    Object.assign(current, opened, { onHead: false });

    let left = current.framesRead;
    while (left > 0) {
      const got = media._rm_read_pcm(current.decoder, pointer, Math.min(chunk, left));
      if (got < 0) {
        this.failures.push({ id: current.id, name: current.name, said: this.lastError(), at: played });
        this.closeCurrent();
        return 'failed';
      }
      if (got === 0) break;
      left -= got;
    }

    // The clip's own length said nothing about the track's.
    this.boundaries.push({
      id: current.id,
      name: current.name,
      at: this.framesWritten / STREAM_RATE,
      offset: current.offset + played,
      duration: media._rm_duration(current.decoder),
    });
    return 'joined';
  }

  closeCurrent() {
    if (!this.current) return;
    this.media._rm_close(this.current.decoder);
    this.table.remove(this.current.sourceId);
    this.current = null;
  }

  // Adds a track ahead of the rest of the queue: one that is opened again after a failure.
  addFirst(track) {
    this.queue.unshift(track);
  }

  // The next track that opens, or null when none did: the queue is empty, or a track failed.
  advance() {
    this.closeCurrent();
    const track = this.queue.shift();
    if (!track) return null;

    this.current = this.open(track);
    if (!this.current) return null;

    this.boundaries.push({
      id: track.id,
      name: track.name,
      at: this.framesWritten / STREAM_RATE,
      offset: this.current.offset,
      duration: this.media._rm_duration(this.current.decoder),
    });
    return this.current;
  }

  // Stops the current track and forgets the queue. What is added next starts on a new block, with
  // nothing of the old tracks left in the output. The bytes already made are the caller's to remove
  // from the buffer.
  stop() {
    this.closeCurrent();
    this.queue = [];
    this.media._rm_output_drop(this.output);
  }

  // Moves the current track to a position. The stream's clock keeps running, so this is a new entry
  // in the boundaries: stream time at, which is track time offset.
  seekCurrent(seconds) {
    const ret = this.media._rm_seek(this.current.decoder, seconds);
    if (ret < 0) throw new Error(this.lastError());
    this.media._rm_output_drop(this.output);
    this.current.offset = seconds;
    this.boundaries.push({
      id: this.current.id,
      name: this.current.name,
      at: this.framesWritten / STREAM_RATE,
      offset: seconds,
      duration: this.media._rm_duration(this.current.decoder),
    });
  }

  // Makes up to the given number of seconds of stream. Returns the bytes, and drained when the queue
  // ran out. Drained is not the end of the stream: the next track may still be on its way. finish()
  // says there is nothing more. A failure stops here with failed set, so the caller can open the same
  // track again and the sound carries on from the same sample. Calling again moves on instead.
  render(seconds) {
    const { media, output } = this;
    const wanted = Math.round(seconds * STREAM_RATE);
    const chunk = 4096;
    const pointer = media._malloc(chunk * 8);
    const failuresBefore = this.failures.length;
    let made = 0;
    let drained = false;
    let waiting = false;

    try {
      while (made < wanted) {
        if (!this.current && !this.advance()) {
          drained = this.failures.length === failuresBefore;
          break;
        }

        const got = media._rm_read_pcm(this.current.decoder, pointer, Math.min(chunk, wanted - made));
        if (got === 0) {
          if (!this.current.onHead) {
            this.closeCurrent();
            continue;
          }
          const joined = this.joinBehind(pointer, chunk);
          if (joined === 'joined') continue;
          waiting = joined === 'waiting';
          break;
        }
        if (got < 0) {
          const at = this.current.offset + this.current.framesRead / STREAM_RATE;
          this.failures.push({ id: this.current.id, name: this.current.name, said: this.lastError(), at });
          this.closeCurrent();
          break;
        }

        const samples = media.HEAPF32.subarray(pointer >> 2, (pointer >> 2) + got * 2);
        if (this.current.gain !== undefined && this.current.gain !== 1) {
          for (let i = 0; i < samples.length; i++) samples[i] *= this.current.gain;
        }
        this.equalizer.process(samples);

        const ret = media._rm_output_write(output, pointer, got);
        if (ret < 0) throw new Error(this.lastError());
        made += got;
        this.current.framesRead += got;
        this.framesWritten += got;
      }
    } finally {
      media._free(pointer);
    }

    const ret = media._rm_output_cut(output, 0);
    if (ret < 0) throw new Error(this.lastError());
    return { bytes: this.take(), drained, waiting, failed: this.failures.length > failuresBefore };
  }

  // The queue has ended. Writes the last short block.
  finish() {
    const ret = this.media._rm_output_cut(this.output, 1);
    if (ret < 0) throw new Error(this.lastError());
    return this.take();
  }

  close() {
    this.closeCurrent();
    this.media._rm_output_close(this.output);
    this.output = 0;
  }
}

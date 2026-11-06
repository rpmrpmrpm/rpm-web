// The playback chain: tracks go in, one continuous stream of FLAC in fragmented MP4 comes out. It runs
// in a worker in the browser and in Node in the tests.
//
// The stream is continuous because the queue never starts a new track. A locked iPhone cannot call
// play(), so the next track is written into the stream that is already playing.

export const STREAM_RATE = 44100;

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

    if (this.blocks.size >= UrlSource.BLOCKS_KEPT) this.blocks.delete(this.blocks.keys().next().value);
    this.blocks.set(index, block);
    return block;
  }

  read(view) {
    if (this.position >= this.size) return 0;
    const index = Math.floor(this.position / UrlSource.BLOCK);
    const offset = this.position - index * UrlSource.BLOCK;
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

  read(id, view) {
    return this.sources.get(id).read(view);
  }

  seek(id, offset, whence) {
    return this.sources.get(id).seek(offset, whence);
  }
}

export class Chain {
  // track: { name, source, gain }. gain is the levelling, as a factor.
  queue = [];
  current = null;
  framesWritten = 0;
  // Where each track starts in the stream, in seconds.
  boundaries = [];
  // Tracks that could not be played, with the words FFmpeg gave.
  failures = [];

  constructor(media) {
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

  open(track) {
    let id;
    try {
      // A remote track is only touched when it is reached, not when it joins the queue.
      id = this.table.add(track.source ?? track.makeSource());
    } catch (error) {
      this.failures.push({ name: track.name, said: String(error) });
      return null;
    }
    const name = this.media.stringToNewUTF8(track.name);
    const decoder = this.media._rm_open(id, name, STREAM_RATE);
    this.media._free(name);
    if (!decoder) {
      this.failures.push({ name: track.name, said: this.lastError() });
      this.table.remove(id);
      return null;
    }
    return { ...track, id, decoder };
  }

  closeCurrent() {
    if (!this.current) return;
    this.media._rm_close(this.current.decoder);
    this.table.remove(this.current.id);
    this.current = null;
  }

  // The next track that opens, or null when the queue has ended.
  advance() {
    this.closeCurrent();
    while (this.queue.length > 0) {
      const track = this.queue.shift();
      this.current = this.open(track);
      if (this.current) {
        this.boundaries.push({ name: track.name, at: this.framesWritten / STREAM_RATE });
        return this.current;
      }
    }
    return null;
  }

  // Stops the current track where it is. What the caller does next starts on a new block, with nothing
  // of this track left in the output. The bytes already made are the caller's to remove from the
  // buffer.
  stopCurrent() {
    this.closeCurrent();
    this.media._rm_output_drop(this.output);
  }

  // Moves the current track to a position. The stream's clock keeps running, so this is a new entry
  // in the boundaries: stream time at, which is track time offset.
  seekCurrent(seconds) {
    const ret = this.media._rm_seek(this.current.decoder, seconds);
    if (ret < 0) throw new Error(this.lastError());
    this.media._rm_output_drop(this.output);
    this.boundaries.push({ name: this.current.name, at: this.framesWritten / STREAM_RATE, offset: seconds });
  }

  // Makes up to the given number of seconds of stream. Returns the bytes, and whether the queue ended.
  render(seconds) {
    const { media, output } = this;
    const wanted = Math.round(seconds * STREAM_RATE);
    const chunk = 4096;
    const pointer = media._malloc(chunk * 8);
    let made = 0;
    let ended = false;

    try {
      while (made < wanted) {
        if (!this.current && !this.advance()) {
          ended = true;
          break;
        }

        const got = media._rm_read_pcm(this.current.decoder, pointer, Math.min(chunk, wanted - made));
        if (got === 0) {
          this.closeCurrent();
          continue;
        }
        if (got < 0) {
          this.failures.push({ name: this.current.name, said: this.lastError() });
          this.closeCurrent();
          continue;
        }

        if (this.current.gain !== undefined && this.current.gain !== 1) {
          const samples = media.HEAPF32.subarray(pointer >> 2, (pointer >> 2) + got * 2);
          for (let i = 0; i < samples.length; i++) samples[i] *= this.current.gain;
        }

        const ret = media._rm_output_write(output, pointer, got);
        if (ret < 0) throw new Error(this.lastError());
        made += got;
        this.framesWritten += got;
      }
    } finally {
      media._free(pointer);
    }

    const ret = media._rm_output_cut(output, ended ? 1 : 0);
    if (ret < 0) throw new Error(this.lastError());
    return { bytes: this.take(), ended };
  }

  close() {
    this.closeCurrent();
    this.media._rm_output_close(this.output);
    this.output = 0;
  }
}

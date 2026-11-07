import { describe, expect, it } from 'vitest';

import { cueAudioName, isAlbumFile, type FileFacts } from '../../src/import/album-file';
import { ImportQueue, type ImportRow, type PickedFile } from '../../src/import/queue';

const MINUTE = 60;
const facts = (changes: Partial<FileFacts>): FileFacts => ({ stem: 'rip', seconds: 0, trackNumber: 0, trackCount: 0, folderFiles: 1, hasCue: false, ...changes });

describe('a whole album in one file', () => {
  it('is a very long file', () => {
    expect(isAlbumFile(facts({ seconds: 45 * MINUTE }))).toBe(true);
  });

  it('is not a normal track', () => {
    expect(isAlbumFile(facts({ seconds: 4 * MINUTE }))).toBe(false);
  });

  it('is not decided by the file name alone', () => {
    expect(isAlbumFile(facts({ stem: 'Pink Floyd Full Album', seconds: 4 * MINUTE }))).toBe(false);
  });

  it('is a named side, once it runs long enough', () => {
    expect(isAlbumFile(facts({ stem: 'Abbey Road - Side A', seconds: 5 * MINUTE }))).toBe(false);
    expect(isAlbumFile(facts({ stem: 'Abbey Road - Side A', seconds: 12 * MINUTE }))).toBe(true);
  });

  it('is not the long song among an album of tracks', () => {
    expect(isAlbumFile(facts({ stem: '08 The Long One', seconds: 25 * MINUTE, folderFiles: 8 }))).toBe(false);
  });

  it('is a long file alone in its folder', () => {
    expect(isAlbumFile(facts({ seconds: 22 * MINUTE }))).toBe(true);
  });

  it('is not a long file with some company', () => {
    expect(isAlbumFile(facts({ seconds: 22 * MINUTE, folderFiles: 3 }))).toBe(false);
  });

  it('is not a file that says which track it is', () => {
    expect(isAlbumFile(facts({ seconds: 50 * MINUTE, trackNumber: 4 }))).toBe(false);
    expect(isAlbumFile(facts({ seconds: 50 * MINUTE, trackNumber: 1, trackCount: 12 }))).toBe(false);
    expect(isAlbumFile(facts({ seconds: 50 * MINUTE, trackNumber: 1 }))).toBe(true);
  });

  it('is whatever a cue sheet describes, whatever else is true', () => {
    expect(isAlbumFile(facts({ seconds: 6 * MINUTE, trackNumber: 3, trackCount: 12, folderFiles: 8, hasCue: true }))).toBe(true);
  });
});

describe('a cue sheet', () => {
  it('names its file', () => {
    expect(cueAudioName('PERFORMER "A"\nFILE "rip.flac" WAVE\nTRACK 01 AUDIO')).toBe('rip.flac');
  });

  it('names a file without quotes', () => {
    expect(cueAudioName('file rip.flac WAVE\r\n')).toBe('rip.flac');
  });

  it('names only the first file', () => {
    expect(cueAudioName('FILE "one.flac" WAVE\nFILE "two.flac" WAVE')).toBe('one.flac');
  });

  it('may name nothing', () => {
    expect(cueAudioName('TRACK 01 AUDIO')).toBeNull();
  });
});

describe('the queue', () => {
  const picked = (path: string, text = 'x'): PickedFile => ({ file: new File([text], path.split('/').pop()!), path });

  function ready(queue: ImportQueue, seconds: number, ...files: PickedFile[]): ImportRow[] {
    const rows = queue.add(files);
    for (const row of rows) queue.read(row, { DurationSeconds: seconds }, false);
    return rows;
  }

  const settled = () => new Promise((done) => setTimeout(done));

  it('marks a long file alone in its folder', () => {
    const queue = new ImportQueue();
    const [row] = ready(queue, 50 * MINUTE, picked('Rip/album.flac'));
    expect(queue.albumFiles().has(row!)).toBe(true);
  });

  it('counts the audio beside a file by its folder', () => {
    const queue = new ImportQueue();
    const rows = ready(queue, 25 * MINUTE, ...['1', '2', '3', '4', '5'].map((name) => picked(`Prog/${name}.flac`)), picked('Other/alone.flac'));
    const marked = queue.albumFiles();
    expect(rows.filter((row) => marked.has(row)).map((row) => row.path)).toEqual(['Other/alone.flac']);
  });

  it('does not mark a row before its file has been read', () => {
    const queue = new ImportQueue();
    const [row] = queue.add([picked('Rip/album.flac')]);
    expect(queue.albumFiles().has(row!)).toBe(false);
  });

  it('does not mark a row that has gone up', () => {
    const queue = new ImportQueue();
    const [row] = ready(queue, 50 * MINUTE, picked('Rip/album.flac'));
    row!.state = 'done';
    expect(queue.albumFiles().has(row!)).toBe(false);
  });

  it('takes a cue sheet of the same name, however short the file', () => {
    const queue = new ImportQueue();
    queue.add([picked('Rip/album.cue')]);
    const [row] = ready(queue, 6 * MINUTE, picked('Rip/album.flac'));
    expect(queue.albumFiles().has(row!)).toBe(true);
  });

  it('takes the folder\'s only cue sheet when it names the file', async () => {
    const queue = new ImportQueue();
    queue.add([picked('Rip/different.cue', 'FILE "rip.flac" WAVE')]);
    const [row] = ready(queue, 6 * MINUTE, picked('Rip/rip.flac'));
    await settled();
    expect(queue.albumFiles().has(row!)).toBe(true);
  });

  it('ignores a cue sheet that names another file', async () => {
    const queue = new ImportQueue();
    queue.add([picked('Rip/other.cue', 'FILE "other.flac" WAVE')]);
    const [row] = ready(queue, 6 * MINUTE, picked('Rip/rip.flac'));
    await settled();
    expect(queue.albumFiles().has(row!)).toBe(false);
  });

  it('never makes a row of a cue sheet', () => {
    const queue = new ImportQueue();
    expect(queue.add([picked('Rip/album.cue')])).toEqual([]);
  });
});

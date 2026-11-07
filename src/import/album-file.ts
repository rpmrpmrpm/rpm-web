// Whether a file is probably a whole album or record in one file. The web app does not split, so this only
// decides whether to say that the desktop app can. These are the rules of AlbumFileDetector: length alone is
// not enough, because a twenty-three minute song is a song.

const LONG_SECONDS = 20 * 60;
const LONE_SECONDS = 45 * 60;
const NAMED_SECONDS = 8 * 60;
const ALBUM_SIBLINGS = 5;

const NAMED = /full\s*album|side\s*[ab12]\b|vinyl\s*rip|whole\s*(cd|album|record)|complete\s*album/i;

export interface FileFacts {
  // The file name, without its extension.
  stem: string;
  seconds: number;
  trackNumber: number;
  trackCount: number;
  // Audio files in its folder, this one included.
  folderFiles: number;
  hasCue: boolean;
}

export function isAlbumFile({ stem, seconds, trackNumber, trackCount, folderFiles, hasCue }: FileFacts): boolean {
  // A cue sheet is the track list of the file it names, so nothing is left to guess.
  if (hasCue) return true;

  // The tags say which track of a record it is. Track 1 of nothing is what a tagger writes on a whole side.
  if (trackNumber >= 2 || trackCount >= 3) return false;

  // The long song on somebody's album.
  if (folderFiles >= ALBUM_SIBLINGS) return false;

  return (
    (NAMED.test(stem) && seconds >= NAMED_SECONDS) ||
    seconds >= LONE_SECONDS ||
    // Long, and nearly alone in its folder: one file, or the two sides of a record.
    (seconds >= LONG_SECONDS && folderFiles <= 2)
  );
}

// The audio file a cue sheet names: its first FILE line. A sheet with one FILE per track is not a single
// album file, and it still names only the first.
export function cueAudioName(text: string): string | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!/^FILE\s/i.test(line)) continue;
    return /"([^"]*)"/.exec(line)?.[1] ?? line.split(/\s+/)[1] ?? null;
  }
  return null;
}

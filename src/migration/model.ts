// What a reader finds in another music app's library. The same shapes as RPM.Core/Migration on the
// desktop, field by field, so both apps import a library the same way.

export type SourceKind = 'musicbee' | 'itunes' | 'jellyfin' | 'plex' | 'navidrome' | 'playlistfiles' | 'ibroadcast';

// Where a track's audio is: a file on the person's computer, or a file on a media server.
export type LocalFile = { kind: 'local'; path: string };
export type RemoteFile = { kind: 'remote'; key: string; extension: string; size: number };
export type SourceFile = LocalFile | RemoteFile;

export interface SourceTrack {
  sourceId: string;
  file: SourceFile;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNumber: number;
  discNumber: number;
  year: number; // 0 when the app does not say
  genre: string; // '' when the app does not say
  durationSeconds: number;
  sizeBytes: number;
  rating: number; // 0 to 10 (half stars), 0 = not rated
  favorite: boolean;
  plays: number;
  lastPlayed: Date | null;
  added: Date | null;
}

export interface SourcePlaylist {
  sourceId: string;
  name: string;
  folder: string[]; // outermost first
  smart: boolean;
  trackIds: string[]; // in order, with repeats
  unresolved: string[];
}

export interface SourceSkip {
  what: string;
  reasonKey: string;
}

export interface SourceLibrary {
  kind: SourceKind;
  libraryId: string;
  name: string;
  tracks: SourceTrack[];
  playlists: SourcePlaylist[];
  skipped: SourceSkip[];
}

// Whose tags a track gets when the file's tags and the other app's tags differ. 'file': the file's tags stay
// and the other app only fills tags the file does not have, for apps that read their tags from the file.
// 'source': the other app's tags replace the file's wherever it gives a value, for an app that keeps edited
// tags apart from the file it stores (iBroadcast). It is SourceLibrary.Tags of the desktop app.
export type TagRule = 'file' | 'source';

export function tagRule(kind: SourceKind): TagRule {
  switch (kind) {
    case 'ibroadcast':
      return 'source';
    case 'musicbee':
    case 'itunes':
    case 'jellyfin':
    case 'plex':
    case 'navidrome':
    case 'playlistfiles':
      return 'file';
    default: {
      const unknown: never = kind;
      throw new Error(`A source kind with no tag rule: ${String(unknown)}`);
    }
  }
}

// The device a source library's plays are stored under: one per library, so a second import replaces
// its plays instead of adding them again.
export const deviceId = (library: SourceLibrary): string => `import:${library.kind}:${library.libraryId}`;

export const SkipReason = {
  NotAFile: 'Migration_SkipNotAFile',
  NotOnThisComputer: 'Migration_SkipNotOnThisComputer',
  NotMusic: 'Migration_SkipNotMusic',
} as const;

// Lower-case hex SHA-256 of the text, the first 16 characters: the id of a library that has none of its
// own (a MusicBee music folder, a Navidrome server and user).
export async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// An ISO 8601 date, or null. Servers write up to nine digits after the second; the digits after the
// third are dropped first.
export function isoDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const at = new Date(text.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(at.getTime()) ? null : at;
}

// "Artist - Title", or the title alone.
export const what = (artist: string, title: string): string => (artist ? `${artist} - ${title}` : title);

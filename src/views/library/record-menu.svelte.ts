// What a record and a song offer, on a right click and behind the small key beside them. The same menu on the same
// thing in every view, as AlbumMenuFactory and TrackMenuFactory on the desktop. What needs a file on this computer
// (the folder, the disc, the local copy) and what is not built here (the DJ, reviews, sharing) is left out, rather
// than shown greyed for good.

import { favorites, player, playlists } from '../../app';
import type { CloudTrack } from '../../api/wire';
import { icons } from '../../design/icons';
import type { CloudAlbum } from '../../library/albums';
import { foldersIn, type CloudPlaylist } from '../../library/playlists';
import { text } from '../../strings/loc';
import type { MenuEntry, MenuItem } from '../menu/menu.svelte';
import { openMenu, tidy } from '../menu/menu.svelte';

class Asked {
  adding = $state.raw<readonly CloudTrack[] | null>(null);
  editing = $state.raw<{ tracks: readonly CloudTrack[]; album: CloudAlbum | null } | null>(null);
  deleting = $state.raw<{ tracks: readonly CloudTrack[]; name: string; wholeAlbum: boolean } | null>(null);
  opening = $state.raw<CloudAlbum | null>(null);
}

export const asked = new Asked();

let known: CloudPlaylist[] = [];

// Asked for again each time, because another device may have changed the list. A menu that opens before the answer
// has the list from last time.
function readPlaylists() {
  void playlists.list().then(
    (list) => (known = list),
    () => {},
  );
}

const filed = (list: readonly CloudPlaylist[]) => [...list].sort((a, b) => [...a.folder, a.name].join('\u0000').localeCompare([...b.folder, b.name].join('\u0000')));

function playlistRows(tracks: readonly CloudTrack[]): MenuEntry[] {
  const ids = tracks.map((track) => track.rpmId);
  return filed(known).map((playlist) => ({
    label: '  '.repeat(playlist.folder.length) + playlist.name,
    run: () => void playlists.add(playlist.playlistId, ids),
  }));
}

function toPlaylist(tracks: readonly CloudTrack[], label: string, nowPlaying: boolean): MenuItem {
  return {
    label,
    glyph: icons.playlist,
    get items() {
      const rows = playlistRows(tracks);
      return tidy([
        ...(nowPlaying ? [{ label: text('AlbumMenu_PlaylistNowPlaying'), glyph: icons.play, run: () => player.addToQueue(tracks) }] : []),
        'rule',
        ...rows,
        'rule',
        { label: text('Playlists_NewPlaylistFrom'), glyph: icons.plus, run: () => (asked.adding = tracks) },
      ] as MenuEntry[]);
    },
  };
}

export async function albumMenu(album: CloudAlbum, place: 'collection' | 'page'): Promise<MenuEntry[]> {
  readPlaylists();
  const tracks = album.tracks;
  const loved = await favorites.isAlbumMarked(album);
  return [
    toPlaylist(tracks, text('AlbumMenu_AddToPlaylist'), true),
    'rule',
    { label: text('AlbumMenu_Play'), glyph: icons.play, run: () => player.play(tracks, 0) },
    {
      label: text('AlbumMenu_Shuffle'),
      glyph: icons.shuffle,
      run: () => {
        player.play(tracks, 0, { inAlbumOrder: false });
        player.toggleShuffle();
      },
    },
    { label: text('AlbumMenu_PlayNext'), glyph: icons.playNext, run: () => player.playNext(tracks) },
    'rule',
    ...(place === 'collection' ? [{ label: text('AlbumMenu_AlbumPage'), glyph: icons.album, run: () => (asked.opening = album) }] : []),
    { label: text('AlbumMenu_EditAlbum'), glyph: icons.pen, run: () => (asked.editing = { tracks, album }) },
    { label: text('AlbumMenu_Favorite'), glyph: icons.heart, outline: !loved, run: () => void favorites.markAlbum(album, !loved) },
    'rule',
    { label: text('Delete_Cloud'), glyph: icons.trash, run: () => (asked.deleting = { tracks, name: album.album, wholeAlbum: true }) },
  ];
}

// list and index say where the song stands, so Play carries on through what is shown around it.
export function trackMenu(track: CloudTrack, list: readonly CloudTrack[], index: number, options: { inAlbumOrder: boolean; album?: CloudAlbum } = { inAlbumOrder: true }): MenuEntry[] {
  readPlaylists();
  const on = favorites.marks.isMarked(track.rpmId);
  return [
    { label: text('AlbumMenu_Play'), glyph: icons.play, run: () => player.play(list, index, { inAlbumOrder: options.inAlbumOrder }) },
    { label: text('AlbumMenu_PlayNext'), glyph: icons.playNext, run: () => player.playNext([track]) },
    { label: text('Review_CtxAddNowPlaying'), glyph: icons.playlist, run: () => player.addToQueue([track]) },
    toPlaylist([track], text('Playlists_AddToPlaylist'), false),
    'rule',
    { label: text(on ? 'Track_UnsetFavorite' : 'Track_SetFavorite'), glyph: icons.heart, outline: !on, run: () => void favorites.mark(track, !on) },
    'rule',
    { label: text('Review_CtxEditTrack'), glyph: icons.edit, run: () => (asked.editing = { tracks: [track], album: null }) },
    ...(options.album ? [{ label: text('AlbumMenu_AlbumPage'), glyph: icons.album, run: () => (asked.opening = options.album!) }] : []),
    'rule',
    { label: text('Delete_Cloud'), glyph: icons.trash, run: () => (asked.deleting = { tracks: [track], name: track.title ?? '', wholeAlbum: false }) },
  ];
}

// The small key: the same menu, under the key, for everyone who would not think to right-click on a web page.
export async function menuAt(event: MouseEvent, entries: MenuEntry[] | Promise<MenuEntry[]>) {
  const key = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const list = tidy(await entries);
  openMenu(list, key.left, key.bottom + 4);
}

export { foldersIn };

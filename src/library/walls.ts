// The artist and genre walls, built once per library. Reading them walks every track, so a view that
// opens twice does not pay twice.

import type { CloudAlbum } from './albums';
import { buildArtistWall, creditRows, type ArtistWallItem } from './artists';
import { buildGenreWall, type GenreWallItem } from './genres';

let readFrom: readonly CloudAlbum[] | null = null;
let artists: ArtistWallItem[] = [];
let genres: GenreWallItem[] = [];
let byKey = new Map<string, CloudAlbum>();

function read(albums: readonly CloudAlbum[]) {
  if (albums === readFrom) return;
  readFrom = albums;
  artists = buildArtistWall(creditRows(albums));
  genres = buildGenreWall(albums);
  byKey = new Map(albums.map((album) => [album.key, album]));
}

export function artistWall(albums: readonly CloudAlbum[]): ArtistWallItem[] {
  read(albums);
  return artists;
}

export function genreWall(albums: readonly CloudAlbum[]): GenreWallItem[] {
  read(albums);
  return genres;
}

export function albumsByKey(albums: readonly CloudAlbum[]): Map<string, CloudAlbum> {
  read(albums);
  return byKey;
}

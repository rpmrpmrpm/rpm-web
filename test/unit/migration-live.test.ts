// The web readers against a real Jellyfin and a real Navidrome. Skipped unless RPM_MIGRATION_LIVE=1, with
// RPM_LIVE_JELLYFIN and RPM_LIVE_NAVIDROME set to servers that hold the five test tracks (user "test",
// password "secret"), a favourite, plays and a playlist.

import { describe, expect, it } from 'vitest';

import { jellyfinWithPassword, JellyfinServer } from '../../src/migration/jellyfin';
import type { SourceLibrary } from '../../src/migration/model';
import type { Fetch } from '../../src/migration/server';
import { subsonicCheck, SubsonicServer } from '../../src/migration/subsonic';

const live = process.env.RPM_MIGRATION_LIVE === '1';
const fetcher: Fetch = (url, init) => fetch(url, init);
const titleOf = (lib: SourceLibrary, id: string) => lib.tracks.find((t) => t.sourceId === id)!.title;

describe.skipIf(!live)('against real servers', () => {
  it('reads and downloads from Jellyfin without counting a play', async () => {
    const session = await jellyfinWithPassword(fetcher, process.env.RPM_LIVE_JELLYFIN!, 'rpm-web-live', 'test', 'secret');
    const server = new JellyfinServer(fetcher, session, 'rpm-web-live');
    const lib = await server.read(() => {});
    expect(lib.tracks).toHaveLength(5);
    const opening = lib.tracks.find((t) => t.title === 'Opening')!;
    expect(opening.favorite).toBe(true);
    expect(lib.playlists.find((p) => p.name === 'Evening')!.trackIds.map((id) => titleOf(lib, id))).toEqual(['Shore', 'Opening', 'Shore']);
    const file = await server.open(opening.file as never);
    expect(new TextDecoder().decode(new Uint8Array(await file.slice(0, 4).arrayBuffer()))).toBe('fLaC');
    const again = await server.read(() => {});
    expect(again.tracks.find((t) => t.title === 'Opening')!.plays).toBe(opening.plays);
  });

  it('reads and downloads from Navidrome without counting a play', async () => {
    const login = { server: process.env.RPM_LIVE_NAVIDROME!, user: 'test', password: 'secret' };
    await subsonicCheck(fetcher, login);
    const server = new SubsonicServer(fetcher, login);
    const lib = await server.read(() => {});
    // The server may hold more than the five test tones (a larger library to watch the progress with).
    expect(lib.tracks.length).toBeGreaterThanOrEqual(5);
    expect(lib.tracks.find((t) => t.title === 'Opening')!.plays).toBe(3);
    expect(lib.tracks.find((t) => t.title === 'Middle')!.rating).toBe(8);
    expect(lib.playlists.find((p) => p.name === 'Weekend')!.trackIds.map((id) => titleOf(lib, id))).toEqual(['Tide', 'Opening', 'Tide']);
    const opening = lib.tracks.find((t) => t.title === 'Opening')!;
    const file = await server.open(opening.file as never);
    expect(new TextDecoder().decode(new Uint8Array(await file.slice(0, 4).arrayBuffer()))).toBe('fLaC');
    expect((await server.read(() => {})).tracks.find((t) => t.title === 'Opening')!.plays).toBe(3);
  });
});

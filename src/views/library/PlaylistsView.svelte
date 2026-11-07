<script lang="ts">
  // The account's playlists. Those it made itself can be changed. Auto playlists are the desktop's, so they
  // are shown when a desktop has cut them, and the page says where they come from.
  import { onMount } from 'svelte';

  import type { CloudTrack } from '../../api/wire';
  import { player, playlists } from '../../app';
  import { icons } from '../../design/icons';
  import { PlaylistGone, type CloudPlaylist, type GeneratedList } from '../../library/playlists';
  import { library } from '../../state.svelte';
  import { trackCount } from '../../strings/counts';
  import { text } from '../../strings/loc';
  import DesktopGet from '../shell/DesktopGet.svelte';
  import TrackRows from './TrackRows.svelte';

  let held = $state.raw<CloudPlaylist[] | null>(null);
  let generated = $state.raw<GeneratedList[]>([]);
  let failed = $state(false);
  let openId = $state<string | null>(null);
  let openGenerated = $state<GeneratedList | null>(null);
  let making = $state(false);
  let naming = $state('');
  let renaming = $state(false);
  let refusal = $state('');

  async function read() {
    try {
      held = await playlists.list();
      generated = await playlists.generated().catch(() => []);
      failed = false;
    } catch {
      failed = true;
    }
  }

  onMount(read);

  const byId = $derived(new Map(library.albums.flatMap((album) => album.tracks).map((track) => [track.rpmId, track])));
  const tracksOf = (ids: readonly string[]): CloudTrack[] => ids.flatMap((id) => byId.get(id) ?? []);
  const open = $derived(held?.find((playlist) => playlist.playlistId === openId) ?? null);
  const shownTracks = $derived(tracksOf(open?.trackIds ?? openGenerated?.trackIds ?? []));
  const missing = $derived((open?.trackIds.length ?? 0) - (open ? shownTracks.length : 0));

  async function act(run: () => Promise<unknown>) {
    refusal = '';
    try {
      await run();
    } catch (error) {
      refusal = text(error instanceof PlaylistGone ? 'Rpm_PlaylistWrite_Gone' : 'Rpm_PlaylistPick_Failed');
    }
    await read();
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!naming.trim()) return;
    await act(() => playlists.create(naming, []));
    naming = '';
    making = false;
  }

  async function rename(event: SubmitEvent) {
    event.preventDefault();
    if (open && naming.trim()) await act(() => playlists.rename(open.playlistId, naming));
    renaming = false;
    naming = '';
  }

  async function remove() {
    if (!open) return;
    const id = open.playlistId;
    openId = null;
    await act(() => playlists.remove(id));
  }

  const length = trackCount;
  const generatedName = (list: GeneratedList) => list.title ?? list.kind;
</script>

{#if open || openGenerated}
  <div class="page">
    <button class="link" onclick={() => { openId = null; openGenerated = null; }}><i class="icon">{icons.back}</i> {text('Playlists_Title')}</button>
    <h2 class="heading">{open?.name ?? generatedName(openGenerated!)}</h2>
    <p class="soft">{length(shownTracks.length)}{missing > 0 ? `  •  ${missing === 1 ? text('Rpm_Playlist_MissingOne') : text('Rpm_Playlist_Missing', missing)}` : ''}</p>

    <div class="keys">
      <button class="glass-button primary" disabled={!shownTracks.length} onclick={() => player.play(shownTracks, 0, { inAlbumOrder: false })}><i class="icon">{icons.play}</i> {text('Rpm_Playlist_PlayList')}</button>
      {#if open}
        <button class="glass-button" onclick={() => { renaming = !renaming; naming = open.name; }}>{text('Playlists_Rename')}</button>
        <button class="glass-button" onclick={remove}>{text('Playlists_Delete')}</button>
      {/if}
    </div>

    {#if renaming}
      <form onsubmit={rename}>
        <input class="field" aria-label={text('Rpm_NewPlaylist_Name')} bind:value={naming} />
        <button class="glass-button" type="submit">{text('Playlists_Rename')}</button>
      </form>
    {/if}
    {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}

    {#if shownTracks.length}
      <TrackRows tracks={shownTracks} onRemove={open ? (track, index) => act(() => playlists.removeAt(open.playlistId, track.rpmId, index)) : undefined} />
    {:else}
      <p class="soft">{text('Rpm_Playlist_EmptyPlain')}</p>
    {/if}
  </div>
{:else}
  <div class="page">
    <h2 class="heading">{text('Playlists_Title')}</h2>

    <div class="note">
      <p>{text('Web_PlaylistsDesktopNote')}</p>
      <DesktopGet />
    </div>

    {#if failed}
      <p class="refusal" role="alert">{text('Rpm_Playlists_Error')}</p>
      <button class="glass-button" onclick={read}>{text('Rpm_Library_Retry')}</button>
    {:else if held === null}
      <p class="soft">{text('Rpm_Playlists_Loading')}</p>
    {:else}
      {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
      <div class="keys">
        <button class="glass-button" onclick={() => (making = !making)}>{text('Playlists_NewPlaylist')}</button>
      </div>
      {#if making}
        <form onsubmit={create}>
          <input class="field" aria-label={text('Rpm_NewPlaylist_Name')} placeholder={text('Rpm_NewPlaylist_Name')} bind:value={naming} />
          <button class="glass-button primary" type="submit">{text('Rpm_NewPlaylist_Create')}</button>
        </form>
      {/if}

      <ul>
        {#each held as playlist (playlist.playlistId)}
          <li>
            <button onclick={() => (openId = playlist.playlistId)}>
              <i class="icon">{icons.playlist}</i>
              <span class="words">
                <strong>{playlist.name}</strong>
                <small>{[...playlist.folder, length(playlist.trackIds.length)].join('  •  ')}</small>
              </span>
            </button>
          </li>
        {/each}
        {#each generated as list, index (`${list.kind}-${index}`)}
          <li>
            <button onclick={() => (openGenerated = list)}>
              <i class="icon">{icons.playlist}</i>
              <span class="words">
                <strong>{generatedName(list)}</strong>
                <small>{length(list.trackIds.length)}</small>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
    padding: 14px 16px;
    overflow-y: auto;
  }

  .page > .link {
    align-self: flex-start;
  }

  p {
    margin: 0;
  }

  .soft {
    color: var(--text-soft);
    font-size: 12.5px;
  }

  .refusal {
    color: var(--error);
    font-size: 13px;
  }

  .note {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border: 1px solid var(--hairline);
    border-radius: 8px;
    background: rgb(255 255 255 / 0.04);
    color: var(--text-soft);
    font-size: 13px;
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  form .field {
    flex: 1 1 200px;
  }

  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 4px 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li button {
    display: flex;
    gap: 12px;
    align-items: center;
    width: 100%;
    padding: 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 13px;
  }

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--text-soft);
    font-size: 11.5px;
  }

  @media (hover: hover) {
    li button:hover {
      background: rgb(255 255 255 / 0.07);
    }
  }
</style>

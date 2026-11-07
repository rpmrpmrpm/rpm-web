<script lang="ts">
  // Puts tracks on a playlist, or on a new one.
  import type { CloudTrack } from '../../api/wire';
  import { playlists } from '../../app';
  import { PlaylistGone, type CloudPlaylist } from '../../library/playlists';
  import { text } from '../../strings/loc';
  import Window from '../import/Window.svelte';

  let { tracks, onClose }: { tracks: readonly CloudTrack[]; onClose: () => void } = $props();

  let held = $state.raw<CloudPlaylist[] | null>(null);
  let naming = $state('');
  let refusal = $state('');
  let busy = $state(false);

  void playlists
    .list()
    .then((list) => (held = list))
    .catch(() => (refusal = text('Rpm_Playlists_Error')));

  async function act(run: () => Promise<unknown>) {
    busy = true;
    refusal = '';
    try {
      await run();
      onClose();
    } catch (error) {
      refusal = text(error instanceof PlaylistGone ? 'Rpm_PlaylistWrite_Gone' : 'Rpm_PlaylistPick_Failed');
    } finally {
      busy = false;
    }
  }

  const ids = () => tracks.map((track) => track.rpmId);

  function create(event: SubmitEvent) {
    event.preventDefault();
    if (naming.trim()) void act(() => playlists.create(naming, ids()));
  }
</script>

<Window title={text('Playlists_AddToPlaylist')} {onClose}>
  <form onsubmit={create}>
    <input class="field" aria-label={text('Rpm_NewPlaylist_Name')} placeholder={text('Rpm_NewPlaylist_Name')} bind:value={naming} />
    <button class="glass-button primary" type="submit" disabled={busy}>{text('Rpm_NewPlaylist_Create')}</button>
  </form>
  {#if refusal}<p role="alert">{refusal}</p>{/if}
  <ul>
    {#each held ?? [] as playlist (playlist.playlistId)}
      <li><button disabled={busy} onclick={() => act(() => playlists.add(playlist.playlistId, ids()))}>{playlist.name}</button></li>
    {/each}
  </ul>
</Window>

<style>
  form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  form .field {
    flex: 1 1 200px;
  }

  p {
    margin: 0;
    color: var(--error);
    font-size: 13px;
  }

  ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li button {
    width: 100%;
    padding: 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  @media (hover: hover) {
    li button:hover {
      background: rgb(255 255 255 / 0.07);
    }
  }
</style>

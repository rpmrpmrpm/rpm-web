<script lang="ts">
  // The windows a record's menu opens. They stand here, once, because a menu can open from any view.
  import { catalogue, cloud, player } from '../../app';
  import { icons } from '../../design/icons';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import Window from '../import/Window.svelte';
  import AddToPlaylist from './AddToPlaylist.svelte';
  import AlbumPage from './AlbumPage.svelte';
  import AlbumEditor from '../edit/AlbumEditor.svelte';
  import MassEditor from '../edit/MassEditor.svelte';
  import ReleaseFill from '../edit/ReleaseFill.svelte';
  import TrackEditor from '../edit/TrackEditor.svelte';
  import ReviewWindow from './ReviewWindow.svelte';
  import { asked } from './record-menu.svelte';

  let { compact }: { compact: boolean } = $props();

  let busy = $state(false);
  let refusal = $state('');

  const closeDelete = () => {
    asked.deleting = null;
    refusal = '';
  };

  async function confirmDelete() {
    const tracks = asked.deleting?.tracks ?? [];
    busy = true;
    refusal = '';
    if (tracks.some((track) => track.rpmId === now.track?.rpmId)) player.stop();
    // One at a time: each delete changes the account's usage total in a transaction, so two at once conflict.
    let failed = 0;
    for (const track of tracks) {
      try {
        await cloud.remove(track.rpmId);
      } catch {
        failed++;
      }
    }
    busy = false;
    await catalogue.refresh();
    if (failed) refusal = text('Cloud_TracksNotRemoved', failed, tracks.length, '').trim();
    else closeDelete();
  }
</script>

{#if asked.adding}
  <AddToPlaylist tracks={asked.adding} onClose={() => (asked.adding = null)} />
{/if}

{#if asked.editing?.kind === 'track'}
  <TrackEditor track={asked.editing.track} onClose={() => (asked.editing = null)} />
{:else if asked.editing?.kind === 'album'}
  <AlbumEditor album={asked.editing.album} onClose={() => (asked.editing = null)} />
{:else if asked.editing?.kind === 'mass'}
  {#if asked.editing.tracks.length === 1}
    <TrackEditor track={asked.editing.tracks[0]!} onClose={() => (asked.editing = null)} />
  {:else}
    <MassEditor tracks={asked.editing.tracks} onClose={() => (asked.editing = null)} />
  {/if}
{:else if asked.editing?.kind === 'release'}
  <ReleaseFill tracks={asked.editing.tracks} onClose={() => (asked.editing = null)} />
{/if}

{#if asked.reviewing}
  <ReviewWindow album={asked.reviewing} onClose={() => (asked.reviewing = null)} />
{/if}

{#if asked.opening && compact}
  <AlbumPage album={asked.opening} onClose={() => (asked.opening = null)} />
{/if}

{#if asked.deleting}
  <Window title={text('Delete_Menu')} glyph={icons.trash} minWidth={420} maxWidth={520} minHeight={260} openHeight={300} onClose={closeDelete}>
    <p>{text(asked.deleting.wholeAlbum ? 'AlbumDelete_CloudLast' : 'TrackDelete_CloudLast', asked.deleting.name)}</p>
    {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
    {#snippet footer()}
      <button class="glass-button" disabled={busy} onclick={closeDelete}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
      <button class="glass-button danger" disabled={busy} onclick={confirmDelete}><i class="icon">{icons.trash}</i>{text('Delete_Cloud')}</button>
    {/snippet}
  </Window>
{/if}

<style>
  p {
    margin: 0;
    color: var(--text-soft);
    font-size: 13px;
    line-height: 1.5;
  }

  .refusal {
    color: var(--error);
  }
</style>

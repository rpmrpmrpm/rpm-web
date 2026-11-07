<script lang="ts">
  // A record: its name, its keys, and its tracklist by disc. The drawer on the wall and the page on a
  // phone both show this.
  import { catalogue, cloud, covers, favorites, headClips, player } from '../../app';
  import { durationSeconds, isExplicit, type CloudTrack } from '../../api/wire';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { discOf, trackOf } from '../../library/grouping';
  import { byDisc } from '../../library/tracklist';
  import { library, now } from '../../state.svelte';
  import { trackCount } from '../../strings/counts';
  import { text } from '../../strings/loc';
  import AddToPlaylist from './AddToPlaylist.svelte';
  import EditTags from './EditTags.svelte';
  import Heart from './Heart.svelte';
  import Stars from './Stars.svelte';

  let { album, columns = 2, onSleeve }: { album: CloudAlbum; columns?: number; onSleeve?: (url: string) => void } = $props();

  let sleeve = $state<string | null>(null);

  // A record that is opened is a record about to be played.
  $effect(() => headClips.warm(album.tracks.map((track) => track.rpmId)));

  $effect(() => {
    const wanted = album;
    let current = true;
    void covers.url(wanted, 512).then((url) => {
      if (!current) return;
      sleeve = url;
      if (url) onSleeve?.(url);
    });
    return () => {
      current = false;
    };
  });

  let loved = $state(false);

  $effect(() => {
    void library.marksVersion;
    const wanted = album;
    let current = true;
    void favorites.isAlbumMarked(wanted).then((marked) => {
      if (current) loved = marked;
    });
    return () => {
      current = false;
    };
  });

  const discs = $derived(byDisc(album.tracks, discOf, trackOf));
  const seconds = $derived(album.tracks.reduce((sum, track) => sum + durationSeconds(track), 0));

  const time = (value: number) => {
    const total = Math.round(value);
    return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : '';
  };

  const play = (track: CloudTrack) => player.play(album.tracks, album.tracks.indexOf(track));

  let adding = $state<readonly CloudTrack[] | null>(null);
  let editing = $state<readonly CloudTrack[] | null>(null);

  // Deleting is asked about first, on the page, because it cannot be undone.
  let asking = $state<readonly CloudTrack[] | null>(null);
  let deleting = $state(false);
  let refusal = $state('');

  const asked = $derived(text('Web_DeleteAsk', asking?.length === 1 ? (asking[0]!.title ?? '') : album.album));

  async function confirmDelete() {
    const tracks = asking ?? [];
    deleting = true;
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
    deleting = false;
    asking = null;
    if (failed) refusal = text('Cloud_TracksNotRemoved', failed, tracks.length, '').trim();
    await catalogue.refresh();
  }
</script>

<div class="detail">
  <div class="main">
    <header>
      <h3>{album.album}</h3>
      <p>
        {album.artist}{album.year ? ` • ${album.year}` : ''} • {trackCount(album.tracks.length)}
        {seconds ? ` • ${Math.round(seconds / 60)} min` : ''}
      </p>
      <div class="keys">
        <button class="glass-button primary" onclick={() => player.play(album.tracks, 0)}><i class="icon">{icons.play}</i> {text('AlbumMenu_Play')}</button>
        <button
          class="glass-button"
          onclick={() => {
            player.play(album.tracks, 0, { inAlbumOrder: false });
            player.toggleShuffle();
          }}><i class="icon">{icons.shuffle}</i> {text('AlbumMenu_Shuffle')}</button
        >
        <button class="glass-button" class:loved aria-pressed={loved} onclick={() => favorites.markAlbum(album, !loved)}><i class="icon">{icons.heart}</i> {text(loved ? 'Album_UnsetFavorite' : 'Album_SetFavorite')}</button>
        <button class="glass-button" onclick={() => (adding = album.tracks)}><i class="icon">{icons.plus}</i> {text('Playlists_AddToPlaylist')}</button>
        <button class="glass-button" onclick={() => (editing = album.tracks)}><i class="icon">{icons.pen}</i> {text('AlbumEdit_Title')}</button>
        <button class="glass-button" onclick={() => (asking = album.tracks)}><i class="icon">{icons.trash}</i> {text('Delete_Cloud')}</button>
      </div>
      <Stars {album} />
      {#if asking}
        <div class="ask" role="alert">
          <span>{asked}</span>
          <button class="glass-button primary" disabled={deleting} onclick={confirmDelete}>{text('Delete_Menu')}</button>
          <button class="glass-button" disabled={deleting} onclick={() => (asking = null)}>{text('Common_Cancel')}</button>
        </div>
      {/if}
      {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
    </header>

    <div class="tracks" style:column-count={columns}>
      {#each discs as disc}
        {#if discs.length > 1}
          <div class="disc">{text('Album_DiscHeader', disc.discNumber)}</div>
        {/if}
        {#each disc.tracks as track (track.rpmId)}
          <div class="track" class:playing={now.track?.rpmId === track.rpmId}>
            <button class="play" onclick={() => play(track)}>
              <span class="number">{trackOf(track) || ''}</span>
              <span class="name">{track.title}{#if isExplicit(track)}<span class="badge">E</span>{/if}</span>
              <span class="length">{time(durationSeconds(track))}</span>
            </button>
            <Heart {track} />
            <button class="bin" title={text('Details_Title')} aria-label={text('Details_Title')} onclick={() => (editing = [track])}><i class="icon">{icons.pen}</i></button>
            <button class="bin" title={text('Delete_Cloud')} aria-label={text('Delete_Cloud')} onclick={() => (asking = [track])}><i class="icon">{icons.trash}</i></button>
          </div>
        {/each}
      {/each}
    </div>
  </div>

  {#if columns > 1 && sleeve}
    <img src={sleeve} alt="" />
  {/if}
</div>

{#if adding}
  <AddToPlaylist tracks={adding} onClose={() => (adding = null)} />
{/if}
{#if editing}
  <EditTags tracks={editing} album={editing.length === album.tracks.length ? album : null} onClose={() => (editing = null)} />
{/if}

<style>
  .loved .icon {
    color: var(--favorite);
  }

  .detail {
    display: flex;
    gap: 20px;
  }

  .main {
    flex: 1;
    min-width: 0;
  }

  header {
    margin-bottom: 14px;
  }

  h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
  }

  p {
    margin: 3px 0 0;
    color: var(--text-soft);
    font-size: 12.5px;
  }

  .keys {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .keys .icon {
    margin-right: 6px;
    font-size: 12px;
  }

  .tracks {
    column-gap: 18px;
  }

  .disc {
    margin: 10px 0 4px;
    padding-bottom: 5px;
    border-bottom: 1px solid var(--hairline);
    color: var(--text-soft);
    font-size: 11px;
    font-weight: 700;
    break-after: avoid;
  }

  .ask {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
    align-items: center;
    margin-top: 10px;
    font-size: 12.5px;
  }

  .ask span {
    flex: 1 1 220px;
  }

  .refusal {
    color: var(--error);
  }

  .track {
    display: flex;
    align-items: center;
    border-radius: 4px;
    break-inside: avoid;
  }

  .play {
    display: grid;
    flex: 1;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    gap: 8px;
    min-width: 0;
    min-height: 26px;
    padding: 3px 6px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .bin {
    flex: none;
    width: 26px;
    height: 26px;
    border: 0;
    background: none;
    color: var(--text-faint);
    font-size: 11px;
    cursor: pointer;
  }

  @media (hover: hover) {
    .bin {
      visibility: hidden;
    }

    .track:hover .bin,
    .bin:focus-visible {
      visibility: visible;
    }
  }

  @media (hover: hover) {
    .track:hover {
      background: rgb(255 255 255 / 0.1);
    }
  }

  @media (pointer: coarse) {
    .track {
      align-items: center;
      min-height: 44px;
    }
  }

  .track.playing .name {
    color: #5fe08a;
  }

  .number,
  .length {
    color: rgb(255 255 255 / 0.53);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .name {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    display: inline-grid;
    place-items: center;
    width: 13px;
    height: 13px;
    margin-left: 5px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.25);
    color: #000;
    font-size: 9px;
    font-weight: 700;
    vertical-align: 1px;
  }

  img {
    flex: none;
    align-self: flex-start;
    width: 210px;
    height: 210px;
    border-radius: 6px;
    object-fit: cover;
  }
</style>

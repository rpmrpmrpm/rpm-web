<script lang="ts">
  // One list, opened: its cover over the wash, the keys, and the running order. Rows of a list somebody made can
  // be dragged. The new order goes through the merge, so a song a phone added meanwhile stays.
  import { durationSeconds, type CloudTrack } from '../../api/wire';
  import { covers, player } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { library, now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import Heart from './Heart.svelte';
  import PlaylistCover from './PlaylistCover.svelte';

  let { id = null, name, subtitle, tracks, glyph, version = 0, onBack, onRemove, onMove, keys }: {
    id?: string | null;
    name: string;
    subtitle: string;
    tracks: CloudTrack[];
    glyph?: string;
    version?: number;
    onBack: () => void;
    onRemove?: (track: CloudTrack, index: number) => void;
    onMove?: (from: number, to: number) => void;
    keys?: import('svelte').Snippet;
  } = $props();

  const START_DRAG_PX = 6;

  let list = $state<HTMLElement | null>(null);
  let dragging = $state<number | null>(null);
  let dropAt = $state<number | null>(null);
  let started: { x: number; y: number; index: number; pointer: number } | null = null;
  let moved = false;

  const albumOf = $derived.by(() => {
    const byTrack = new Map<string, CloudAlbum>();
    for (const album of library.albums) for (const track of album.tracks) byTrack.set(track.rpmId, album);
    return byTrack;
  });

  const time = (track: CloudTrack) => {
    const total = Math.round(durationSeconds(track));
    return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : '';
  };

  function pressed(event: PointerEvent, index: number) {
    if (!onMove || event.button !== 0 || (event.target as HTMLElement).closest('.heart, .bin')) return;
    const fromGrip = !!(event.target as HTMLElement).closest('.grip');
    // A finger on the row scrolls the list. The grip is what moves it.
    if (event.pointerType !== 'mouse' && !fromGrip) return;
    started = { x: event.clientX, y: event.clientY, index, pointer: event.pointerId };
    moved = false;
  }

  function dragged(event: PointerEvent) {
    if (!started || event.pointerId !== started.pointer) return;
    if (dragging === null) {
      if (Math.hypot(event.clientX - started.x, event.clientY - started.y) < START_DRAG_PX) return;
      dragging = started.index;
      moved = true;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    const rows = [...(list?.children ?? [])] as HTMLElement[];
    let at = rows.length;
    for (const [index, row] of rows.entries()) {
      const box = row.getBoundingClientRect();
      if (event.clientY < box.top + box.height / 2) {
        at = index;
        break;
      }
    }
    dropAt = at;
  }

  function released() {
    const from = dragging;
    const to = dropAt;
    started = null;
    dragging = null;
    dropAt = null;
    if (from === null || to === null) return;
    // The place is counted with the row still in the list.
    const place = to > from ? to - 1 : to;
    if (place !== from) onMove?.(from, place);
  }

  // A drag ends in a click on the row it started on, which must not start the song.
  function played(index: number) {
    if (moved) {
      moved = false;
      return;
    }
    player.play(tracks, index, { inAlbumOrder: false });
  }

  function nudged(event: KeyboardEvent, index: number) {
    if (!onMove || !event.altKey) return;
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1;
    if (to < 0 || to >= tracks.length) return;
    event.preventDefault();
    onMove(index, to);
  }

  let sleeves = $state.raw<Map<string, string>>(new Map());

  $effect(() => {
    const albums = [...new Set(tracks.flatMap((track) => albumOf.get(track.rpmId) ?? []))];
    let current = true;
    void Promise.all(albums.map(async (album) => [album.key, await covers.url(album, 128)] as const)).then((found) => {
      if (current) sleeves = new Map(found.filter((pair): pair is readonly [string, string] => pair[1] !== null));
    });
    return () => {
      current = false;
    };
  });

  const sleeveOf = (track: CloudTrack) => {
    const album = albumOf.get(track.rpmId);
    return album ? (sleeves.get(album.key) ?? null) : null;
  };

  function shuffled() {
    player.play(tracks, 0, { inAlbumOrder: false });
    if (!now.shuffled) player.toggleShuffle();
  }
</script>

<div class="detail">
  <header>
    <button class="back" title={text('Album_Back')} aria-label={text('Album_Back')} onclick={onBack}><i class="icon">{icons.back}</i></button>
    <div class="art"><PlaylistCover {id} {tracks} {glyph} {version} /></div>
    <div class="words">
      <strong class="name">{name}</strong>
      <span>{subtitle}</span>
    </div>
    <div class="actions">
      {@render keys?.()}
      <button class="round" disabled={!tracks.length} title={text('AlbumMenu_Play')} aria-label={text('AlbumMenu_Play')} onclick={() => player.play(tracks, 0, { inAlbumOrder: false })}><i class="icon">{icons.play}</i></button>
      <button class="round" disabled={!tracks.length} title={text('AlbumMenu_Shuffle')} aria-label={text('AlbumMenu_Shuffle')} onclick={shuffled}><i class="icon">{icons.shuffle}</i></button>
    </div>
  </header>

  {#if tracks.length}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <ol bind:this={list} class:moving={dragging !== null} onpointermove={dragged} onpointerup={released} onpointercancel={released}>
      {#each tracks as track, index (`${track.rpmId}-${index}`)}
        <li class:on={now.track?.rpmId === track.rpmId} class:lifted={dragging === index} class:above={dropAt === index} class:below={dropAt === tracks.length && index === tracks.length - 1}>
          <button class="song" onpointerdown={(event) => pressed(event, index)} onclick={() => played(index)} onkeydown={(event) => nudged(event, index)}>
            <span class="place">{index + 1}</span>
            <span class="sleeve">
              {#if sleeveOf(track)}<img src={sleeveOf(track)} alt="" loading="lazy" />{:else}<i class="icon">{icons.album}</i>{/if}
            </span>
            <span class="title">{track.title}</span>
            <span class="by">{track.artist ?? ''}</span>
            <span class="from">{track.album ?? ''}</span>
            <span class="length">{time(track)}</span>
          </button>
          <Heart {track} />
          {#if onRemove}
            <button class="bin" title={text('Playlists_Remove')} aria-label={text('Playlists_Remove')} onclick={() => onRemove(track, index)}><i class="icon">{icons.trash}</i></button>
          {/if}
          {#if onMove}
            <span class="grip" onpointerdown={(event) => pressed(event, index)} aria-hidden="true"><i class="icon">{icons.grip}</i></span>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty">{text('Rpm_Playlist_EmptyPlain')}</p>
  {/if}
</div>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  header {
    display: grid;
    flex: none;
    grid-template-columns: auto 196px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: end;
    padding: 28px 12px 28px 28px;
  }

  .back {
    align-self: start;
    width: 32px;
    height: 28px;
    margin-right: 18px;
    padding: 0;
    border: 1px solid rgb(255 255 255 / 0.55);
    border-radius: 6px;
    background: none;
    color: rgb(255 255 255 / 0.93);
    font-size: 12px;
    cursor: pointer;
  }

  .back:hover {
    background: rgb(0 0 0 / 0.3);
  }

  .art {
    width: 196px;
    border-radius: 8px;
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    max-width: 520px;
  }

  .name {
    font-size: 15px;
    font-weight: 700;
  }

  .words span {
    overflow: hidden;
    color: rgb(255 255 255 / 0.6);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    gap: 6px;
  }

  .actions :global(.round) {
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 17px;
    background: none;
    color: rgb(255 255 255 / 0.9);
    font-size: 14px;
    cursor: pointer;
  }

  .actions :global(.round:hover) {
    background: rgb(255 255 255 / 0.12);
  }

  .actions :global(.round:disabled) {
    opacity: 0.4;
  }

  ol {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 12px 12px 10px;
    overflow-y: auto;
    list-style: none;
  }

  ol.moving {
    cursor: grabbing;
    user-select: none;
  }

  li {
    position: relative;
    display: flex;
    align-items: center;
    height: 64px;
    border-radius: 6px;
  }

  li:hover {
    background: rgb(255 255 255 / 0.07);
  }

  li.lifted {
    opacity: 0.45;
  }

  li.above::before,
  li.below::after {
    position: absolute;
    right: 10px;
    left: 10px;
    height: 2px;
    border-radius: 1px;
    background: #0371d0;
    content: '';
  }

  li.above::before {
    top: -1px;
  }

  li.below::after {
    bottom: -1px;
  }

  .song {
    display: grid;
    flex: 1;
    grid-template-columns: 26px 56px minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1.4fr) auto;
    gap: 10px;
    align-items: center;
    min-width: 0;
    height: 100%;
    padding: 0 10px;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .place {
    color: rgb(255 255 255 / 0.48);
    font-size: 11.5px;
    text-align: center;
  }

  .sleeve {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    overflow: hidden;
    border-radius: 5px;
    background: rgb(0 0 0 / 0.2);
    color: rgb(255 255 255 / 0.25);
    font-size: 20px;
  }

  .sleeve img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .title,
  .by,
  .from {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    color: rgb(255 255 255 / 0.93);
    font-size: 12.5px;
  }

  li.on .title {
    color: var(--accent);
  }

  .by {
    color: rgb(255 255 255 / 0.68);
    font-size: 12px;
  }

  .from,
  .length {
    color: rgb(255 255 255 / 0.55);
    font-size: 12px;
  }

  .bin,
  .grip {
    flex: none;
    padding: 6px;
    border: 0;
    background: none;
    color: var(--text-faint);
    font-size: 12px;
  }

  .bin {
    cursor: pointer;
    opacity: 0;
  }

  li:hover .bin,
  .bin:focus-visible {
    opacity: 1;
  }

  .grip {
    display: none;
    touch-action: none;
  }

  .empty {
    margin: 0;
    padding: 24px 28px;
    color: var(--text-soft);
    font-size: 12.5px;
  }

  @media (pointer: coarse) {
    .grip {
      display: block;
    }

    .bin {
      opacity: 1;
    }
  }

  @media (width < 700px) {
    header {
      grid-template-columns: auto minmax(0, 1fr);
      padding: 14px 16px;
    }

    .art {
      width: min(56vw, 196px);
      grid-column: 1 / -1;
      justify-self: center;
    }

    .words,
    .actions {
      grid-column: 1 / -1;
    }

    .back {
      grid-column: 1 / -1;
    }

    .song {
      grid-template-columns: 22px 48px minmax(0, 1fr) auto;
    }

    .sleeve {
      width: 48px;
      height: 48px;
    }

    .by,
    .from {
      display: none;
    }

    li {
      height: 60px;
    }
  }
</style>

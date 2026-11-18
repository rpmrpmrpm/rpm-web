<script lang="ts">
  // The Now playing card the deck's queue key opens, as the desktop's QueueCard: every row of the queue with the
  // playing one lit, each with the record's cover, the title over "artist · album" and the time. A press on a row
  // plays it where it stands. Two keys in the band change the queue while it plays: Shuffle puts what is still to
  // come in another order and, pressed again, puts it back; Rearrange shows the rows' grips, and a row can then be
  // dragged to another place. The card opens on the playing row, and a press outside it closes it.
  import { onMount, tick } from 'svelte';

  import { durationSeconds, type CloudTrack } from '../../api/wire';
  import { player } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { library, now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import QueueThumb from './QueueThumb.svelte';

  let { onClose, anchor }: { onClose: () => void; anchor: HTMLElement | null } = $props();

  const START_DRAG_PX = 6;

  let card = $state<HTMLElement | null>(null);
  let list = $state<HTMLElement | null>(null);
  let rearranging = $state(false);
  let dragging = $state<number | null>(null);
  let dropAt = $state<number | null>(null);
  let started: { x: number; y: number; index: number; pointer: number } | null = null;
  let moved = false;

  const count = $derived(now.queue.length);
  // Shuffle can do something when it can put a shuffled queue back, or when two or more songs are still to come.
  const canShuffle = $derived(now.shuffled || count - now.index - 1 >= 2);
  // The list is capped to the window, less the deck it opens from and a gap at the top.
  let tallest = $state(Math.min(Math.max(innerHeight - 180, 200), 520));

  const albumOf = $derived.by(() => {
    const byTrack = new Map<string, CloudAlbum>();
    for (const album of library.albums) for (const track of album.tracks) byTrack.set(track.rpmId, album);
    return byTrack;
  });

  // Rearranging goes off with the last row it could move.
  $effect(() => {
    if (count < 2) rearranging = false;
  });

  // The playing row is the one you came to see, so the card opens on it.
  onMount(() => {
    void tick().then(() => {
      const playing = list?.children[now.index] as HTMLElement | undefined;
      if (playing && list) list.scrollTop = playing.offsetTop - list.offsetTop;
    });
  });

  function outside(event: PointerEvent) {
    const target = event.target as Node;
    if (card?.contains(target) || anchor?.contains(target)) return;
    onClose();
  }

  const byline = (track: CloudTrack) => [track.artist, track.album].filter((part) => part && part.trim()).join(' · ');

  const time = (track: CloudTrack) => {
    const total = Math.round(durationSeconds(track));
    return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : '';
  };

  // While rearranging, a press on a row picks it up rather than playing it. A finger on a row scrolls the list; the
  // grip is what moves it.
  function pressed(event: PointerEvent, index: number) {
    if (!rearranging || event.button !== 0) return;
    if (event.pointerType !== 'mouse' && !(event.target as HTMLElement).closest('.grip')) return;
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
    if (place !== from) void player.move(from, place);
  }

  // A drag ends in a click on the row it started on, which must not start the song.
  function chosen(index: number) {
    if (moved) {
      moved = false;
      return;
    }
    if (!rearranging) player.playAt(index);
  }

  // Alt and an arrow moves a row while rearranging, for the keyboard.
  function nudged(event: KeyboardEvent, index: number) {
    if (!rearranging || !event.altKey) return;
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1;
    if (to < 0 || to >= count) return;
    event.preventDefault();
    void player.move(index, to);
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={(event) => event.key === 'Escape' && onClose()} onresize={() => (tallest = Math.min(Math.max(innerHeight - 180, 200), 520))} />

<div class="card" bind:this={card} role="dialog" aria-label={text('Playlists_NowPlaying')}>
  <header>
    <h3>{text('Playlists_NowPlaying')}</h3>
    <button
      class="key"
      class:on={now.shuffled}
      disabled={!canShuffle}
      title={text(now.shuffled ? 'Deck_QueueUnshuffle' : 'Rpm_Queue_Shuffle')}
      aria-label={text(now.shuffled ? 'Deck_QueueUnshuffle' : 'Rpm_Queue_Shuffle')}
      aria-pressed={now.shuffled}
      onclick={() => void player.toggleShuffle()}><i class="icon">{icons.shuffle}</i></button
    >
    <!-- The phone's glyphs: grip lines to start rearranging, a tick to finish. -->
    <button
      class="key"
      class:on={rearranging}
      disabled={!rearranging && count < 2}
      title={text(rearranging ? 'CloudChip_StageDone' : 'Rpm_Queue_Rearrange')}
      aria-label={text(rearranging ? 'CloudChip_StageDone' : 'Rpm_Queue_Rearrange')}
      aria-pressed={rearranging}
      onclick={() => (rearranging = !rearranging)}><i class="icon">{rearranging ? icons.check : icons.gripLines}</i></button
    >
    {#if count}<span class="count">{text('Home_Songs', count)}</span>{/if}
  </header>

  {#if count}
    <ol bind:this={list} class:moving={dragging !== null} style:max-height="{tallest}px" onpointermove={dragged} onpointerup={released} onpointercancel={released}>
      {#each now.queue as track, index (index)}
        <li class:playing={index === now.index} class:lifted={dragging === index} class:above={dropAt === index} class:below={dropAt === count && index === count - 1}>
          <button class="row" onpointerdown={(event) => pressed(event, index)} onclick={() => chosen(index)} onkeydown={(event) => nudged(event, index)}>
            <QueueThumb album={albumOf.get(track.rpmId) ?? null} />
            <span class="words">
              <span class="title">{track.title || track.relativePath?.split('/').pop() || ''}</span>
              {#if byline(track)}<span class="byline">{byline(track)}</span>{/if}
            </span>
            <span class="time">{time(track)}</span>
            {#if rearranging}<span class="grip" aria-hidden="true"><i class="icon">{icons.menu}</i></span>{/if}
          </button>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty">{text('Deck_QueueEmpty')}</p>
  {/if}
</div>

<style>
  /* The surface of the app's menus and flyouts, with the darker band across the top that the desktop's deck
     flyouts wear. */
  .card {
    position: absolute;
    bottom: calc(100% + 14px);
    left: 50%;
    z-index: 5;
    display: flex;
    flex-direction: column;
    width: min(360px, calc(100vw - 32px));
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.094);
    border-radius: 8px;
    background: rgb(38 47 64 / 0.96);
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.5);
    backdrop-filter: blur(30px);
    transform: translateX(-50%);
  }

  header {
    display: flex;
    flex: none;
    gap: 2px;
    align-items: center;
    height: 32px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid rgb(255 255 255 / 0.094);
    background: rgb(0 0 0 / 0.25);
  }

  h3 {
    flex: 1;
    margin: 0;
    color: rgb(255 255 255 / 0.8);
    font-size: 12px;
    font-weight: 600;
  }

  /* The band's keys: bare glyphs, lit in the app's cyan on a faint wash while they are on. */
  .key {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: rgb(255 255 255 / 0.8);
    font-size: 11px;
    cursor: pointer;
  }

  .key.on {
    background: rgb(4 200 255 / 0.15);
    color: #04c8ff;
  }

  .key:disabled {
    color: rgb(255 255 255 / 0.267);
    cursor: default;
  }

  @media (hover: hover) {
    .key:not(:disabled):not(.on):hover {
      background: rgb(255 255 255 / 0.094);
    }
  }

  .count {
    margin-left: 8px;
    color: rgb(255 255 255 / 0.533);
    font-size: 11px;
    white-space: nowrap;
  }

  ol {
    margin: 0;
    padding: 6px 6px 8px;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
  }

  ol.moving {
    cursor: grabbing;
    user-select: none;
  }

  li {
    position: relative;
    padding: 1px 0;
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

  .row {
    display: flex;
    gap: 10px;
    align-items: center;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: rgb(255 255 255 / 0.867);
    text-align: left;
    cursor: pointer;
  }

  /* The playing row is lit the way the deck's flyouts light what is playing: a cyan wash, and white words. */
  li.playing .row {
    background: rgb(4 200 255 / 0.078);
    color: #fff;
  }

  @media (hover: hover) {
    li:not(.playing) .row:hover {
      background: rgb(255 255 255 / 0.06);
    }
  }

  .words {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .title,
  .byline {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-size: 13px;
  }

  .byline {
    color: rgb(255 255 255 / 0.6);
    font-size: 11px;
  }

  .time {
    flex: none;
    color: rgb(255 255 255 / 0.467);
    font-size: 11px;
  }

  .grip {
    flex: none;
    margin: 0 2px 0 4px;
    color: rgb(255 255 255 / 0.4);
    font-size: 13px;
    cursor: grab;
    touch-action: none;
  }

  .empty {
    margin: 14px 16px 16px;
    color: rgb(255 255 255 / 0.6);
    font-size: 12px;
    line-height: 1.45;
  }
</style>

<script lang="ts">
  // The data table: every track, sorted by any column, drawn only near the view. With a mouse, a click selects
  // a row and a double click plays the table from there, in the order on screen, as on the desktop. Shift and
  // Ctrl or Cmd extend the selection, and the right-click menu of a selection edits it. On a touch screen a
  // tap plays.
  import { durationSeconds, type CloudTrack } from '../../api/wire';
  import { catalogue, player, playLog } from '../../app';
  import { library, now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import { menuOn } from '../menu/menu.svelte';
  import { selectionMenu, trackMenu } from './record-menu.svelte';

  let { tracks }: { tracks: CloudTrack[] } = $props();

  type Column = { id: string; label: string; read: (track: CloudTrack) => string | number; number?: boolean; phone?: boolean };

  const LINE = 28;
  const EXTRA = 12;
  const collator = new Intl.Collator(undefined, { sensitivity: 'accent', numeric: true });

  const played = $derived.by(() => {
    void library.playsVersion;
    return playLog.everythingPlayed();
  });

  const COLUMNS: Column[] = [
    { id: 'title', label: 'Review_ColTitle', read: (track) => track.title ?? '', phone: true },
    { id: 'artist', label: 'Review_ColArtist', read: (track) => track.artist ?? '' },
    { id: 'album', label: 'Review_ColAlbum', read: (track) => track.album ?? '' },
    { id: 'year', label: 'Review_ColYear', read: (track) => track.tags?.year ?? 0, number: true },
    { id: 'genre', label: 'Review_ColGenre', read: (track) => track.tags?.genre ?? '' },
    { id: 'length', label: 'Review_ColLength', read: (track) => durationSeconds(track), number: true, phone: true },
    { id: 'plays', label: 'Review_ColPlays', read: (track) => played.get(track.rpmId)?.plays ?? 0, number: true },
  ];

  let sortBy = $state('artist');
  let descending = $state(false);
  let scroll = $state(0);
  let viewport = $state(0);

  const sorted = $derived.by(() => {
    const column = COLUMNS.find((held) => held.id === sortBy)!;
    const rows = [...tracks].sort((a, b) => {
      const x = column.read(a);
      const y = column.read(b);
      return typeof x === 'number' ? x - (y as number) : collator.compare(x, y as string);
    });
    return descending ? rows.reverse() : rows;
  });

  const first = $derived(Math.max(0, Math.floor(scroll / LINE) - EXTRA));
  const shown = $derived(sorted.slice(first, first + Math.ceil(viewport / LINE) + EXTRA * 2));

  function sort(id: string) {
    if (sortBy === id) descending = !descending;
    else {
      sortBy = id;
      descending = false;
    }
  }

  // Held by id, so a sort or a refresh keeps the selection on the same songs.
  let selected = $state.raw<ReadonlySet<string>>(new Set());
  let anchor: string | null = null;
  const precise = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

  function choose(event: MouseEvent, index: number) {
    const track = sorted[index]!;
    if (!precise) {
      player.play(sorted, index, { inAlbumOrder: false });
      return;
    }
    const from = anchor === null ? -1 : sorted.findIndex((row) => row.rpmId === anchor);
    if (event.shiftKey && from >= 0) {
      const [low, high] = from < index ? [from, index] : [index, from];
      selected = new Set(sorted.slice(low, high + 1).map((row) => row.rpmId));
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selected);
      if (next.has(track.rpmId)) next.delete(track.rpmId);
      else next.add(track.rpmId);
      selected = next;
    } else {
      selected = new Set([track.rpmId]);
    }
    anchor = track.rpmId;
  }

  // A right click on a song outside the selection selects that song alone, as on the desktop.
  function menuFor(track: CloudTrack, index: number) {
    if (selected.size > 1 && selected.has(track.rpmId)) return selectionMenu(sorted.filter((row) => selected.has(row.rpmId)));
    if (precise) {
      selected = new Set([track.rpmId]);
      anchor = track.rpmId;
    }
    return trackMenu(track, sorted, index, { inAlbumOrder: false, album: catalogue.albums.find((held) => held.tracks.some((row) => row.rpmId === track.rpmId)) });
  }

  function keys(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selected = new Set(sorted.map((row) => row.rpmId));
    } else if (event.key === 'Escape') {
      selected = new Set();
    }
  }

  const cell = (column: Column, track: CloudTrack): string => {
    const value = column.read(track);
    if (column.id === 'length') {
      const total = Math.round(value as number);
      return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : '';
    }
    return value === 0 ? '' : String(value);
  };
</script>

<div class="table">
  <div class="head">
    {#each COLUMNS as column (column.id)}
      <button class={column.id} class:phone={column.phone} class:on={sortBy === column.id} onclick={() => sort(column.id)}>{text(column.label)}</button>
    {/each}
  </div>
  <div class="rows" role="listbox" aria-multiselectable="true" tabindex="-1" bind:clientHeight={viewport} onscroll={(event) => (scroll = event.currentTarget.scrollTop)} onkeydown={keys}>
    <div class="tall" style:height="{sorted.length * LINE}px">
      {#each shown as track, index (track.rpmId)}
        <button
          class="row"
          role="option"
          aria-selected={selected.has(track.rpmId)}
          class:playing={now.track?.rpmId === track.rpmId}
          class:selected={selected.has(track.rpmId)}
          style:transform="translateY({(first + index) * LINE}px)"
          style:height="{LINE}px"
          onclick={(event) => choose(event, first + index)}
          ondblclick={() => precise && player.play(sorted, first + index, { inAlbumOrder: false })}
          use:menuOn={() => menuFor(track, first + index)}
        >
          {#each COLUMNS as column (column.id)}
            <span class={column.id} class:phone={column.phone}>{cell(column, track)}</span>
          {/each}
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .table {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    font-size: 12.5px;
  }

  .head,
  .row {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1.4fr) 56px minmax(0, 1fr) 56px 50px;
    gap: 10px;
    align-items: center;
    padding: 0 16px;
  }

  .head {
    border-bottom: 1px solid var(--hairline);
  }

  .head button {
    padding: 6px 0;
    border: 0;
    background: none;
    color: var(--text-soft);
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .head button.on {
    color: var(--text);
    font-weight: 700;
  }

  .rows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .tall {
    position: relative;
  }

  .row {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row.playing .title {
    color: #5fe08a;
  }

  .row.selected {
    background: var(--selected);
  }

  .row span:not(.title) {
    color: var(--text-soft);
  }

  @media (hover: hover) {
    .row:not(.selected):hover {
      background: rgb(255 255 255 / 0.06);
    }
  }

  @media (max-width: 700px) {
    .head,
    .row {
      grid-template-columns: minmax(0, 1fr) 56px;
    }

    .head button:not(.phone),
    .row span:not(.phone) {
      display: none;
    }
  }
</style>

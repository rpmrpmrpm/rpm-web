<script lang="ts">
  // The data table: every track, sorted by any column, drawn only near the view. A row plays the table from
  // there, in the order on screen.
  import { durationSeconds, type CloudTrack } from '../../api/wire';
  import { player, playLog } from '../../app';
  import { library, now } from '../../state.svelte';
  import { text } from '../../strings/loc';

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
  <div class="rows" bind:clientHeight={viewport} onscroll={(event) => (scroll = event.currentTarget.scrollTop)}>
    <div class="field" style:height="{sorted.length * LINE}px">
      {#each shown as track, index (track.rpmId)}
        <button class="row" class:playing={now.track?.rpmId === track.rpmId} style:transform="translateY({(first + index) * LINE}px)" style:height="{LINE}px" onclick={() => player.play(sorted, first + index, { inAlbumOrder: false })}>
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

  .field {
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

  .row span:not(.title) {
    color: var(--text-soft);
  }

  @media (hover: hover) {
    .row:hover {
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

<script lang="ts">
  // The library pane: its heading, its keys, and the wall.
  import { catalogue } from '../../app';
  import { icons } from '../../design/icons';
  import type { AlbumOrdering } from '../../library/albums';
  import { library } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import AlbumWall from './AlbumWall.svelte';

  let { compact = false, onImport }: { compact?: boolean; onImport: () => void } = $props();

  let search = $state('');
  let target = $state(166);

  const orderings: [AlbumOrdering, string][] = [
    ['Artist', 'AlbumSort_Artist'],
    ['Album', 'AlbumSort_Album'],
    ['Added', 'AlbumSort_Added'],
  ];

  const stats = $derived.by(() => {
    const hours = Math.floor(library.seconds / 3600);
    const days = Math.floor(hours / 24);
    const time =
      days > 1
        ? text('Stats_DaysHours', days, hours % 24)
        : days === 1
          ? text('Stats_DaysHoursOne', hours % 24)
          : text('Stats_HoursMinutes', hours, Math.floor((library.seconds % 3600) / 60));
    return [text('Stats_Albums', library.albums.length), text('Stats_Songs', library.songs), time].join('  •  ');
  });

  const shown = $derived.by(() => {
    const words = search.trim().toLowerCase();
    if (!words) return library.albums;
    return library.albums.filter(
      (album) =>
        album.album.toLowerCase().includes(words) ||
        album.artist.toLowerCase().includes(words) ||
        album.tracks.some((track) => track.title?.toLowerCase().includes(words)),
    );
  });
</script>

<div class="collection" class:compact>
  <header>
    <div class="titles">
      <h2 class="heading">{text('Library_Title')}</h2>
      {#if library.state === 'ready'}<p>{stats}</p>{/if}
    </div>

    <div class="tools">
      <label class="search">
        <i class="icon">{icons.search}</i>
        <input type="search" placeholder={text('Review_SearchPlaceholder')} bind:value={search} />
      </label>
      <select aria-label={text('AlbumSort_Tooltip')} onchange={(event) => catalogue.setOrdering(event.currentTarget.value as AlbumOrdering)}>
        {#each orderings as [ordering, key]}
          <option value={ordering}>{text(key)}</option>
        {/each}
      </select>
      {#if !compact}
        <input class="size" type="range" min="120" max="280" step="2" aria-label={text('Library_ViewGrid')} bind:value={target} />
      {/if}
    </div>
  </header>

  {#if library.stale}
    <div class="band" role="status">
      <span>{text('Rpm_Library_Error')}</span>
      <button class="link" onclick={() => catalogue.refresh()}>{text('Rpm_Library_Retry')}</button>
    </div>
  {/if}

  {#if library.state === 'ready' && library.albums.length > 0}
    <AlbumWall albums={shown} {target} {compact} />
  {:else if library.state === 'ready'}
    <div class="message">
      <p>{text('Web_LibraryEmpty')}</p>
      <button class="glass-button primary" onclick={onImport}>{text('Queue_Title')}</button>
    </div>
  {:else if library.state === 'failed'}
    <div class="message">
      <p>{text('Rpm_Library_Error')}</p>
      <button class="glass-button" onclick={() => catalogue.refresh()}>{text('Rpm_Library_Retry')}</button>
    </div>
  {:else if library.state === 'reading'}
    <p class="message">{text('Tv_Library_ReadingCount', library.read)}</p>
  {/if}
</div>

<style>
  .collection {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    align-items: flex-start;
    justify-content: space-between;
    padding: 14px 16px 8px;
  }

  .titles p {
    margin: 2px 0 0;
    color: var(--text-soft);
    font-size: 12px;
    white-space: pre;
  }

  .tools {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .search {
    display: flex;
    gap: 8px;
    align-items: center;
    height: 30px;
    padding: 0 9px;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    background: rgb(0 0 0 / 0.15);
    color: rgb(255 255 255 / 0.6);
    font-size: 12px;
  }

  .search input {
    width: 150px;
    border: 0;
    background: none;
    outline: none;
    font-size: 16px;
  }

  @media (pointer: fine) {
    .search input {
      font-size: 12px;
    }
  }

  select {
    height: 30px;
    padding: 0 6px;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    background: rgb(0 0 0 / 0.15);
    font-size: 12px;
  }

  .size {
    width: 110px;
    accent-color: #fff;
  }

  .compact .tools {
    width: 100%;
  }

  .compact .search {
    flex: 1;
  }

  .compact .search input {
    width: 100%;
  }

  .band {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    margin: 0 16px 8px;
    padding: 8px 12px;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.08);
    font-size: 13px;
  }

  .message {
    padding: 24px 16px;
    color: var(--text-soft);
  }
</style>

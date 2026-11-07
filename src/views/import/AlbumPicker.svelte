<script lang="ts">
  // A record in the collection, picked by name.
  import { untrack } from 'svelte';

  import { catalogue } from '../../app';
  import { findAlbums } from '../../import/from-collection';
  import type { CloudAlbum } from '../../library/albums';
  import { text } from '../../strings/loc';
  import Sleeve from '../library/Sleeve.svelte';
  import Window from './Window.svelte';

  let { seed, onPick, onClose }: { seed: string; onPick: (album: CloudAlbum) => void; onClose: () => void } = $props();

  let words = $state(untrack(() => seed));
  const found = $derived(findAlbums(catalogue.albums, words));
</script>

<Window title={text('Lookup_FromLibrary')} {onClose}>
  <input class="field" aria-label={text('Lookup_SearchButton')} placeholder={text('Lookup_SearchButton')} bind:value={words} />
  {#if found.length}
    <ul>
      {#each found as album (album.key)}
        <li>
          <button onclick={() => onPick(album)}>
            <Sleeve {album} size={40} />
            <span class="words"><strong>{album.album}</strong><small>{album.artist}{album.year ? `  •  ${album.year}` : ''}</small></span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p>{text('Lookup_NoResults')}</p>
  {/if}
</Window>

<style>
  ul {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    display: flex;
    gap: 10px;
    align-items: center;
    width: 100%;
    padding: 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  button:hover {
    background: var(--glass-face);
  }

  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 13px;
    font-weight: 400;
  }

  small {
    color: var(--text-soft);
    font-size: 11.5px;
  }

  p {
    margin: 0;
    color: var(--text-soft);
    font-size: 12.5px;
  }
</style>

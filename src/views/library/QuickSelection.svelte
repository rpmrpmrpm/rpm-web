<script lang="ts" module>
  import type { CloudTrack } from '../../api/wire';
  import type { CloudAlbum } from '../../library/albums';

  export interface QuickEntry {
    key: string;
    title: string;
    line: string;
    album: CloudAlbum | undefined;
    tracks: CloudTrack[];
  }
</script>

<script lang="ts">
  // The quick selection under the banner: what is played most, of whatever kind, in four lists. A press plays.
  import { player } from '../../app';
  import { icons } from '../../design/icons';
  import { inPanels } from '../../library/home-features';
  import { text } from '../../strings/loc';
  import { menuOn, type MenuEntry } from '../menu/menu.svelte';
  import { albumMenu, trackMenu } from './record-menu.svelte';
  import Sleeve from './Sleeve.svelte';

  let { entries }: { entries: QuickEntry[] } = $props();

  const panels = $derived(inPanels(entries));
  const playAll = () => player.play(entries.flatMap((entry) => entry.tracks), 0, { inAlbumOrder: false });

  // One song is a song's menu, and a whole record is a record's.
  const menuOf = async (entry: QuickEntry): Promise<MenuEntry[]> => (entry.album && entry.tracks.length > 1 ? albumMenu(entry.album, 'collection') : trackMenu(entry.tracks[0]!, entry.tracks, 0, { inAlbumOrder: false, album: entry.album }));
</script>

{#if entries.length}
  <section>
    <header>
      <h3>{text('Home_QuickPicks')}</h3>
      <button class="play-all" onclick={playAll}><i class="icon">{icons.play}</i>{text('Home_PlayAllTracks')}</button>
    </header>
    <div class="panels">
      {#each panels as panel}
        <ul>
          {#each panel as entry (entry.key)}
            <li>
              <button onclick={() => player.play(entry.tracks, 0, { inAlbumOrder: entry.tracks.length > 1 })} use:menuOn={() => menuOf(entry)}>
                <Sleeve album={entry.album} size={48} />
                <span class="words">
                  <strong>{entry.title}</strong>
                  <small>{entry.line}</small>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/each}
    </div>
  </section>
{/if}

<style>
  section {
    margin-bottom: 26px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  h3 {
    margin: 0;
    color: rgb(255 255 255 / 0.67);
    font-size: 12px;
    font-weight: 600;
  }

  .play-all {
    display: inline-flex;
    gap: 7px;
    align-items: center;
    height: 28px;
    padding: 0 14px;
    border: 1px solid rgb(255 255 255 / 0.149);
    border-radius: 14px;
    background: rgb(255 255 255 / 0.078);
    color: rgb(255 255 255 / 0.95);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .play-all .icon {
    font-size: 10px;
  }

  @media (hover: hover) {
    .play-all:hover {
      background: rgb(255 255 255 / 0.14);
    }
  }

  .panels {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(max(210px, 24%), 1fr));
    gap: 0 10px;
    margin-left: -8px;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li button {
    display: flex;
    gap: 10px;
    align-items: center;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  li button:hover {
    background: rgb(255 255 255 / 0.08);
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: rgb(255 255 255 / 0.95);
    font-size: 12.5px;
    font-weight: 600;
  }

  small {
    color: rgb(255 255 255 / 0.6);
    font-size: 11px;
  }
</style>

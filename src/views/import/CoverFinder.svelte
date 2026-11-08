<script lang="ts">
  // Find cover art or disc art: every source the API can reach, and one picture chosen from them. A cover
  // that comes with its disc brings both.
  import { untrack } from 'svelte';

  import { coverSearch } from '../../app';
  import { icons } from '../../design/icons';
  import type { CoverCandidate, CoverKind, PickedPicture } from '../../import/cover-search';
  import { text } from '../../strings/loc';
  import Window from './Window.svelte';
  import RecordSpinner from '../library/RecordSpinner.svelte';

  let { kind, artist, album, onUse, onClose }: {
    kind: CoverKind;
    artist: string;
    album: string;
    onUse: (picture: PickedPicture, disc: PickedPicture | null) => void;
    onClose: () => void;
  } = $props();

  const thumbOf = (cover: CoverCandidate) => (kind === 'disc' ? (cover.discThumbUrl ?? cover.thumbUrl) : cover.thumbUrl);

  let artistWords = $state(untrack(() => artist));
  let albumWords = $state(untrack(() => album));
  let available = $state<string[]>([]);
  let chosen = $state<string[]>([]);
  let found = $state<CoverCandidate[]>([]);
  let thumbs = $state<Record<string, string>>({});
  let note = $state(text('CoverSearch_EmptyStart'));
  let searching = $state(false);
  let fetching = $state(false);
  let run = 0;

  async function search(event?: SubmitEvent) {
    event?.preventDefault();
    if (!artistWords.trim() && !albumWords.trim()) return;
    const mine = ++run;
    searching = true;
    found = [];
    note = text('CoverSearch_Searching');
    try {
      const answer = await coverSearch.search(artistWords, albumWords, chosen, kind);
      if (mine !== run) return;
      found = answer;
      note = answer.length ? text('CoverSearch_Found', answer.length, new Set(answer.map((cover) => cover.source)).size) : text(kind === 'disc' ? 'CoverSearch_NoDiscs' : 'CoverSearch_NoResults');
      for (const cover of answer) {
        void coverSearch.shown(thumbOf(cover)).then((shown) => {
          if (shown && mine === run) thumbs[thumbOf(cover)] = shown;
        });
      }
    } catch {
      if (mine === run) note = text('CoverSearch_NoSources');
    } finally {
      if (mine === run) searching = false;
    }
  }

  async function use(cover: CoverCandidate) {
    const both = kind === 'cover' && cover.discUrl;
    fetching = true;
    note = text(both ? 'CoverSearch_FetchingBoth' : 'CoverSearch_Fetching');
    const addresses = kind === 'disc' ? [cover.discUrl ?? cover.fullUrl, thumbOf(cover)] : [cover.fullUrl, cover.thumbUrl];
    const picture = await coverSearch.download(addresses).catch(() => null);
    const disc = both ? await coverSearch.download([cover.discUrl, cover.discThumbUrl]).catch(() => null) : null;
    fetching = false;
    if (picture) onUse(picture, disc);
    else note = text('CoverSearch_CouldNotFetch');
  }

  void coverSearch
    .sources(untrack(() => kind))
    .then((names) => {
      available = names;
      chosen = names;
    })
    .catch(() => {})
    .finally(() => void search());
</script>

<Window title={text(kind === 'disc' ? 'CoverSearch_HeadingDisc' : 'CoverSearch_Heading')} glyph={icons.image} minWidth={820} maxWidth={1400} openWidth={1020} minHeight={480} openHeight={660} {onClose}>
  <form onsubmit={search}>
    <input class="field" aria-label={text('Lookup_Artist')} placeholder={text('Lookup_Artist')} bind:value={artistWords} />
    <input class="field" aria-label={text('Lookup_Album')} placeholder={text('Lookup_Album')} bind:value={albumWords} />
    <button class="glass-button" type="submit" disabled={searching}><i class="icon">{icons.search}</i>{text('CoverSearch_Search')}</button>
  </form>

  {#if available.length}
    <div class="sources" role="group" aria-label={text('CoverSearch_SourcesKicker')}>
      {#each available as source}
        <label><input type="checkbox" value={source} bind:group={chosen} /> {source}</label>
      {/each}
    </div>
  {/if}

  {#if kind === 'disc'}<p>{text('CoverSearch_DiscSourcesShort')}</p>{/if}
  <p role="status">{note}</p>

  {#if searching && !found.length}<div class="asking"><RecordSpinner size={52} /></div>{/if}
  <div class="covers">
    {#each found as cover (cover.fullUrl)}
      <button class="cover" disabled={fetching} title={text('CoverSearch_Use')} onclick={() => use(cover)}>
        <span class="art">{#if thumbs[thumbOf(cover)]}<img src={thumbs[thumbOf(cover)]} alt="" loading="lazy" />{/if}</span>
        <small>{cover.source}{cover.width ? `  •  ${cover.width} × ${cover.height}` : ''}</small>
        {#if kind === 'cover' && cover.discUrl}<small>{text('CoverSearch_IncludesDisc')}</small>{/if}
      </button>
    {/each}
  </div>

  {#snippet footer()}
    <button class="glass-button" onclick={onClose}><i class="icon">{icons.close}</i>{text('Settings_Close')}</button>
  {/snippet}
</Window>

<style>
  .asking {
    display: grid;
    place-items: center;
    padding: 32px 0;
  }

  form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: 10px;
  }

  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 12.5px;
  }

  p {
    margin: 0;
    color: var(--text-soft);
    font-size: 12.5px;
  }

  .covers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }

  .cover {
    display: grid;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .art {
    display: block;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 6px;
    background: rgb(255 255 255 / 0.08);
  }

  .art img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  small {
    color: var(--text-soft);
    font-size: 11px;
  }

  @media (max-width: 699px) {
    form {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>

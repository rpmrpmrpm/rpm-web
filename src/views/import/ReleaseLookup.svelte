<script lang="ts">
  // Look up release: search the catalogues, pick a pressing, then see what it would do to each file.
  import { untrack } from 'svelte';

  import { coverSearch, importQueue, releaseLookup, session } from '../../app';
  import type { FillLine, ImportRow } from '../../import/queue';
  import { canSearch, fitOf, GOOD_MATCH, orderResults, type ReleaseDetail, type ReleaseMedia, type ReleaseQuery, type ReleaseResult, type SourceAnswer } from '../../import/release';
  import { text } from '../../strings/loc';
  import Window from './Window.svelte';

  let { rows, onClose, onDone }: { rows: ImportRow[]; onClose: () => void; onDone: (note: string) => void } = $props();

  const SHORTLIST = 5;
  const MEDIA: [ReleaseMedia, string][] = [
    ['any', 'Media_Any'],
    ['cd', 'Media_Cd'],
    ['vinyl', 'Media_Vinyl'],
    ['cassette', 'Media_Cassette'],
    ['digital', 'Media_Digital'],
  ];

  const first = untrack(() => rows[0]?.tags);
  let query = $state<ReleaseQuery>({
    album: first?.Album ?? '',
    artist: first?.AlbumArtist ?? first?.Artist ?? '',
    media: 'any',
    catalogNumber: first?.CatalogNumber ? String(first.CatalogNumber) : '',
    barcode: first?.Barcode ? String(first.Barcode) : '',
    country: '',
    year: 0,
  });

  let step = $state<'release' | 'tracks'>('release');
  let results = $state<ReleaseResult[]>([]);
  let sources = $state<SourceAnswer[]>([]);
  let searching = $state(false);
  let searched = $state(false);
  let fits = $state<Record<string, number>>({});
  let thumbs = $state<Record<string, string>>({});
  let refusal = $state('');

  let picked = $state<ReleaseResult | null>(null);
  let detail = $state<ReleaseDetail | null>(null);
  // The rows stay plain objects, so the fill writes to the real queue. Only what can be edited here is state.
  let lines = $state.raw<FillLine[]>([]);
  let edits = $state<{ title: string; artist: string; selected: boolean }[]>([]);
  let albumFields = $state(true);
  let overwriteArt = $state(false);
  let working = $state(false);

  let run = 0;
  const lengths = untrack(() => rows.map((row) => row.tags.DurationSeconds ?? 0).filter((length) => length > 0));
  const idOf = (result: ReleaseResult) => `${result.provider}/${result.id}`;

  const sourceLine = (source: SourceAnswer): string => {
    if (source.state === 'found') return text('Lookup_SourceFound', source.name, source.found);
    if (source.state === 'none') return text('Lookup_SourceNone', source.name);
    if (source.state === 'unavailable') return text('Lookup_SourceUnavailable', source.name);
    if (source.state === 'failed') return text('Lookup_SourceFailed', source.name);
    return text('Lookup_SourceSearching', source.name);
  };

  async function ask(index: number, find: () => Promise<ReleaseResult[] | null>, mine: number) {
    try {
      const found = await find();
      if (mine !== run) return;
      sources[index] = { ...sources[index]!, state: found === null ? 'unavailable' : found.length ? 'found' : 'none', found: found?.length ?? 0 };
      if (found) results = orderResults([...results, ...found], query);
    } catch {
      if (mine === run) sources[index] = { ...sources[index]!, state: 'failed' };
    }
  }

  // Only the shortlist is worth a listing each: the rest keep the free order.
  async function weigh(mine: number) {
    for (const result of results.slice(0, SHORTLIST)) {
      if (mine !== run) return;
      if (!lengths.length) break;
      const listing = await releaseLookup.detail(result).catch(() => null);
      if (listing?.tracks.length && mine === run) fits[idOf(result)] = fitOf(listing, lengths);
    }
    if (mine === run && Object.keys(fits).length) {
      const rank = (result: ReleaseResult) => fits[idOf(result)] ?? result.relevance;
      results = [...results].sort((a, b) => rank(b) - rank(a));
    }
  }

  async function showThumbs(mine: number) {
    await Promise.all(
      results.map(async (result) => {
        const address = await releaseLookup.coverOf(result, 250).catch(() => null);
        const shown = address ? await coverSearch.shown(address) : null;
        if (shown && mine === run) thumbs[idOf(result)] = shown;
      }),
    );
  }

  async function search(event?: SubmitEvent) {
    event?.preventDefault();
    if (!canSearch(query)) return;
    const mine = ++run;
    searching = true;
    searched = true;
    refusal = '';
    results = [];
    fits = {};
    sources = [
      { name: text('Lookup_SourceRpm'), state: 'searching', found: 0 },
      { name: 'Discogs', state: 'searching', found: 0 },
    ];
    const asking = $state.snapshot(query);
    await Promise.all([ask(0, () => releaseLookup.searchRpm(asking), mine), ask(1, () => releaseLookup.searchDiscogs(asking), mine)]);
    if (mine !== run) return;
    searching = false;
    void showThumbs(mine);
    await weigh(mine);
  }

  async function use(result: ReleaseResult) {
    picked = result;
    working = true;
    refusal = '';
    try {
      const listing = await releaseLookup.detail(result);
      if (!listing.tracks.length) {
        refusal = text('Lookup_NoListing');
        return;
      }
      detail = listing;
      lines = importQueue.fillFrom(rows, listing);
      edits = lines.map(({ title, artist, selected }) => ({ title, artist, selected }));
      step = 'tracks';
    } catch {
      refusal = text('Lookup_SourceFailed', result.provider === 'rpm' ? text('Lookup_SourceRpm') : 'Discogs');
    } finally {
      working = false;
    }
  }

  async function apply() {
    if (!detail || !picked) return;
    working = true;
    const named = importQueue.applyFill(lines.map((line, index) => ({ ...line, ...edits[index]! })), detail, albumFields);
    if (overwriteArt) {
      const address = detail.coverUrl ?? (await releaseLookup.coverOf({ ...picked, coverUrl: null }, 1200).catch(() => null));
      const picture = address ? await coverSearch.download([address, picked.coverUrl]) : null;
      if (picture) importQueue.setCover(rows, picture);
    }
    working = false;
    onDone(text('Queue_NamedTracks', named, lines.length));
    onClose();
  }

  const matched = $derived(lines.filter((line) => line.track).length);
  const albumSummary = $derived(detail ? [detail.title, detail.artist, detail.year || null, detail.label].filter(Boolean).join('   ·   ') : '');
  const connectDiscogs = $derived(sources.some((source) => source.name === 'Discogs' && source.state === 'unavailable'));

  async function connect() {
    const tab = window.open('', '_blank');
    const address = await session.startDiscogs();
    if (address && tab) tab.location.href = address;
    else tab?.close();
  }

  if (canSearch(query)) void search();
</script>

<Window title={text('Lookup_Heading')} wide {onClose}>
  {#if step === 'release'}
    <form onsubmit={search}>
      <label><span>{text('Lookup_Album')}</span><input class="field" bind:value={query.album} /></label>
      <label><span>{text('Lookup_Artist')}</span><input class="field" bind:value={query.artist} /></label>
      <label><span>{text('Lookup_CatalogNumber')}</span><input class="field" placeholder={text('Lookup_CatalogHint')} bind:value={query.catalogNumber} /></label>
      <label><span>{text('Lookup_Barcode')}</span><input class="field" inputmode="numeric" placeholder={text('Lookup_BarcodeHint')} bind:value={query.barcode} /></label>
      <label><span>{text('Lookup_Country')}</span><input class="field" placeholder={text('Lookup_CountryHint')} bind:value={query.country} /></label>
      <label>
        <span>{text('Lookup_Media')}</span>
        <select class="field" bind:value={query.media}>
          {#each MEDIA as [media, key]}<option value={media}>{text(key)}</option>{/each}
        </select>
      </label>
      <button class="glass-button primary" type="submit" disabled={searching || !canSearch(query)}>{searching ? text('Lookup_Searching') : text('Lookup_SearchButton')}</button>
    </form>

    {#if sources.length}
      <p class="sources" role="status">
        {sources.map(sourceLine).join('   ·   ')}
        {#if connectDiscogs}<button class="link" onclick={connect}>{text('Catalog_DiscogsConnect')}</button>{/if}
      </p>
    {/if}
    {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}

    {#if results.length}
      <ul class="results">
        {#each results as result (idOf(result))}
          <li>
            <span class="thumb">{#if thumbs[idOf(result)]}<img src={thumbs[idOf(result)]} alt="" loading="lazy" />{/if}</span>
            <span class="words">
              <strong>{result.title}</strong>
              <span>{result.artist ?? ''}</span>
              <small>{[result.year || null, result.country, result.format, result.trackCount ? text('Home_Songs', result.trackCount) : null, result.label, result.catalogNumber].filter(Boolean).join('  •  ')}</small>
            </span>
            {#if (fits[idOf(result)] ?? 0) >= GOOD_MATCH}<span class="fit" title={text('Lookup_TracksHeading')}></span>{/if}
            <button class="glass-button" disabled={working} onclick={() => use(result)}>{text('Lookup_Use')}</button>
          </li>
        {/each}
      </ul>
    {:else if searched && !searching}
      <p class="soft">{text('Lookup_NoResults')}</p>
    {:else if !searched}
      <p class="soft">{text('Lookup_EmptyHint')}</p>
    {/if}
  {:else if detail}
    <p class="soft">{text('Lookup_TracksFrom', detail.title, detail.tracks.length)}  •  {text('Lookup_TracksMatched', matched, lines.length)}</p>

    <div class="scroller">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>{text('Lookup_ColCurrent')}</th>
            <th>{text('Review_ColTrack')}</th>
            <th>{text('Review_ColTitle')}</th>
            <th>{text('Review_ColArtist')}</th>
          </tr>
        </thead>
        <tbody>
          {#each lines as line, index (line.row.id)}
            <tr class:unmatched={!line.track}>
              <td><input type="checkbox" aria-label={line.title || line.row.path} disabled={!line.track} bind:checked={edits[index]!.selected} /></td>
              <td class="now">{line.row.tags.Title ?? line.row.file.name}</td>
              {#if line.track}
                <td>{line.track.discPosition || line.track.position}</td>
                <td><input class="field" aria-label={text('Review_ColTitle')} bind:value={edits[index]!.title} /></td>
                <td><input class="field" aria-label={text('Review_ColArtist')} bind:value={edits[index]!.artist} /></td>
              {:else}
                <td colspan="3" class="soft">{text('Lookup_NoTrackOnRelease')}</td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <label class="tick"><input type="checkbox" bind:checked={albumFields} /> {text('Lookup_AlbumFields')}</label>
    {#if albumFields}<p class="soft">{albumSummary}</p>{/if}
    <label class="tick"><input type="checkbox" bind:checked={overwriteArt} /> {text('Lookup_OverwriteArt')}</label>

    <div class="keys">
      <button class="glass-button" onclick={() => (step = 'release')}>{text('Lookup_Back')}</button>
      <button class="glass-button primary" disabled={working} onclick={apply}>{text('Lookup_ApplyTracks')}</button>
    </div>
  {/if}
</Window>

<style>
  form {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 12px;
    align-items: end;
  }

  label span {
    display: block;
    margin-bottom: 3px;
    color: var(--text-soft);
    font-size: 11.5px;
  }

  p {
    margin: 0;
    font-size: 13px;
  }

  .soft,
  .sources {
    color: var(--text-soft);
    font-size: 12.5px;
  }

  .refusal {
    color: var(--error);
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 6px;
    border-radius: 6px;
  }

  li:nth-child(odd) {
    background: rgb(255 255 255 / 0.04);
  }

  .thumb {
    flex: none;
    width: 52px;
    height: 52px;
    overflow: hidden;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.08);
  }

  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .words {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    font-size: 13px;
  }

  .words small {
    color: var(--text-soft);
    font-size: 11.5px;
  }

  .fit {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #5fe08a;
  }

  .scroller {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  th {
    padding: 4px 6px;
    color: var(--text-soft);
    font-size: 11px;
    font-weight: 400;
    text-align: left;
  }

  td {
    padding: 3px 6px;
  }

  .now {
    max-width: 220px;
    overflow: hidden;
    color: var(--text-soft);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  tr.unmatched .now {
    color: var(--text-faint);
  }

  td .field {
    width: 100%;
    min-width: 130px;
  }

  .tick {
    font-size: 13px;
  }

  .keys {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  @media (max-width: 699px) {
    form {
      grid-template-columns: minmax(0, 1fr);
    }

    li {
      flex-wrap: wrap;
    }
  }
</style>

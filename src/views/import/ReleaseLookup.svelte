<script lang="ts">
  // Look up release: search the catalogues, pick a pressing, then see what it would do to each file.
  import { untrack } from 'svelte';

  import { coverSearch, importQueue, releaseLookup, session } from '../../app';
  import type { FillLine, ImportQueue, ImportRow } from '../../import/queue';
  import { canSearch, fitOf, GOOD_MATCH, orderResults, type ReleaseDetail, type ReleaseMedia, type ReleaseQuery, type ReleaseResult, type SourceAnswer } from '../../import/release';
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';
  import Window from './Window.svelte';
  import RecordSpinner from '../library/RecordSpinner.svelte';

  // The queue the result is written to. The edit windows give a queue of their own, over rows that stand for
  // the tracks they edit, so the same lookup fills their boxes.
  let { rows, onClose, onDone, queue = importQueue }: { rows: ImportRow[]; onClose: () => void; onDone: (note: string) => void; queue?: Pick<ImportQueue, 'fillFrom' | 'applyFill' | 'setCover'> } = $props();

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

  // The row chosen in the list. Nothing happens to the files until the footer's key is pressed.
  let chosen = $state<ReleaseResult | null>(null);
  let setTracks = $state(true);
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

  function clear() {
    query = { album: '', artist: '', media: 'any', catalogNumber: '', barcode: '', country: '', year: 0 };
    run++;
    searching = false;
    searched = false;
    results = [];
    sources = [];
    chosen = null;
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
    chosen = null;
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
      lines = queue.fillFrom(rows, listing);
      edits = lines.map(({ title, artist, selected }) => ({ title, artist, selected }));
      if (setTracks) step = 'tracks';
      else await apply();
    } catch {
      refusal = text('Lookup_SourceFailed', result.provider === 'rpm' ? text('Lookup_SourceRpm') : 'Discogs');
    } finally {
      working = false;
    }
  }

  async function apply() {
    if (!detail || !picked) return;
    working = true;
    const named = queue.applyFill(
      lines.map((line, index) => ({ ...line, ...edits[index]!, selected: setTracks && edits[index]!.selected })),
      detail,
      albumFields,
    );
    if (overwriteArt) {
      const address = detail.coverUrl ?? (await releaseLookup.coverOf({ ...picked, coverUrl: null }, 1200).catch(() => null));
      const picture = address ? await coverSearch.download([address, picked.coverUrl]) : null;
      if (picture) queue.setCover(rows, picture);
    }
    working = false;
    onDone(text('Queue_NamedTracks', named, lines.length));
    onClose();
  }

  const asked = $derived(
    [query.album && `${text('Lookup_Album')}: ${query.album}`, query.artist && `${text('Lookup_Artist')}: ${query.artist}`, query.catalogNumber, query.barcode].filter(Boolean).join('   ·   '),
  );
  const matched = $derived(lines.filter((line) => line.track).length);
  const albumSummary = $derived(detail ? [detail.title, detail.artist, detail.year || null, detail.label].filter(Boolean).join('   ·   ') : '');
  const connectDiscogs = $derived(sources.some((source) => source.name === 'Discogs' && source.state === 'unavailable'));

  async function connect() {
    const tab = window.open('', '_blank');
    const address = await session.startDiscogs();
    if (address && tab) tab.location.href = address;
    else tab?.close();
  }

  if (untrack(() => canSearch(query))) void search();
</script>

<Window title={text('Lookup_Heading')} glyph={icons.search} minWidth={820} maxWidth={1180} minHeight={460} openHeight={620} {onClose}>
  {#if step === 'release'}
    <div class="sides">
      <form onsubmit={search}>
        <h3 class="kicker">{text('Lookup_SearchKicker')}</h3>
        <label><span>{text('Lookup_Album')}</span><input class="field" bind:value={query.album} /></label>
        <label><span>{text('Lookup_Artist')}</span><input class="field" bind:value={query.artist} /></label>
        <div class="pair">
          <label><span>{text('Review_ColYear')}</span><input class="field" inputmode="numeric" value={query.year || ''} oninput={(event) => (query.year = Number(event.currentTarget.value) || 0)} /></label>
          <label class="near"><span>{text('Lookup_Country')}</span><input class="field" placeholder={text('Lookup_CountryHint')} bind:value={query.country} /></label>
        </div>
        <label>
          <span>{text('Lookup_Media')}</span>
          <select class="field media" bind:value={query.media}>
            {#each MEDIA as [media, key]}<option value={media}>{text(key)}</option>{/each}
          </select>
        </label>
        <label><span>{text('Lookup_CatalogNumber')}</span><input class="field" placeholder={text('Lookup_CatalogHint')} bind:value={query.catalogNumber} /></label>
        <label><span>{text('Lookup_Barcode')}</span><input class="field" inputmode="numeric" placeholder={text('Lookup_BarcodeHint')} bind:value={query.barcode} /></label>
        <div class="search-keys">
          <button class="glass-button" type="button" title={text('Lookup_ClearTooltip')} onclick={clear}><i class="icon">{icons.eraser}</i>{text('Lookup_Clear')}</button>
          <button class="glass-button" type="submit" disabled={searching || !canSearch(query)}><i class="icon">{icons.search}</i>{searching ? text('Lookup_Searching') : text('Lookup_SearchButton')}</button>
        </div>
      </form>

      <section class="found">
        <h3 class="kicker">{text('Lookup_ResultsKicker')}</h3>
        {#if asked && searched}<p class="asked"><i class="icon">{icons.search}</i>{asked}</p>{/if}
        {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}

        {#if results.length}
          <ul class="results">
            {#each results as result (idOf(result))}
              <li>
                <button class:on={chosen === result} aria-pressed={chosen === result} onclick={() => (chosen = result)} ondblclick={() => use(result)}>
                  <span class="thumb">{#if thumbs[idOf(result)]}<img src={thumbs[idOf(result)]} alt="" loading="lazy" />{/if}</span>
                  <span class="words">
                    <strong>{result.title}</strong>
                    <small>{[result.artist, result.year || null, result.country, result.format, result.catalogNumber, result.label].filter(Boolean).join(' · ')}</small>
                  </span>
                  {#if (fits[idOf(result)] ?? 0) >= GOOD_MATCH}<span class="fit" title={text('Lookup_TracksHeading')}></span>{/if}
                  {#if thumbs[idOf(result)]}<i class="icon art" title={text('Lookup_ArtTooltip')}>{icons.image}</i>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {:else if searching}
          <div class="asking"><RecordSpinner size={52} /></div>
        {:else if searched}
          <p class="soft">{text('Lookup_NoResults')}</p>
        {:else if !searched}
          <p class="soft">{text('Lookup_EmptyHint')}</p>
        {/if}
      </section>
    </div>
  {:else if detail}
    <ol class="steps">
      <li>{text('Lookup_StepRelease')}</li>
      <li class="on">{text('Lookup_StepTracks')}</li>
    </ol>
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
  {/if}

  {#snippet leading()}
    {#if step === 'release' && sources.length}
      <p class="sources" role="status">
        <span>{text('Search_Found', results.length)}</span>
        {#each sources as source}
          <span class="source"><i class="icon" class:found={source.state === 'found'}>{source.state === 'found' || source.state === 'none' ? icons.check : icons.minus}</i>{sourceLine(source)}</span>
        {/each}
        {#if connectDiscogs}<button class="link" onclick={connect}>{text('Catalog_DiscogsConnect')}</button>{/if}
      </p>
    {/if}
  {/snippet}

  {#snippet footer()}
    {#if step === 'release'}
      <label class="tick"><input type="checkbox" bind:checked={setTracks} /> {text('Lookup_SetTrackMetadata')}</label>
      <label class="tick"><input type="checkbox" bind:checked={overwriteArt} /> {text('Lookup_OverwriteArt')}</label>
      <button class="glass-button" onclick={onClose}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
      <button class="glass-button primary" disabled={!chosen || working} onclick={() => chosen && use(chosen)}><i class="icon">{icons.check}</i>{text(setTracks ? 'Lookup_Next' : 'Lookup_Use')}</button>
    {:else}
      <label class="tick"><input type="checkbox" bind:checked={overwriteArt} /> {text('Lookup_OverwriteArt')}</label>
      <button class="glass-button" onclick={() => (step = 'release')}><i class="icon">{icons.back}</i>{text('Lookup_Back')}</button>
      <button class="glass-button primary" disabled={working} onclick={apply}><i class="icon">{icons.check}</i>{text('Lookup_ApplyTracks')}</button>
    {/if}
  {/snippet}
</Window>

<style>
  .asking {
    display: grid;
    place-items: center;
    padding: 32px 0;
  }

  .sides {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
    gap: 30px;
    min-height: 0;
  }

  form,
  .found {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }

  h3 {
    margin: 0 0 4px;
    padding-bottom: 5px;
    border-bottom: 1px solid rgb(255 255 255 / 0.1);
    text-transform: uppercase;
  }

  label:not(.tick) {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    font-size: 12px;
  }

  label:not(.tick) span {
    color: rgb(255 255 255 / 0.75);
  }

  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr);
    gap: 10px;
  }

  label.near {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .media {
    max-width: 150px;
  }

  .search-keys {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 6px;
  }

  p {
    margin: 0;
    font-size: 12px;
  }

  .soft {
    color: rgb(255 255 255 / 0.55);
  }

  .asked {
    display: flex;
    gap: 8px;
    align-items: center;
    color: rgb(255 255 255 / 0.7);
  }

  .asked .icon {
    font-size: 11px;
  }

  .refusal {
    color: var(--error);
  }

  .results {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .results button {
    display: flex;
    gap: 12px;
    align-items: center;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .results button:hover {
    background: rgb(255 255 255 / 0.06);
  }

  .results button.on {
    background: rgb(3 113 208 / 0.3);
  }

  .thumb {
    flex: none;
    width: 62px;
    height: 62px;
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
    gap: 3px;
    min-width: 0;
  }

  .words strong {
    overflow: hidden;
    font-size: 13.5px;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .words small {
    color: rgb(255 255 255 / 0.55);
    font-size: 12px;
  }

  .art {
    flex: none;
    margin-right: 10px;
    color: rgb(255 255 255 / 0.55);
    font-size: 12px;
  }

  .fit {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--found);
  }

  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    align-items: center;
    color: rgb(255 255 255 / 0.7);
  }

  .source {
    display: inline-flex;
    gap: 7px;
    align-items: center;
  }

  .source .icon {
    color: rgb(255 255 255 / 0.4);
    font-size: 10px;
  }

  .source .icon.found {
    color: var(--found);
  }

  .tick {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    font-size: 13px;
    white-space: nowrap;
    cursor: pointer;
  }

  .steps {
    display: flex;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .steps li {
    padding: 4px 12px;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.06);
    color: rgb(255 255 255 / 0.55);
    font-size: 11.5px;
  }

  .steps li.on {
    background: rgb(3 113 208 / 0.35);
    color: #fff;
  }

  .scroller {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  th {
    padding: 3px 6px;
    color: rgb(255 255 255 / 0.55);
    font-size: 11px;
    font-weight: 400;
    text-align: left;
  }

  td {
    padding: 2px 6px;
  }

  .now {
    max-width: 220px;
    overflow: hidden;
    color: rgb(255 255 255 / 0.55);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unmatched {
    opacity: 0.6;
  }

  @media (max-width: 859px) {
    .sides {
      grid-template-columns: minmax(0, 1fr);
      overflow-y: auto;
    }

    .results {
      overflow: visible;
    }
  }
</style>

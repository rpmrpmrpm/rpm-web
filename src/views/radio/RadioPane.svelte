<script lang="ts">
  // Internet radio: the dial, the search and what narrows it, and the stations. The directory is asked when the
  // typing stops, because it is run by volunteers. Choosing a row does not tune: only its key does.
  import { onMount } from 'svelte';

  import { radioDirectory, radioFavorites, radioRules, session, tuner } from '../../app';
  import { icons } from '../../design/icons';
  import { DirectoryDown } from '../../radio/directory';
  import {
    FORMATS,
    forPicker,
    GENRES,
    NO_SIEVE,
    onePerStation,
    shortCountry,
    sieveIsOn,
    sorted,
    throughSieve,
    underRules,
    withRetagged,
    type AdsWanted,
    type Country,
    type Ordering,
    type Sieve,
  } from '../../radio/results';
  import { callSign, carriesAds, displayOf, type RadioStation } from '../../radio/station';
  import { onAir } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import RadioDial from './RadioDial.svelte';
  import StationLogo from './StationLogo.svelte';

  const COUNTRY_KEY = 'rpm.radioCountry';
  const TYPING_MS = 400;

  const ORDERS: [Ordering, string][] = [
    ['listed', 'Radio_SortListed'],
    ['nameUp', 'Radio_SortNameUp'],
    ['nameDown', 'Radio_SortNameDown'],
    ['votes', 'Radio_SortVotes'],
    ['quality', 'Radio_SortQuality'],
  ];

  const ADS: [AdsWanted, string][] = [
    ['either', 'Radio_AdsEither'],
    ['without', 'Radio_AdsWithout'],
    ['with', 'Radio_AdsWith'],
  ];

  const storedCountry = () => {
    try {
      return localStorage.getItem(COUNTRY_KEY);
    } catch {
      return null;
    }
  };

  let found = $state.raw<RadioStation[]>([]);
  let countries = $state.raw<Country[]>([]);
  let asking = $state(true);
  let down = $state(false);
  let typed = $state('');
  let country = $state<string | null>(storedCountry());
  let sieve = $state.raw<Sieve>(NO_SIEVE);
  let order = $state<Ordering>('listed');
  let savedOnly = $state(false);
  let panel = $state<'country' | 'sort' | 'filter' | null>(null);
  let savedVersion = $state(0);
  let rulesVersion = $state(0);
  let searching: AbortController | null = null;

  async function search() {
    searching?.abort();
    const stop = new AbortController();
    searching = stop;
    asking = true;
    const question = { name: typed, genre: sieve.genre, countryCode: country };
    try {
      // Usually after the first search. The rules are put on when the list is read, so that does not matter.
      void radioRules.refresh().then(() => rulesVersion++);
      let answer = await radioDirectory.search(question, stop.signal);
      if (sieve.genre) {
        const uuids = radioRules.retagged(sieve.genre);
        if (uuids.length) answer = withRetagged(answer, (await radioDirectory.byUuid(uuids).catch(() => [])).filter(playable), question);
      }
      if (stop.signal.aborted) return;
      found = onePerStation(answer);
      down = false;
    } catch (error) {
      if (stop.signal.aborted) return;
      if (!(error instanceof DirectoryDown)) throw error;
      down = true;
    } finally {
      if (!stop.signal.aborted) asking = false;
    }
  }

  const hlsWorks = new Audio().canPlayType('application/vnd.apple.mpegurl') !== '';
  function playable(station: RadioStation): boolean {
    return station.streamUrl.startsWith('https://') && (!station.isHls || hlsWorks);
  }

  onMount(() => {
    const unlisten = radioFavorites.onChange(() => savedVersion++);
    const user = session.user;
    if (user) void radioFavorites.sync(user.userId).catch(() => {});
    void radioDirectory
      .countries()
      .then((list) => (countries = forPicker(list)))
      .catch(() => {});
    void search();
    return () => {
      unlisten();
      searching?.abort();
    };
  });

  let typing: ReturnType<typeof setTimeout> | undefined;
  function typedSomething() {
    clearTimeout(typing);
    typing = setTimeout(() => void search(), TYPING_MS);
  }

  function setCountry(code: string | null) {
    country = code;
    panel = null;
    try {
      if (code) localStorage.setItem(COUNTRY_KEY, code);
      else localStorage.removeItem(COUNTRY_KEY);
    } catch {
      // A preference. It holds for this visit either way.
    }
    void search();
  }

  function setGenre(genre: string | null) {
    sieve = { ...sieve, genre };
    void search();
  }

  const saved = $derived.by(() => {
    void savedVersion;
    return radioFavorites.stations;
  });
  const savedIds = $derived(new Set(saved.map((station) => station.uuid.toLowerCase())));
  const isSaved = (station: RadioStation) => savedIds.has(station.uuid.toLowerCase());

  const shown = $derived.by(() => {
    void rulesVersion;
    const base = savedOnly ? saved : found.filter(playable);
    return sorted(order, throughSieve(sieve, underRules(radioRules.rules, base)));
  });

  const countryLabel = $derived(countries.find((row) => row.code === country)?.name ?? (country ? shortCountry(country, country) : text('Radio_AllCountries')));
  const heading = $derived(shown.length === 0 ? text('Stats_Empty') : shown.length === 1 ? text('Stats_StationsOne') : text('Stats_Stations', shown.length));
  const empty = $derived.by(() => {
    if (asking && !savedOnly) return '';
    if (savedOnly && !saved.length) return text('Radio_NoFavorites');
    if (sieveIsOn(sieve)) return text('Radio_NoFilterMatch');
    return savedOnly || down ? '' : text('Radio_NoResults');
  });

  const status = $derived.by(() => {
    if (!onAir.station) return text('Radio_NothingTuned');
    if (onAir.air === 'tuning') return text('Radio_TunedTo', displayOf(onAir.station));
    if (onAir.air === 'reconnecting') return text('Radio_Reconnecting');
    return text('Radio_NoTrack');
  });

  function detail(station: RadioStation): string {
    const format = station.codec?.trim().toUpperCase();
    return [shortCountry(station.country, station.countryCode), format].filter(Boolean).join(' · ');
  }

  const isTuned = (station: RadioStation) => onAir.station?.uuid === station.uuid && onAir.wantsToPlay;
  const saveLabel = text('Radio_Save');

  function press(station: RadioStation) {
    if (isTuned(station)) tuner.stop();
    else tuner.tune(station, shown);
  }

  const closeOnOutside = (event: PointerEvent) => {
    if (panel && !(event.target as HTMLElement).closest('.panel, .opens')) panel = null;
  };
</script>

<svelte:window onpointerdown={closeOnOutside} onkeydown={(event) => event.key === 'Escape' && (panel = null)} />

<div class="radio">
  <div class="pane-head">
    <h2 class="heading">{text('Radio_Title')}</h2>
    <p class="pane-line">{heading}</p>
  </div>

  <div class="dial"><RadioDial stations={shown} tuned={onAir.station} {status} reconnecting={onAir.air === 'reconnecting'} onTune={(station) => tuner.tune(station, shown)} /></div>

  <div class="tools">
    <label class="find">
      <i class="icon">{icons.search}</i>
      <input type="search" aria-label={text('Radio_SearchPlaceholder')} placeholder={text('Radio_SearchPlaceholder')} bind:value={typed} oninput={typedSomething} />
    </label>
    <button class="tool opens country" title={text('Radio_AllCountries')} onclick={() => (panel = panel === 'country' ? null : 'country')}>
      <span>{countryLabel}</span><i class="icon">{icons.chevronDown}</i>
    </button>
    <button class="tool opens square" class:set={order !== 'listed'} title={text('Radio_Sort')} aria-label={text('Radio_Sort')} onclick={() => (panel = panel === 'sort' ? null : 'sort')}><i class="icon">{icons.sortUp}</i></button>
    <button class="tool opens square" class:set={sieveIsOn(sieve)} title={text('Radio_Filter')} aria-label={text('Radio_Filter')} onclick={() => (panel = panel === 'filter' ? null : 'filter')}><i class="icon">{icons.filter}</i></button>
    <button class="tool square saved" class:on={savedOnly} title={text('Radio_ShowFavorites')} aria-label={text('Radio_ShowFavorites')} aria-pressed={savedOnly} onclick={() => (savedOnly = !savedOnly)}><i class="icon" class:outline={!savedOnly}>{icons.heart}</i></button>

    {#if panel === 'country'}
      <div class="panel" role="menu">
        <button class="pin" role="menuitem" onclick={() => setCountry(null)}>{text('Radio_ClearLocation')}</button>
        {#each countries as row (row.code)}
          <button role="menuitem" class:on={row.code === country} onclick={() => setCountry(row.code)}>{row.name}</button>
        {/each}
      </div>
    {:else if panel === 'sort'}
      <div class="panel" role="menu">
        <p>{text('Radio_SortHeading')}</p>
        {#each ORDERS as [id, label] (id)}
          <button role="menuitem" class:on={order === id} onclick={() => { order = id; panel = null; }}>{text(label)}</button>
        {/each}
      </div>
    {:else if panel === 'filter'}
      <div class="panel" role="menu">
        <button class="pin" role="menuitem" disabled={!sieveIsOn(sieve)} onclick={() => { const hadGenre = sieve.genre !== null; sieve = NO_SIEVE; if (hadGenre) void search(); }}>{text('Radio_ClearFilters')}</button>
        <p>{text('Radio_FilterFormat')}</p>
        <button role="menuitem" class:on={!sieve.format} onclick={() => (sieve = { ...sieve, format: null })}>{text('Radio_AllFormats')}</button>
        {#each FORMATS as format}
          <button role="menuitem" class:on={sieve.format === format} onclick={() => (sieve = { ...sieve, format })}>{format}</button>
        {/each}
        <p>{text('Radio_FilterAds')}</p>
        {#each ADS as [id, label] (id)}
          <button role="menuitem" class:on={sieve.ads === id} onclick={() => (sieve = { ...sieve, ads: id })}>{text(label)}</button>
        {/each}
        <p>{text('Radio_FilterGenre')}</p>
        <button role="menuitem" class:on={!sieve.genre} onclick={() => setGenre(null)}>{text('Radio_AllGenres')}</button>
        {#each GENRES as genre}
          <button role="menuitem" class:on={sieve.genre === genre} onclick={() => setGenre(genre)}>{genre}</button>
        {/each}
      </div>
    {/if}
  </div>

  {#if down}<p class="band" role="status">{text('Radio_DirectoryDown')}</p>{/if}

  <ul>
    {#each shown as station (station.uuid)}
      {@const works = playable(station)}
      <li>
        <StationLogo {station} />
        <div class="words">
          <div class="line">
            <span class="lamp" class:off={station.reachable === false} title={text(station.reachable === false ? 'Radio_OffAir' : 'Radio_OnAir')}></span>
            <span class="name">{displayOf(station)}</span>
            {#if carriesAds(station)}<span class="ads" title={text('Radio_CarriesAds')}>AD</span>{/if}
          </div>
          <span class="detail">{detail(station)}</span>
        </div>
        <span class="sign">({callSign(displayOf(station))})</span>
        <button class="heart" class:on={isSaved(station)} title={saveLabel} aria-label={saveLabel} aria-pressed={isSaved(station)} onclick={() => radioFavorites.toggle(station)}><i class="icon" class:outline={!isSaved(station)}>{icons.heart}</i></button>
        <button class="glass-button primary tune" disabled={!works} title={works ? text(isTuned(station) ? 'Radio_StopStation' : 'Radio_PlayStation') : text('Web_RadioNotHere')} aria-label={text(isTuned(station) ? 'Radio_StopStation' : 'Radio_PlayStation')} onclick={() => press(station)}><i class="icon">{isTuned(station) ? icons.stop : icons.play}</i></button>
      </li>
    {/each}
  </ul>

  {#if !shown.length && empty}<p class="empty">{empty}</p>{/if}
</div>

<style>
  .radio {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
  }

  .dial {
    display: flex;
    flex: none;
    flex-direction: column;
    margin: 0 16px;
  }

  .tools {
    position: relative;
    z-index: 2;
    display: flex;
    flex: none;
    gap: 8px;
    align-items: center;
    margin: 12px 16px 8px;
  }

  .find {
    display: flex;
    flex: 1;
    gap: 8px;
    align-items: center;
    min-width: 0;
    height: 24px;
    padding: 0 9px;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.08);
    color: rgb(255 255 255 / 0.6);
    font-size: 11px;
  }

  .find input {
    flex: 1;
    min-width: 0;
    height: 18px;
    padding: 0;
    border: 0;
    outline: 0;
    background: none;
    color: #fff;
    font-size: 12px;
  }

  .country {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    justify-content: space-between;
    width: 132px;
    padding: 0 9px;
  }

  .country span {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .country .icon {
    font-size: 8px;
    opacity: 0.7;
  }

  .square {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    padding: 0;
    font-size: 12px;
  }

  .square.set::after {
    position: absolute;
    top: -1px;
    right: -2px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    content: '';
  }

  .saved {
    color: var(--text-faint);
  }

  .saved.on {
    color: var(--favorite);
  }

  .panel {
    position: absolute;
    top: 28px;
    right: 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
    width: 240px;
    max-height: 528px;
    padding: 4px 0;
    overflow-y: auto;
    border: 1px solid rgb(255 255 255 / 0.13);
    border-radius: 8px;
    background: rgb(20 24 32 / 0.97);
  }

  .panel p {
    height: 26px;
    margin: 0;
    padding: 7px 12px 0;
    font-size: 11px;
    opacity: 0.6;
  }

  .panel button {
    flex: none;
    height: 26px;
    padding: 0 12px;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.9);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .panel button:hover {
    background: rgb(255 255 255 / 0.08);
  }

  .panel button.on {
    color: var(--accent);
  }

  .panel button:disabled {
    opacity: 0.4;
  }

  .band {
    flex: none;
    margin: 0 16px 8px;
    color: var(--warning);
    font-size: 11.5px;
  }

  ul {
    flex: none;
    margin: 0;
    padding: 0 8px 14px;
    list-style: none;
  }

  li {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 7px 6px;
    border-radius: 6px;
  }

  li:hover {
    background: rgb(255 255 255 / 0.05);
  }

  .words {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .line {
    display: flex;
    gap: 5px;
    align-items: center;
    min-width: 0;
  }

  /* Lit while the station was answering when the directory last checked. The glow is left out on a dead one. */
  .lamp {
    flex: none;
    width: 6px;
    height: 6px;
    margin: 3px;
    border-radius: 50%;
    background: #ff4438;
    box-shadow: 0 0 5px 1px rgb(255 59 48 / 0.6);
  }

  .lamp.off {
    background: rgb(255 255 255 / 0.2);
    box-shadow: none;
  }

  .name {
    overflow: hidden;
    color: rgb(255 255 255 / 0.93);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ads {
    flex: none;
    padding: 0 3px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.75);
    color: #0b0d10;
    font-size: 8px;
    font-weight: 700;
    line-height: 13px;
  }

  .detail {
    overflow: hidden;
    color: rgb(255 255 255 / 0.47);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sign {
    flex: none;
    color: rgb(4 200 255 / 0.67);
    font-size: 10px;
    letter-spacing: 0.06em;
  }

  .heart {
    flex: none;
    width: 28px;
    height: 26px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-faint);
    font-size: 13px;
    cursor: pointer;
  }

  .heart.on {
    color: var(--favorite);
  }

  .tune {
    flex: none;
    width: 45px;
    min-width: 0;
    height: 39px;
    padding: 0;
    font-size: 11px;
  }

  .tune:disabled {
    opacity: 0.4;
  }

  .empty {
    margin: 26px 28px 0;
    color: rgb(255 255 255 / 0.53);
    font-size: 12px;
    text-align: center;
  }

  @media (width < 700px) {
    .sign {
      display: none;
    }
  }
</style>

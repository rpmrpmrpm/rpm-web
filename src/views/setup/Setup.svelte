<script lang="ts">
  // The setup, as the desktop's first-run wizard: a welcome, then the language and country, the first music, the
  // look, the layout of the library, and done. It lies over the whole window until it is finished. Every choice
  // here is also in Settings, in the radio pane or at the top of the library, so nothing is lost by skipping it.
  import { onDestroy, onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  import { BECOME_SUPPORTER, importQueue, radioDirectory, session } from '../../app';
  import { backdrop, BACKDROPS, effectiveId } from '../../design/backdrop.svelte';
  import { icons } from '../../design/icons';
  import wallPicture from '../../design/images/setup/layout-wall.jpg';
  import listPicture from '../../design/images/setup/layout-list.jpg';
  import tablePicture from '../../design/images/setup/layout-table.jpg';
  import { pickedFromHandles, pickedFromInput } from '../../import/pick';
  import type { ImportRow, PickedFile } from '../../import/queue';
  import { starterMusic } from '../../import/starter';
  import { browserCountry, storeCountry, storedCountry } from '../../radio/country';
  import type { Country } from '../../radio/results';
  import { currentLanguage, inEveryLanguage, LANGUAGES, setLanguage, text } from '../../strings/loc';
  import { addToQueue, importing, runImport } from '../import/importing.svelte';
  import { collection, pickView, type CollectionView } from '../library/view.svelte';
  import Mark from '../shell/Mark.svelte';
  import { taglineParts } from '../shell/tagline';
  import { browserStores, keepStep, SETUP_STEPS, stepNumber, type SetupStep } from './setup';

  let { opening, onDone }: { opening: SetupStep | 'hello'; onDone: () => void } = $props();

  const { tab } = browserStores();

  // svelte-ignore state_referenced_locally
  let step = $state<SetupStep | 'hello'>(opening);
  const supporter = $derived(session.user?.supporter === true);
  const tagline = taglineParts(text('Art_ParkedTagline'));

  function go(next: SetupStep) {
    step = next;
    keepStep(tab, next);
  }

  // The ground is always rpm's own dark picture, as the desktop's wizard stands on its own blues: a busy picture
  // chosen on the look step would be behind the text of every step after it. The tiles show what is chosen.
  const GROUND = BACKDROPS[0]!.picture;

  const kicker = (at: SetupStep) => text('Wizard_StepOf', stepNumber(at), SETUP_STEPS.length);

  // The welcome: the greeting turns through every language the app speaks, and the line and the key under it come
  // up after two seconds, as on the desktop.
  const TURN_MS = 2200;
  const LINE_MS = 2000;
  let greetings = $state.raw<string[]>([text('Wizard_Hello')]);
  let greeting = $state(0);
  let lineShown = $state(false);
  let turning: ReturnType<typeof setInterval> | undefined;
  let showing: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    if (step !== 'hello') return;
    showing = setTimeout(() => (lineShown = true), LINE_MS);
    void inEveryLanguage('Wizard_Hello').then((found) => {
      // The language in use first, so the welcome opens in it.
      const own = text('Wizard_Hello');
      greetings = [own, ...found.filter((line) => line !== own)];
      turning = setInterval(() => (greeting = (greeting + 1) % greetings.length), TURN_MS);
    });
  });

  onDestroy(() => {
    clearInterval(turning);
    clearTimeout(showing);
  });

  // Language and country. A new language reloads the page, and the setup comes back at this step in it. The
  // country is written when Next is pressed, as the desktop writes its choices.
  let countries = $state.raw<Country[] | null>(null);
  let countriesFailed = $state(false);
  let country = $state(storedCountry() ?? browserCountry(navigator.languages) ?? '');

  onMount(() => {
    radioDirectory
      .countries()
      .then((list) => {
        const byCode = new Map(list.map((row) => [row.code.trim().toUpperCase(), row]));
        countries = [...byCode.entries()].map(([code, row]) => ({ ...row, code })).sort((a, b) => a.name.localeCompare(b.name));
        if (country && !byCode.has(country)) country = '';
      })
      .catch(() => (countriesFailed = true));
  });

  function regionDone() {
    if (!countriesFailed) storeCountry(country || null);
    go('import');
  }

  // The first music. What is chosen goes in the import queue, as files added in the Import pane do, and Import
  // here runs that import while the setup goes on.
  type FolderChooser = { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
  const chooseFolder = (window as FolderChooser).showDirectoryPicker;
  const folderInput = 'webkitdirectory' in HTMLInputElement.prototype && !/iPhone|iPad/.test(navigator.userAgent);

  let version = $state(0);
  onDestroy(importQueue.onChange(() => version++));

  // What was chosen: its name, whether it is rpm's own three tracks, and the rows it put in the queue, which a
  // second choice takes out again.
  let source = $state<{ name: string; starter: boolean } | null>(null);
  let added: ImportRow[] = [];
  let reading = $state(false);
  let refusal = $state('');

  const importable = $derived.by(() => {
    void version;
    return importQueue.importableRows().length;
  });

  async function take(name: string, starter: boolean, files: Promise<PickedFile[]>) {
    refusal = '';
    reading = true;
    try {
      const picked = await files;
      source = { name, starter };
      added = await addToQueue(picked);
    } finally {
      reading = false;
    }
  }

  function change() {
    importQueue.remove(added);
    added = [];
    source = null;
  }

  async function pickFolder() {
    try {
      const folder = await chooseFolder!.call(window);
      await take(folder.name, false, pickedFromHandles([folder]));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
    }
  }

  function pickedInput(event: Event & { currentTarget: HTMLInputElement }) {
    const files = event.currentTarget.files;
    if (files?.length) {
      const first = files[0]!.webkitRelativePath.split('/')[0];
      void take(first || text('Web_ImportAddFiles'), false, Promise.resolve(pickedFromInput(files)));
    }
    event.currentTarget.value = '';
  }

  async function tryStarter() {
    try {
      await take(text('Wizard_StarterSource'), true, starterMusic(import.meta.env.BASE_URL, (...args) => fetch(...args)));
    } catch {
      refusal = text('Web_StarterFailed');
    }
  }

  function importNow() {
    void runImport();
    go('look');
  }

  // The look. The picture changes behind the setup as it is picked, so the choice is seen.
  let backdropNote = $state('');
  const chosenBackdrop = $derived(backdrop.own ? null : effectiveId(backdrop.id, supporter));

  async function pickBackdrop(id: string, supporters: boolean | undefined) {
    backdropNote = '';
    if (supporters && !supporter) {
      backdropNote = text('Supporters_Backdrop');
      return;
    }
    await backdrop.pick(id);
  }

  // The layout.
  const LAYOUTS: [CollectionView, string, string, string][] = [
    ['grid', wallPicture, 'Library_ViewGrid', 'Wizard_LayoutWallDesc'],
    ['list', listPicture, 'Library_ViewAlbums', 'Wizard_LayoutListDesc'],
    ['table', tablePicture, 'Library_ViewTable', 'Wizard_LayoutTableDesc'],
  ];
</script>

<div class="setup" role="dialog" aria-modal="true" aria-label={text('Wizard_Hello')}>
  <div class="ground" style:background-image="url({GROUND})"></div>
  <div class="shade"></div>

  <header class="corner">
    <Mark size={2} strength={0.91} />
    <p class="tagline"><span class="head">{tagline.head}</span>{tagline.tail}</p>
  </header>

  {#if step === 'hello'}
    <div class="hello" in:fade={{ duration: 400 }}>
      <div class="greeting">
        {#key greeting}
          <h1 transition:fade={{ duration: 500 }}>{greetings[greeting]}</h1>
        {/key}
      </div>
      <p class="line" class:shown={lineShown}>{text('Wizard_HelloSubtitle')}</p>
      <button class="glass-button primary go" class:shown={lineShown} disabled={!lineShown} onclick={() => go('region')}>{text('Wizard_Continue')}<i class="icon">{icons.forward}</i></button>
    </div>
  {:else}
    {#key step}
      <div class="step" in:fade={{ duration: 220, delay: 120 }} out:fade={{ duration: 120 }}>
        <div class="body">
          <p class="kicker">{kicker(step)}</p>

          {#if step === 'region'}
            <h1>{text('Tv_Setup_RegionTitle')}</h1>
            <p class="lead">{text('Wizard_RegionBody')}</p>
            <div class="card choices">
              <i class="icon">{icons.language}</i>
              <label for="setup-language">{text('Tv_Setup_Language')}</label>
              <select id="setup-language" class="field" value={currentLanguage()} onchange={(event) => (keepStep(tab, 'region'), void setLanguage(event.currentTarget.value))}>
                {#each LANGUAGES as [code, name]}<option value={code}>{name}</option>{/each}
              </select>
              <i class="icon">{icons.globe}</i>
              <label for="setup-country">{text('Tv_Setup_Country')}</label>
              <select id="setup-country" class="field" disabled={countries === null} bind:value={country}>
                <option value="">{text('Radio_AllCountries')}</option>
                {#each countries ?? [] as row (row.code)}<option value={row.code}>{row.name}</option>{/each}
              </select>
            </div>
          {:else if step === 'import'}
            <h1>{text('Wizard_ImportTitle')}</h1>
            <p class="lead">{text('Wizard_ImportBody')}</p>
            {#if source === null}
              <div class="tiles">
                {#if chooseFolder}
                  <button class="tile" disabled={reading} onclick={pickFolder}>
                    <i class="icon big">{icons.folder}</i>
                    <strong>{text('Wizard_ChooseFolder')}</strong>
                    <span>{text('AddMusic_FolderHint')}</span>
                  </button>
                {:else}
                  <label class="tile" class:off={reading}>
                    <i class="icon big">{icons.folder}</i>
                    <strong>{text(folderInput ? 'Wizard_ChooseFolder' : 'Web_ImportAddFiles')}</strong>
                    <span>{text('AddMusic_FolderHint')}</span>
                    {#if folderInput}
                      <input type="file" webkitdirectory hidden onchange={pickedInput} />
                    {:else}
                      <input type="file" multiple accept="audio/*,.flac,.m4a,.opus,.ogg,.oga,.wv,.wma,.aif,.aiff" hidden onchange={pickedInput} />
                    {/if}
                  </label>
                {/if}
                <button class="tile" disabled={reading} onclick={tryStarter}>
                  <i class="icon big">{icons.music}</i>
                  <strong>{text('Wizard_TryStarter')}</strong>
                  <span>{text('Wizard_TryStarterHint')}</span>
                </button>
              </div>
              {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
            {:else}
              <div class="card chosen">
                <i class="icon">{source.starter ? icons.music : icons.folder}</i>
                <div>
                  <strong>{source.name}</strong>
                  <span>{importable === 1 ? text('Queue_SelectedForImportOne') : text('Queue_SelectedForImport', importable)}</span>
                </div>
                <button class="glass-button" disabled={reading} onclick={change}>{text('Settings_Change')}</button>
              </div>
            {/if}
          {:else if step === 'look'}
            <h1>{text('Wizard_LookTitle')}</h1>
            <h2>{text('Settings_Background')}</h2>
            <p class="lead">{text('Wizard_LookBackgroundHint')}</p>
            <div class="pictures">
              {#each BACKDROPS as choice (choice.id)}
                <button class="picture" class:picked={chosenBackdrop === choice.id} aria-pressed={chosenBackdrop === choice.id} onclick={() => pickBackdrop(choice.id, choice.supporters)}>
                  <img src={choice.tile} alt="" />
                  <span>{text(choice.label)}</span>
                </button>
              {/each}
            </div>
            {#if backdropNote}<p class="note" role="status">{backdropNote}</p>{/if}
          {:else if step === 'layout'}
            <h1>{text('Wizard_LayoutTitle')}</h1>
            <p class="lead">{text('Wizard_LayoutBody')}</p>
            <div class="layouts">
              {#each LAYOUTS as [id, picture, name, line] (id)}
                <button class="layout" class:picked={collection.view === id} aria-pressed={collection.view === id} onclick={() => pickView(id)}>
                  <img src={picture} alt="" />
                  <strong>{text(name)}</strong>
                  <span>{text(line)}</span>
                </button>
              {/each}
            </div>
          {:else}
            <h1>{text('Wizard_DoneTitle')}</h1>
            {#if importing.running}<p class="lead">{text('Web_ImportKeepOpen')}</p>{/if}
            {#if !supporter}
              <div class="card pitch">
                <h2>{text('Wizard_SupportTitle')}</h2>
                <p>{text('Wizard_SupportPitch')}</p>
                <a class="glass-button" href={BECOME_SUPPORTER} target="_blank" rel="noopener"><i class="icon">{icons.heart}</i>{text('Cloud_BecomeSupporter')}</a>
              </div>
            {/if}
          {/if}
        </div>

        <footer>
          <div class="dots" aria-hidden="true">
            {#each SETUP_STEPS as each, index (each)}<span class:lit={index < stepNumber(step)}></span>{/each}
          </div>
          <div class="keys">
            {#if step === 'region'}
              <button class="glass-button primary go" onclick={regionDone}>{text('Wizard_Next')}<i class="icon">{icons.forward}</i></button>
            {:else if step === 'import'}
              <button class="glass-button go" onclick={() => go('look')}>{text('Wizard_SkipForNow')}</button>
              {#if source !== null}
                <button class="glass-button primary go" disabled={reading || importing.running || importable === 0} onclick={importNow}><i class="icon">{icons.import}</i>{text('Wizard_GoImport')}</button>
              {/if}
            {:else if step === 'look'}
              <button class="glass-button primary go" onclick={() => go('layout')}>{text('Wizard_Next')}<i class="icon">{icons.forward}</i></button>
            {:else if step === 'layout'}
              <button class="glass-button primary go" onclick={() => go('done')}>{text('Wizard_Next')}<i class="icon">{icons.forward}</i></button>
            {:else}
              <button class="glass-button primary go" onclick={onDone}>{text('Wizard_Finish')}<i class="icon">{icons.forward}</i></button>
            {/if}
          </div>
        </footer>
      </div>
    {/key}
  {/if}
</div>

<style>
  .setup {
    position: fixed;
    z-index: 30;
    inset: 0;
    overflow: hidden;
    background: #000;
    color: #fff;
  }

  .ground {
    position: absolute;
    inset: 0;
    background-position: center;
    background-size: cover;
  }

  /* Over the picture, so the text reads whatever is under it: lighter at the top, darker at the foot. */
  .shade {
    position: absolute;
    inset: 0;
    background: linear-gradient(rgb(8 12 18 / 0.34), rgb(8 12 18 / 0.78));
  }

  /* The mark and its line, where the app keeps them once the setup is done. */
  .corner {
    position: absolute;
    top: 44px;
    left: 25px;
    pointer-events: none;
  }

  .tagline {
    margin: 1px 0 0 8px;
    color: rgb(255 255 255 / 0.65);
    font-size: 11px;
    line-height: 14px;
  }

  .tagline .head {
    color: rgb(255 255 255 / 0.4);
  }

  .hello {
    position: absolute;
    inset: 0;
    display: grid;
    gap: 18px;
    align-content: center;
    justify-items: center;
    padding: 0 24px;
    text-align: center;
  }

  .greeting {
    display: grid;
    min-height: 56px;
  }

  .greeting h1 {
    grid-area: 1 / 1;
    margin: 0;
    font-size: 44px;
    font-weight: 700;
    white-space: nowrap;
  }

  .hello .line {
    margin: 0;
    color: rgb(255 255 255 / 0.77);
    font-size: 18px;
    opacity: 0;
    transition: opacity 600ms;
  }

  .hello .go {
    margin-top: 22px;
    opacity: 0;
    transition: opacity 600ms;
  }

  .hello .shown {
    opacity: 1;
  }

  .step {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr) 64px;
    padding: 0 52px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 20px;
    align-items: center;
    justify-content: safe center;
    min-height: 0;
    padding: 110px 0 24px;
    overflow-y: auto;
    text-align: center;
  }

  .kicker {
    margin: 0;
    color: rgb(255 255 255 / 0.42);
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  h1 {
    max-width: 760px;
    margin: 0;
    font-size: 38px;
    font-weight: 700;
    line-height: 42px;
  }

  h2 {
    margin: 12px 0 0;
    font-size: 16px;
    font-weight: 700;
  }

  .lead {
    max-width: 560px;
    margin: 0;
    color: rgb(255 255 255 / 0.64);
    font-size: 14px;
    line-height: 22px;
  }

  .card {
    box-sizing: border-box;
    padding: 14px 16px;
    border: 1px solid rgb(255 255 255 / 0.17);
    border-radius: 12px;
    background: rgb(255 255 255 / 0.075);
  }

  .choices {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    gap: 12px 14px;
    align-items: center;
    width: min(560px, 100%);
    text-align: left;
  }

  .choices .icon {
    color: var(--accent);
    font-size: 16px;
  }

  .choices label {
    min-width: 80px;
    font-size: 14px;
  }

  .choices .field {
    height: 32px;
    font-size: 13px;
  }

  .tiles {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    justify-content: center;
    margin-top: 10px;
  }

  .tile {
    display: grid;
    gap: 8px;
    justify-items: center;
    align-content: center;
    box-sizing: border-box;
    width: 260px;
    min-height: 200px;
    padding: 22px 20px;
    border: 1px solid rgb(255 255 255 / 0.17);
    border-radius: 14px;
    background: rgb(255 255 255 / 0.075);
    color: #fff;
    font: inherit;
    cursor: pointer;
    transition:
      background 150ms,
      border-color 150ms;
  }

  .tile:hover:not(:disabled, .off) {
    border-color: rgb(255 255 255 / 0.4);
    background: rgb(255 255 255 / 0.12);
  }

  .tile:disabled,
  .tile.off {
    opacity: 0.5;
    cursor: default;
    pointer-events: none;
  }

  .tile .big {
    margin-bottom: 6px;
    color: var(--accent);
    font-size: 38px;
  }

  .tile strong {
    font-size: 16px;
  }

  .tile span {
    color: rgb(255 255 255 / 0.55);
    font-size: 12.5px;
    line-height: 1.45;
  }

  .chosen {
    display: flex;
    gap: 14px;
    align-items: center;
    width: min(560px, 100%);
    text-align: left;
  }

  .chosen .icon {
    color: var(--accent);
    font-size: 22px;
  }

  .chosen div {
    display: grid;
    flex: 1;
    gap: 2px;
    min-width: 0;
  }

  .chosen strong {
    overflow: hidden;
    font-size: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chosen span {
    color: rgb(255 255 255 / 0.6);
    font-size: 12.5px;
  }

  .refusal {
    margin: 0;
    color: var(--error);
    font-size: 13px;
  }

  .note {
    max-width: 560px;
    margin: 0;
    color: rgb(255 255 255 / 0.75);
    font-size: 13px;
  }

  .pictures,
  .layouts {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    justify-content: center;
    margin-top: 4px;
  }

  .picture,
  .layout {
    display: grid;
    gap: 6px;
    justify-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.7);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .picture img,
  .layout img {
    display: block;
    border: 2px solid transparent;
    border-radius: 10px;
    object-fit: cover;
    transition: border-color 150ms;
  }

  .picture img {
    width: 150px;
    height: 94px;
  }

  .layout {
    gap: 4px;
    width: 280px;
  }

  .layout img {
    width: 100%;
    height: auto;
    margin-bottom: 6px;
    aspect-ratio: 960 / 579;
  }

  .layout strong {
    color: #fff;
    font-size: 15px;
  }

  .layout span {
    color: rgb(255 255 255 / 0.55);
    font-size: 12.5px;
    line-height: 1.45;
  }

  .picture:hover img,
  .layout:hover img {
    border-color: rgb(255 255 255 / 0.35);
  }

  .picture.picked img,
  .layout.picked img {
    border-color: var(--accent);
  }

  .picture.picked span {
    color: var(--accent);
  }

  .pitch {
    display: grid;
    gap: 10px;
    justify-items: center;
    width: min(560px, 100%);
    margin-top: 10px;
  }

  .pitch h2 {
    margin: 0;
  }

  .pitch p {
    margin: 0;
    color: rgb(255 255 255 / 0.7);
    font-size: 13.5px;
    line-height: 1.55;
  }

  footer {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
  }

  .dots {
    display: flex;
    gap: 9px;
  }

  .dots span {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.22);
  }

  .dots span.lit {
    background: var(--accent);
  }

  .keys {
    display: flex;
    gap: 10px;
  }

  /* The setup's keys: the app's glass, larger, as the desktop's wizard has them. */
  .go {
    height: 40px;
    padding: 0 24px;
    font-size: 14px;
    font-weight: 700;
  }

  .go .icon {
    font-size: 12px;
  }

  @media (max-width: 699px) {
    .corner {
      top: 18px;
      left: 16px;
    }

    .step {
      padding: 0 16px env(safe-area-inset-bottom);
    }

    .body {
      padding-top: 84px;
    }

    h1 {
      font-size: 28px;
      line-height: 32px;
    }

    .greeting h1 {
      font-size: 32px;
    }

    .tile {
      width: 100%;
      min-height: 0;
    }

    .layout {
      width: 100%;
    }
  }
</style>

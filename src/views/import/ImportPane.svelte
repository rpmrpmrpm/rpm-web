<script lang="ts">
  // The import workbench. Rows are proposed here: nothing leaves the browser until Import is pressed, and
  // the ticks are the selection.
  import { catalogue, importer, importMedia, importQueue, queueKeeper } from '../../app';
  import { icons } from '../../design/icons';
  import { bestPreset, FILENAME_PRESETS } from '../../import/filename-tags';
  import { handlesOfDrop, pickedFromDrop, pickedFromHandles, pickedFromInput } from '../../import/pick';
  import { tagsMissing, type ChipFilter, type ImportRow, type PickedFile, type QueueGroup } from '../../import/queue';
  import { text } from '../../strings/loc';
  import DesktopGet from '../shell/DesktopGet.svelte';
  import RecogniseWindow from './RecogniseWindow.svelte';
  import ReleaseLookup from './ReleaseLookup.svelte';
  import TagPanel from './TagPanel.svelte';
  import TagsFromTags from './TagsFromTags.svelte';

  const small = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent);
  const folderPicker = 'webkitdirectory' in HTMLInputElement.prototype && !/iPhone|iPad/.test(navigator.userAgent);

  // Chrome and Edge. A folder picked this way can be opened again on the next visit.
  type FolderChooser = { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
  type AskedHandle = FileSystemHandle & { requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState> };
  const chooseFolder = (window as FolderChooser).showDirectoryPicker;

  // A plain counter, raised on every queue change, because the rows are not reactive objects.
  let version = $state(0);
  importQueue.onChange(() => version++);

  let running = $state(false);
  let recognising = $state(false);
  let chip = $state<ChipFilter | null>(null);
  let search = $state('');
  let showTags = $state(false);
  let showNames = $state(false);
  let lookingUp = $state(false);
  let fromTags = $state(false);
  let columnsOpen = $state(false);
  let moreOpen = $state(false);
  let toast = $state('');
  let preset = $state(0);
  let dropping = $state(false);
  let message = $state('');
  let dragged = $state<ImportRow[]>([]);

  const duplicates = $derived.by(() => {
    void version;
    return importQueue.duplicates();
  });

  type Line = { kind: 'group'; group: QueueGroup } | { kind: 'row'; row: ImportRow; group: QueueGroup };

  const lines = $derived.by((): Line[] => {
    void version;
    const words = search.trim().toLowerCase();
    const keep = (row: ImportRow) => {
      if (chip === 'missing' && !tagsMissing(row)) return false;
      if (chip === 'unreadable' && row.state !== 'unreadable' && row.state !== 'refused') return false;
      if (chip === 'ticked' && !row.ticked) return false;
      if (chip === 'duplicates' && !duplicates.includes(row)) return false;
      if (!words) return true;
      return [row.tags.Title, row.tags.Artist, row.tags.Album, row.path].some((value) => value?.toLowerCase().includes(words));
    };
    return importQueue.groups().flatMap((group) => {
      const rows = group.rows.filter(keep);
      return rows.length ? [{ kind: 'group', group } as Line, ...rows.map((row) => ({ kind: 'row', row, group }) as Line)] : [];
    });
  });

  const counts = $derived.by(() => {
    void version;
    return importQueue.counts();
  });

  const ticked = $derived.by(() => {
    void version;
    return importQueue.rows.filter((row) => row.ticked);
  });

  // Every ticked row whose audio can be read.
  const recognisable = $derived(ticked.filter((row) => !['reading', 'refused', 'unreadable'].includes(row.state)));

  // From the report of a run. The tag panel is the editor here, and it acts on the ticks.
  function editRecognised(rows: ImportRow[]) {
    recognising = false;
    importQueue.setAllTicks(false);
    for (const row of rows) importQueue.setTick(row, true);
    showTags = true;
  }

  const importable = $derived.by(() => {
    void version;
    return importQueue.importableRows().length;
  });

  // The window of rows. They are all one height, so only those near the view exist.
  const coarse = matchMedia('(pointer: coarse)').matches;
  const LINE = coarse ? 48 : 30;
  let scroll = $state(0);
  let viewport = $state(0);
  const first = $derived(Math.max(0, Math.floor(scroll / LINE) - 6));
  const window_ = $derived(lines.slice(first, first + Math.ceil(viewport / LINE) + 12));

  async function add(picked: PickedFile[]) {
    const rows = importQueue.add(picked);
    if (rows.length && !showNames) preset = bestPreset(importQueue.rows.map((row) => row.path));

    for (const row of rows) {
      if (row.state !== 'reading') continue;
      try {
        const { tags, hasArt } = await importMedia.tags(row.file);
        importQueue.read(row, tags, hasArt);
      } catch {
        row.state = 'unreadable';
        row.ticked = false;
        row.note = 'Cloud_FailUnreadable';
        importQueue.changed();
      }
    }
  }

  const waiting = $derived.by(() => {
    void version;
    return importQueue.waiting.size;
  });

  const albumFiles = $derived.by(() => {
    void version;
    return importQueue.albumFiles();
  });

  async function addFolder() {
    try {
      const folder = await chooseFolder!.call(window);
      queueKeeper.addSources([folder]);
      await add(await pickedFromHandles([folder]));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
    }
  }

  // The browser asks the person once per folder, and a folder they refuse stays out.
  async function reopen() {
    const open: FileSystemHandle[] = [];
    for (const source of queueKeeper.sources) {
      if ((await (source as AskedHandle).requestPermission?.({ mode: 'read' })) === 'granted') open.push(source);
    }
    await add(await pickedFromHandles(open));
  }

  async function drop(event: DragEvent) {
    event.preventDefault();
    dropping = false;
    const items = event.dataTransfer?.items;
    if (!items?.length) return;

    // Both read the items, and neither can wait: they are empty once the drop is over.
    const handles = handlesOfDrop(items);
    const picked = pickedFromDrop(items);
    queueKeeper.addSources((await handles).filter((handle) => handle !== null));
    await add(await picked);
  }

  function picked(event: Event & { currentTarget: HTMLInputElement }) {
    const files = event.currentTarget.files;
    if (files) void add(pickedFromInput(files));
    event.currentTarget.value = '';
  }

  const leaving = (event: BeforeUnloadEvent) => event.preventDefault();

  async function run() {
    running = true;
    message = '';
    addEventListener('beforeunload', leaving);

    // A phone that sleeps stops the page, and an upload with it.
    let lock: WakeLockSentinel | null = null;
    try {
      lock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      // A page that may not hold the screen on still imports.
    }

    const outcome = await importer.run(importQueue.importableRows(), small ? 1 : 3);

    void lock?.release();
    removeEventListener('beforeunload', leaving);
    running = false;
    if (outcome === 'full') message = text('Rpm_Error_StorageFull');
    await catalogue.refresh();
  }

  const COLUMNS: { id: string; label: string; read: (row: ImportRow) => string }[] = [
    { id: 'album', label: 'Review_ColAlbum', read: (row) => row.tags.Album ?? '' },
    { id: 'albumartist', label: 'Review_ColAlbumArtist', read: (row) => row.tags.AlbumArtist ?? '' },
    { id: 'year', label: 'Review_ColYear', read: (row) => (row.tags.Year ? String(row.tags.Year) : '') },
    { id: 'genre', label: 'Review_ColGenre', read: (row) => row.tags.Genre ?? '' },
    { id: 'disc', label: 'Review_ColDisc', read: (row) => (row.tags.DiscNumber ? String(row.tags.DiscNumber) : '') },
    { id: 'codec', label: 'Review_ColCodec', read: (row) => row.tags.CodecDescription ?? '' },
    { id: 'bitrate', label: 'Review_ColBitrate', read: (row) => (row.tags.BitrateKbps ? String(Math.round(row.tags.BitrateKbps)) : '') },
    { id: 'file', label: 'Review_ColFile', read: (row) => row.file.name },
  ];
  const COLUMNS_KEY = 'rpm-import-columns';

  function storedColumns(): string[] {
    try {
      return JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  }

  let columns = $state<string[]>(storedColumns());
  const shownColumns = $derived(COLUMNS.filter((column) => columns.includes(column.id)));

  function toggleColumn(id: string) {
    columns = columns.includes(id) ? columns.filter((held) => held !== id) : [...columns, id];
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(columns));
    } catch {
      // It holds for this visit.
    }
  }

  // A note of what the last tool did stays for a while, then the footer goes back to saying where things are.
  $effect(() => {
    if (!toast) return;
    const clearing = setTimeout(() => (toast = ''), 6000);
    return () => clearTimeout(clearing);
  });

  function numberDiscs() {
    const written = importQueue.numberDiscs(ticked);
    toast = written ? text('Queue_DiscsNumbered', written) : text('Queue_DiscsNoneFound');
  }

  function clearDone() {
    importQueue.remove(importQueue.rows.filter((row) => row.state === 'done' || row.state === 'known'));
  }

  const seconds = (value?: number) => {
    const total = Math.round(value ?? 0);
    return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : '';
  };

  const size = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

  const statusOf = (row: ImportRow): string => {
    if (row.state === 'done') return text('Web_ImportDone');
    return row.note ? text(row.note) : '';
  };

  // Dragging starts on the handle, by mouse or by a held touch, so a swipe still scrolls the list.
  function startDrag(event: PointerEvent, row: ImportRow) {
    event.preventDefault();
    dragged = importQueue.acting(row);
    if (!dragged.includes(row)) dragged = [row];
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function endDrag(event: PointerEvent) {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-line]');
    const moving = dragged;
    dragged = [];
    if (!target || moving.length === 0) return;

    const line = lines[Number(target.dataset.line)];
    if (!line) return;
    const before = line.kind === 'row' ? line.row : (line.group.rows[0] ?? null);
    const sameRecord = moving.every((row) => line.group.rows.includes(row));
    importQueue.move(moving, before, sameRecord ? undefined : line.group);
  }
</script>

<div
  class="bench"
  class:dropping
  role="region"
  ondragover={(event) => {
    event.preventDefault();
    dropping = true;
  }}
  ondragleave={() => (dropping = false)}
  ondrop={drop}
>
  <header>
    <h2 class="heading">{text('Queue_PaneTitle')}</h2>
    <p class="rip">{text('Web_ImportRipNote')}</p>
    {#if counts.total > 0}
      <p>{counts.total === 1 ? text('Queue_StatusFileOne') : text('Queue_StatusFiles', counts.total)}  •  {size(counts.bytes)}</p>
    {/if}
    {#if waiting > 0}
      <div class="saved">
        <p>{text('Web_ImportSavedNote', waiting)}</p>
        {#if queueKeeper.sources.length}<button class="tool" onclick={reopen}>{text('Web_ImportSavedReopen')}</button>{/if}
        <button class="tool" onclick={() => queueKeeper.forget()}>{text('Web_ImportSavedForget')}</button>
      </div>
    {/if}
  </header>

  {#if counts.total === 0}
    <div class="empty">
      <h3>{text('Queue_EmptyTitle')}</h3>
      <p>{text('Web_ImportEmptyHint')}</p>
      <div class="adds">
        <label class="glass-button primary">{text('Web_ImportAddFiles')}<input type="file" multiple accept="audio/*,.flac,.m4a,.opus,.ogg,.oga,.wv,.wma,.aif,.aiff" hidden onchange={picked} /></label>
        {#if chooseFolder}
          <button class="glass-button" onclick={addFolder}>{text('Web_ImportAddFolder')}</button>
        {:else if folderPicker}
          <label class="glass-button">{text('Web_ImportAddFolder')}<input type="file" webkitdirectory hidden onchange={picked} /></label>
        {/if}
      </div>
      <div class="get"><DesktopGet /></div>
    </div>
  {:else}
    <div class="tools">
      <button class="tool" class:on={showTags} onclick={() => (showTags = !showTags)}>{text('Queue_TagPanelTitle')}</button>
      <button class="tool" disabled={running || !recognisable.length} onclick={() => (recognising = true)}>{text('Queue_ToolRecognize')}</button>
      <button class="tool" disabled={!ticked.length} onclick={() => (lookingUp = true)}>{text('Queue_ToolTagsFromRelease')}</button>
      <button class="tool" onclick={() => importQueue.numberTracks(ticked)}>{text('Queue_ActionNumberTracks')}</button>
      <div class="columns">
        <button class="tool" class:on={moreOpen} onclick={() => { moreOpen = !moreOpen; columnsOpen = false; }}>{text('Queue_ActionMore')}</button>
        {#if moreOpen}
          <div class="menu">
            <button class:on={showNames} onclick={() => { moreOpen = false; showNames = !showNames; }}>{text('Queue_ActionTagsFromFilename')}</button>
            <button disabled={!ticked.length} onclick={() => { moreOpen = false; fromTags = true; }}>{text('Queue_ToolTagsFromTags')}</button>
            <button onclick={() => { moreOpen = false; numberDiscs(); }}>{text('Queue_CtxNumberDiscs')}</button>
            <button onclick={() => { moreOpen = false; columnsOpen = !columnsOpen; }}>{text('Queue_Columns')}</button>
          </div>
        {/if}
        {#if columnsOpen}
          <div class="menu">
            {#each COLUMNS as column}
              <label><input type="checkbox" checked={columns.includes(column.id)} onchange={() => toggleColumn(column.id)} /> {text(column.label)}</label>
            {/each}
          </div>
        {/if}
      </div>
      <button class="tool" onclick={() => importQueue.remove(ticked)}>{text('Queue_CtxRemove')}</button>
      <label class="search"><i class="icon">{icons.search}</i><input type="search" placeholder={text('Review_SearchPlaceholder')} bind:value={search} /></label>
    </div>

    <div class="chips">
      {#each [['missing', text('Queue_ChipNotIdentified'), counts.missing], ['unreadable', text('Queue_ChipUnreadable'), counts.unreadable], ['duplicates', text('Queue_ChipDuplicates'), duplicates.length], ['ticked', text('Queue_ChipTicked'), counts.ticked]] as [id, label, count] (id)}
        <button class="chip" class:on={chip === id} onclick={() => (chip = chip === id ? null : (id as ChipFilter))}>{label} <span>{count}</span></button>
      {/each}
    </div>

    {#if duplicates.length}
      <div class="names">
        <button class="tool" onclick={() => importQueue.remove(duplicates)}>{text('Queue_RemoveDuplicates')}</button>
      </div>
    {/if}

    {#if showNames}
      <div class="names">
        <select bind:value={preset} aria-label={text('Queue_ActionTagsFromFilename')}>
          {#each FILENAME_PRESETS as pattern, index}<option value={index}>{pattern}</option>{/each}
        </select>
        <button class="glass-button" onclick={() => importQueue.tagsFromFilename(ticked, FILENAME_PRESETS[preset]!)}>{text('Queue_TagPanelApply', ticked.length)}</button>
      </div>
    {/if}

    <div class="body">
      {#if showTags}
        <TagPanel rows={ticked} {version} />
      {/if}

      <div class="grid" bind:clientHeight={viewport} onscroll={(event) => (scroll = event.currentTarget.scrollTop)}>
        <div class="field2" style:height="{lines.length * LINE}px">
          {#each window_ as line, index (line.kind === 'row' ? line.row.id : line.group.key)}
            {@const position = first + index}
            <div class="line" data-line={position} style:transform="translateY({position * LINE}px)" style:height="{LINE}px">
              {#if line.kind === 'group'}
                <div class="group">
                  <input
                    type="checkbox"
                    aria-label={line.group.album}
                    checked={line.group.rows.every((row) => row.ticked)}
                    onchange={(event) => {
                      for (const row of line.group.rows) importQueue.setTick(row, event.currentTarget.checked);
                    }}
                  />
                  <span class="album">{line.group.album}</span>
                  <span class="by">{line.group.artist}</span>
                </div>
              {:else}
                <div class="row" class:ghost={dragged.includes(line.row)}>
                  <input type="checkbox" aria-label={line.row.tags.Title ?? line.row.path} checked={line.row.ticked} disabled={line.row.state === 'refused'} onchange={(event) => importQueue.setTick(line.row, event.currentTarget.checked)} />
                  <span class="handle" role="presentation" onpointerdown={(event) => startDrag(event, line.row)} onpointerup={endDrag}><i class="icon">{icons.menu}</i></span>
                  <span class="number">{line.row.tags.TrackNumber || ''}</span>
                  <span class="title" class:missing={!line.row.tags.Title}>{line.row.tags.Title ?? line.row.file.name}</span>
                  <span class="artist">{line.row.tags.Artist ?? ''}</span>
                  {#each shownColumns as column (column.id)}
                    <span class="extra" title={text(column.label)}>{column.read(line.row)}</span>
                  {/each}
                  {#if albumFiles.has(line.row)}
                    <button class="split" title={text('Web_ImportAlbumFileTip')} aria-label={text('Web_ImportAlbumFileTip')} onclick={() => (toast = text('Web_ImportAlbumFileTip'))}><i class="icon">{icons.scissors}</i></button>
                  {/if}
                  <span class="length">{seconds(line.row.tags.DurationSeconds)}</span>
                  <span class="state {line.row.state}">{statusOf(line.row)}</span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <footer>
      <div class="select">
        <span>{text('Queue_SelectLabel')}</span>
        <button class="tool" onclick={() => importQueue.setAllTicks(true)}>{text('Queue_SelectAllWord')}</button>
        <button class="tool" onclick={() => importQueue.setAllTicks(false)}>{text('Queue_SelectNoneWord')}</button>
      </div>
      <p class="status" role="status">
        {#if message}<span class="error">{message}</span>{:else if toast}{toast}{:else if running}{text('Web_ImportKeepOpen')}{:else if counts.done > 0}{counts.done} {text('Web_ImportDone').toLowerCase()}{/if}
      </p>
      {#if counts.done > 0 && !running}<button class="tool" onclick={clearDone}>{text('Web_ImportClearDone')}</button>{/if}
      <label class="tool add">{text('AddMusic_Title')}<input type="file" multiple hidden onchange={picked} /></label>
      <button class="glass-button primary" disabled={running || importable === 0} onclick={run}>{text('Queue_ImportAction')}</button>
    </footer>
  {/if}
</div>

{#if lookingUp}
  <ReleaseLookup rows={ticked} onClose={() => (lookingUp = false)} onDone={(note) => (toast = note)} />
{/if}
{#if fromTags}
  <TagsFromTags rows={ticked} onClose={() => (fromTags = false)} onDone={(note) => (toast = note)} />
{/if}

{#if recognising}
  <RecogniseWindow rows={recognisable} onClose={() => (recognising = false)} onEdit={editRecognised} />
{/if}

<style>
  .saved {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 8px;
    align-items: center;
    margin-top: 8px;
  }

  .saved p {
    flex: 1 1 100%;
  }

  .bench {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .bench.dropping {
    outline: 2px dashed rgb(255 255 255 / 0.4);
    outline-offset: -6px;
  }

  header {
    padding: 14px 16px 6px;
  }

  .rip {
    color: var(--text-faint);
  }

  .get {
    margin-top: 14px;
  }

  .columns {
    position: relative;
  }

  .menu {
    position: absolute;
    z-index: 5;
    top: calc(100% + 4px);
    left: 0;
    display: grid;
    gap: 6px;
    min-width: 170px;
    padding: 10px 12px;
    border: 1px solid var(--hairline);
    border-radius: 8px;
    background: var(--ground);
    font-size: 12.5px;
  }

  .menu button {
    padding: 4px 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .menu button:disabled {
    opacity: 0.5;
  }

  .extra {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-soft);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 480px) {
    .extra {
      display: none;
    }
  }

  header p {
    margin: 2px 0 0;
    color: var(--text-soft);
    font-size: 12px;
    white-space: pre;
  }

  .empty {
    display: grid;
    gap: 10px;
    justify-items: center;
    margin: auto;
    max-width: 300px;
    padding: 24px 16px;
    text-align: center;
  }

  .empty h3 {
    margin: 0;
    font-size: 14px;
  }

  .empty p {
    margin: 0;
    color: var(--text-soft);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .adds {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-top: 6px;
  }

  label.glass-button {
    display: inline-grid;
    place-items: center;
    cursor: pointer;
  }

  .tools,
  .chips,
  .names {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 4px 16px;
  }



  .search {
    display: flex;
    flex: 1;
    gap: 6px;
    align-items: center;
    min-width: 120px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    color: rgb(255 255 255 / 0.6);
    font-size: 11px;
  }

  .search input {
    flex: 1;
    width: 100%;
    border: 0;
    background: none;
    outline: none;
    font-size: 12px;
  }

  .chip {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--hairline);
    border-radius: 12px;
    background: none;
    color: var(--text-soft);
    font-size: 11px;
    cursor: pointer;
  }

  .chip.on {
    background: rgb(255 255 255 / 0.18);
    color: #fff;
  }

  .chip span {
    opacity: 0.7;
  }

  .names select {
    flex: 1;
    min-width: 0;
    height: var(--control-height);
    border: 1px solid var(--hairline);
    border-radius: 6px;
    background: rgb(0 0 0 / 0.2);
    font-size: 12px;
  }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .grid {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    contain: strict;
  }

  .field2 {
    position: relative;
  }

  .line {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    contain: layout style;
  }

  .group,
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    height: 100%;
    padding: 0 16px;
    font-size: 12.5px;
  }

  .group {
    background: rgb(255 255 255 / 0.05);
  }

  .album {
    overflow: hidden;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .by {
    overflow: hidden;
    color: var(--text-faint);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row.ghost {
    opacity: 0.4;
  }

  .handle {
    color: rgb(255 255 255 / 0.25);
    font-size: 10px;
    cursor: grab;
    touch-action: none;
  }

  .number {
    flex: none;
    width: 20px;
    color: var(--text-faint);
    text-align: right;
  }

  .title {
    flex: 2;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title.missing {
    color: var(--text-soft);
    font-style: italic;
  }

  .artist {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-soft);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .split {
    flex: none;
    padding: 2px;
    border: 0;
    background: none;
    color: var(--warning);
    font-size: 11px;
    cursor: help;
  }

  .length {
    flex: none;
    color: var(--text-faint);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .state {
    flex: none;
    max-width: 150px;
    overflow: hidden;
    color: var(--text-soft);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state.failed,
  .state.refused,
  .state.unreadable {
    color: var(--error);
  }

  .state.done,
  .state.known {
    color: #5fe08a;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 8px 16px;
    border-top: 1px solid var(--hairline);
  }

  .select {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text-soft);
    font-size: 12px;
  }

  .status {
    flex: 1;
    min-width: 80px;
    margin: 0;
    color: var(--text-soft);
    font-size: 12px;
  }

  .error {
    color: var(--error);
  }

  .add {
    cursor: pointer;
  }

  @media (max-width: 480px) {
    .artist,
    .length {
      display: none;
    }

    footer .primary {
      flex: 1 0 100%;
    }
  }
</style>

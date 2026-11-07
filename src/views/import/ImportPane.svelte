<script lang="ts">
  // The import workbench. Rows are proposed here: nothing leaves the browser until Import is pressed, and
  // the ticks are the selection.
  import { catalogue, importer, importMedia, importQueue, queueKeeper } from '../../app';
  import { icons } from '../../design/icons';
  import { bestPreset, FILENAME_PRESETS } from '../../import/filename-tags';
  import { handlesOfDrop, pickedFromDrop, pickedFromHandles, pickedFromInput } from '../../import/pick';
  import { tagsMissing, type ChipFilter, type ImportRow, type PickedFile, type QueueGroup } from '../../import/queue';
  import { text } from '../../strings/loc';
  import { menuOn, openMenu, type MenuEntry } from '../menu/menu.svelte';
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
  let filtersOpen = $state(false);
  let toast = $state('');
  let preset = $state(0);
  let dropping = $state(false);
  let message = $state('');
  let dragged = $state<ImportRow[]>([]);

  const duplicates = $derived.by(() => {
    void version;
    return importQueue.duplicates();
  });

  type Line = { kind: 'artist'; name: string; groups: QueueGroup[] } | { kind: 'group'; group: QueueGroup } | { kind: 'row'; row: ImportRow; group: QueueGroup };

  // Which branches of the tree are folded, by the artist's name or the record's key.
  let folded = $state.raw<ReadonlySet<string>>(new Set());

  function fold(key: string) {
    const next = new Set(folded);
    if (!next.delete(key)) next.add(key);
    folded = next;
  }

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
    // The queue's records, gathered under their artists, as the desktop's tree.
    const artists = new Map<string, QueueGroup[]>();
    for (const group of importQueue.groups()) {
      if (!group.rows.some(keep)) continue;
      artists.set(group.artist, [...(artists.get(group.artist) ?? []), group]);
    }
    return [...artists].flatMap(([name, groups]) => {
      const artist: Line = { kind: 'artist', name, groups };
      if (folded.has(`artist:${name}`)) return [artist];
      return [
        artist,
        ...groups.flatMap((group): Line[] => {
          const head: Line = { kind: 'group', group };
          return folded.has(group.key) ? [head] : [head, ...group.rows.filter(keep).map((row): Line => ({ kind: 'row', row, group }))];
        }),
      ];
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
  const LINE = coarse ? 48 : 22;
  const HEAD = 22;
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

  const folderOf = (row: ImportRow) => {
    const parts = row.path.split('/');
    return parts.length > 1 ? (parts.at(-2) ?? '') : '';
  };

  type Column = { id: string; label: string; width: number; number?: boolean; read: (row: ImportRow) => string };

  const COLUMNS: Column[] = [
    { id: 'folder', label: 'Review_ColFolder', width: 180, read: folderOf },
    { id: 'title', label: 'Review_ColTitle', width: 190, read: (row) => row.tags.Title ?? '' },
    { id: 'artist', label: 'Review_ColArtist', width: 150, read: (row) => row.tags.Artist ?? '' },
    { id: 'album', label: 'Review_ColAlbum', width: 150, read: (row) => row.tags.Album ?? '' },
    { id: 'albumartist', label: 'Review_ColAlbumArtist', width: 150, read: (row) => row.tags.AlbumArtist ?? '' },
    { id: 'track', label: 'Review_ColTrack', width: 56, number: true, read: (row) => (row.tags.TrackNumber ? String(row.tags.TrackNumber) : '') },
    { id: 'disc', label: 'Review_ColDisc', width: 48, number: true, read: (row) => (row.tags.DiscNumber ? String(row.tags.DiscNumber) : '') },
    { id: 'year', label: 'Review_ColYear', width: 64, number: true, read: (row) => (row.tags.Year ? String(row.tags.Year) : '') },
    { id: 'genre', label: 'Review_ColGenre', width: 120, read: (row) => row.tags.Genre ?? '' },
    { id: 'length', label: 'Review_ColLength', width: 70, number: true, read: (row) => seconds(row.tags.DurationSeconds) },
    { id: 'codec', label: 'Review_ColCodec', width: 120, read: (row) => row.tags.CodecDescription ?? '' },
    { id: 'bitrate', label: 'Review_ColBitrate', width: 86, number: true, read: (row) => (row.tags.BitrateKbps ? String(Math.round(row.tags.BitrateKbps)) : '') },
    { id: 'size', label: 'Review_ColSize', width: 80, number: true, read: (row) => size(row.file.size) },
    { id: 'file', label: 'Review_ColFile', width: 200, read: (row) => row.file.name },
  ];

  // Stored as the columns put away, so a column added later is up for everyone.
  const HIDDEN_KEY = 'rpm-import-hidden-columns';
  const FIRST_HIDDEN = ['file', 'size'];

  function storedHidden(): string[] {
    try {
      const held = localStorage.getItem(HIDDEN_KEY);
      return held ? (JSON.parse(held) as string[]) : FIRST_HIDDEN;
    } catch {
      return FIRST_HIDDEN;
    }
  }

  let hidden = $state<string[]>(storedHidden());
  const shownColumns = $derived(COLUMNS.filter((column) => !hidden.includes(column.id)));
  const NAME_WIDTH = 260;
  const STATE_WIDTH = 96;
  const MARKS = 82;
  const gridColumns = $derived(`${MARKS}px ${NAME_WIDTH}px ${shownColumns.map((column) => `${column.width}px`).join(' ')} minmax(${STATE_WIDTH}px, 1fr)`);
  const gridWidth = $derived(MARKS + NAME_WIDTH + STATE_WIDTH + shownColumns.reduce((sum, column) => sum + column.width, 0));

  function setHidden(next: string[]) {
    hidden = next;
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    } catch {
      // It holds for this visit.
    }
  }

  const toggleColumn = (id: string) => setHidden(hidden.includes(id) ? hidden.filter((held) => held !== id) : [...hidden, id]);

  const columnEntries = (): MenuEntry[] => COLUMNS.map((column) => ({ label: text(column.label), ticked: !hidden.includes(column.id), run: () => toggleColumn(column.id) }));

  function menuUnder(event: MouseEvent, entries: MenuEntry[]) {
    const key = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(entries, key.left, key.bottom + 4);
  }

  // A column's head: this is the way back for one that was put away.
  const headMenu = (column: Column): MenuEntry[] => [
    { label: text('Grid_HideColumn'), run: () => toggleColumn(column.id) },
    { label: text('Grid_Columns'), items: columnEntries() },
    { label: text('Grid_ShowAllColumns'), run: () => setHidden([]) },
  ];

  const rowsOfLine = (line: Line): ImportRow[] => (line.kind === 'row' ? [line.row] : line.kind === 'group' ? line.group.rows : line.groups.flatMap((group) => group.rows));

  const setTicks = (rows: readonly ImportRow[], on: boolean) => {
    for (const row of rows) importQueue.setTick(row, on);
  };

  // What a row of the queue can have done to it. A row outside the ticks acts alone, as in every list.
  function lineMenu(line: Line): MenuEntry[] {
    const rows = rowsOfLine(line);
    const acting = line.kind === 'row' && !line.row.ticked ? rows : ticked.length ? ticked : rows;
    const only = (run: () => void) => () => {
      if (line.kind === 'row' && !line.row.ticked) {
        importQueue.setAllTicks(false);
        importQueue.setTick(line.row, true);
      }
      run();
    };
    return [
      ...(line.kind === 'row'
        ? []
        : ([
            { label: text('Queue_SelectAll'), glyph: icons.check, run: () => setTicks(rows, true) },
            { label: text('Queue_DeselectAll'), glyph: icons.minus, run: () => setTicks(rows, false) },
            'rule',
          ] as MenuEntry[])),
      { label: text('Review_CtxRecognize'), glyph: icons.magic, disabled: running, run: only(() => (recognising = true)) },
      { label: text('Queue_ActionTagsFromFilename'), glyph: icons.file, run: only(() => (showNames = true)) },
      { label: text('Queue_ToolTagsFromRelease'), glyph: icons.book, run: only(() => (lookingUp = true)) },
      { label: text('Queue_ToolTagsFromTags'), glyph: icons.swap, run: only(() => (fromTags = true)) },
      { label: text('Queue_ActionNumberTracks'), glyph: icons.numbers, run: () => importQueue.numberTracks(acting) },
      { label: text('Queue_CtxNumberDiscs'), glyph: icons.folderClosed, run: only(numberDiscs) },
      { label: text('MassEdit_MenuEdit'), glyph: icons.edit, run: only(() => (showTags = true)) },
      'rule',
      { label: text('Queue_CtxRemove'), glyph: icons.close, run: () => importQueue.remove(acting) },
    ];
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

  // Facts, in the order a person checks them. QueueStatus on the desktop.
  const facts = $derived.by(() => {
    const said = [
      counts.total === 1 ? text('Queue_StatusFileOne') : text('Queue_StatusFiles', counts.total),
      counts.bytes > 0 ? size(counts.bytes) : '',
      counts.seconds >= 1 ? seconds(counts.seconds) : '',
      counts.missing > 0 ? text('Queue_StatusNotIdentified', counts.missing) : '',
      duplicates.length === 1 ? text('Queue_StatusDuplicateOne') : duplicates.length > 1 ? text('Queue_StatusDuplicates', duplicates.length) : '',
      counts.unreadable === 1 ? text('Queue_StatusUnreadableOne') : counts.unreadable > 1 ? text('Queue_StatusUnreadable', counts.unreadable) : '',
    ];
    return said.filter(Boolean).join(', ');
  });

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
    // An artist's row stands for their first record.
    const group = line.kind === 'artist' ? line.groups[0]! : line.group;
    const before = line.kind === 'row' ? line.row : (group.rows[0] ?? null);
    const sameRecord = moving.every((row) => group.rows.includes(row));
    importQueue.move(moving, before, sameRecord ? undefined : group);
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
  <header class="pane-head">
    <h2 class="heading">{text('Queue_PaneTitle')}</h2>
    <p class="pane-line">{counts.total === 0 ? text('Web_ImportRipNote') : ticked.length === 1 ? text('Queue_SelectedForImportOne') : text('Queue_SelectedForImport', ticked.length)}</p>
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
      <span class="mark"><i class="icon">{icons.import}</i><i class="icon plus">{icons.plus}</i></span>
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
    <div class="toolbar">
      <div class="keys">
        <button class="tool-key" disabled={running || !recognisable.length} title={text('Queue_ToolRecognize')} aria-label={text('Queue_ToolRecognize')} onclick={() => (recognising = true)}><i class="icon">{icons.magic}</i></button>
        <span class="divider"></span>
        <button class="tool-key" class:on={showNames} title={text('Queue_ActionTagsFromFilename')} aria-label={text('Queue_ActionTagsFromFilename')} onclick={() => (showNames = !showNames)}><i class="icon">{icons.file}</i></button>
        <button class="tool-key" disabled={!ticked.length} title={text('Queue_ToolTagsFromRelease')} aria-label={text('Queue_ToolTagsFromRelease')} onclick={() => (lookingUp = true)}><i class="icon">{icons.book}</i></button>
        <button class="tool-key" disabled={!ticked.length} title={text('Queue_ToolTagsFromTags')} aria-label={text('Queue_ToolTagsFromTags')} onclick={() => (fromTags = true)}><i class="icon">{icons.swap}</i></button>
        <span class="divider"></span>
        <button class="tool-key" disabled={!ticked.length} title={text('Queue_ActionNumberTracks')} aria-label={text('Queue_ActionNumberTracks')} onclick={() => importQueue.numberTracks(ticked)}><i class="icon">{icons.numbers}</i></button>
        <button class="tool-key" title={text('Queue_CtxNumberDiscs')} aria-label={text('Queue_CtxNumberDiscs')} onclick={numberDiscs}><i class="icon">{icons.folderClosed}</i></button>
        <span class="divider"></span>
        <button class="tool-key" class:on={showTags} title={text('Queue_ToolEdit')} aria-label={text('Queue_ToolEdit')} onclick={() => (showTags = !showTags)}><i class="icon">{icons.edit}</i></button>
        <span class="divider"></span>
        <button class="tool-key" disabled={!ticked.length} title={text('Queue_CtxRemove')} aria-label={text('Queue_CtxRemove')} onclick={() => importQueue.remove(ticked)}><i class="icon">{icons.close}</i></button>
      </div>

      <div class="view-keys">
        <label class="search"><i class="icon">{icons.search}</i><input type="search" placeholder={text('Review_SearchPlaceholder')} bind:value={search} /></label>
        <button class="tool-key" class:on={filtersOpen || chip !== null} title={text('Queue_FiltersLabel')} aria-label={text('Queue_FiltersLabel')} onclick={() => (filtersOpen = !filtersOpen)}><i class="icon small">{icons.filter}</i></button>
        <button class="tool-key" title={text('Queue_Columns')} aria-label={text('Queue_Columns')} onclick={(event) => menuUnder(event, columnEntries())}><i class="icon">{icons.columns}</i></button>
        <button class="tool-key" class:on={showTags} title={text('Queue_TagPanelTitle')} aria-label={text('Queue_TagPanelTitle')} onclick={() => (showTags = !showTags)}><i class="icon">{icons.tag}</i></button>
      </div>
    </div>

    {#if filtersOpen || chip !== null}
      <div class="strip">
        {#each [['missing', text('Queue_ChipNotIdentified'), counts.missing], ['unreadable', text('Queue_ChipUnreadable'), counts.unreadable], ['duplicates', text('Queue_ChipDuplicates'), duplicates.length], ['ticked', text('Queue_ChipTicked'), counts.ticked]] as [id, label, count] (id)}
          <button class="tool-key chip" class:lit={chip === id} onclick={() => (chip = chip === id ? null : (id as ChipFilter))}>{label} <span>{count}</span></button>
        {/each}
        {#if duplicates.length}
          <button class="tool-key chip" onclick={() => importQueue.remove(duplicates)}>{text('Queue_RemoveDuplicates')}</button>
        {/if}
      </div>
    {/if}

    {#if showNames}
      <div class="strip">
        <select class="field names" bind:value={preset} aria-label={text('Queue_ActionTagsFromFilename')}>
          {#each FILENAME_PRESETS as pattern, index}<option value={index}>{pattern}</option>{/each}
        </select>
        <button class="tool" onclick={() => importQueue.tagsFromFilename(ticked, FILENAME_PRESETS[preset]!)}>{text('Queue_TagPanelApply', ticked.length)}</button>
      </div>
    {/if}

    <div class="body">
      {#if showTags}
        <TagPanel rows={ticked} {version} onClose={() => (showTags = false)} />
      {/if}

      <div class="list-side">
      <div class="grid" bind:clientHeight={viewport} onscroll={(event) => (scroll = event.currentTarget.scrollTop)}>
        <div class="head" style:--columns={gridColumns} style:width="{gridWidth}px" style:height="{HEAD}px">
          <span></span>
          <span>{text('Review_ColName')}</span>
          {#each shownColumns as column (column.id)}
            <span class:number={column.number} role="columnheader" tabindex="-1" use:menuOn={() => headMenu(column)}>{text(column.label)}</span>
          {/each}
          <span></span>
        </div>
        <div class="field2" style:width="{gridWidth}px" style:min-width="100%" style:height="{lines.length * LINE}px">
          {#each window_ as line, index (line.kind === 'row' ? line.row.id : line.kind === 'group' ? line.group.key : `artist:${line.name}`)}
            {@const position = first + index}
            <div class="line" class:even={position % 2 === 0} data-line={position} style:transform="translateY({position * LINE}px)" style:height="{LINE}px" role="row" tabindex="-1" use:menuOn={() => lineMenu(line)}>
              {#if line.kind === 'row'}
                <div class="cells row" class:ghost={dragged.includes(line.row)} class:ticked={line.row.ticked} style:--columns={gridColumns}>
                  <span class="marks">
                    <input type="checkbox" aria-label={line.row.tags.Title ?? line.row.path} checked={line.row.ticked} disabled={line.row.state === 'refused'} onchange={(event) => importQueue.setTick(line.row, event.currentTarget.checked)} />
                    <button class="pen" title={text('Queue_ToolEdit')} aria-label={text('Queue_ToolEdit')} onclick={() => { importQueue.setAllTicks(false); importQueue.setTick(line.row, true); showTags = true; }}><i class="icon">{icons.edit}</i></button>
                    <span class="handle" role="presentation" onpointerdown={(event) => startDrag(event, line.row)} onpointerup={endDrag}><i class="icon">{icons.grip}</i></span>
                  </span>
                  <span class="name track-name">
                    <i class="icon glyph" class:missing={tagsMissing(line.row)}>{tagsMissing(line.row) ? icons.help : icons.check}</i>
                    <span class="number">{line.row.tags.TrackNumber ? String(line.row.tags.TrackNumber).padStart(2, '0') : ''}</span>
                    <span class="title" class:missing={!line.row.tags.Title}>{line.row.tags.Title ?? line.row.file.name}</span>
                    {#if albumFiles.has(line.row)}
                      <button class="split" title={text('Web_ImportAlbumFileTip')} aria-label={text('Web_ImportAlbumFileTip')} onclick={() => (toast = text('Web_ImportAlbumFileTip'))}><i class="icon">{icons.scissors}</i></button>
                    {/if}
                  </span>
                  {#each shownColumns as column (column.id)}
                    <span class="cell" class:number={column.number} title={text(column.label)}>{column.read(line.row)}</span>
                  {/each}
                  <span class="state {line.row.state}">{statusOf(line.row)}</span>
                </div>
              {:else}
                {@const rows = rowsOfLine(line)}
                {@const key = line.kind === 'group' ? line.group.key : `artist:${line.name}`}
                <div class="cells group" class:ticked={rows.every((row) => row.ticked)} style:--columns={gridColumns}>
                  <span class="marks">
                    <input
                      type="checkbox"
                      aria-label={line.kind === 'group' ? line.group.album : line.name}
                      checked={rows.every((row) => row.ticked)}
                      onchange={(event) => setTicks(rows, event.currentTarget.checked)}
                    />
                  </span>
                  <span class="name" class:inner={line.kind === 'group'}>
                    <button class="fold" class:shut={folded.has(key)} aria-label={line.kind === 'group' ? line.group.album : line.name} onclick={() => fold(key)}><i class="icon">{icons.caretDown}</i></button>
                    <i class="icon glyph kind">{line.kind === 'group' ? icons.album : icons.artist}</i>
                    {#if line.kind === 'group'}<span class="album">{line.group.album || text('Queue_UnknownAlbum')}</span>{:else}<span class="by">{line.name || text('Queue_UnknownArtist')}</span>{/if}
                  </span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    <footer>
      <div class="select">
        <span>{text('Queue_SelectLabel')}</span>
        <button title={text('Queue_SelectAll')} onclick={() => importQueue.setAllTicks(true)}>{text('Queue_SelectAllWord')}</button>
        <i>/</i>
        <button title={text('Queue_DeselectAll')} onclick={() => importQueue.setAllTicks(false)}>{text('Queue_SelectNoneWord')}</button>
      </div>
      <p class="status" role="status">
        {#if message}<span class="error">{message}</span>{:else if toast}{toast}{:else if running}{text('Web_ImportKeepOpen')}{:else}{facts}{/if}
      </p>
      {#if counts.done > 0 && !running}<button class="glass-button slim" onclick={clearDone}>{text('Web_ImportClearDone')}</button>{/if}
      <label class="glass-button slim add"><i class="icon">{icons.plus}</i>{text('AddMusic_Title')}<input type="file" multiple hidden onchange={picked} /></label>
      <button class="glass-button primary slim" disabled={running || importable === 0} onclick={run}><i class="icon">{icons.import}</i>{text('Queue_ImportAction')}<i class="icon chevron">{icons.forward}</i></button>
    </footer>
      </div>
    </div>
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

  .saved {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 8px;
    align-items: center;
    margin-bottom: 8px;
    color: var(--text-soft);
    font-size: 12px;
  }

  .saved p {
    flex: 1 1 100%;
    margin: 0;
  }

  .empty {
    display: grid;
    flex: 1;
    gap: 14px;
    align-content: center;
    justify-items: center;
    max-width: 320px;
    margin: 0 auto;
    padding: 24px 16px;
    text-align: center;
  }

  .mark {
    position: relative;
    margin-bottom: 2px;
    color: rgb(255 255 255 / 0.33);
    font-size: 42px;
  }

  .mark .plus {
    position: absolute;
    right: -10px;
    bottom: -2px;
    font-size: 14px;
  }

  .empty h3 {
    margin: 0;
    color: rgb(255 255 255 / 0.8);
    font-size: 13px;
    font-weight: 600;
  }

  .empty p {
    margin: 0;
    color: rgb(255 255 255 / 0.53);
    font-size: 11.5px;
    line-height: 1.45;
  }

  .adds {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-top: 4px;
  }

  label.glass-button {
    cursor: pointer;
  }

  .get {
    margin-top: 6px;
  }

  .toolbar {
    display: flex;
    flex: none;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    min-height: 38px;
    padding: 4px 16px;
    border-block: 1px solid rgb(255 255 255 / 0.122);
    background: rgb(0 0 0 / 0.2);
  }

  .keys,
  .view-keys {
    display: flex;
    gap: 2px;
    align-items: center;
    min-width: 0;
  }

  .keys {
    overflow-x: auto;
    scrollbar-width: none;
  }

  .view-keys {
    flex: none;
    gap: 4px;
  }

  /* Flat: a toolbar draws itself with its icons, and the keys appear under the pointer. */
  .tool-key {
    display: inline-flex;
    flex: none;
    gap: 6px;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 28px;
    padding: 0 9px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: rgb(255 255 255 / 0.88);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .tool-key:disabled {
    color: rgb(255 255 255 / 0.31);
    cursor: default;
  }

  .tool-key .small {
    font-size: 11px;
  }

  @media (hover: hover) {
    .tool-key:not(:disabled):hover {
      background: rgb(255 255 255 / 0.122);
    }
  }

  .tool-key:not(:disabled):active {
    background: rgb(255 255 255 / 0.059);
  }

  .tool-key.on,
  .tool-key.lit {
    border-color: rgb(4 200 255 / 0.44);
    background: rgb(4 200 255 / 0.18);
    color: #fff;
  }

  .divider {
    flex: none;
    width: 1px;
    height: 16px;
    margin: 0 6px;
    background: rgb(255 255 255 / 0.122);
  }

  .search {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 170px;
    height: 28px;
    padding: 0 9px;
    border: 1px solid rgb(255 255 255 / 0.141);
    border-radius: 4px;
    background: rgb(0 0 0 / 0.22);
    color: rgb(255 255 255 / 0.54);
    font-size: 11px;
  }

  .search input {
    flex: 1;
    width: 100%;
    min-width: 0;
    border: 0;
    background: none;
    color: #fff;
    outline: none;
    font-size: 16px;
  }

  @media (pointer: fine) {
    .search input {
      font-size: 12px;
    }
  }

  .strip {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    padding: 4px 16px;
    border-bottom: 1px solid rgb(255 255 255 / 0.122);
    background: rgb(0 0 0 / 0.2);
  }

  .chip span {
    color: rgb(255 255 255 / 0.54);
  }

  .names {
    width: min(320px, 100%);
    margin-right: 6px;
  }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .list-side {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .grid {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: auto;
    background: rgb(0 0 0 / 0.2);
  }

  .head {
    position: sticky;
    z-index: 2;
    top: 0;
    display: grid;
    grid-template-columns: var(--columns);
    min-width: 100%;
    border-bottom: 1px solid rgb(255 255 255 / 0.122);
    background: rgb(12 16 22 / 0.92);
    color: rgb(255 255 255 / 0.8);
    font-size: 12px;
  }

  .head span {
    overflow: hidden;
    padding: 0 8px;
    border-right: 1px solid rgb(255 255 255 / 0.078);
    line-height: 21px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .number {
    text-align: right;
  }

  .field2 {
    position: relative;
  }

  .line {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
  }

  .cells {
    --band: transparent;
    --wash: transparent;
    display: grid;
    grid-template-columns: var(--columns);
    align-items: center;
    height: 100%;
    background: linear-gradient(var(--wash), var(--wash)), linear-gradient(var(--band), var(--band));
    color: rgb(255 255 255 / 0.87);
    font-size: 12px;
  }

  .line:not(.even) .cells {
    --band: rgb(255 255 255 / 0.055);
  }

  /* What is ticked is what will be imported: the grid's selection wash, with its bar at the edge. */
  .cells.ticked {
    --wash: rgb(4 200 255 / 0.141);
    box-shadow: inset 3px 0 0 #04c8ff;
  }

  @media (hover: hover) {
    .cells:hover {
      --wash: rgb(255 255 255 / 0.039);
    }

    .cells.ticked:hover {
      --wash: rgb(4 200 255 / 0.188);
    }
  }

  .marks {
    display: grid;
    grid-template-columns: 30px 26px 26px;
    align-items: center;
    justify-items: center;
    height: 100%;
  }

  .pen {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.7);
    font-size: 11px;
    cursor: pointer;
  }

  .handle {
    color: rgb(255 255 255 / 0.3);
    font-size: 10px;
    cursor: grab;
    touch-action: none;
  }

  @media (hover: hover) {
    .handle {
      opacity: 0;
    }

    .cells:hover .handle {
      opacity: 1;
    }
  }

  .name {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
    padding-left: 6px;
    white-space: nowrap;
  }

  .name.inner {
    padding-left: 22px;
  }

  .track-name {
    padding-left: 40px;
  }

  .fold {
    flex: none;
    width: 14px;
    height: 14px;
    padding: 0;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.7);
    font-size: 11px;
    cursor: pointer;
  }

  .fold .icon {
    display: block;
    transition: transform 120ms;
  }

  .fold.shut .icon {
    transform: rotate(-90deg);
  }

  .glyph {
    flex: none;
    width: 14px;
    color: rgb(143 176 200);
    font-size: 11px;
    text-align: center;
  }

  .glyph.kind {
    color: #0371d0;
  }

  .glyph.missing {
    color: #04c8ff;
  }

  .number + .title {
    margin-left: 2px;
  }

  .name .number {
    flex: none;
    color: rgb(255 255 255 / 0.87);
  }

  .album,
  .by,
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .title.missing {
    color: rgb(255 255 255 / 0.6);
  }

  .split {
    flex: none;
    padding: 0;
    border: 0;
    background: none;
    color: #63c9f0;
    font-size: 11px;
    cursor: pointer;
  }

  .cell {
    overflow: hidden;
    padding: 0 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state {
    overflow: hidden;
    padding: 0 8px;
    color: rgb(255 255 255 / 0.6);
    font-size: 11.5px;
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
    color: var(--found);
  }

  .row.ghost {
    opacity: 0.4;
  }

  footer {
    display: flex;
    flex: none;
    gap: 12px;
    align-items: center;
    padding: 7px 14px;
    border-top: 1px solid rgb(255 255 255 / 0.122);
    background: rgb(0 0 0 / 0.2);
  }

  .select {
    display: flex;
    flex: none;
    align-items: center;
    color: rgb(255 255 255 / 0.66);
    font-size: 12px;
  }

  .select span {
    margin-right: 4px;
  }

  .select button {
    height: 26px;
    padding: 0 6px;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.86);
    font: inherit;
    cursor: pointer;
  }

  .select i {
    color: rgb(255 255 255 / 0.3);
    font-style: normal;
  }

  .status {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: rgb(255 255 255 / 0.66);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error {
    color: var(--error);
  }

  .slim {
    min-width: 0;
    height: 30px;
    padding: 0 12px;
    font-size: 12.5px;
  }

  .slim .icon {
    font-size: 11px;
  }

  .slim .chevron {
    font-size: 13px;
  }

  /* A phone reads the name and the state: the rest of the record is in the tag panel. */
  @media (max-width: 699px) {
    .toolbar {
      padding: 4px 8px;
    }

    .search {
      width: 120px;
    }

    .view-keys .tool-key:nth-of-type(n + 2) {
      display: none;
    }

    .marks {
      grid-template-columns: 34px 0 26px;
    }

    .pen {
      display: none;
    }

    footer {
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px;
    }

    .status {
      order: 3;
      flex: 1 1 100%;
    }

    .select {
      margin-right: auto;
    }
  }
</style>

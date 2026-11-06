<script lang="ts">
  // The import workbench. Rows are proposed here: nothing leaves the browser until Import is pressed, and
  // the ticks are the selection.
  import { catalogue, importer, importMedia, importQueue } from '../../app';
  import { icons } from '../../design/icons';
  import { bestPreset, FILENAME_PRESETS } from '../../import/filename-tags';
  import { pickedFromDrop, pickedFromInput } from '../../import/pick';
  import { tagsMissing, type ChipFilter, type ImportRow, type PickedFile, type QueueGroup } from '../../import/queue';
  import { text } from '../../strings/loc';
  import TagPanel from './TagPanel.svelte';

  const small = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent);
  const folderPicker = 'webkitdirectory' in HTMLInputElement.prototype && !/iPhone|iPad/.test(navigator.userAgent);

  // A plain counter, raised on every queue change, because the rows are not reactive objects.
  let version = $state(0);
  importQueue.onChange(() => version++);

  let running = $state(false);
  let chip = $state<ChipFilter | null>(null);
  let search = $state('');
  let showTags = $state(false);
  let showNames = $state(false);
  let preset = $state(0);
  let dropping = $state(false);
  let message = $state('');
  let dragged = $state<ImportRow[]>([]);

  type Line = { kind: 'group'; group: QueueGroup } | { kind: 'row'; row: ImportRow; group: QueueGroup };

  const lines = $derived.by((): Line[] => {
    void version;
    const words = search.trim().toLowerCase();
    const keep = (row: ImportRow) => {
      if (chip === 'missing' && !tagsMissing(row)) return false;
      if (chip === 'unreadable' && row.state !== 'unreadable' && row.state !== 'refused') return false;
      if (chip === 'ticked' && !row.ticked) return false;
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
        row.tags = tags;
        row.hasArt = hasArt;
        row.state = 'ready';
      } catch {
        row.state = 'unreadable';
        row.ticked = false;
        row.note = 'Cloud_FailUnreadable';
      }
      importQueue.changed();
    }
  }

  async function drop(event: DragEvent) {
    event.preventDefault();
    dropping = false;
    if (event.dataTransfer?.items.length) await add(await pickedFromDrop(event.dataTransfer.items));
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
    {#if counts.total > 0}
      <p>{counts.total === 1 ? text('Queue_StatusFileOne') : text('Queue_StatusFiles', counts.total)}  •  {size(counts.bytes)}</p>
    {/if}
  </header>

  {#if counts.total === 0}
    <div class="empty">
      <h3>{text('Queue_EmptyTitle')}</h3>
      <p>{text('Web_ImportEmptyHint')}</p>
      <div class="adds">
        <label class="glass-button primary">{text('Web_ImportAddFiles')}<input type="file" multiple accept="audio/*,.flac,.m4a,.opus,.ogg,.oga,.wv,.wma,.aif,.aiff" hidden onchange={picked} /></label>
        {#if folderPicker}
          <label class="glass-button">{text('Web_ImportAddFolder')}<input type="file" webkitdirectory hidden onchange={picked} /></label>
        {/if}
      </div>
    </div>
  {:else}
    <div class="tools">
      <button class="tool" class:on={showTags} onclick={() => (showTags = !showTags)}>{text('Queue_TagPanelTitle')}</button>
      <button class="tool" class:on={showNames} onclick={() => (showNames = !showNames)}>{text('Queue_ActionTagsFromFilename')}</button>
      <button class="tool" onclick={() => importQueue.numberTracks(ticked)}>{text('Queue_ActionNumberTracks')}</button>
      <button class="tool" onclick={() => importQueue.remove(ticked)}>{text('Queue_CtxRemove')}</button>
      <label class="search"><i class="icon">{icons.search}</i><input type="search" placeholder={text('Review_SearchPlaceholder')} bind:value={search} /></label>
    </div>

    <div class="chips">
      {#each [['missing', text('Queue_ChipNotIdentified'), counts.missing], ['unreadable', text('Queue_ChipUnreadable'), counts.unreadable], ['ticked', text('Queue_ChipTicked'), counts.ticked]] as [id, label, count] (id)}
        <button class="chip" class:on={chip === id} onclick={() => (chip = chip === id ? null : (id as ChipFilter))}>{label} <span>{count}</span></button>
      {/each}
    </div>

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
        {#if message}<span class="error">{message}</span>{:else if running}{text('Web_ImportKeepOpen')}{:else if counts.done > 0}{counts.done} {text('Web_ImportDone').toLowerCase()}{/if}
      </p>
      {#if counts.done > 0 && !running}<button class="tool" onclick={clearDone}>{text('Web_ImportClearDone')}</button>{/if}
      <label class="tool add">{text('AddMusic_Title')}<input type="file" multiple hidden onchange={picked} /></label>
      <button class="glass-button primary" disabled={running || importable === 0} onclick={run}>{text('Queue_ImportAction')}</button>
    </footer>
  {/if}
</div>

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

  header {
    padding: 14px 16px 6px;
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

  .tool {
    display: inline-grid;
    place-items: center;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    background: rgb(255 255 255 / 0.05);
    font-size: 12px;
    cursor: pointer;
  }

  .tool.on {
    background: rgb(255 255 255 / 0.2);
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

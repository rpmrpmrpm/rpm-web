<script lang="ts">
  // The account's playlists, as the desktop has them: a wall of covers or a tree, one folder at a time, and the
  // list itself opened in the pane. Those it made itself can be changed. Auto playlists are the desktop's, so they
  // are shown when a desktop has cut them, and the page says where they come from.
  import { onMount } from 'svelte';

  import { durationSeconds, type CloudTrack } from '../../api/wire';
  import { favorites, player, playlists } from '../../app';
  import { icons } from '../../design/icons';
  import { hasAnother, Readings } from '../../library/generated-lists';
  import { lookOf } from '../../library/list-look';
  import { foldersIn, listsIn, PlaylistGone, type CloudPlaylist, type GeneratedList } from '../../library/playlists';
  import { library, now } from '../../state.svelte';
  import { trackCount } from '../../strings/counts';
  import { text } from '../../strings/loc';
  import Window from '../import/Window.svelte';
  import { menuOn, type MenuEntry } from '../menu/menu.svelte';
  import DesktopGet from '../shell/DesktopGet.svelte';
  import PlaylistCover from './PlaylistCover.svelte';
  import PlaylistDetail from './PlaylistDetail.svelte';
  import { pages } from './pages.svelte';
  import RecordSpinner from './RecordSpinner.svelte';

  const VIEW_KEY = 'rpm.playlistView';
  const SIZE_KEY = 'rpm.playlistTile';
  const SMALLEST = 96;
  const LARGEST = 260;
  const FIRST_SIZE = 150;

  const stored = (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const store = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // A preference. It holds for this visit either way.
    }
  };

  let held = $state.raw<CloudPlaylist[] | null>(null);
  let generated = $state.raw<GeneratedList[]>([]);
  let failed = $state(false);
  let path = $state.raw<string[]>([]);
  let made = $state.raw<string[][]>([]);
  let view = $state<'icons' | 'list'>(stored(VIEW_KEY) === 'list' ? 'list' : 'icons');
  let tile = $state(Number(stored(SIZE_KEY)) || FIRST_SIZE);
  let expanded = $state.raw<Set<string>>(new Set());
  let naming = $state<'playlist' | 'folder' | 'rename' | 'cover' | 'file' | null>(null);
  let typed = $state('');
  let refusal = $state('');
  let coverVersion = $state(0);
  let picker = $state<HTMLInputElement | null>(null);

  async function read() {
    try {
      held = await playlists.list();
      generated = await playlists.generated().catch(() => []);
      failed = false;
    } catch {
      failed = true;
    }
  }

  onMount(read);

  const byId = $derived(new Map(library.albums.flatMap((album) => album.tracks).map((track) => [track.rpmId, track])));
  const tracksOf = (ids: readonly string[]): CloudTrack[] => ids.flatMap((id) => byId.get(id) ?? []);
  // A generated list shows one slice of the run the desktop sent. "Generate new" moves it to the next slice.
  const readings = new Readings();
  let stepped = $state(0);
  const showingOf = (list: GeneratedList): CloudTrack[] => {
    void stepped;
    return tracksOf(readings.showing(list));
  };
  const openedGenerated = $derived(pages.playlist?.kind === 'generated' ? pages.playlist.list : null);
  function generateNew(list: GeneratedList) {
    readings.step(list);
    stepped++;
  }
  const secondsOf = (tracks: readonly CloudTrack[]) => tracks.reduce((sum, track) => sum + durationSeconds(track), 0);

  const open = $derived(pages.playlist?.kind === 'list' ? (held?.find((playlist) => playlist.playlistId === (pages.playlist as { id: string }).id) ?? null) : null);
  const shownTracks = $derived.by(() => {
    if (pages.playlist?.kind === 'queue') return now.queue;
    if (pages.playlist?.kind === 'generated') return showingOf(pages.playlist.list);
    return tracksOf(open?.trackIds ?? []);
  });
  const missing = $derived((open?.trackIds.length ?? 0) - (open ? shownTracks.length : 0));

  async function act(run: () => Promise<unknown>) {
    refusal = '';
    try {
      await run();
    } catch (error) {
      refusal = text(error instanceof PlaylistGone ? 'Rpm_PlaylistWrite_Gone' : 'Rpm_PlaylistPick_Failed');
    }
    await read();
  }

  function ask(what: 'playlist' | 'folder' | 'rename') {
    naming = what;
    typed = what === 'rename' ? (open?.name ?? '') : '';
  }

  async function named(event: SubmitEvent) {
    event.preventDefault();
    const name = typed.trim();
    const what = naming;
    naming = null;
    if (!name) return;
    if (what === 'folder') {
      made = [...made, [...path, name]];
      path = [...path, name];
    } else if (what === 'playlist') {
      await act(() => playlists.create(name, [], path));
    } else if (what === 'rename' && open) {
      await act(() => playlists.rename(open.playlistId, name));
    }
  }

  async function remove() {
    if (!open) return;
    const id = open.playlistId;
    pages.playlist = null;
    await act(() => playlists.remove(id));
  }

  // The rows move at once, and the store is told. A refusal puts back what it holds.
  function moved(from: number, to: number) {
    if (!open) return;
    const shown = open.trackIds;
    const mine = [...shown];
    const [row] = mine.splice(from, 1);
    mine.splice(to, 0, row!);
    held = held!.map((list) => (list.playlistId === open.playlistId ? { ...list, trackIds: mine } : list));
    void act(() => playlists.reorder(open.playlistId, shown, mine));
  }

  async function picked(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    naming = null;
    if (!file || !open) return;
    const id = open.playlistId;
    await act(async () => playlists.choosePicture(id, new Uint8Array(await file.arrayBuffer()), file.type || 'image/jpeg'));
    coverVersion++;
  }

  async function automatic() {
    naming = null;
    if (!open) return;
    const id = open.playlistId;
    await act(() => playlists.removePicture(id));
    coverVersion++;
  }

  function filed(event: SubmitEvent) {
    event.preventDefault();
    const unchanged = typed === open?.folder.join(' / ');
    const folder = typed.split('/').map((name) => name.trim()).filter(Boolean);
    naming = null;
    if (open && !unchanged) void act(() => playlists.refile(open.playlistId, folder));
  }

  // A question asked of the library, not a list anybody keeps, so there is nothing in the cloud to open.
  const favourite = $derived.by((): GeneratedList => {
    void library.marksVersion;
    return { kind: 'favorites', title: text('Playlists_FavoriteTracks'), trackIds: favorites.marks.marked(library.albums).map((track) => track.rpmId) };
  });

  const generatedName = (list: GeneratedList) => list.title ?? list.kind;
  // The frame a list from the desktop wears, or null for a kind this build has no colours for. The marked songs
  // are this page's own question, not one of the desktop's lists, and wear no frame, as on the phone.
  const framedOf = (list: GeneratedList) => {
    const look = list.kind === 'favorites' ? null : lookOf(list.kind, list.genre, list.decade ?? 0);
    return look ? { name: generatedName(list), look } : null;
  };
  const inHere = $derived(held ? listsIn(held, path) : []);
  const folders = $derived(held ? foldersIn(held, path, made) : []);
  const root = $derived(path.length === 0);
  const automaticLists = $derived(root ? (favourite.trackIds.length ? [favourite, ...generated] : generated) : []);

  const subheading = $derived.by(() => {
    if (!held) return '';
    const count = held.length + generated.length;
    if (!count) return text('Stats_Empty');
    const seconds = secondsOf(held.flatMap((list) => tracksOf(list.trackIds)));
    const total = Math.floor(seconds / 60);
    const length = total < 60 ? text('Stats_Minutes', total) : text('Stats_HoursMinutes', Math.floor(total / 60), total % 60);
    return `${count === 1 ? text('Stats_PlaylistsOne') : text('Stats_Playlists', count)}  •  ${length}`;
  });

  const openedName = $derived(pages.playlist?.kind === 'queue' ? text('Playlists_NowPlaying') : pages.playlist?.kind === 'generated' ? generatedName(pages.playlist.list) : (open?.name ?? ''));
  const openedLine = $derived(
    `${trackCount(shownTracks.length)}${missing > 0 ? `  •  ${missing === 1 ? text('Rpm_Playlist_MissingOne') : text('Rpm_Playlist_Missing', missing)}` : ''}`,
  );

  function setView(next: 'icons' | 'list') {
    view = next;
    store(VIEW_KEY, next);
  }

  function setTile(event: Event) {
    tile = Number((event.currentTarget as HTMLInputElement).value);
    store(SIZE_KEY, String(tile));
  }

  // The tree, flattened: what is open is listed under its folder.
  type Row = { depth: number; folder: string[] | null; name: string; list?: CloudPlaylist };

  const rows = $derived.by(() => {
    const all = held ?? [];
    const walk = (at: string[], depth: number): Row[] => [
      ...listsIn(all, at).map((list): Row => ({ depth, folder: null, name: list.name, list })),
      ...foldersIn(all, at, made).flatMap((name): Row[] => {
        const folder = [...at, name];
        return [{ depth, folder, name }, ...(expanded.has(folder.join('/')) ? walk(folder, depth + 1) : [])];
      }),
    ];
    return walk([], 0);
  });

  // The app's own lists and a folder play. Only a list somebody made can be changed.
  const playingMenu = (tracks: readonly CloudTrack[]): MenuEntry[] => [
    { label: text('Playlists_Play'), glyph: icons.play, disabled: !tracks.length, run: () => player.play(tracks, 0, { inAlbumOrder: false }) },
    { label: text('Playlists_AddToNowPlaying'), glyph: icons.playlist, disabled: !tracks.length, run: () => player.addToQueue(tracks) },
  ];

  const openThen = (list: CloudPlaylist, run: () => void) => () => {
    pages.playlist = { kind: 'list', id: list.playlistId };
    run();
  };

  const listMenu = (list: CloudPlaylist): MenuEntry[] => [
    ...playingMenu(tracksOf(list.trackIds)),
    'rule',
    { label: text('Playlists_Rename'), glyph: icons.pen, run: openThen(list, () => { naming = 'rename'; typed = list.name; }) },
    { label: text('Playlists_ChangeCover'), glyph: icons.image, run: openThen(list, () => (naming = 'cover')) },
    { label: text('Playlists_Delete'), glyph: icons.trash, run: openThen(list, () => void remove()) },
  ];

  function folderMenu(folder: string[]): MenuEntry[] {
    const under = (held ?? []).filter((list) => folder.every((name, index) => list.folder[index] === name));
    return [
      ...playingMenu(under.flatMap((list) => tracksOf(list.trackIds))),
      'rule',
      { label: text('Playlists_NewPlaylist'), glyph: icons.plus, run: () => { path = folder; ask('playlist'); } },
      { label: text('Playlists_NewFolder'), glyph: icons.folderClosed, run: () => { path = folder; ask('folder'); } },
    ];
  }

  function toggle(folder: string[]) {
    const key = folder.join('/');
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expanded = next;
  }
</script>

{#snippet tileFace(name: string, cover: import('svelte').Snippet, onclick: () => void, menu: () => MenuEntry[] = () => [])}
  <li>
    <button class="tile" title={name} {onclick} use:menuOn={menu}>
      <span class="face">{@render cover()}</span>
      <strong>{name}</strong>
    </button>
  </li>
{/snippet}

{#if pages.playlist}
  <PlaylistDetail
    id={open?.playlistId ?? (pages.playlist.kind === 'generated' ? (pages.playlist.list.id ?? null) : null)}
    name={openedName}
    subtitle={openedLine}
    tracks={shownTracks}
    glyph={pages.playlist.kind === 'queue' ? icons.play : icons.playlist}
    version={coverVersion}
    framed={openedGenerated ? framedOf(openedGenerated) : null}
    onBack={() => (pages.playlist = null)}
    onRemove={open ? (track, index) => { const id = open!.playlistId; void act(() => playlists.removeAt(id, track.rpmId, index)); } : undefined}
    onMove={open ? moved : undefined}
  >
    {#snippet keys()}
      {#if openedGenerated && hasAnother(openedGenerated)}
        {@const list = openedGenerated}
        <button class="round" title={text('Playlists_GenerateNew')} aria-label={text('Playlists_GenerateNew')} onclick={() => generateNew(list)}><i class="icon">{icons.refresh}</i></button>
      {/if}
      {#if open}
        <button class="round" title={text('Playlists_ChangeCover')} aria-label={text('Playlists_ChangeCover')} onclick={() => (naming = 'cover')}><i class="icon">{icons.image}</i></button>
        <button class="round" title={text('Playlists_Rename')} aria-label={text('Playlists_Rename')} onclick={() => ask('rename')}><i class="icon">{icons.pen}</i></button>
        <button class="round" title={text('Playlists_DefaultFolder')} aria-label={text('Playlists_DefaultFolder')} onclick={() => { typed = open!.folder.join(' / '); naming = 'file'; }}><i class="icon">{icons.folderClosed}</i></button>
        <button class="round" title={text('Playlists_Delete')} aria-label={text('Playlists_Delete')} onclick={remove}><i class="icon">{icons.trash}</i></button>
      {/if}
    {/snippet}
  </PlaylistDetail>
  {#if refusal}<p class="refusal over" role="alert">{refusal}</p>{/if}
{:else}
  <div class="page">
    <div class="top">
      <div class="titles">
        <h2 class="heading">{text('Playlists_Title')}</h2>
        <p class="pane-line">{subheading}</p>
      </div>
      <div class="views">
        <div class="toggle">
          <button class:on={view === 'icons'} title={text('Playlists_ViewIcons')} aria-label={text('Playlists_ViewIcons')} aria-pressed={view === 'icons'} onclick={() => setView('icons')}><i class="icon">{icons.grid}</i></button>
          <button class:on={view === 'list'} title={text('Playlists_ViewList')} aria-label={text('Playlists_ViewList')} aria-pressed={view === 'list'} onclick={() => setView('list')}><i class="icon">{icons.list}</i></button>
        </div>
        {#if view === 'icons'}
          <input class="size slider" style:--fill="{((tile - SMALLEST) / (LARGEST - SMALLEST)) * 100}%" type="range" min={SMALLEST} max={LARGEST} step="2" aria-label={text('AlbumGrid_CoverSize')} value={tile} oninput={setTile} />
        {/if}
      </div>
    </div>

    {#if failed}
      <p class="refusal" role="alert">{text('Rpm_Playlists_Error')}</p>
      <button class="glass-button" onclick={read}>{text('Rpm_Library_Retry')}</button>
    {:else if held === null}
      <div class="asking"><RecordSpinner size={52} /><p class="sub">{text('Rpm_Playlists_Loading')}</p></div>
    {:else}
      {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
      <div class="keys">
        <button class="new" onclick={() => ask('playlist')}><i class="icon">{icons.plus}</i>{text('Playlists_NewPlaylist')}</button>
        <button class="new" title={text('Playlists_NewFolder')} aria-label={text('Playlists_NewFolder')} onclick={() => ask('folder')}><i class="icon">{icons.folderClosed}</i></button>
      </div>

      {#if view === 'icons'}
        {#if !root}
          <nav class="trail">
            <button onclick={() => (path = [])}>{text('Playlists_Title')}</button>
            {#each path as name, index}
              <i class="icon">{icons.forward}</i>
              <button onclick={() => (path = path.slice(0, index + 1))}>{name}</button>
            {/each}
          </nav>
        {/if}

        {#if !root && !inHere.length && !folders.length}
          <p class="sub middle">{text('Playlists_FolderEmpty')}</p>
        {:else}
          <ul class="wall" style:--tile="{tile}px">
            {#if root}
              {#snippet queueCover()}<PlaylistCover tracks={now.queue} glyph={icons.play} />{/snippet}
              {@render tileFace(text('Playlists_NowPlaying'), queueCover, () => (pages.playlist = { kind: 'queue' }))}
            {/if}
            {#each inHere as playlist (playlist.playlistId)}
              {#snippet listCover()}<PlaylistCover id={playlist.playlistId} tracks={tracksOf(playlist.trackIds)} version={coverVersion} />{/snippet}
              {@render tileFace(playlist.name, listCover, () => (pages.playlist = { kind: 'list', id: playlist.playlistId }), () => listMenu(playlist))}
            {/each}
            {#each automaticLists as list, index (`${list.kind}-${index}`)}
              {#snippet autoCover()}<PlaylistCover id={list.id ?? null} tracks={showingOf(list)} framed={framedOf(list)} />{/snippet}
              {@render tileFace(generatedName(list), autoCover, () => (pages.playlist = { kind: 'generated', list }), () => playingMenu(showingOf(list)))}
            {/each}
            {#each folders as name (name)}
              {#snippet folderCover()}<PlaylistCover tracks={[]} glyph={icons.folderClosed} />{/snippet}
              {@render tileFace(name, folderCover, () => (path = [...path, name]), () => folderMenu([...path, name]))}
            {/each}
          </ul>
        {/if}
      {:else}
        <ul class="tree">
          {#each favourite.trackIds.length ? [favourite, ...generated] : generated as list, index (`${list.kind}-${index}`)}
            <li><button style:padding-left="22px" onclick={() => (pages.playlist = { kind: 'generated', list })} use:menuOn={() => playingMenu(showingOf(list))}><i class="icon">{icons.playlist}</i><span>{generatedName(list)}</span></button></li>
          {/each}
          {#each rows as row (`${row.folder?.join('/') ?? row.list?.playlistId}`)}
            <li>
              {#if row.list}
                <button style:padding-left="{22 + row.depth * 18}px" onclick={() => (pages.playlist = { kind: 'list', id: row.list!.playlistId })} use:menuOn={() => listMenu(row.list!)}><i class="icon">{icons.playlist}</i><span>{row.name}</span></button>
              {:else}
                {@const open = expanded.has(row.folder!.join('/'))}
                <button style:padding-left="{4 + row.depth * 18}px" title={text(open ? 'Playlists_Collapse' : 'Playlists_Expand')} aria-expanded={open} onclick={() => toggle(row.folder!)} use:menuOn={() => folderMenu(row.folder!)}>
                  <i class="icon chevron" class:open>{icons.forward}</i><i class="icon">{icons.folderClosed}</i><span>{row.name}</span>
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
    <div class="note">
      <p>{text('Web_PlaylistsDesktopNote')}</p>
      <DesktopGet />
    </div>
  </div>
{/if}

{#if naming === 'playlist' || naming === 'folder' || naming === 'rename'}
  <Window
    title={text(naming === 'folder' ? 'Playlists_NewFolder' : naming === 'rename' ? 'Playlists_Rename' : 'Playlists_NewPlaylist')}
    glyph={naming === 'folder' ? icons.folderClosed : icons.playlist}
    minWidth={420}
    maxWidth={560}
    minHeight={260}
    openHeight={280}
    onClose={() => (naming = null)}
  >
    <form id="naming" onsubmit={named}>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="field" autofocus aria-label={text('Rpm_NewPlaylist_Name')} placeholder={text('Rpm_NewPlaylist_Name')} bind:value={typed} />
    </form>
    {#snippet footer()}
      <button class="glass-button" onclick={() => (naming = null)}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
      <button class="glass-button primary" type="submit" form="naming"><i class="icon">{icons.check}</i>{text(naming === 'rename' ? 'Playlists_Rename' : 'Rpm_NewPlaylist_Create')}</button>
    {/snippet}
  </Window>
{:else if naming === 'file'}
  <Window title={text('Playlists_DefaultFolder')} glyph={icons.folderClosed} minWidth={420} maxWidth={560} minHeight={260} openHeight={280} onClose={() => (naming = null)}>
    <form id="filing" onsubmit={filed}>
      <input class="field" aria-label={text('Playlists_DefaultFolder')} list="folders" bind:value={typed} />
      <p class="sub">{text('Web_PlaylistFolderHint')}</p>
      <datalist id="folders">{#each new Set((held ?? []).map((list) => list.folder.join(' / ')).filter(Boolean)) as path}<option value={path}></option>{/each}</datalist>
    </form>
    {#snippet footer()}
      <button class="glass-button" onclick={() => (naming = null)}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
      <button class="glass-button primary" type="submit" form="filing"><i class="icon">{icons.check}</i>{text('Common_OK')}</button>
    {/snippet}
  </Window>
{:else if naming === 'cover'}
  <Window title={text('Playlists_CoverTitle')} glyph={icons.image} minWidth={420} maxWidth={560} minHeight={280} openHeight={300} onClose={() => (naming = null)}>
    <div class="choices">
      <button class="glass-button" onclick={() => picker?.click()}><i class="icon">{icons.image}</i>{text('Playlists_CoverChooseFile')}</button>
      <button class="glass-button" onclick={automatic}><i class="icon">{icons.grid}</i>{text('Playlists_CoverAutomatic')}</button>
    </div>
    <input bind:this={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onchange={picked} />
    {#snippet footer()}
      <button class="glass-button" onclick={() => (naming = null)}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
    {/snippet}
  </Window>
{/if}

<style>
  .asking {
    display: grid;
    gap: 10px;
    place-items: center;
    padding: 32px 0;
  }

  .page {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    padding: 12px 16px 16px;
    overflow-y: auto;
  }

  .top {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .titles {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .titles .pane-line {
    margin-bottom: 2px;
  }

  p {
    margin: 0;
  }

  .sub {
    color: var(--text-soft);
    font-size: 11.5px;
  }

  .middle {
    padding: 48px 0;
    text-align: center;
  }

  .views {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .toggle {
    display: flex;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.13);
    border-radius: 6px;
    background: rgb(255 255 255 / 0.08);
  }

  .toggle button {
    width: 32px;
    height: 26px;
    padding: 0;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.67);
    font-size: 13px;
    cursor: pointer;
  }

  .toggle button:hover,
  .toggle button.on {
    background: rgb(255 255 255 / 0.1);
    color: #fff;
  }

  .size {
    width: 96px;
  }

  /* At the foot, where the desktop keeps its card of lists to unlock: this is news, not the page. */
  .note {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: center;
    justify-content: space-between;
    margin-top: auto;
    padding: 12px 16px;
    border: 1px solid rgb(255 255 255 / 0.094);
    border-radius: 8px;
    background: rgb(255 255 255 / 0.039);
    color: rgb(255 255 255 / 0.64);
    font-size: 12px;
  }

  .keys {
    display: flex;
    gap: 6px;
  }

  .new {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    height: 30px;
    padding: 0 10px;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 6px;
    background: rgb(255 255 255 / 0.078);
    color: rgb(255 255 255 / 0.94);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .new:hover {
    background: rgb(255 255 255 / 0.2);
  }

  .trail {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    color: var(--text-faint);
    font-size: 9px;
  }

  .trail button {
    padding: 2px 4px;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.8);
    font-size: 12.5px;
    cursor: pointer;
  }

  .wall {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--tile) + 16px), 1fr));
    gap: 14px 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 7px;
    align-items: center;
    width: calc(var(--tile) + 16px);
    margin: 0 auto;
    padding: 8px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: inherit;
    cursor: pointer;
  }

  .tile:hover {
    background: rgb(255 255 255 / 0.08);
  }

  .face {
    display: block;
    width: var(--tile);
    border-radius: 6px;
  }

  .tile strong {
    display: -webkit-box;
    max-width: 100%;
    min-height: 30px;
    overflow: hidden;
    color: rgb(255 255 255 / 0.95);
    font-size: 12px;
    font-weight: 600;
    line-height: 15px;
    text-align: center;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .tree {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tree button {
    display: flex;
    gap: 6px;
    align-items: center;
    width: 100%;
    height: 24px;
    padding: 0 6px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: rgb(255 255 255 / 0.9);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .tree button:hover {
    background: rgb(255 255 255 / 0.08);
  }

  .tree .icon {
    width: 12px;
    color: rgb(255 255 255 / 0.5);
    font-size: 12px;
  }

  .tree .chevron {
    font-size: 9px;
    transition: transform 160ms var(--move);
  }

  .tree .chevron.open {
    transform: rotate(90deg);
  }

  .tree span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .refusal {
    color: var(--error);
    font-size: 13px;
  }

  .refusal.over {
    position: absolute;
    right: 16px;
    bottom: 12px;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  form .field {
    width: 100%;
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>

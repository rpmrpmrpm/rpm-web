<script lang="ts">
  // Import from another app: choose the app, connect, see what was found, follow the progress, read the
  // report. The desktop's MigrationDialog. The import belongs to migrating.svelte.ts, so Hide closes the
  // window and the import goes on; every face that shows an import says that nothing in the other app is
  // changed or removed.
  import { icons } from '../../../design/icons';
  import { pickedFromHandles, pickedFromInput } from '../../../import/pick';
  import type { PickedFile } from '../../../import/queue';
  import { finishQuickConnect, jellyfinWithPassword, startQuickConnect } from '../../../migration/jellyfin';
  import { matchPicked, readITunesLibrary } from '../../../migration/itunes';
  import type { SourceKind, SourceLibrary } from '../../../migration/model';
  import { readPlaylistFiles } from '../../../migration/playlist-files';
  import { plexFinish, plexPickConnection, plexServers, plexStart, type PlexServerChoice } from '../../../migration/plex';
  import { reachable, ServerBlocked, SignInExpired, SignInFailed } from '../../../migration/server';
  import { subsonicCheck } from '../../../migration/subsonic';
  import { text } from '../../../strings/loc';
  import Window from '../Window.svelte';
  import {
    cloudSpace, fetcher, jellyfinDevice, migrating, pauseMigration, plexClient, serverFor, size, startMigration, summaryOf, unfinished,
    type Connection,
  } from './migrating.svelte';

  let { onClose }: { onClose: () => void } = $props();

  type Face = 'apps' | 'connect' | 'reading' | 'summary' | 'run';
  let face = $state<Face>(migrating.running || migrating.end ? 'run' : 'apps');
  let kind = $state<SourceKind>('musicbee');
  let error = $state('');
  let note = $state('');
  let found = $state(0);
  let address = $state('');
  let user = $state('');
  let password = $state('');
  let libraryFile = $state<File | null>(null);
  let playlistFiles = $state<File[]>([]);
  let musicFolder = $state<PickedFile[]>([]);
  let plexChoices = $state<PlexServerChoice[]>([]);
  let plexPick = $state(0);
  let library = $state.raw<SourceLibrary | null>(null);
  let connection = $state.raw<Connection | null>(null);
  let space = $state<{ used: number; quota: number; unlimited: boolean } | null>(null);
  let open = $state<{ kind: SourceKind; name: string }[]>([]);
  let work: AbortController | null = null;

  unfinished().then((records) => (open = records.map((r) => ({ kind: r.kind, name: r.name }))));

  const chooseFolder = (window as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const fileKind = $derived(kind === 'musicbee' || kind === 'itunes');
  const serverKind = $derived(kind === 'jellyfin' || kind === 'navidrome');

  const SOURCES: { kind: SourceKind; name: string; hint: string; glyph: string }[] = [
    { kind: 'musicbee', name: 'Migration_SourceMusicBee', hint: 'Migration_HintFile', glyph: icons.music },
    { kind: 'itunes', name: 'Migration_SourceITunes', hint: 'Migration_HintFile', glyph: icons.music },
    { kind: 'playlistfiles', name: 'Migration_SourcePlaylistFiles', hint: 'Migration_HintPlaylistFiles', glyph: icons.file },
    { kind: 'jellyfin', name: 'Migration_SourceJellyfin', hint: 'Migration_HintServer', glyph: icons.import },
    { kind: 'plex', name: 'Migration_SourcePlex', hint: 'Migration_HintServer', glyph: icons.import },
    { kind: 'navidrome', name: 'Migration_SourceNavidrome', hint: 'Migration_HintServer', glyph: icons.import },
  ];
  const sourceName = (k: SourceKind) => text(SOURCES.find((s) => s.kind === k)!.name);
  const labelOf = (lib: SourceLibrary) => (lib.kind !== 'playlistfiles' && lib.name ? lib.name : sourceName(lib.kind));
  const keeps = (lib: SourceLibrary) =>
    lib.kind === 'playlistfiles' ? text('Migration_KeepsOriginalsPlaylists')
    : lib.kind === 'musicbee' || lib.kind === 'itunes' ? text('Migration_KeepsOriginalsFile', labelOf(lib))
    : text('Migration_KeepsOriginalsServer', labelOf(lib));

  function choose(k: SourceKind) {
    kind = k;
    error = note = '';
    libraryFile = null;
    playlistFiles = [];
    musicFolder = [];
    plexChoices = [];
    face = 'connect';
  }

  function fail(caught: unknown) {
    error = text(
      caught instanceof SignInFailed || caught instanceof SignInExpired ? 'Migration_SignInFailed'
      : caught instanceof ServerBlocked ? 'Migration_ServerBlocked'
      : fileKind || kind === 'playlistfiles' ? 'Migration_FileUnreadable'
      : 'Migration_ServerUnreachable',
    );
  }

  function serverAddress(): string | null {
    let value = address.trim();
    if (value && !value.includes('://')) value = 'http://' + value;
    try {
      new URL(value);
    } catch {
      error = text('Migration_ServerUnreachable');
      return null;
    }
    if (reachable(value) === 'blocked') {
      error = text('Migration_ServerBlocked');
      return null;
    }
    return value;
  }

  async function pickMusicFolder() {
    try {
      if (chooseFolder) musicFolder = await pickedFromHandles([await chooseFolder.call(window)]);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) fail(caught);
    }
  }

  async function read(next: Connection | null, reader: () => Promise<SourceLibrary>) {
    error = '';
    found = 0;
    face = 'reading';
    try {
      const lib = await reader();
      library = lib;
      connection = next ?? { kind: lib.kind as 'musicbee' | 'itunes' | 'playlistfiles', picked: lib.kind === 'playlistfiles' ? pickedForPlaylists(lib) : matchPicked(lib, musicFolder) };
      space = await cloudSpace();
      face = 'summary';
    } catch (caught) {
      face = 'connect';
      fail(caught);
    }
  }

  // Playlist files name paths a page cannot open; the music folder picked with them is where the tracks are.
  const pickedForPlaylists = (lib: SourceLibrary) => matchPicked(lib, musicFolder);

  async function readFile() {
    if (fileKind && libraryFile && musicFolder.length > 0) {
      const xml = await libraryFile.text();
      await read(null, () => readITunesLibrary(xml, kind as 'musicbee' | 'itunes'));
    } else if (kind === 'playlistfiles' && playlistFiles.length > 0 && musicFolder.length > 0) {
      const files = await Promise.all(playlistFiles.map(async (f) => ({ path: '/' + (f.webkitRelativePath || f.name), bytes: new Uint8Array(await f.arrayBuffer()) })));
      await read(null, async () => readPlaylistFiles(files));
    }
  }

  async function signIn() {
    const server = serverAddress();
    if (!server) return;
    try {
      const next: Connection = kind === 'jellyfin'
        ? { kind: 'jellyfin', session: await jellyfinWithPassword(fetcher, server, jellyfinDevice(), user.trim(), password) }
        : { kind: 'navidrome', login: { server, user: user.trim(), password } };
      if (next.kind === 'navidrome') await subsonicCheck(fetcher, next.login);
      await read(next, () => serverFor(next)!.read((n) => (found = n)));
    } catch (caught) {
      fail(caught);
    }
  }

  async function quickConnect() {
    const server = serverAddress();
    if (!server) return;
    work?.abort();
    const stop = (work = new AbortController());
    try {
      const { code, secret } = await startQuickConnect(fetcher, server, jellyfinDevice());
      note = text('Migration_QuickConnectCode', code);
      while (!stop.signal.aborted) {
        await new Promise((done) => setTimeout(done, 3000));
        const session = await finishQuickConnect(fetcher, server, jellyfinDevice(), secret);
        if (session) {
          const next: Connection = { kind: 'jellyfin', session };
          await read(next, () => serverFor(next)!.read((n) => (found = n)));
          return;
        }
      }
    } catch (caught) {
      fail(caught);
    }
  }

  async function plexSignIn() {
    work?.abort();
    const stop = (work = new AbortController());
    try {
      const pin = await plexStart(fetcher, plexClient());
      window.open(pin.authPage, '_blank', 'noopener');
      note = text('Migration_PlexWaiting');
      let token: string | null = null;
      while (!token && !stop.signal.aborted) {
        await new Promise((done) => setTimeout(done, 2000));
        token = await plexFinish(fetcher, plexClient(), pin);
      }
      if (!token) return;
      note = '';
      plexChoices = await plexServers(fetcher, plexClient(), token);
      if (plexChoices.length === 0) error = text('Migration_PlexNoServer');
      else if (plexChoices.length === 1) await plexConnect(plexChoices[0]!);
    } catch (caught) {
      fail(caught);
    }
  }

  async function plexConnect(server: PlexServerChoice) {
    // A web page can only reach an https connection.
    const at = await plexPickConnection(fetcher, { ...server, connections: server.connections.filter((c) => c.startsWith('https:')) });
    if (!at) {
      error = text('Migration_PlexNoServer');
      return;
    }
    const next: Connection = { kind: 'plex', server, connection: at };
    await read(next, () => serverFor(next)!.read((n) => (found = n)));
  }

  function start() {
    if (!library || !connection) return;
    face = 'run';
    void startMigration(library, connection, labelOf(library));
  }

  function continueRun() {
    if (!migrating.library || !migrating.connection) return;
    if (migrating.end === 'signin') {
      choose(migrating.library.kind);
      return;
    }
    void startMigration(migrating.library, migrating.connection, migrating.label);
  }

  function retry() {
    if (!migrating.library || !migrating.connection || !migrating.report) return;
    void startMigration(migrating.library, migrating.connection, migrating.label, migrating.report.notImported.map((n) => n.sourceId));
  }

  function close() {
    work?.abort();
    onClose();
  }

  const summary = $derived(library ? summaryOf(library) : null);
  const progress = $derived(migrating.progress);
  const done = $derived(progress ? progress.counts.imported + progress.counts.alreadyInRpm + progress.counts.notImported : 0);
  const stage = $derived(
    progress?.stage === 'playlists' ? text('Migration_StagePlaylists') : progress?.stage === 'finishing' ? text('Migration_StageFinishing') : text('Migration_StageTracks'),
  );
  const timeLeft = (secondsLeft: number) => {
    const minutes = Math.max(1, Math.round(secondsLeft / 60));
    return minutes < 60 ? text('Stats_Minutes', minutes) : text('Stats_HoursMinutes', Math.floor(minutes / 60), minutes % 60);
  };
  const stopped = $derived(
    migrating.end === 'signin' ? text('Migration_StoppedSignIn') : migrating.end === 'cloudfull' ? text('Migration_StoppedCloudFull') : text('Migration_Paused'),
  );
</script>

<Window title={text('Migration_Title')} glyph={icons.import} minWidth={460} maxWidth={720} openHeight={560} onClose={close}>
  {#if face === 'apps'}
    <h4 class="kicker">{text('Migration_ChooseKicker')}</h4>
    {#each open as unfinishedImport (unfinishedImport.kind + unfinishedImport.name)}
      <button class="glass-button continue" onclick={() => choose(unfinishedImport.kind)}>{text('Migration_ContinueImport', unfinishedImport.name || sourceName(unfinishedImport.kind))}</button>
    {/each}
    <div class="tiles">
      {#each SOURCES as source (source.kind)}
        <button class="tile" onclick={() => choose(source.kind)}>
          <i class="icon">{source.glyph}</i>
          <strong>{text(source.name)}</strong>
          <span>{text(source.hint)}</span>
        </button>
      {/each}
    </div>
  {:else if face === 'connect'}
    <h4 class="kicker">{sourceName(kind)}</h4>
    {#if fileKind || kind === 'playlistfiles'}
      <p class="line">{text(kind === 'musicbee' ? 'Migration_HowMusicBee' : kind === 'itunes' ? 'Migration_HowITunes' : 'Migration_HowPlaylistFiles')}</p>
      <div class="row">
        {#if fileKind}
          <label class="glass-button">{text('Migration_ChooseFile')}<input type="file" accept=".xml" hidden onchange={(e) => (libraryFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} /></label>
          {#if libraryFile}<span class="quiet">{libraryFile.name}</span>{/if}
        {:else}
          <label class="glass-button">{text('Migration_ChoosePlaylists')}<input type="file" multiple accept=".m3u,.m3u8,.pls" hidden onchange={(e) => (playlistFiles = [...((e.currentTarget as HTMLInputElement).files ?? [])])} /></label>
          {#if playlistFiles.length}<span class="quiet">{playlistFiles.map((f) => f.name).join(', ')}</span>{/if}
        {/if}
      </div>
      <p class="quiet">{text('Migration_MusicFolderHint')}</p>
      <div class="row">
        {#if chooseFolder}
          <button class="glass-button" onclick={pickMusicFolder}>{text('Migration_ChooseMusicFolder')}</button>
        {:else}
          <label class="glass-button">{text('Migration_ChooseMusicFolder')}<input type="file" webkitdirectory hidden onchange={(e) => (musicFolder = pickedFromInput((e.currentTarget as HTMLInputElement).files!))} /></label>
        {/if}
        {#if musicFolder.length}<span class="quiet">{musicFolder.length}</span>{/if}
      </div>
    {:else if serverKind}
      <label class="field">{text('Migration_ServerAddress')}<input bind:value={address} autocomplete="url" /></label>
      <label class="field">{text('Migration_UserName')}<input bind:value={user} autocomplete="username" /></label>
      <label class="field">{text('Migration_Password')}<input type="password" bind:value={password} autocomplete="current-password" /></label>
      {#if kind === 'jellyfin'}<button class="glass-button" onclick={quickConnect}>{text('Migration_QuickConnect')}</button>{/if}
    {:else}
      <button class="glass-button" onclick={plexSignIn}>{text('Migration_PlexSignIn')}</button>
      {#if plexChoices.length > 1}
        <label class="field">{text('Migration_PlexServer')}
          <select bind:value={plexPick}>{#each plexChoices as server, index (server.machineId)}<option value={index}>{server.name}</option>{/each}</select>
        </label>
      {/if}
    {/if}
    {#if note}<p class="quiet">{note}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {:else if face === 'reading'}
    <div class="reading"><progress></progress><p class="line">{text('Migration_Reading', found)}</p></div>
  {:else if face === 'summary' && library && summary}
    <h4 class="kicker">{text('Migration_SummaryKicker')}</h4>
    <p class="big">{text('Migration_SummaryTracks', library.tracks.length, size(summary.totalBytes))}</p>
    <p class="line">{text('Migration_SummaryPlaylists', library.playlists.length)}</p>
    <p class="line">{text('Migration_SummaryAlready', summary.aboutAlreadyInRpm)}</p>
    {#if library.skipped.length}<p class="quiet">{text('Migration_SummarySkipped', library.skipped.length)}</p>{/if}
    {#if space && !space.unlimited}
      {@const free = Math.max(0, space.quota - space.used)}
      <p class="quiet">{text(free >= summary.aboutBytesNeeded ? 'Migration_SpaceCloud' : 'Migration_SpaceCloudShort', size(summary.aboutBytesNeeded), size(free))}</p>
    {/if}
    <p class="line keeps">{keeps(library)}</p>
  {:else if face === 'run'}
    {#if migrating.end === 'finished' && migrating.report}
      {@const report = migrating.report}
      <h4 class="kicker">{text('Migration_ReportTitle', report.label)}</h4>
      <p class="big">{text('Migration_ReportCounts', report.counts.found, report.counts.imported, report.counts.alreadyInRpm, report.counts.notImported)}</p>
      {#if report.playlists.length}<p class="line">{text('Migration_ReportPlaylists', report.playlists.length)}</p>{/if}
      {#each report.playlists.filter((p) => p.unmatched > 0 || p.wasSmart) as playlist (playlist.name)}
        <p class="quiet">{playlist.wasSmart && playlist.unmatched === 0 ? text('Migration_ReportSmart', playlist.name) : text('Migration_ReportPlaylistUnmatched', playlist.name, playlist.unmatched)}</p>
      {/each}
      {#if report.notImported.length}
        <h4 class="kicker">{text('Migration_ReportNotImported')}</h4>
        <ul class="list">{#each report.notImported.slice(0, 500) as item (item.sourceId)}<li>{item.what}: {text(item.reasonKey)}{item.detail ? ` (${item.detail})` : ''}</li>{/each}</ul>
      {/if}
      {#if report.lowerQuality.length}
        <h4 class="kicker">{text('Migration_ReportLowerQuality')}</h4>
        <p class="quiet">{text('Migration_ReportLowerQualityHint')}</p>
        <ul class="list">{#each report.lowerQuality.slice(0, 500) as path (path)}<li>{path}</li>{/each}</ul>
      {/if}
      {#if report.skipped.length}
        <h4 class="kicker">{text('Migration_ReportSkipped')}</h4>
        <ul class="list">{#each report.skipped.slice(0, 500) as item, index (index)}<li>{item.what}: {text(item.reasonKey)}</li>{/each}</ul>
      {/if}
    {:else}
      <h4 class="kicker">{stage}</h4>
      <progress max="1" value={progress && progress.bytesTotal > 0 ? progress.bytesDone / progress.bytesTotal : 0}></progress>
      {#if progress}
        <p class="big">{text('Migration_ProgressTracks', done, progress.counts.found, size(progress.bytesDone), size(progress.bytesTotal))}</p>
        <p class="line">{text('Migration_ProgressCounts', progress.counts.imported, progress.counts.alreadyInRpm, progress.counts.notImported)}</p>
        {#if progress.album}<p class="quiet clip">{text('Migration_ProgressAlbum', progress.album)}</p>{/if}
        {#if progress.timeLeft}<p class="quiet">{text('Migration_ProgressTimeLeft', timeLeft(progress.timeLeft))}</p>{/if}
      {/if}
      {#if !migrating.running && migrating.end}<p class="error">{stopped}</p>{/if}
      <p class="quiet">{text('Web_ImportKeepOpen')}</p>
      {#if migrating.library}<p class="quiet keeps">{keeps(migrating.library)}</p>{/if}
    {/if}
  {/if}

  {#snippet leading()}
    {#if face === 'connect' || face === 'summary'}
      <button class="glass-button" onclick={() => (face = face === 'summary' ? 'connect' : 'apps')}>{text('Migration_Back')}</button>
    {/if}
  {/snippet}

  {#snippet footer()}
    {#if face === 'run' && migrating.running}
      <button class="glass-button" onclick={close}>{text('Migration_Hide')}</button>
      <button class="glass-button" onclick={pauseMigration}>{text('Migration_Pause')}</button>
    {:else}
      <button class="glass-button" onclick={close}>{text('Migration_Close')}</button>
    {/if}
    {#if face === 'connect' && serverKind}
      <button class="glass-button primary" onclick={signIn}>{text('Migration_SignIn')}</button>
    {:else if face === 'connect' && kind === 'plex' && plexChoices.length > 1}
      <button class="glass-button primary" onclick={() => plexConnect(plexChoices[plexPick]!)}>{text('Migration_Continue')}</button>
    {:else if face === 'connect' && !serverKind && kind !== 'plex'}
      <button class="glass-button primary" disabled={musicFolder.length === 0 || (fileKind ? !libraryFile : playlistFiles.length === 0)} onclick={readFile}>{text('Migration_Continue')}</button>
    {:else if face === 'summary'}
      <button class="glass-button primary" onclick={start}>{text('Migration_Start')}</button>
    {:else if face === 'run' && !migrating.running && migrating.end && migrating.end !== 'finished'}
      <button class="glass-button primary" onclick={continueRun}>{text('Migration_Continue')}</button>
    {:else if face === 'run' && migrating.end === 'finished' && migrating.report?.notImported.length}
      <button class="glass-button" onclick={retry}>{text('Migration_TryAgain')}</button>
    {/if}
  {/snippet}
</Window>

<style>
  .kicker {
    margin: 0 0 8px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.6);
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    padding-bottom: 6px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 14px 8px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.13);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.95);
    cursor: pointer;
  }
  .tile:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .tile span {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.55);
    text-align: center;
  }
  .continue {
    margin-bottom: 10px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin: 8px 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
  }
  .field input,
  .field select {
    font: inherit;
    font-size: 13px;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(0, 0, 0, 0.25);
    color: white;
  }
  .line {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.88);
    margin: 4px 0;
  }
  .big {
    font-size: 15px;
    color: white;
    margin: 6px 0;
  }
  .quiet {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
    margin: 4px 0;
  }
  .clip {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .keeps {
    margin-top: 12px;
  }
  .error {
    font-size: 12.5px;
    color: #ffb2b2;
  }
  .reading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding-top: 40px;
  }
  progress {
    width: 100%;
  }
  .list {
    max-height: 180px;
    overflow: auto;
    margin: 4px 0 10px;
    padding-left: 18px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.8);
  }
</style>

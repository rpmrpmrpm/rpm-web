<script lang="ts">
  // Recognise: one window for the whole run, as the desktop's. Which files will be looked up, what each one
  // came back as, and the way to correct an answer. The account decides how far a run reaches, and the
  // server has the last word, so there is no control for it here.
  import { recogniser as importRecogniser, session } from '../../app';
  import { icons } from '../../design/icons';
  import { needsName, type ImportRow } from '../../import/queue';
  import { nameOf, type Outcome, type Recogniser, type Report } from '../../import/recognise';
  import { currentLanguage, text } from '../../strings/loc';
  import BecomeSupporter from '../profile/BecomeSupporter.svelte';
  import Window from './Window.svelte';

  // The recogniser writes what it finds to the rows of its queue. The library gives one of its own, over rows
  // that stand for tracks already in the cloud.
  let { rows, onClose, onEdit, recogniser = importRecogniser }: { rows: ImportRow[]; onClose: () => void; onEdit: (rows: ImportRow[]) => void; recogniser?: Recogniser } = $props();

  const SOURCES: Record<string, string> = {
    'own-db': 'RecogResult_SourceOwnDb',
    acoustid: 'RecogResult_SourceAcoustId',
    audd: 'RecogResult_SourceAudD',
  };

  const user = session.user;
  const advanced = user?.supporter === true;
  const until = user && !user.tester && user.supporterUntil > 0 ? new Date(user.supporterUntil * 1000).toLocaleDateString(currentLanguage()) : null;
  const reach = !advanced ? text('Recognize_ReachBasic') : until ? text('Recognize_ReachAdvancedUntil', until) : text('Recognize_ReachAdvanced');

  let phase = $state<'choose' | 'working' | 'report'>('choose');
  let outcomes = $state.raw<Outcome[]>([]);
  let report = $state.raw<Report | null>(null);
  let index = $state(0);
  let current = $state('');
  let stop: AbortController | null = null;

  const trouble = $derived([report?.stopped, report?.note].filter(Boolean).map((key) => text(key!)));

  async function start() {
    stop = new AbortController();
    phase = 'working';
    outcomes = [];
    report = null;
    index = 0;
    const done = await recogniser.run(
      rows,
      advanced,
      {
        started: (at, row) => {
          index = at;
          current = row.file.name;
        },
        landed: (outcome) => (outcomes = [...outcomes, outcome]),
      },
      stop.signal,
    );
    stop = null;
    report = done;
    phase = 'report';
  }

  function close() {
    stop?.abort();
    onClose();
  }

  const glyph = (line: Outcome) => (line.failed ? icons.warning : line.answer ? icons.check : icons.minus);
  const result = (line: Outcome) =>
    line.failed ? text('RecogResult_Failed') : ((line.answer && nameOf(line.answer.artist, line.answer.title)) ?? text('RecogResult_NoMatch'));

  // The file's name is always shown. The old name only when the answer changed it.
  function detail(line: Outcome): string {
    const was = nameOf(line.wasArtist, line.wasTitle);
    const file = line.row.file.name;
    return line.answer && was && was !== nameOf(line.answer.artist, line.answer.title) ? `${file} · ${text('Recognize_Was', was)}` : file;
  }
</script>

<Window title={text('Recognize_Title')} glyph={icons.fingerprint} minWidth={620} maxWidth={900} minHeight={460} openHeight={640} onClose={close}>
  {#if phase === 'choose'}
    <p>{text('Recognize_Intro', rows.length)}</p>
    <div class="list">
      <table>
        <thead>
          <tr><th>{text('Tags_ColFile')}</th><th>{text('TagsFromTags_ColNow')}</th><th>{text('Recognize_ColStatus')}</th></tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr>
              <td>{row.file.name}</td>
              <td>{nameOf(row.tags.Artist, row.tags.Title) ?? text('Recognize_TargetNoName')}</td>
              <td class:wanted={needsName(row)}>{text(needsName(row) ? 'Recognize_TargetUnnamed' : 'Recognize_TargetNamed')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="head">
      <h3>{report ? text('RecogResult_Recognized', report.recognised, report.attempted) : text('Recognize_RunHeadline', rows.length)}</h3>
      {#if phase === 'working'}<span>{text('Recognize_Working', index + 1, rows.length, current)}</span>{/if}
    </div>
    {#if phase === 'working'}
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={rows.length} aria-valuenow={outcomes.length}><span style:width="{(outcomes.length / rows.length) * 100}%"></span></div>
    {/if}
    {#each trouble as line}<p class="trouble">{line}</p>{/each}

    <ul class="list">
      {#each outcomes as line (line.row.id)}
        <li>
          <i class="icon mark" class:found={line.answer} class:failed={line.failed}>{glyph(line)}</i>
          <div class="names">
            <span class="result">{result(line)}</span>
            <span class="file">{detail(line)}</span>
          </div>
          <div class="source">
            {#if line.answer}
              <span>{SOURCES[line.answer.source] ? text(SOURCES[line.answer.source]!) : ''}</span>
              {#if line.score > 0}<span>{text('Recognize_Score', Math.round(line.score * 100))}</span>{/if}
            {/if}
          </div>
          {#if phase === 'report'}
            <button class="key" title={text('Recognize_EditTip')} aria-label={text('Recognize_EditTip')} onclick={() => onEdit([line.row])}><i class="icon">{icons.pen}</i></button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#snippet footnote()}
    {#if report && report.sentToAudD > 0}
      <p>{text('Recognize_AdvancedNote', report.sentToAudD, report.identifiedByAudD)}</p>
    {/if}
    {#if !advanced}
      <div class="pitch">
        <i class="icon">{icons.heart}</i>
        <span>{text('Recognize_SupportPitch')}</span>
        <BecomeSupporter kind="tool" />
      </div>
    {/if}
  {/snippet}

  {#snippet leading()}
    <span class="reach"><i class="icon">{advanced ? icons.fingerprint : icons.lock}</i> {reach}</span>
  {/snippet}

  {#snippet footer()}
    {#if phase === 'report' && outcomes.length > 1}
      <button class="glass-button" onclick={() => onEdit(outcomes.map((line) => line.row))}><i class="icon">{icons.pen}</i>{text('Recognize_EditAll', outcomes.length)}</button>
    {/if}
    <button class="glass-button" onclick={close}><i class="icon">{icons.close}</i>{text('RecogResult_Close')}</button>
    {#if phase === 'working'}
      <button class="glass-button primary" onclick={() => stop?.abort()}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
    {:else if phase === 'report'}
      <button class="glass-button primary" onclick={() => (phase = 'choose')}><i class="icon">{icons.fingerprint}</i>{text('Recognize_Again')}</button>
    {:else}
      <button class="glass-button primary" onclick={start}><i class="icon">{icons.fingerprint}</i>{text('Recognize_Start')}</button>
    {/if}
  {/snippet}
</Window>

<style>
  p {
    margin: 0;
    color: var(--text-soft);
    font-size: 12.5px;
  }

  .trouble {
    color: var(--warning);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: baseline;
    justify-content: space-between;
  }

  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  .head span {
    overflow: hidden;
    color: var(--text-soft);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    height: 3px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--hairline);
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--text-soft);
    transition: width 200ms;
  }

  .list {
    flex: 1;
    min-height: 120px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  th {
    padding: 3px 6px;
    color: var(--text-soft);
    font-size: 11px;
    font-weight: 400;
    text-align: left;
  }

  td {
    max-width: 280px;
    padding: 3px 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  td.wanted {
    color: var(--warning);
  }

  li {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 4px 6px;
    border-top: 1px solid var(--hairline);
  }

  li:first-child {
    border-top: 0;
  }

  .mark {
    flex: none;
    width: 14px;
    color: var(--text-soft);
    font-size: 11px;
    text-align: center;
  }

  .mark.found {
    color: var(--found);
  }

  .mark.failed {
    color: var(--error);
  }

  .names {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .result,
  .file {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result {
    font-size: 12.5px;
  }

  .file {
    color: var(--text-soft);
    font-size: 11px;
  }

  .source {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: flex-end;
    color: var(--text-soft);
    font-size: 11px;
  }

  .pitch {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    padding: 8px 12px;
    border: 1px solid rgb(255 255 255 / 0.13);
    border-radius: 6px;
    background: rgb(255 255 255 / 0.08);
    font-size: 11.5px;
  }

  .pitch .icon {
    color: var(--accent);
    font-size: 11px;
  }

  .pitch span {
    flex: 1 1 240px;
    color: rgb(255 255 255 / 0.8);
  }

  .reach {
    flex: 1 1 auto;
    color: var(--text-soft);
    font-size: 11.5px;
  }
</style>

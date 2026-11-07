<script lang="ts">
  // Tags from tags: write one tag from a pattern over the others, with the result shown first.
  import { importQueue } from '../../app';
  import { icons } from '../../design/icons';
  import { tokenValue, type ImportRow, type TrackTags } from '../../import/queue';
  import { renderTemplate, TAG_PRESETS } from '../../import/tag-template';
  import { text } from '../../strings/loc';
  import Window from './Window.svelte';

  let { rows, onClose, onDone }: { rows: ImportRow[]; onClose: () => void; onDone: (note: string) => void } = $props();

  const TARGETS: [keyof TrackTags & string, string][] = [
    ['Title', 'Review_ColTitle'],
    ['Artist', 'Review_ColArtist'],
    ['AlbumArtist', 'Review_ColAlbumArtist'],
    ['Album', 'Review_ColAlbum'],
    ['Genre', 'Review_ColGenre'],
    ['Composers', 'Review_ColComposer'],
    ['Work', 'Review_ColWork'],
  ];
  const TOKENS = ['title', 'artist', 'album', 'albumartist', 'year', 'track', 'disc', 'genre', 'composer', 'file'];
  const PREVIEW = 8;

  let target = $state<keyof TrackTags & string>('Title');
  let pattern = $state(TAG_PRESETS[0]!);

  const preview = $derived(
    rows.slice(0, PREVIEW).map((row) => ({ id: row.id, now: String(row.tags[target] ?? ''), next: renderTemplate(pattern, (token) => tokenValue(row, token)) })),
  );
  const written = $derived(rows.filter((row) => {
    const value = renderTemplate(pattern, (token) => tokenValue(row, token));
    return value && row.tags[target] !== value;
  }).length);
  const targetName = $derived(text(TARGETS.find(([key]) => key === target)![1]));

  function apply() {
    onDone(text('TagsFromTags_Applied', importQueue.tagsFromTags(rows, pattern, target)));
    onClose();
  }
</script>

<Window title={text('TagsFromTags_Title')} minWidth={620} maxWidth={900} minHeight={460} openHeight={560} {onClose}>
  <div class="row">
    <label>
      <span>{text('TagsFromTags_Target')}</span>
      <select class="field" bind:value={target}>
        {#each TARGETS as [key, label]}<option value={key}>{text(label)}</option>{/each}
      </select>
    </label>
    <label class="grow">
      <span>{text('TagsFromTags_Format')}</span>
      <input class="field" list="tag-presets" spellcheck="false" bind:value={pattern} />
      <datalist id="tag-presets">
        {#each TAG_PRESETS as preset}<option value={preset}></option>{/each}
      </datalist>
    </label>
  </div>

  <div class="tokens" role="group" aria-label={text('Tags_Fields')}>
    {#each TOKENS as token}
      <button class="tool" title={text('Tags_FieldTooltip')} onclick={() => (pattern += `{${token}}`)}>{token}</button>
    {/each}
  </div>

  <table>
    <thead>
      <tr><th>{text('TagsFromTags_ColNow')}</th><th>{text('TagsFromTags_ColNew')}</th></tr>
    </thead>
    <tbody>
      {#each preview as line (line.id)}
        <tr><td>{line.now}</td><td>{line.next || text('TagsFromTags_Empty')}</td></tr>
      {/each}
    </tbody>
  </table>

  <p>{text('TagsFromTags_Summary', written, rows.length, targetName)}</p>

  {#snippet footer()}
    <button class="glass-button" onclick={onClose}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
    <button class="glass-button primary" disabled={!written} onclick={apply}><i class="icon">{icons.check}</i>{text('Lookup_ApplyTracks')}</button>
  {/snippet}
</Window>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .grow {
    flex: 1 1 240px;
  }

  label span {
    display: block;
    margin-bottom: 3px;
    color: var(--text-soft);
    font-size: 11.5px;
  }

  .grow .field {
    width: 100%;
  }

  .tokens {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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

  p {
    margin: 0;
    color: var(--text-soft);
    font-size: 12.5px;
  }

</style>

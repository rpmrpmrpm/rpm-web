<script lang="ts">
  // The tags of what is ticked. Only the fields changed here are applied. A field whose value differs
  // between the rows says so, and stays as each row has it unless something is typed.
  import { importQueue } from '../../app';
  import type { ImportRow, TrackTags } from '../../import/queue';
  import { text } from '../../strings/loc';

  let { rows, version }: { rows: ImportRow[]; version: number } = $props();

  type Field = { key: keyof TrackTags & string; label: string; number?: boolean };

  const fields: Field[] = [
    { key: 'Title', label: text('Review_ColTitle') },
    { key: 'Artist', label: text('Review_ColArtist') },
    { key: 'AlbumArtist', label: text('Review_ColAlbumArtist') },
    { key: 'Album', label: text('Review_ColAlbum') },
    { key: 'TrackNumber', label: text('Review_ColTrack'), number: true },
    { key: 'DiscNumber', label: text('Review_ColDisc'), number: true },
    { key: 'Year', label: text('Review_ColYear'), number: true },
    { key: 'Genre', label: text('Review_ColGenre') },
  ];

  let edits = $state<Record<string, string>>({});

  const common = (key: string): string | null => {
    void version;
    const values = new Set(rows.map((row) => String(row.tags[key] ?? '')));
    return values.size === 1 ? [...values][0]! : null;
  };

  const shown = (field: Field) => edits[field.key] ?? common(field.key) ?? '';
  const changed = $derived(Object.keys(edits).length > 0);

  function apply() {
    const values: Partial<TrackTags> = {};
    for (const field of fields) {
      const value = edits[field.key];
      if (value === undefined) continue;
      values[field.key] = field.number ? Number(value) || 0 : value.trim() || null;
    }
    importQueue.applyTags(rows, values);
    edits = {};
  }
</script>

<aside class="panel">
  {#if rows.length === 0}
    <p>{text('Queue_TagPanelEmpty')}</p>
  {:else}
    {#each fields as field (field.key)}
      <label>
        <span>{field.label}</span>
        <input
          class="field"
          inputmode={field.number ? 'numeric' : 'text'}
          placeholder={common(field.key) === null ? text('Web_ImportMixed') : ''}
          value={shown(field)}
          oninput={(event) => (edits[field.key] = event.currentTarget.value)}
        />
      </label>
    {/each}
    <div class="keys">
      <button class="glass-button" disabled={!changed} onclick={() => (edits = {})}>{text('Queue_TagPanelRevert')}</button>
      <button class="glass-button primary" disabled={!changed} onclick={apply}>
        {rows.length === 1 ? text('Queue_TagPanelApplyOne') : text('Queue_TagPanelApply', rows.length)}
      </button>
    </div>
  {/if}
</aside>

<style>
  .panel {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    width: 220px;
    padding: 8px 12px 12px 16px;
    overflow-y: auto;
    border-right: 1px solid var(--hairline);
  }

  p {
    margin: 0;
    color: var(--text-soft);
    font-size: 12.5px;
  }

  label {
    display: grid;
    gap: 3px;
    color: var(--text-soft);
    font-size: 11px;
  }

  label .field {
    height: 30px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 12.5px;
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .keys button {
    flex: 1;
    height: 32px;
    padding: 0 8px;
    font-size: 12px;
    white-space: nowrap;
  }

  @media (max-width: 699px) {
    .panel {
      position: fixed;
      right: 0;
      bottom: calc(56px + env(safe-area-inset-bottom));
      left: 0;
      z-index: 3;
      width: auto;
      max-height: 60dvh;
      padding: 14px 16px;
      border-top: 1px solid var(--hairline);
      border-right: 0;
      border-radius: 14px 14px 0 0;
      background: rgb(16 18 24 / 0.97);
    }
  }
</style>

<script lang="ts">
  // The tags of what is ticked. Only the fields changed here are applied. A field whose value differs
  // between the rows says so, and stays as each row has it unless something is typed.
  import { covers, importQueue } from '../../app';
  import { albumFields } from '../../import/from-collection';
  import type { ImportRow, TrackTags } from '../../import/queue';
  import type { CloudAlbum } from '../../library/albums';
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';
  import AlbumPicker from './AlbumPicker.svelte';
  import CoverPanel from './CoverPanel.svelte';

  let { rows, version, onClose }: { rows: ImportRow[]; version: number; onClose: () => void } = $props();

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

  const more: Field[] = [
    { key: 'Subgenre', label: text('Review_ColSubgenre') },
    { key: 'Composers', label: text('Review_ColComposer') },
    { key: 'Work', label: text('Review_ColWork') },
    { key: 'DiscSubtitle', label: text('Review_ColDiscTitle') },
    { key: 'DiscCount', label: text('Details_DiscCount'), number: true },
    { key: 'TrackCount', label: text('Details_TrackCount'), number: true },
    { key: 'Publisher', label: text('Details_Publisher') },
    { key: 'CatalogNumber', label: text('Lookup_CatalogNumber') },
    { key: 'Barcode', label: text('Lookup_Barcode') },
    { key: 'ReleaseCountry', label: text('Lookup_Country') },
    { key: 'Comment', label: text('Details_Comment') },
  ];

  let showMore = $state(false);
  const showing = $derived(showMore ? [...fields, ...more] : fields);

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
    for (const field of [...fields, ...more]) {
      const value = edits[field.key];
      if (value === undefined) continue;
      values[field.key] = field.number ? Number(value) || 0 : value.trim() || null;
    }
    importQueue.applyTags(rows, values);
    edits = {};
  }

  let picking = $state(false);

  // What the record says, and its cover. Nobody is asked: pointing at a record is the whole purpose.
  async function takeAlbum(album: CloudAlbum) {
    picking = false;
    importQueue.applyTags(rows, albumFields(album));
    const picture = await covers.picture(album).catch(() => null);
    if (picture) importQueue.setCover(rows, picture);
  }
</script>

<aside class="panel">
  <header>
    <span>{text('Queue_TagPanelTitle')}</span>
    <button class="close" title={text('Common_Cancel')} aria-label={text('Common_Cancel')} onclick={onClose}><i class="icon">{icons.close}</i></button>
  </header>

  {#if rows.length === 0}
    <p>{text('Queue_TagPanelEmpty')}</p>
  {:else}
    <div class="fields">
      <CoverPanel {rows} {version} />
      <button class="tool" onclick={() => (picking = true)}>{text('Lookup_FromLibrary')}</button>
      {#each showing as field (field.key)}
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
      <button class="tool" onclick={() => (showMore = !showMore)}>{text('Common_MoreOptions')}</button>
    </div>
    <div class="keys">
      <button class="revert" disabled={!changed} onclick={() => (edits = {})}>{text('Queue_TagPanelRevert')}</button>
      <button class="glass-button primary apply" disabled={!changed} onclick={apply}>
        {rows.length === 1 ? text('Queue_TagPanelApplyOne') : text('Queue_TagPanelApply', rows.length)}
      </button>
    </div>
  {/if}
</aside>

{#if picking}
  <AlbumPicker seed={rows[0]?.tags.Album || rows[0]?.tags.Artist || ''} onPick={takeAlbum} onClose={() => (picking = false)} />
{/if}

<style>
  .panel {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 312px;
    min-height: 0;
    border-right: 1px solid rgb(255 255 255 / 0.122);
    background: rgb(0 0 0 / 0.2);
  }

  header {
    display: flex;
    flex: none;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 8px 14px;
    color: rgb(255 255 255 / 0.66);
    font-size: 11.5px;
    font-weight: 600;
  }

  .close {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: rgb(255 255 255 / 0.7);
    font-size: 11px;
    cursor: pointer;
  }

  @media (hover: hover) {
    .close:hover {
      background: rgb(255 255 255 / 0.122);
    }
  }

  p {
    margin: 0;
    padding: 0 14px;
    color: rgb(255 255 255 / 0.47);
    font-size: 11.5px;
  }

  .fields {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    padding: 0 14px 8px;
    overflow-y: auto;
  }

  label {
    display: grid;
    gap: 3px;
    color: rgb(255 255 255 / 0.66);
    font-size: 11px;
  }

  /* The band at the foot, the height of the queue's own, so the two share a rule along their top. */
  .keys {
    display: flex;
    flex: none;
    gap: 6px;
    justify-content: flex-end;
    padding: 7px 14px;
    border-top: 1px solid rgb(255 255 255 / 0.122);
  }

  .revert {
    height: 28px;
    padding: 0 9px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: rgb(255 255 255 / 0.88);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .revert:disabled {
    color: rgb(255 255 255 / 0.31);
    cursor: default;
  }

  .apply {
    min-width: 0;
    height: 30px;
    padding: 0 14px;
    font-size: 12.5px;
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
      border-top: 1px solid var(--hairline);
      border-right: 0;
      border-radius: 14px 14px 0 0;
      background: rgb(16 18 24 / 0.97);
    }
  }
</style>

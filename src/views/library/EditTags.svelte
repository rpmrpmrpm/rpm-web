<script lang="ts">
  // The tags of tracks already in the cloud: of one track, or of a whole record. A field left blank is not
  // changed, because the store cannot clear a tag.
  import { untrack } from 'svelte';

  import type { CloudTrack } from '../../api/wire';
  import { catalogEdits, catalogue } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import type { TagEdit } from '../../library/edit';
  import { text } from '../../strings/loc';
  import Window from '../import/Window.svelte';

  let { tracks, album, onClose }: { tracks: readonly CloudTrack[]; album: CloudAlbum | null; onClose: () => void } = $props();

  type Field = { key: keyof TagEdit; label: string; number?: boolean; read: (track: CloudTrack) => string | number | null | undefined };

  const RECORD: Field[] = [
    { key: 'album', label: 'Review_ColAlbum', read: (track) => track.album },
    { key: 'albumArtist', label: 'Review_ColAlbumArtist', read: (track) => track.tags?.albumArtist },
    { key: 'year', label: 'Review_ColYear', number: true, read: (track) => track.tags?.year },
    { key: 'genre', label: 'Review_ColGenre', read: (track) => track.tags?.genre },
  ];
  const TRACK: Field[] = [
    { key: 'title', label: 'Review_ColTitle', read: (track) => track.title },
    { key: 'artist', label: 'Review_ColArtist', read: (track) => track.artist },
    { key: 'trackNumber', label: 'Review_ColTrack', number: true, read: (track) => track.tags?.trackNumber },
    { key: 'discNumber', label: 'Review_ColDisc', number: true, read: (track) => track.tags?.discNumber },
    { key: 'composer', label: 'Review_ColComposer', read: (track) => track.tags?.composer },
    { key: 'work', label: 'Review_ColWork', read: (track) => track.tags?.work },
  ];

  const shown = untrack(() => (tracks.length === 1 ? [...TRACK, ...RECORD] : RECORD));

  // What the tracks agree on. A field they differ on stays empty, and stays as each track has it.
  function common(field: Field): string {
    const values = new Set(untrack(() => tracks).map((track) => String(field.read(track) || '')));
    return values.size === 1 ? [...values][0]! : '';
  }

  let values = $state<Record<string, string>>(Object.fromEntries(shown.map((field) => [field.key, common(field)])));
  let saving = $state(false);
  let refusal = $state('');

  async function save(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    refusal = '';
    const edit = Object.fromEntries(shown.map((field) => [field.key, field.number ? Number(values[field.key]) || 0 : values[field.key]])) as TagEdit;
    try {
      await catalogEdits.apply(tracks, edit, album);
      await catalogue.refresh();
      onClose();
    } catch {
      refusal = text('Web_EditFailed');
    } finally {
      saving = false;
    }
  }
</script>

<Window
  title={text(tracks.length === 1 ? 'Details_Title' : 'AlbumEdit_Title')}
  glyph={icons.pen}
  minWidth={tracks.length === 1 ? 740 : 700}
  maxWidth={tracks.length === 1 ? 1000 : 1080}
  minHeight={tracks.length === 1 ? 568 : 560}
  openHeight={tracks.length === 1 ? 628 : 680}
  {onClose}
>
  <form id="edit-tags" onsubmit={save}>
    <div class="fields">
      {#each shown as field (field.key)}
        <label>
          <span>{text(field.label)}</span>
          <input class="field" inputmode={field.number ? 'numeric' : undefined} bind:value={values[field.key]} />
        </label>
      {/each}
    </div>
    <p>{text('Web_EditDesktopNote')}</p>
    {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
  </form>

  {#snippet footer()}
    <button class="glass-button" type="button" onclick={onClose}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
    <button class="glass-button primary" type="submit" form="edit-tags" disabled={saving}><i class="icon">{icons.check}</i>{text('Details_Save')}</button>
  {/snippet}
</Window>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }

  label span {
    display: block;
    margin-bottom: 3px;
    color: var(--text-soft);
    font-size: 11.5px;
  }


  p {
    margin: 0;
    color: var(--text-soft);
    font-size: 12px;
  }

  .refusal {
    color: var(--error);
  }

</style>

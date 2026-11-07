<script lang="ts">
  // One track's tags, in full, on tabs (the desktop's TrackDetailsDialog). The fields that are true of the
  // whole record carry a marker: amber when the other tracks of the record hold something else, and a switch
  // that writes the value to all of them. Off, an edit here changes this track alone, which is how a record
  // that was split in two is repaired.
  import { untrack } from 'svelte';

  import type { CloudTrack } from '../../api/wire';
  import { catalogEdits, catalogue, covers } from '../../app';
  import { icons } from '../../design/icons';
  import { rowTags, type PictureChange, type TrackEdit } from '../../library/edit';
  import { genreSuggestions, readField, styleSuggestions, tagField, writeField, type TagSet } from '../../library/tag-fields';
  import type { CloudAlbum } from '../../library/albums';
  import { albumFields } from '../../import/from-collection';
  import type { PickedPicture } from '../../import/cover-search';
  import { text } from '../../strings/loc';
  import { openMenu } from '../menu/menu.svelte';
  import AlbumPicker from '../import/AlbumPicker.svelte';
  import CoverFinder from '../import/CoverFinder.svelte';
  import ReleaseLookup from '../import/ReleaseLookup.svelte';
  import Window from '../import/Window.svelte';
  import { addressOf, albumOf, disagreement } from './editing';
  import FieldBox from './FieldBox.svelte';
  import FormGroup from './FormGroup.svelte';
  import FormRow from './FormRow.svelte';
  import { keysOf, TABS, TRACK_LAYOUT, TRACK_SOUND, type Group } from './form';
  import { changedBy, lookupQueue, lookupRow } from './lookup-rows';
  import Marker from './Marker.svelte';
  import PictureWell from './PictureWell.svelte';
  import TabStrip from './TabStrip.svelte';

  let { track, onClose }: { track: CloudTrack; onClose: () => void } = $props();

  const KEYS = [...keysOf(TRACK_LAYOUT), 'Bpm', 'MusicalKey', 'Lyrics'];

  const album: CloudAlbum | null = untrack(() => albumOf(track));
  // What the record's other tracks say, from the catalogue. The fields it does not hold are not compared.
  const others: TagSet[] = untrack(() => (album?.tracks ?? []).filter((row) => row.rpmId !== track.rpmId).map(rowTags));

  let before = $state.raw<TagSet | null>(null);
  let values = $state<Record<string, string>>({});
  let armed = $state<Record<string, boolean>>({});
  let reading = $state(true);
  let refusal = $state('');
  let saving = $state(false);

  // The work tab comes second on a track that is part of a work: which piece and which movement it is are the
  // first things anyone corrects on a classical file.
  const tabs = $derived(
    before && readField(before, 'Work') ? [TABS.basic, TABS.work, TABS.credits, TABS.sound, TABS.lyrics, TABS.artwork] : [TABS.basic, TABS.credits, TABS.work, TABS.sound, TABS.lyrics, TABS.artwork],
  );
  let tab = $state('basic');

  let cover = $state<PictureChange>(undefined);
  let shownCover = $state<string | null>(null);
  let coverBytes = $state(0);
  let finding = $state(false);
  let looking = $state(false);
  let picking = $state(false);

  function fill(tags: TagSet) {
    values = Object.fromEntries(KEYS.map((key) => [key, readField(tags, key)]));
  }

  async function read() {
    reading = true;
    refusal = '';
    try {
      const [tags] = await catalogEdits.read([track]);
      before = tags!;
      fill(tags!);
    } catch {
      refusal = text('Web_EditReadFailed');
    } finally {
      reading = false;
    }
  }

  void read();

  $effect(() => {
    if (!album) return;
    let current = true;
    void covers.url(album, 440).then((address) => {
      if (current && cover === undefined) shownCover = address;
    });
    return () => {
      current = false;
    };
  });

  // Where a field belongs to the whole record, its marker: what the other tracks say, and the switch.
  const markerKey = (key: string): string | null => {
    const scope = tagField(key).scope;
    return scope === 'track' || !album || others.length === 0 ? null : key;
  };

  function suggestionsFor(key: string): readonly string[] {
    const suggests = tagField(key).suggests;
    if (suggests === 'genres') return genreSuggestions();
    if (suggests === 'styles') return styleSuggestions(values.Genre);
    return [];
  }

  function afterOf(tags: TagSet): TagSet {
    let after = { ...tags };
    for (const key of KEYS) if (values[key] !== readField(tags, key)) after = writeField(after, key, values[key] ?? '');
    return after;
  }

  async function save() {
    if (!before) return;
    saving = true;
    refusal = '';
    try {
      const edits: TrackEdit[] = [{ track, before, after: afterOf(before) }];
      const reach = Object.keys(armed).filter((key) => armed[key]);
      if (reach.length && album) {
        const siblings = album.tracks.filter((row) => row.rpmId !== track.rpmId);
        const sets = await catalogEdits.read(siblings);
        siblings.forEach((sibling, index) => {
          let after = sets[index]!;
          for (const key of reach) after = writeField(after, key, values[key] ?? '');
          edits.push({ track: sibling, before: sets[index]!, after });
        });
      }
      await catalogEdits.save(edits, album, { cover });
      await catalogue.refresh();
      onClose();
    } catch {
      refusal = text('Web_EditFailed');
    } finally {
      saving = false;
    }
  }

  function takeCover(picture: PickedPicture) {
    cover = picture;
    coverBytes = picture.bytes.length;
    if (shownCover?.startsWith('blob:') && !album) URL.revokeObjectURL(shownCover);
    shownCover = addressOf(picture);
  }

  // The lookup and the album picker write to rows that stand for this track. Their answer is read back into
  // the boxes, and nothing is saved until Save is pressed.
  const queue = lookupQueue();
  let rows = $state.raw<ReturnType<typeof lookupRow>[]>([]);

  function openLookup() {
    if (!before) return;
    rows = [lookupRow(track, afterOf(before))];
    looking = true;
  }

  function lookedUp() {
    const [row] = rows;
    if (!row || !before) return;
    const changed = changedBy(row, afterOf(before));
    for (const [key, value] of Object.entries(changed)) if (KEYS.includes(key)) values[key] = readField({ [key]: value }, key);
    if (row.cover) takeCover(row.cover);
  }

  function pickedAlbum(picked: CloudAlbum) {
    picking = false;
    for (const [key, value] of Object.entries(albumFields(picked))) values[key] = readField({ [key]: value }, key);
    void covers.picture(picked).then((picture) => picture && takeCover(picture), () => {});
  }

  function lookupMenu(event: MouseEvent) {
    const key = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(
      [
        { label: text('Lookup_FromLibrary'), glyph: icons.album, run: () => (picking = true) },
        { label: text('Lookup_FromCatalogue'), glyph: icons.search, run: openLookup },
      ],
      key.left,
      key.bottom + 4,
    );
  }

  const fileName = $derived(track.relativePath?.split('/').pop() ?? '');
</script>

{#snippet field(key: string, pair?: string)}
  {@const tag = tagField(key)}
  {@const marked = markerKey(pair ?? key)}
  <FormRow label={text(tag.label)} top={tag.multiline || tag.lines}>
    <FieldBox {tag} bind:value={values[key]} suggestions={suggestionsFor(key)} />
    {#if pair}
      <span class="of">{text('MassEdit_Of')}</span>
      <FieldBox tag={tagField(pair)} bind:value={values[pair]} />
    {/if}
    {#snippet trailing()}
      {#if marked}<Marker canArm disagreement={disagreement(marked, values[marked] ?? '', others)} bind:armed={armed[marked]} />{/if}
    {/snippet}
  </FormRow>
{/snippet}

{#snippet column(groups: Group[])}
  <div class="column">
    {#each groups as group (group.heading)}
      <FormGroup heading={group.heading}>
        {#each group.rows as row (row.key)}{@render field(row.key, row.pair)}{/each}
      </FormGroup>
    {/each}
  </div>
{/snippet}

<Window title={text('Details_Title')} glyph={icons.genre} minWidth={740} maxWidth={1000} minHeight={568} openHeight={628} {onClose}>
  <div class="top">
    <TabStrip {tabs} bind:current={tab} />
    <button class="glass-button lookup" type="button" disabled={!before} onclick={lookupMenu}><i class="icon">{icons.search}</i>{text('MassEdit_LookUpRelease')}</button>
  </div>

  {#if reading}
    <p class="note">{text('Web_EditReading')}</p>
  {:else if before}
    {#if tab === 'basic' || tab === 'credits' || tab === 'work'}
      {@const [left, right] = TRACK_LAYOUT[tab]}
      <div class="columns">
        {@render column(left)}
        {@render column(right)}
      </div>
    {:else if tab === 'sound'}
      <div class="columns">
        <div class="column">
          {@render column([TRACK_SOUND])}
          <p class="hint">{text('Details_SoundHint')}</p>
        </div>
        <div class="column">
          <!-- How loud the record is: the store's own measurement, which no tag carries. -->
          {#if track.tags?.loudnessLufs}
            <FormGroup heading="MassEdit_GroupLevel">
              <FormRow label={text('Details_Loudness')}>
                <span class="reading">{track.tags.loudnessLufs.toFixed(1)} {text('Details_LufsUnit')}</span>
              </FormRow>
              {#if track.tags.truePeak}
                <FormRow label={text('Details_TruePeak')}><span class="reading">{track.tags.truePeak.toFixed(3)}</span></FormRow>
              {/if}
            </FormGroup>
          {/if}
        </div>
      </div>
    {:else if tab === 'lyrics'}
      <textarea class="field lyrics" placeholder={text('Details_LyricsPlaceholder')} aria-label={text('Details_Lyrics')} bind:value={values.Lyrics}></textarea>
    {:else if tab === 'artwork'}
      <div class="art">
        <PictureWell
          heading="Details_GroupCover"
          edge={220}
          shown={cover === 'remove' ? null : shownCover}
          bytes={coverBytes}
          onTake={takeCover}
          onFind={() => (finding = true)}
          onRemove={() => {
            cover = 'remove';
            shownCover = null;
          }}
        />
        <p class="hint">{text('Web_ArtHint')}</p>
      </div>
    {/if}
  {/if}

  {#snippet footnote()}
    {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
  {/snippet}

  {#snippet leading()}<span class="file" title={track.relativePath ?? ''}>{fileName}</span>{/snippet}

  {#snippet footer()}
    <button class="glass-button" type="button" onclick={onClose}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
    <button class="glass-button primary" type="button" disabled={!before || saving} onclick={save}><i class="icon">{icons.save}</i>{text('Details_Save')}</button>
  {/snippet}
</Window>

{#if finding}
  <CoverFinder
    kind="cover"
    artist={values.AlbumArtist || values.Artist || ''}
    album={values.Album ?? ''}
    onUse={(picture) => {
      takeCover(picture);
      finding = false;
    }}
    onClose={() => (finding = false)}
  />
{/if}

{#if looking}
  <ReleaseLookup {rows} {queue} onDone={lookedUp} onClose={() => (looking = false)} />
{/if}

{#if picking}
  <AlbumPicker seed={values.Album || values.Artist || ''} onPick={pickedAlbum} onClose={() => (picking = false)} />
{/if}

<style>
  .top {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 16px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .lookup {
    min-width: 0;
    height: 24px;
    padding: 0 12px;
    font-size: 11.5px;
    font-weight: 400;
  }

  .lookup .icon {
    font-size: 11px;
  }

  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px 24px;
    align-items: start;
    padding-right: 14px;
  }

  .column {
    display: grid;
    gap: 16px;
    align-content: start;
  }

  .of {
    flex: none;
    color: rgb(255 255 255 / 0.65);
    font-size: 11.5px;
  }

  .reading {
    color: rgb(255 255 255 / 0.85);
    font-size: 11.5px;
  }

  .lyrics {
    flex: 1;
    min-height: 240px;
    resize: none;
  }

  .art {
    display: grid;
    gap: 10px;
    align-content: start;
  }

  .note,
  .hint {
    margin: 0;
    color: rgb(255 255 255 / 0.65);
    font-size: 11.5px;
  }

  .art .hint {
    max-width: 220px;
    color: rgb(255 255 255 / 0.4);
    font-size: 11px;
  }

  .refusal {
    margin: 0;
    color: var(--error);
    font-size: 12px;
  }

  .file {
    display: block;
    max-width: 420px;
    overflow: hidden;
    color: rgb(255 255 255 / 0.55);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 699px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
      padding-right: 0;
    }
  }
</style>

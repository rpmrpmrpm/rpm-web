<script lang="ts">
  // A record, edited as a record (the desktop's AlbumEditDialog). Each box holds what most of the tracks say.
  // What is changed is written to every track and the rest stays as it is, so there is nothing to tick. Where
  // the tracks disagree, the marker turns amber and says what the others hold, and saving makes them agree,
  // which is the repair for a record split in two.
  import { untrack } from 'svelte';

  import { catalogEdits, catalogue, covers, favorites } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { discKeyForTrack } from '../../library/art-key';
  import type { Picture, PictureChange, TrackEdit } from '../../library/edit';
  import { ALBUM_TO_TRACK, genreSuggestions, readField, styleSuggestions, tagField, writeField, type TagSet } from '../../library/tag-fields';
  import { text } from '../../strings/loc';
  import CoverFinder from '../import/CoverFinder.svelte';
  import ReleaseLookup from '../import/ReleaseLookup.svelte';
  import Window from '../import/Window.svelte';
  import { addressOf, discOf } from './editing';
  import FieldBox from './FieldBox.svelte';
  import FormGroup from './FormGroup.svelte';
  import FormRow from './FormRow.svelte';
  import { ALBUM_CLASSICAL, ALBUM_LAYOUT, ALBUM_SETTLES, TABS, type Group } from './form';
  import { lookupQueue, lookupRow } from './lookup-rows';
  import Marker from './Marker.svelte';
  import PictureWell from './PictureWell.svelte';
  import TabStrip from './TabStrip.svelte';

  let { album, onClose }: { album: CloudAlbum; onClose: () => void } = $props();

  const tracks = untrack(() => album.tracks);
  const tabs = [TABS.basic, TABS.work, TABS.artwork, TABS.settings];
  let tab = $state('basic');

  // One box: the field, which disc it is about (null for the whole record), what it opened with, and whether
  // the tracks disagreed when the window opened.
  interface Box {
    id: string;
    key: string;
    disc: number | null;
    seed: string;
    disagreement: string | null;
    settles: boolean;
  }

  let sets = $state.raw<TagSet[] | null>(null);
  let boxes = $state.raw<Box[]>([]);
  let values = $state<Record<string, string>>({});
  let discs = $state.raw<number[]>([]);
  let reading = $state(true);
  let refusal = $state('');
  let saving = $state(false);
  let applyToTracks = $state(false);

  let classicalSeed = $state(false);
  let classical = $state('no');

  // What most of the tracks hold, with a blank losing to anything named.
  function seedOf(values: readonly string[]): string {
    const counts = new Map<string, number>();
    for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }

  function boxFor(key: string, over: readonly TagSet[], disc: number | null, settles = true): Box {
    const held = over.map((tags) => readField(tags, key));
    const seed = seedOf(held);
    const others = held.filter((value) => value !== seed);
    const distinct = [...new Set(others)];
    const disagreement = others.length === 0 ? null : distinct.length === 1 ? text('Edit_AlbumDisagrees', others.length, distinct[0]!) : text('Edit_AlbumDisagreesMany');
    return { id: disc === null ? key : `${key}@${disc}`, key, disc, seed, disagreement, settles };
  }

  const recordKeys = [...Object.values(ALBUM_LAYOUT).flatMap((columns) => columns.flat().flatMap((group) => group.rows.map((row) => row.key)))];

  async function read() {
    reading = true;
    refusal = '';
    try {
      const read = await catalogEdits.read(tracks);
      const made: Box[] = [];
      for (const key of recordKeys) made.push(boxFor(key, read, null));
      for (const row of ALBUM_CLASSICAL.rows) made.push(boxFor(row.key, read, null, ALBUM_SETTLES.has(row.key)));
      // The disc's own fields. One disc in the set: the record is the disc, and its number, count and name
      // each have one value. Several: one box could only be right for one of them, so each disc gets a row,
      // and the disc number is not offered. Disc 2's number is 2.
      const numbers = [...new Set(read.map(discOf))].sort((a, b) => a - b);
      if (numbers.length <= 1) {
        for (const key of ['DiscNumber', 'TrackCount', 'DiscSubtitle']) made.push(boxFor(key, read, null));
      } else {
        for (const disc of numbers) {
          const on = read.filter((tags) => discOf(tags) === disc);
          made.push(boxFor('DiscSubtitle', on, disc), boxFor('TrackCount', on, disc));
        }
      }
      discs = numbers;
      boxes = made;
      values = Object.fromEntries(made.map((box) => [box.id, box.seed]));
      sets = read;
    } catch {
      refusal = text('Web_EditReadFailed');
    } finally {
      reading = false;
    }
  }

  void read();
  void favorites.isClassical(untrack(() => album)).then((on) => {
    classicalSeed = on;
    classical = on ? 'yes' : 'no';
  });

  const boxOf = (id: string) => boxes.find((box) => box.id === id);

  // Changed by hand or by a lookup, or standing over tracks that disagree and now holding a value to settle
  // them with. An empty box never settles a disagreement: most of the record saying nothing is no reason to
  // erase what the rest says.
  const dirty = (box: Box) => (values[box.id] ?? '').trim() !== box.seed || (box.settles && !!box.disagreement && (values[box.id] ?? '').trim() !== '');

  function suggestionsFor(key: string): readonly string[] {
    const suggests = tagField(key).suggests;
    if (suggests === 'genres') return genreSuggestions();
    if (suggests === 'styles') return styleSuggestions(values.Genre);
    return [];
  }

  // ── the pictures ──

  interface Well {
    shown: string | null;
    bytes: number;
    change: PictureChange;
  }

  let cover = $state<Well>({ shown: null, bytes: 0, change: undefined });
  let disc = $state<Well>({ shown: null, bytes: 0, change: undefined });
  let finding = $state<'cover' | 'disc' | null>(null);

  const sizeOf = async (address: string) => (await (await fetch(address)).blob()).size;

  $effect(() => {
    let current = true;
    void covers.url(untrack(() => album), 440).then(async (address) => {
      if (!current || !address) return;
      cover.shown = address;
      cover.bytes = await sizeOf(address).catch(() => 0);
    });
    void (async () => {
      const first = untrack(() => album.tracks[0]);
      if (!first) return;
      const picture = await covers.pictureAt(await discKeyForTrack(first.tags?.albumArtist, first.artist, first.album)).catch(() => null);
      if (current && picture) disc = { shown: addressOf(picture), bytes: picture.bytes.length, change: undefined };
    })();
    return () => {
      current = false;
    };
  });

  function take(well: 'cover' | 'disc', picture: Picture) {
    const next = { shown: addressOf(picture), bytes: picture.bytes.length, change: picture };
    if (well === 'cover') cover = next;
    else disc = next;
  }

  // ── the release lookup ──

  const queue = lookupQueue();
  let rows = $state.raw<ReturnType<typeof lookupRow>[]>([]);
  let looking = $state(false);

  function afterOf(tags: TagSet): TagSet {
    let after = { ...tags };
    const own = discOf(tags);
    for (const box of boxes) {
      if (!dirty(box) || (box.disc !== null && box.disc !== own)) continue;
      after = writeField(after, box.key, values[box.id] ?? '');
    }
    if (applyToTracks) {
      for (const [record, track] of ALBUM_TO_TRACK) {
        const value = (values[record] ?? '').trim();
        if (value) after = writeField(after, track, value);
      }
    }
    return after;
  }

  function openLookup() {
    if (!sets) return;
    rows = tracks.map((track, index) => lookupRow(track, afterOf(sets![index]!)));
    looking = true;
  }

  // The record's boxes take what the pressing says. The per-track names are not in this window.
  function lookedUp() {
    const [row] = rows;
    if (!row) return;
    for (const box of boxes) {
      if (box.disc !== null) {
        const onDisc = rows.find((candidate) => discOf(candidate.tags) === box.disc);
        if (onDisc) values[box.id] = readField(onDisc.tags, box.key);
        continue;
      }
      const value = readField(row.tags, box.key);
      if (value) values[box.id] = value;
    }
    if (row.cover) take('cover', row.cover);
    if (row.disc) take('disc', row.disc);
  }

  // ── saving ──

  async function save() {
    if (!sets) return;
    saving = true;
    refusal = '';
    try {
      const edits: TrackEdit[] = tracks.map((track, index) => ({ track, before: sets![index]!, after: afterOf(sets![index]!) }));
      await catalogEdits.save(edits, album, { cover: cover.change, disc: disc.change });
      if ((classical === 'yes') !== classicalSeed) await favorites.markClassical(album, classical === 'yes');
      await catalogue.refresh();
      onClose();
    } catch {
      refusal = text('Web_EditFailed');
    } finally {
      saving = false;
    }
  }

  const folder = $derived(tracks[0]?.relativePath?.split('/').slice(0, -1).join('/') ?? '');
</script>

{#snippet field(id: string, label: string, pair?: string)}
  {@const box = boxOf(id)}
  {#if box}
    {@const tag = tagField(box.key)}
    <FormRow {label} top={tag.lines}>
      <FieldBox {tag} bind:value={values[id]} suggestions={suggestionsFor(box.key)} />
      {#if pair && boxOf(pair)}
        <span class="of">{text('MassEdit_Of')}</span>
        <FieldBox tag={tagField(pair)} bind:value={values[pair]} />
      {/if}
      {#snippet trailing()}<Marker disagreement={box.disagreement} />{/snippet}
    </FormRow>
  {/if}
{/snippet}

{#snippet column(groups: Group[])}
  <div class="column">
    {#each groups as group (group.heading)}
      {#if group.rows.length}
        <FormGroup heading={group.heading}>
          {#each group.rows as row (row.key)}{@render field(row.key, text(tagField(row.key).label), row.pair)}{/each}
        </FormGroup>
      {/if}
    {/each}
  </div>
{/snippet}

<Window title={text('AlbumEdit_Title')} glyph={icons.album} minWidth={700} maxWidth={1080} minHeight={560} openHeight={680} {onClose}>
  <div class="top">
    <TabStrip {tabs} bind:current={tab} />
    <button class="glass-button lookup" type="button" disabled={!sets} onclick={openLookup}><i class="icon">{icons.search}</i>{text('MassEdit_LookUpRelease')}</button>
  </div>

  {#if reading}
    <p class="note">{text('Web_EditReading')}</p>
  {:else if sets}
    {#if tab === 'basic'}
      <div class="columns">
        {@render column(ALBUM_LAYOUT.basic[0])}
        <div class="column">
          {@render column(ALBUM_LAYOUT.basic[1])}
          {@render column([ALBUM_CLASSICAL])}
          <FormGroup heading="AlbumEdit_GroupDiscs">
            {#if discs.length <= 1}
              {@render field('DiscNumber', text('Details_Disc'))}
              {@render field('TrackCount', text('Details_TrackCount'))}
              {@render field('DiscSubtitle', text('Details_DiscSubtitle'))}
            {:else}
              {#each discs as number (number)}
                {@const subtitle = boxOf(`DiscSubtitle@${number}`)}
                <FormRow label={number > 0 ? text('AlbumEdit_DiscN', number) : text('Details_Disc')}>
                  <FieldBox tag={tagField('DiscSubtitle')} bind:value={values[`DiscSubtitle@${number}`]} />
                  <span class="count" title={text('Details_TrackCount')}><FieldBox tag={tagField('TrackCount')} bind:value={values[`TrackCount@${number}`]} /></span>
                  {#snippet trailing()}<Marker disagreement={subtitle?.disagreement ?? null} />{/snippet}
                </FormRow>
              {/each}
            {/if}
          </FormGroup>
        </div>
      </div>
    {:else if tab === 'work'}
      <div class="columns">
        {@render column(ALBUM_LAYOUT.work[0])}
        {@render column(ALBUM_LAYOUT.work[1])}
      </div>
    {:else if tab === 'artwork'}
      <div class="pictures">
        <PictureWell
          heading="Details_GroupCover"
          shown={cover.shown}
          bytes={cover.bytes}
          onTake={(picture) => take('cover', picture)}
          onFind={() => (finding = 'cover')}
          onRemove={() => (cover = { shown: null, bytes: 0, change: 'remove' })}
        />
        <PictureWell
          heading="Details_GroupDisc"
          disc
          shown={disc.shown}
          bytes={disc.bytes}
          onTake={(picture) => take('disc', picture)}
          onFind={() => (finding = 'disc')}
          onRemove={() => (disc = { shown: null, bytes: 0, change: 'remove' })}
        />
      </div>
    {:else if tab === 'settings'}
      <div class="columns">
        <div class="column">
          <FormGroup heading="AlbumEdit_GroupSettings">
            <FormRow label={text('AlbumEdit_Classical')}>
              <select class="field" bind:value={classical} aria-label={text('AlbumEdit_Classical')}>
                <option value="yes">{text('AlbumEdit_ClassicalYes')}</option>
                <option value="no">{text('AlbumEdit_ClassicalNo')}</option>
              </select>
            </FormRow>
          </FormGroup>
        </div>
      </div>
    {/if}
  {/if}

  {#snippet footnote()}
    {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
  {/snippet}

  {#snippet leading()}<span class="file" title={folder}>{folder}</span>{/snippet}

  {#snippet footer()}
    <label class="apply"><input type="checkbox" bind:checked={applyToTracks} />{text('AlbumEdit_ApplyToTracks')}</label>
    <button class="glass-button" type="button" onclick={onClose}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
    <button class="glass-button primary" type="button" disabled={!sets || saving} onclick={save}><i class="icon">{icons.save}</i>{text('AlbumEdit_Save')}</button>
  {/snippet}
</Window>

{#if finding}
  <CoverFinder
    kind={finding}
    artist={values.AlbumArtist || album.artist}
    album={values.Album || album.album}
    onUse={(picture, label) => {
      take(finding!, picture);
      if (label && finding === 'cover') take('disc', label);
      finding = null;
    }}
    onClose={() => (finding = null)}
  />
{/if}

{#if looking}
  <ReleaseLookup {rows} {queue} onDone={lookedUp} onClose={() => (looking = false)} />
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

  .count {
    display: flex;
    flex: none;
  }

  .pictures {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .note {
    margin: 0;
    color: rgb(255 255 255 / 0.65);
    font-size: 11.5px;
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

  .apply {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    margin-right: 8px;
    font-size: 13px;
    cursor: pointer;
  }

  @media (max-width: 699px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
      padding-right: 0;
    }
  }
</style>

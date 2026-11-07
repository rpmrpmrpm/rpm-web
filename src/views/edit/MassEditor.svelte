<script lang="ts">
  // Several tracks at once (the desktop's MassEditDialog). Each field has a tick, and only ticked fields are
  // written: ticking a field and leaving it blank empties it on every track. A field the tracks agree on
  // shows its value. One they differ on says so, and offers each value they hold.
  import { untrack } from 'svelte';

  import type { CloudTrack } from '../../api/wire';
  import { catalogEdits, catalogue } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import type { Picture, PictureChange, TrackEdit } from '../../library/edit';
  import { genreSuggestions, readField, styleSuggestions, summarise, tagField, writeField, type FieldSummary, type TagSet } from '../../library/tag-fields';
  import { text } from '../../strings/loc';
  import CoverFinder from '../import/CoverFinder.svelte';
  import ReleaseLookup from '../import/ReleaseLookup.svelte';
  import Window from '../import/Window.svelte';
  import { addressOf, albumOf } from './editing';
  import FieldBox from './FieldBox.svelte';
  import FormGroup from './FormGroup.svelte';
  import FormRow from './FormRow.svelte';
  import { keysOf, MASS_LAYOUT, TABS, type Group } from './form';
  import { lookupQueue, lookupRow } from './lookup-rows';
  import PictureWell from './PictureWell.svelte';
  import TabStrip from './TabStrip.svelte';

  let { tracks, onClose }: { tracks: readonly CloudTrack[]; onClose: () => void } = $props();

  const KEYS = keysOf(MASS_LAYOUT);
  const chosen = untrack(() => [...tracks]);

  // The records the selection reaches. A tick on a record's field reaches every one of them, which the caution
  // band says before anything is filled in.
  const groups: { album: CloudAlbum | null; tracks: CloudTrack[] }[] = [];
  for (const track of chosen) {
    const album = albumOf(track);
    const held = groups.find((group) => group.album === album);
    if (held) held.tracks.push(track);
    else groups.push({ album, tracks: [track] });
  }
  const spansAlbums = groups.length > 1;

  const tabs = [TABS.basic, TABS.credits, TABS.work, TABS.artwork];
  let tab = $state('basic');

  let sets = $state.raw<TagSet[] | null>(null);
  let summaries = $state.raw<Record<string, FieldSummary>>({});
  let values = $state<Record<string, string>>({});
  let ticked = $state<Record<string, boolean>>({});
  let reading = $state(true);
  let refusal = $state('');
  let saving = $state(false);

  async function read() {
    reading = true;
    refusal = '';
    try {
      const read = await catalogEdits.read(chosen);
      summaries = Object.fromEntries(KEYS.map((key) => [key, summarise(read, key)]));
      values = Object.fromEntries(KEYS.map((key) => [key, summaries[key]!.agreed ? summaries[key]!.common : '']));
      sets = read;
    } catch {
      refusal = text('Web_EditReadFailed');
    } finally {
      reading = false;
    }
  }

  void read();

  function suggestionsFor(key: string): readonly string[] {
    const held = summaries[key]?.values ?? [];
    const suggests = tagField(key).suggests;
    if (suggests === 'genres') return [...new Set([...held, ...genreSuggestions()])];
    if (suggests === 'styles') return [...new Set([...held, ...styleSuggestions(values.Genre)])];
    return held.length > 1 ? held : [];
  }

  const placeholderFor = (key: string) => (summaries[key] && !summaries[key]!.agreed ? text('MassEdit_Multiple') : '');

  // ── the pictures ──

  interface Well {
    on: boolean;
    shown: string | null;
    bytes: number;
    picture: Picture | null;
  }

  let cover = $state<Well>({ on: false, shown: null, bytes: 0, picture: null });
  let disc = $state<Well>({ on: false, shown: null, bytes: 0, picture: null });
  let finding = $state<'cover' | 'disc' | null>(null);

  function take(which: 'cover' | 'disc', picture: Picture) {
    const next = { on: true, shown: addressOf(picture), bytes: picture.bytes.length, picture };
    if (which === 'cover') cover = next;
    else disc = next;
  }

  // ── the release lookup: it fills every ticked field from the pressing picked ──

  const queue = lookupQueue();
  let rows = $state.raw<ReturnType<typeof lookupRow>[]>([]);
  let looking = $state(false);
  const anyTicked = $derived(Object.values(ticked).some(Boolean));

  function openLookup() {
    if (!sets) return;
    rows = chosen.map((track, index) => lookupRow(track, sets![index]!));
    looking = true;
  }

  function lookedUp() {
    const [row] = rows;
    if (!row) return;
    for (const key of KEYS) {
      if (!ticked[key]) continue;
      const value = readField(row.tags, key);
      if (value) values[key] = value;
    }
    if (row.cover && cover.on) take('cover', row.cover);
  }

  // ── saving ──

  function afterOf(tags: TagSet): TagSet {
    let after = { ...tags };
    for (const key of KEYS) if (ticked[key]) after = writeField(after, key, values[key] ?? '');
    return after;
  }

  async function save() {
    if (!sets) return;
    saving = true;
    refusal = '';
    try {
      const pictureOf = (well: Well): PictureChange => (well.on && well.picture ? well.picture : undefined);
      for (const group of groups) {
        const edits: TrackEdit[] = group.tracks.map((track) => {
          const before = sets![chosen.indexOf(track)]!;
          return { track, before, after: afterOf(before) };
        });
        await catalogEdits.save(edits, group.album, { cover: pictureOf(cover), disc: spansAlbums ? undefined : pictureOf(disc) });
      }
      await catalogue.refresh();
      onClose();
    } catch {
      refusal = text('Web_EditFailed');
    } finally {
      saving = false;
    }
  }
</script>

{#snippet field(key: string, pair?: string)}
  {@const tag = tagField(key)}
  <FormRow label={text(tag.label)} top={tag.multiline || tag.lines}>
    {#snippet tick()}<input type="checkbox" aria-label={text(tag.label)} bind:checked={ticked[key]} />{/snippet}
    <FieldBox {tag} disabled={!ticked[key]} placeholder={placeholderFor(key)} bind:value={values[key]} suggestions={suggestionsFor(key)} />
    {#if pair}
      <span class="of">{text('MassEdit_Of')}</span>
      <input type="checkbox" aria-label={text(tagField(pair).label)} bind:checked={ticked[pair]} />
      <FieldBox tag={tagField(pair)} disabled={!ticked[pair]} placeholder={placeholderFor(pair)} bind:value={values[pair]} />
    {/if}
  </FormRow>
{/snippet}

{#snippet column(groups: Group[])}
  <div class="column">
    {#each groups as group (group.heading)}
      {#if group.rows.length}
        <FormGroup heading={group.heading} ticks>
          {#each group.rows as row (row.key)}{@render field(row.key, row.pair)}{/each}
        </FormGroup>
      {/if}
    {/each}
  </div>
{/snippet}

<Window title={text('MassEdit_Title')} glyph={icons.edit} minWidth={760} maxWidth={1080} minHeight={560} openHeight={680} {onClose}>
  {#snippet banner()}
    {#if spansAlbums}
      <div class="caution" role="note"><i class="icon">{icons.warning}</i>{text('MassEdit_CautionManyAlbums')} {text('MassEdit_CautionManyAlbumsArt')}</div>
    {/if}
  {/snippet}

  <div class="top">
    <TabStrip {tabs} bind:current={tab} />
    <span title={anyTicked ? '' : text('MassEdit_LookUpNeedsFields')}>
      <button class="glass-button lookup" type="button" disabled={!sets || !anyTicked} onclick={openLookup}><i class="icon">{icons.search}</i>{text('MassEdit_LookUpRelease')}</button>
    </span>
  </div>

  {#if reading}
    <p class="note">{text('Web_EditReading')}</p>
  {:else if sets}
    {#if tab === 'basic' || tab === 'credits' || tab === 'work'}
      {@const [left, right] = MASS_LAYOUT[tab]}
      <div class="columns">
        {@render column(left)}
        {@render column(right)}
      </div>
    {:else if tab === 'artwork'}
      <div class="pictures">
        <PictureWell
          heading="Details_GroupCover"
          shown={cover.shown}
          bytes={cover.bytes}
          disabled={!cover.on}
          onTake={(picture) => take('cover', picture)}
          onFind={() => (finding = 'cover')}
          onRemove={() => (cover = { on: cover.on, shown: null, bytes: 0, picture: null })}
        >
          {#snippet tick()}<input type="checkbox" aria-label={text('Details_GroupCover')} bind:checked={cover.on} />{/snippet}
        </PictureWell>
        {#if !spansAlbums}
          <PictureWell
            heading="Details_GroupDisc"
            disc
            shown={disc.shown}
            bytes={disc.bytes}
            disabled={!disc.on}
            onTake={(picture) => take('disc', picture)}
            onFind={() => (finding = 'disc')}
            onRemove={() => (disc = { on: disc.on, shown: null, bytes: 0, picture: null })}
          >
            {#snippet tick()}<input type="checkbox" aria-label={text('Details_GroupDisc')} bind:checked={disc.on} />{/snippet}
          </PictureWell>
        {/if}
      </div>
    {/if}
  {/if}

  {#snippet footnote()}
    {#if refusal}<p class="refusal" role="alert">{refusal}</p>{/if}
  {/snippet}

  {#snippet leading()}<span class="count">{text('AlbumPicker_Tracks', chosen.length)}</span>{/snippet}

  {#snippet footer()}
    <button class="glass-button" type="button" onclick={onClose}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
    <button class="glass-button primary" type="button" disabled={!sets || saving || (!anyTicked && !cover.picture && !disc.picture)} onclick={save}><i class="icon">{icons.check}</i>{text('Review_MassApply')}</button>
  {/snippet}
</Window>

{#if finding}
  <CoverFinder
    kind={finding}
    artist={values.AlbumArtist || values.Artist || ''}
    album={values.Album ?? ''}
    onUse={(picture, label) => {
      take(finding!, picture);
      if (label && finding === 'cover' && !spansAlbums) take('disc', label);
      finding = null;
    }}
    onClose={() => (finding = null)}
  />
{/if}

{#if looking}
  <ReleaseLookup {rows} {queue} onDone={lookedUp} onClose={() => (looking = false)} />
{/if}

<style>
  .caution {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px 24px;
    border-bottom: 1px solid rgb(255 212 102 / 0.35);
    background: rgb(255 212 102 / 0.12);
    color: #ffe6a8;
    font-size: 12px;
  }

  .caution .icon {
    color: var(--warning);
    font-size: 12px;
  }

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

  .count {
    color: rgb(255 255 255 / 0.55);
    font-size: 11.5px;
  }

  @media (max-width: 699px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
      padding-right: 0;
    }

    .caution {
      padding: 10px 16px;
    }
  }
</style>

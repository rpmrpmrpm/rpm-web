<script lang="ts">
  // Track metadata from a release: the release lookup over tracks already in the cloud. The tags are read
  // first, the lookup fills them, and what it filled is saved when it closes with Apply.
  import { untrack } from 'svelte';

  import type { CloudTrack } from '../../api/wire';
  import { catalogEdits, catalogue } from '../../app';
  import { icons } from '../../design/icons';
  import type { TrackEdit } from '../../library/edit';
  import type { TagSet } from '../../library/tag-fields';
  import { text } from '../../strings/loc';
  import ReleaseLookup from '../import/ReleaseLookup.svelte';
  import Window from '../import/Window.svelte';
  import { albumOf } from './editing';
  import { lookupQueue, lookupRow } from './lookup-rows';

  let { tracks, onClose }: { tracks: readonly CloudTrack[]; onClose: () => void } = $props();

  const chosen = untrack(() => [...tracks]);
  const queue = lookupQueue();
  let before = $state.raw<TagSet[] | null>(null);
  let rows = $state.raw<ReturnType<typeof lookupRow>[]>([]);
  let refusal = $state('');
  let saving = $state(false);
  // The lookup closes itself after Apply. The save is still running then, and closes this when it is done.
  let applied = false;

  void catalogEdits.read(chosen).then(
    (sets) => {
      before = sets;
      rows = chosen.map((track, index) => lookupRow(track, sets[index]!));
    },
    () => (refusal = text('Web_EditReadFailed')),
  );

  // The lookup is done: every row it wrote to is saved, with the cover it brought where it brought one.
  async function done() {
    if (!before) return;
    saving = true;
    try {
      const edits: TrackEdit[] = chosen.map((track, index) => {
        const { DurationSeconds: _length, ...after } = rows[index]!.tags;
        return { track, before: before![index]!, after };
      });
      const cover = rows.find((row) => row.cover)?.cover ?? undefined;
      const album = chosen.length ? albumOf(chosen[0]!) : null;
      await catalogEdits.save(edits, album, { cover });
      await catalogue.refresh();
      onClose();
    } catch {
      refusal = text('Web_EditFailed');
    } finally {
      saving = false;
    }
  }
</script>

{#if refusal || saving || !before}
  <Window title={text('Queue_CtxNameTracks')} glyph={icons.tag} minWidth={420} maxWidth={520} minHeight={220} openHeight={240} {onClose}>
    <p class:refusal={!!refusal} role={refusal ? 'alert' : undefined}>{refusal || text(saving ? 'Web_EditSaving' : 'Web_EditReading')}</p>
    {#snippet footer()}
      <button class="glass-button" type="button" disabled={saving} onclick={onClose}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
    {/snippet}
  </Window>
{:else}
  <ReleaseLookup
    {rows}
    {queue}
    onDone={() => {
      applied = true;
      void done();
    }}
    onClose={() => {
      if (!applied) onClose();
    }}
  />
{/if}

<style>
  p {
    margin: 0;
    color: var(--text-soft);
    font-size: 13px;
  }

  .refusal {
    color: var(--error);
  }
</style>

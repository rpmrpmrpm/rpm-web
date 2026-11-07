<script lang="ts">
  // Recognise on tracks already in the cloud, as the desktop's library menu has it. The tags are read first,
  // the import's recognise window runs over rows that stand for the tracks, and the names it found are saved
  // when it closes. A pen beside a result saves what was found and opens that track's editor.
  import { untrack } from 'svelte';

  import type { CloudTrack } from '../../api/wire';
  import { api, catalogEdits, catalogue, cloud, importMedia } from '../../app';
  import { icons } from '../../design/icons';
  import { CloudAudio } from '../../import/cloud-audio';
  import type { ImportRow } from '../../import/queue';
  import { Recogniser } from '../../import/recognise';
  import type { TrackEdit } from '../../library/edit';
  import type { TagSet } from '../../library/tag-fields';
  import { text } from '../../strings/loc';
  import RecogniseWindow from '../import/RecogniseWindow.svelte';
  import Window from '../import/Window.svelte';
  import { asked } from '../library/record-menu.svelte';
  import { albumOf } from './editing';
  import { lookupQueue, lookupRow } from './lookup-rows';

  let { tracks, onClose }: { tracks: readonly CloudTrack[]; onClose: () => void } = $props();

  const chosen = untrack(() => [...tracks]);
  const audio = new CloudAudio(cloud, importMedia);
  const recogniser = new Recogniser(api, audio, lookupQueue());

  let before = $state.raw<TagSet[] | null>(null);
  let rows = $state.raw<ImportRow[]>([]);
  let refusal = $state('');
  let saving = $state(false);

  void catalogEdits.read(chosen).then(
    (sets) => {
      before = sets;
      rows = chosen.map((track, index) => ({ ...lookupRow(track, sets[index]!), file: audio.standIn(track) }));
    },
    () => (refusal = text('Web_EditReadFailed')),
  );

  // What the run named, written to the cloud. A track it did not name is not touched.
  async function save(): Promise<boolean> {
    if (!before) return true;
    const edits: TrackEdit[] = chosen.map((track, index) => {
      const { DurationSeconds: _length, ...after } = rows[index]!.tags;
      return { track, before: before![index]!, after };
    });
    saving = true;
    try {
      const groups = new Map<string, TrackEdit[]>();
      for (const edit of edits) {
        const key = albumOf(edit.track)?.key ?? '';
        groups.set(key, [...(groups.get(key) ?? []), edit]);
      }
      for (const group of groups.values()) await catalogEdits.save(group, albumOf(group[0]!.track));
      await catalogue.refresh();
      return true;
    } catch {
      refusal = text('Web_EditFailed');
      return false;
    } finally {
      saving = false;
      audio.forget();
    }
  }

  async function close() {
    if (await save()) onClose();
  }

  async function edit(picked: ImportRow[]) {
    const track = chosen.find((row) => row.rpmId === picked[0]?.id);
    if (!(await save())) return;
    onClose();
    if (track) asked.editing = { kind: 'track', track: catalogue.albums.flatMap((album) => album.tracks).find((row) => row.rpmId === track.rpmId) ?? track };
  }
</script>

{#if refusal || saving || !before}
  <Window title={text('Recognize_Title')} glyph={icons.fingerprint} minWidth={420} maxWidth={520} minHeight={220} openHeight={240} {onClose}>
    <p class:refusal={!!refusal} role={refusal ? 'alert' : undefined}>{refusal || text(saving ? 'Web_EditSaving' : 'Web_EditReading')}</p>
    {#snippet footer()}
      <button class="glass-button" type="button" disabled={saving} onclick={onClose}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
    {/snippet}
  </Window>
{:else}
  <RecogniseWindow {rows} {recogniser} onClose={close} onEdit={edit} />
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

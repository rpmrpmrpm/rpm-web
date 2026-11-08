<script lang="ts">
  // The words in Track info. A timed sheet belongs to the record: it moves with the singer and takes no hand.
  // The sheet is asked for only while this is on screen, so ordinary listening sends LRCLIB nothing.
  import type { CloudTrack } from '../../api/wire';
  import { lyrics } from '../../app';
  import { icons } from '../../design/icons';
  import { EMPTY_SHEET, isSynced, isWordless, lineAt, type LyricSheet } from '../../lyrics/sheet';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';

  let { track }: { track: CloudTrack } = $props();

  let sheet = $state.raw<LyricSheet>(EMPTY_SHEET);
  let asked = $state(false);
  let note = $state('');
  let working = $state(false);
  let scroller = $state<HTMLElement | null>(null);
  let picker = $state<HTMLInputElement | null>(null);

  $effect(() => {
    const wanted = track;
    let current = true;
    sheet = EMPTY_SHEET;
    asked = false;
    note = '';
    void lyrics.of(wanted).then((found) => {
      if (!current) return;
      sheet = found;
      asked = true;
    });
    return () => {
      current = false;
    };
  });

  // A break gets no row, and the well closes over it. A rest maps back to the row before it, so the last words
  // sung stay lit until the next ones are.
  const rows = $derived(sheet.lines.filter((line) => !isWordless(line.text)));
  const rowOf = $derived.by(() => {
    let row = -1;
    return sheet.lines.map((line) => (isWordless(line.text) ? row : ++row));
  });

  const line = $derived(now.track?.rpmId === track.rpmId ? lineAt(sheet, now.seconds) : null);
  const sung = $derived(line === null ? -1 : (rowOf[line] ?? -1));

  $effect(() => {
    const row = scroller?.children[sung] as HTMLElement | undefined;
    if (!scroller || !row) return;
    scroller.scrollTo({ top: row.offsetTop - (scroller.clientHeight - row.offsetHeight) / 2, behavior: 'smooth' });
  });

  const opacity = (row: number) => (sung < 0 ? 0.45 : row === sung ? 1 : Math.abs(row - sung) === 1 ? 0.6 : 0.35);

  async function another() {
    if (working) return;
    working = true;
    const next = await lyrics.another(track, sheet);
    working = false;
    if (next) sheet = next;
    else note = text('TrackInfo_LyricsNoOtherVersion');
  }

  async function own(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const taken = await lyrics.own(track, await file.text());
    if (taken) {
      sheet = taken;
      note = '';
    } else {
      note = text('TrackInfo_LyricsNotTimed');
    }
  }
</script>

<!-- Only a sheet with words to read gets a block, as on the desktop: an empty card headed Lyrics is worse than no
     card. A file of one's own can still be given in the track's edit window. -->
{#if asked && rows.length}
  <section>
    <div class="head">
      <h3>{text('Details_Lyrics')}</h3>
      <div class="keys">
        <button class="tool" title={text('TrackInfo_LyricsUseOwn')} aria-label={text('TrackInfo_LyricsUseOwn')} onclick={() => picker?.click()}><i class="icon">{icons.folder}</i></button>
        {#if isSynced(sheet)}
          <button class="tool" disabled={working} title={text('TrackInfo_LyricsTryAnother')} aria-label={text('TrackInfo_LyricsTryAnother')} onclick={another}><i class="icon">{icons.refresh}</i></button>
        {/if}
      </div>
    </div>
    <input bind:this={picker} type="file" accept=".lrc,.txt" hidden onchange={own} />
    <div class="well" bind:this={scroller}>
      {#each rows as row, index (row.at)}
        <p class:sung={index === sung} style:opacity={opacity(index)}>{row.text}</p>
      {/each}
    </div>
    {#if note}<p class="note" role="status">{note}</p>{/if}
  </section>
{/if}

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0 16px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 24px;
  }

  h3 {
    margin: 0;
    color: rgb(255 255 255 / 0.67);
    font-size: 12px;
    font-weight: 600;
  }

  .keys {
    display: flex;
    gap: 6px;
  }

  .keys .tool {
    padding: 0 9px;
  }

  .well {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 150px;
    padding: 10px 14px;
    overflow: hidden;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.094);
  }

  .well p {
    margin: 0;
    color: rgb(255 255 255 / 0.87);
    font-size: 12px;
    line-height: 18px;
    transition: opacity 240ms var(--move);
  }

  .well p.sung {
    color: #fff;
  }

  .note {
    margin: 0;
    color: var(--text-soft);
    font-size: 11.5px;
  }
</style>

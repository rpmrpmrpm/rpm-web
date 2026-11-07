<script lang="ts">
  // The words on a phone: the sung line stays in the middle, and only one stretch of the song shows at a time.
  // This is LyricView in the phone app. An opacity is worked out from the piece the playhead is in, so it
  // changes when the singing does and not four times a second.
  import type { CloudTrack } from '../../api/wire';
  import { isRest, partAt, scoreOf, type Part } from '../../lyrics/score';
  import type { LyricSheet } from '../../lyrics/sheet';
  import { now } from '../../state.svelte';

  let { track, sheet }: { track: CloudTrack; sheet: LyricSheet } = $props();

  // How many lines either side of the sung line are drawn at all.
  const REACH = 3;
  const DOT_REST = 0.16;

  let list = $state<HTMLElement | null>(null);

  const parts = $derived(scoreOf(sheet));
  const at = $derived(partAt(parts, now.seconds));
  const here = $derived(at === null ? null : parts[at]!);
  const resting = $derived(here !== null && isRest(here.piece));

  $effect(() => {
    const row = list?.children[at ?? 0] as HTMLElement | undefined;
    if (!list || !row) return;
    list.scrollTo({ top: row.offsetTop - (list.clientHeight - row.offsetHeight) / 2, behavior: 'smooth' });
  });

  function fade(part: Part): number {
    if (at === null) return 0;
    const distance = Math.abs(part.id - at);
    if (part.section !== here?.section || (resting && !isRest(part.piece))) return 0;
    if (distance === 0) return 1;
    if (distance === 1) return 0.42;
    if (distance === 2) return 0.24;
    return distance <= REACH ? 0.12 : 0;
  }

  const through = (from: number, until: number) => {
    const run = until - from;
    return run > 0 && Number.isFinite(run) ? Math.min(Math.max((now.seconds - from) / run, 0), 1) : 0;
  };

  const first = $derived(sheet.lines[0]?.seconds ?? 0);
  const countIn = $derived(first > 0 ? Math.min(now.seconds / first, 1) : 1);
  const dot = (filled: number, index: number) => DOT_REST + (1 - DOT_REST) * Math.min(Math.max(filled * 3 - index, 0), 1);
</script>

{#snippet dots(filled: number)}
  <span class="dots">{#each [0, 1, 2] as index}<i style:opacity={dot(filled, index)}></i>{/each}</span>
{/snippet}

<div class="lyrics">
  <div class="list" bind:this={list}>
    {#each parts as part (part.id)}
      <div class="row" class:sung={part.id === at} style:opacity={fade(part)}>
        {#if isRest(part.piece)}
          {@render dots(through(part.piece.from, part.piece.until))}
        {:else}
          {part.piece.words.text}
        {/if}
      </div>
    {/each}
  </div>
  {#if at === null}
    <div class="opening">
      <strong>{track.title}</strong>
      <span>{track.artist}</span>
      {@render dots(countIn)}
    </div>
  {/if}
</div>

<style>
  .lyrics {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .list {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 50% 8px;
    overflow: hidden;
  }

  .row {
    color: #eaeaea;
    font-size: 21px;
    font-weight: 600;
    line-height: 1.25;
    text-align: center;
    transition: opacity 350ms ease-out;
  }

  .row.sung {
    color: #fff;
  }

  .dots {
    display: flex;
    gap: 10px;
    justify-content: center;
  }

  .dots i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #fff;
    transition: opacity 250ms linear;
  }

  .opening {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    align-items: center;
    justify-content: center;
    padding: 0 32px;
    text-align: center;
  }

  .opening strong {
    font-size: 21px;
    font-weight: 600;
  }

  .opening span:not(.dots) {
    margin-bottom: 13px;
    color: rgb(234 234 234 / 0.66);
    font-size: 17px;
    font-weight: 500;
  }
</style>

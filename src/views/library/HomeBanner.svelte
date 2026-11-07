<script lang="ts">
  // The featured banner: one card at a time, with the card before it and the card after it behind it at
  // each side. It steps with the two keys, by pressing a neighbour, by a dot, and by itself while the pointer
  // is off it. The cards change at once and the strip carries them in from the side of the step.
  import { icons } from '../../design/icons';
  import { bannerLayout, DWELL_MS, type Feature } from '../../library/home-features';
  import type { CloudAlbum } from '../../library/albums';
  import { text } from '../../strings/loc';
  import FeatureFace from './FeatureFace.svelte';

  let { cards, albumOf, onOpen }: { cards: Feature[]; albumOf: (key: string) => CloudAlbum | undefined; onOpen: (album: CloudAlbum) => void } = $props();

  const KICKERS: Record<Feature['kind'], string> = {
    continue: 'Home_Continue',
    added: 'Home_Added',
    suggested: 'Home_Suggested',
    played: 'Home_Played',
    listened: 'Home_Listened',
  };

  let at = $state(0);
  let width = $state(0);
  let held = $state(false);
  let from = $state(0);
  let stepped = $state(0);

  const layout = $derived(bannerLayout(width));
  const count = $derived(cards.length);
  const card = (index: number) => cards[((index % count) + count) % count]!;

  function step(by: number) {
    at = ((at + by) % count + count) % count;
    from = by * layout.slide;
    stepped++;
  }

  $effect(() => {
    if (held || count < 2) return;
    void stepped;
    const timer = setTimeout(() => step(1), DWELL_MS);
    return () => clearTimeout(timer);
  });
</script>

{#snippet face(index: number)}
  {@const album = albumOf(card(index).key)}
  {#if album}<FeatureFace {album} kicker={text(KICKERS[card(index).kind])} />{/if}
{/snippet}

{#if count > 0}
  <div class="strip" role="region" aria-label={text('Home_QuickPicks')} onpointerenter={() => (held = true)} onpointerleave={() => (held = false)}>
    <div class="band" bind:clientWidth={width}>
      {#key stepped}
        <div class="track" style:--from="{from}px">
          {#if layout.peek > 0 && count > 1}
            <button class="peek left" style:width="{layout.peek}px" aria-label={text('Home_FeatureBack')} onclick={() => step(-1)}><span style:width="{layout.plate}px">{@render face(at - 1)}</span></button>
            <button class="peek right" style:width="{layout.peek}px" aria-label={text('Home_FeatureOn')} onclick={() => step(1)}><span style:width="{layout.plate}px">{@render face(at + 1)}</span></button>
          {/if}
          <button
            class="plate"
            style:width="{layout.plate}px"
            onclick={() => {
              const album = albumOf(card(at).key);
              if (album) onOpen(album);
            }}>{@render face(at)}</button
          >
        </div>
      {/key}
      {#if count > 1}
        <button class="key side back" aria-label={text('Home_FeatureBack')} title={text('Home_FeatureBack')} onclick={() => step(-1)}><i class="icon">{icons.back}</i></button>
        <button class="key side on" aria-label={text('Home_FeatureOn')} title={text('Home_FeatureOn')} onclick={() => step(1)}><i class="icon">{icons.forward}</i></button>
      {/if}
    </div>

    {#if count > 1}
      <div class="dots">
        {#each cards as _, index}
          <button class:lit={index === at} aria-label={text('Home_FeatureDot', index + 1, count)} onclick={() => step(index - at)}></button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .strip {
    margin-bottom: 26px;
  }

  .band {
    position: relative;
    height: 352px;
  }

  .track {
    position: absolute;
    inset: 0;
    animation: arrive 220ms var(--move);
  }

  @keyframes arrive {
    from {
      transform: translateX(var(--from));
    }
  }

  .plate,
  .peek {
    position: absolute;
    display: block;
    padding: 0;
    overflow: hidden;
    border: 0;
    background: #191b20;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .plate {
    top: 0;
    bottom: 0;
    left: 50%;
    z-index: 1;
    border-radius: 12px;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.1), 0 8px 26px rgb(0 0 0 / 0.5);
    transform: translateX(-50%);
  }

  .peek {
    top: 11px;
    bottom: 11px;
  }

  .peek span {
    position: absolute;
    top: 0;
    bottom: 0;
    display: block;
  }

  .peek.left {
    left: 0;
    border-radius: 12px 0 0 12px;
  }

  .peek.left span {
    left: 0;
  }

  .peek.right {
    right: 0;
    border-radius: 0 12px 12px 0;
  }

  .peek.right span {
    right: 0;
  }

  .side {
    position: absolute;
    top: 50%;
    z-index: 2;
    color: rgb(255 255 255 / 0.85);
    transform: translateY(-50%);
  }

  .back {
    left: 4px;
  }

  .on {
    right: 4px;
  }

  .dots {
    display: flex;
    gap: 7px;
    justify-content: center;
    margin-top: 12px;
  }

  .dots button {
    width: 6px;
    height: 6px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.3);
    cursor: pointer;
  }

  .dots button.lit {
    background: #fff;
  }

  @media (max-width: 699px) {
    .band {
      height: 264px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .track {
      animation: none;
    }
  }
</style>

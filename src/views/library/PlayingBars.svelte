<script lang="ts">
  // The mark in front of the song the player is on, as the desktop's PlayingBars: three bars that bob at their
  // own rates, so it reads as sound and not as a progress bar. It takes the colour of the text beside it. The
  // bars move by scaling, not by height, so a frame changes no layout, and all marks on screen are in step
  // because they share one clock: the time since the page opened.

  // Each bar: its height at the tallest and the shortest, in pixels, and the period of its bob in seconds. The
  // periods do not divide into one another and the starts are a third of a turn apart, so the three never fall
  // into step.
  const BARS = [
    { full: 13, least: 4, period: 1.28, phase: 0 },
    { full: 12, least: 5, period: 0.96, phase: 1 / 3 },
    { full: 10, least: 4, period: 1.52, phase: 2 / 3 },
  ];
</script>

<span class="bars" aria-hidden="true">
  {#each BARS as bar, index (index)}
    <span
      style:height="{bar.full}px"
      style:--least={bar.least / bar.full}
      style:animation-duration="{bar.period / 2}s"
      style:animation-delay="{-(bar.phase * bar.period)}s"
    ></span>
  {/each}
</span>

<style>
  /* The feet of the bars stand on the baseline of the text beside them. */
  .bars {
    display: inline-flex;
    flex: none;
    gap: 2px;
    align-items: flex-end;
    height: 13px;
    margin-right: 6px;
    vertical-align: -1px;
  }

  .bars span {
    width: 2.5px;
    border-radius: 1px;
    background: currentColor;
    transform-origin: bottom;
    animation-name: bob;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
    animation-direction: alternate;
  }

  /* Half a sine each way: alternate runs it back down. */
  @keyframes bob {
    from {
      transform: scaleY(var(--least));
    }
    to {
      transform: scaleY(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bars span {
      animation: none;
      transform: scaleY(0.6);
    }
  }
</style>

<script lang="ts">
  // A review's stars, halves included: the rating is halves of a star, doubled, 1 to 10. A half star is the lit
  // star cut at its middle over a dim one.
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';

  let { rating }: { rating: number } = $props();

  const stars = $derived(Math.max(0, Math.min(10, rating)) / 2);
</script>

<span class="stars" role="img" aria-label={text('Review_Stars', stars)}>
  {#each { length: 5 } as _, index}
    <span class="star" style:--lit="{Math.max(0, Math.min(1, stars - index)) * 100}%"><i class="icon dim">{icons.star}</i><i class="icon lit">{icons.star}</i></span>
  {/each}
</span>

<style>
  .stars {
    display: inline-flex;
    gap: 2px;
    font-size: var(--feed-stars);
    line-height: 1;
  }

  .star {
    position: relative;
    display: inline-block;
  }

  .dim {
    color: rgb(255 255 255 / 0.27);
  }

  .lit {
    position: absolute;
    inset: 0;
    color: #f2c14e;
    clip-path: inset(0 calc(100% - var(--lit)) 0 0);
  }
</style>

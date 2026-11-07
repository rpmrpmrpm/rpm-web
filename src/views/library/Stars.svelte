<script lang="ts">
  // The stars given to a record. Pressing the stars it already has takes them off.
  import { albumRatings, session } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { MOST_STARS } from '../../library/ratings';
  import { text } from '../../strings/loc';

  let { album }: { album: CloudAlbum } = $props();

  let stars = $state(0);
  const account = session.user?.userId ?? '';

  $effect(() => {
    const wanted = album;
    let current = true;
    void albumRatings.stars(wanted, account).then((given) => {
      if (current) stars = given;
    });
    return () => {
      current = false;
    };
  });

  async function rate(given: number) {
    stars = given === stars ? 0 : given;
    await albumRatings.rate(album, stars, account);
  }
</script>

<div class="stars" role="group" aria-label={text('Album_YourRating')} title={text('Album_YourRating')}>
  {#each { length: MOST_STARS } as _, index}
    <button class:on={index < stars} aria-pressed={index + 1 === stars} aria-label={text('Review_Stars', index + 1)} onclick={() => rate(index + 1)}><i class="icon">{icons.star}</i></button>
  {/each}
</div>

<style>
  .stars {
    display: inline-flex;
    align-items: center;
  }

  button {
    padding: 4px 2px;
    border: 0;
    background: none;
    color: var(--text-faint);
    font-size: 13px;
    cursor: pointer;
  }

  button.on {
    color: var(--warning);
  }
</style>

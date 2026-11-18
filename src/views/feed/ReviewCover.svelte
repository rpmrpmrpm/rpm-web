<script lang="ts">
  // The cover square on a review: the record glyph, with the picture over it once there is one. The reader's own
  // copy's cover when the record is in the collection, else the first cover the search finds (FeedCovers).
  import type { FeedReview } from '../../api/community';
  import { covers, coverSearch, feedCovers } from '../../app';
  import { icons } from '../../design/icons';
  import { ownCopy } from '../../social/feed-covers';
  import { library } from '../../state.svelte';

  let { review, edge }: { review: FeedReview; edge: number } = $props();

  let picture = $state<string | null>(null);

  async function find(wanted: FeedReview): Promise<string | null> {
    const own = ownCopy(library.albums, wanted.albumTitle, wanted.albumArtist);
    if (own) {
      // The store's 256 size, sharp on a screen that draws two pixels to the point.
      const url = await covers.url(own, 256);
      if (url) return url;
    }
    const address = await feedCovers.found(wanted.albumArtist, wanted.albumTitle);
    return address ? coverSearch.shown(address) : null;
  }

  $effect(() => {
    const wanted = review;
    let current = true;
    picture = null;
    void find(wanted).then((url) => {
      if (current) picture = url;
    });
    return () => {
      current = false;
    };
  });
</script>

<span class="cover" style:--edge="{edge}px">
  <i class="icon">{icons.album}</i>
  {#if picture}<img src={picture} alt="" />{/if}
</span>

<style>
  .cover {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    box-sizing: border-box;
    width: var(--edge);
    height: var(--edge);
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 10px;
    background: rgb(0 0 0 / 0.133);
  }

  .icon {
    color: rgb(255 255 255 / 0.227);
    font-size: 28px;
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>

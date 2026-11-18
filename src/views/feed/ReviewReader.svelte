<script lang="ts">
  // A review read in full: the author, the cover beside the record's title, artist, year and stars, every line of
  // the review, the votes, and Open album when the record is in the reader's collection. The key that closes it is
  // in the heading row.
  import { session } from '../../app';
  import type { CloudAlbum } from '../../library/albums';
  import { written } from '../../social/written';
  import { text } from '../../strings/loc';
  import Byline from './Byline.svelte';
  import Face from './Face.svelte';
  import { feed, type Page } from './feed.svelte';
  import type { FeedEntry, FeedList } from './feed-list.svelte';
  import HalfStars from './HalfStars.svelte';
  import { quoted } from './parts';
  import ReviewCover from './ReviewCover.svelte';
  import VoteKeys from './VoteKeys.svelte';

  let { page, entry, list, album }: { page: Page; entry: FeedEntry; list: FeedList; album: CloudAlbum | null } = $props();

  // The list's entry with this key, which a fresh read of the list may have replaced, so a vote from either the
  // card or this page shows on both.
  const shown = $derived(list.entries.find((held) => held.key === entry.key) ?? entry);
  const review = $derived(shown.item.kind === 'review' ? shown.item.review : null);
  const me = $derived(session.user?.userId ?? null);
</script>

{#if review}
  {@const name = review.authorDeleted ? text('Community_DeletedUser') : review.authorName}
  <div class="scroll">
    <div class="column">
      {#if list.everyone}
        {#if review.authorDeleted}
          <span class="author"><Face userId={null} hasAvatar={false} {name} size={32} /><Byline {name} millis={review.createdAt} gold={false} /></span>
        {:else}
          <button class="plain author" aria-label={name} onclick={() => feed.openPerson(review.userId)}>
            <Face userId={review.userId} hasAvatar={review.hasAvatar} {name} size={32} />
            <Byline {name} millis={review.createdAt} gold={review.authorSupporter} />
          </button>
        {/if}
      {/if}

      <div class="record">
        <ReviewCover {review} edge={140} />
        <div class="head">
          <p class="title">{review.albumTitle}</p>
          <p class="artist">{review.albumYear > 0 ? `${review.albumArtist}, ${review.albumYear}` : review.albumArtist}</p>
          <p class="rated">
            {#if review.rating > 0}<HalfStars rating={review.rating} />{/if}
            <span class="when">{written(review.createdAt)}</span>
          </p>
        </div>
      </div>

      {#if quoted(review.body)}<p class="full">{quoted(review.body)}</p>{/if}

      <div class="foot">
        <VoteKeys ups={review.ups} downs={review.downs} mine={review.myVote} enabled={review.userId !== me} onVote={(value) => void list.vote(entry.key, value)} />
        {#if album}<button class="plain open" onclick={() => feed.openAlbum(page, album)}>{text('Rpm_Profile_OpenAlbum')}</button>{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scroll {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 7px 16px 24px;
  }

  .author {
    display: flex;
    gap: 10px;
    align-items: center;
    align-self: flex-start;
    max-width: 100%;
  }

  .record {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 14px;
  }

  p {
    margin: 0;
  }

  .title {
    color: #fff;
    font-size: var(--feed-subject);
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .artist {
    margin-top: 2px;
    color: rgb(255 255 255 / 0.6);
    font-size: var(--feed-body);
  }

  .rated {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 6px;
  }

  .when {
    color: rgb(255 255 255 / 0.467);
    font-size: var(--feed-meta);
  }

  .full {
    color: rgb(255 255 255 / 0.933);
    font-size: var(--feed-body);
    line-height: var(--feed-line);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .open {
    height: 32px;
    color: #fff;
    font-size: var(--feed-body);
    font-weight: 600;
  }
</style>

<script lang="ts">
  // A review as a card: the author, then the record's title, artist, year and stars, with the review's text run
  // round the cover at the right, as on the phones. At most ten lines of the text are shown; the whole review is
  // one press away. A press on the card that is not on a key reads it in full.
  import type { FeedReview } from '../../api/community';
  import { written } from '../../social/written';
  import { text } from '../../strings/loc';
  import Byline from './Byline.svelte';
  import Face from './Face.svelte';
  import HalfStars from './HalfStars.svelte';
  import { insideKey, quoted } from './parts';
  import ReviewCover from './ReviewCover.svelte';
  import VoteKeys from './VoteKeys.svelte';

  let {
    review,
    canVote,
    onVote,
    onRead,
    showAuthor,
    onPerson,
  }: {
    review: FeedReview;
    canVote: boolean;
    onVote: (value: number) => void;
    onRead: () => void;
    // Draw the author's line above the record, as on everyone's feed. On the author's own page the line is left
    // out and the time stands beside the stars instead.
    showAuthor: boolean;
    // Opens the author's page from their line; null where it is not drawn.
    onPerson: ((userId: string) => void) | null;
  } = $props();

  const name = $derived(review.authorDeleted ? text('Community_DeletedUser') : review.authorName);
  const opensPerson = $derived(!review.authorDeleted && onPerson !== null);
  const said = $derived(quoted(review.body));

  function pressed(event: MouseEvent) {
    if (!insideKey(event)) onRead();
  }
</script>

<!-- Read full review does what a press on the card does, so the card itself needs no key of its own. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="card review" onclick={pressed}>
  {#if showAuthor}
    {#if opensPerson}
      <button class="plain author" aria-label={name} onclick={() => onPerson?.(review.userId)}>
        <Face userId={review.userId} hasAvatar={review.hasAvatar} {name} size={32} />
        <Byline {name} millis={review.createdAt} gold={review.authorSupporter} />
      </button>
    {:else}
      <span class="author">
        <Face userId={review.authorDeleted ? null : review.userId} hasAvatar={review.hasAvatar} {name} size={32} />
        <Byline {name} millis={review.createdAt} gold={review.authorSupporter} />
      </span>
    {/if}
  {/if}

  <div class="wrap">
    <span class="beside"><ReviewCover {review} edge={120} /></span>
    <p class="title">{review.albumTitle}</p>
    <p class="artist">{review.albumYear > 0 ? `${review.albumArtist}, ${review.albumYear}` : review.albumArtist}</p>
    {#if review.rating > 0 || !showAuthor}
      <p class="rated">
        {#if review.rating > 0}<HalfStars rating={review.rating} />{/if}
        {#if !showAuthor}<span class="when">{written(review.createdAt)}</span>{/if}
      </p>
    {/if}
    {#if said}<p class="said">{said}</p>{/if}
  </div>

  <div class="foot">
    <VoteKeys ups={review.ups} downs={review.downs} mine={review.myVote} enabled={canVote} {onVote} />
    <button class="feed-link" onclick={onRead}>{text('Rpm_Profile_ReadReview')}</button>
  </div>
</div>

<style>
  .review {
    padding: 14px 14px 4px;
    cursor: pointer;
  }

  .author {
    display: flex;
    gap: 10px;
    align-items: center;
    max-width: 100%;
    margin-bottom: 12px;
  }

  /* The text runs round the cover: lines that start beside it stay narrow, and the rest take the full width. */
  .wrap {
    display: flow-root;
  }

  .beside {
    float: right;
    margin: 0 0 8px 12px;
  }

  .title {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    color: #fff;
    font-size: var(--feed-subject);
    font-weight: 600;
    line-height: 1.3;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }

  .artist {
    margin: 2px 0 0;
    overflow: hidden;
    color: rgb(255 255 255 / 0.6);
    font-size: var(--feed-body);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rated {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 6px 0 0;
  }

  .when {
    color: rgb(255 255 255 / 0.467);
    font-size: var(--feed-meta);
  }

  /* Ten lines at most. A clip, not a hidden overflow, because a hidden overflow would stop the lines running
     round the cover. */
  .said {
    max-height: calc(10 * var(--feed-line));
    margin: 8px 0 0;
    overflow: clip;
    color: rgb(255 255 255 / 0.9);
    font-size: var(--feed-body);
    line-height: var(--feed-line);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 6px;
  }
</style>

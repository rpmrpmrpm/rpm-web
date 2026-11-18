<script lang="ts">
  // A post as a card: photo, name and time, the text, the song that was playing, the votes and the reply count.
  // Room inside the card follows the phones' cards. A press on the card that is not on a key opens its thread.
  import type { Post } from '../../api/community';
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';
  import Byline from './Byline.svelte';
  import Face from './Face.svelte';
  import { insideKey, songLine } from './parts';
  import VoteKeys from './VoteKeys.svelte';

  let {
    post,
    canVote,
    onVote,
    onPerson,
    onOpen,
    onMenu,
  }: {
    post: Post;
    canVote: boolean;
    onVote: (value: number) => void;
    // Opens the author's page from their photo or name; null on that page itself, where both stay still.
    onPerson: ((userId: string) => void) | null;
    // Opens the post with its replies; null where the post is already open.
    onOpen: (() => void) | null;
    // Opens the post's menu at a point, from the key in its corner; null draws no key.
    onMenu: ((x: number, y: number) => void) | null;
  } = $props();

  const name = $derived(post.authorDeleted ? text('Community_DeletedUser') : post.authorName);
  const opensPerson = $derived(!post.authorDeleted && onPerson !== null);
  const repliesLabel = $derived(post.replyCount === 0 ? text('Rpm_Profile_Reply') : post.replyCount === 1 ? text('Rpm_Profile_RepliesOne') : text('Rpm_Profile_Replies', post.replyCount));

  function pressed(event: MouseEvent) {
    if (onOpen && !insideKey(event)) onOpen();
  }

  function menu(event: MouseEvent) {
    const key = (event.currentTarget as HTMLElement).getBoundingClientRect();
    onMenu?.(key.left, key.bottom + 4);
  }
</script>

<!-- The keys inside the card do everything a press on the card does, so the card itself needs no key of its own. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="card post" class:opens={onOpen} onclick={pressed}>
  {#if opensPerson}
    <button class="plain photo" aria-label={name} onclick={() => onPerson?.(post.ownerId)}>
      <Face userId={post.ownerId} hasAvatar={post.hasAvatar} {name} size={40} />
    </button>
  {:else}
    <span class="photo"><Face userId={post.authorDeleted ? null : post.ownerId} hasAvatar={post.hasAvatar} {name} size={40} /></span>
  {/if}

  <div class="text">
    <div class="by" class:roomy={onMenu}>
      {#if opensPerson}
        <button class="plain" onclick={() => onPerson?.(post.ownerId)}><Byline {name} millis={post.createdAt} gold={post.authorSupporter} /></button>
      {:else}
        <Byline {name} millis={post.createdAt} gold={post.authorSupporter} />
      {/if}
    </div>
    <p class="body">{post.body}</p>
    {#if post.song}
      <p class="song"><i class="icon">{icons.play}</i><span>{songLine(post.song)}</span></p>
    {/if}
    <div class="foot">
      <VoteKeys ups={post.ups} downs={post.downs} mine={post.myVote} enabled={canVote} {onVote} />
      {#if onOpen}
        <button class="plain replies" aria-label={repliesLabel} onclick={() => onOpen?.()}>
          <i class="icon">{icons.comment}</i>{post.replyCount === 0 ? text('Rpm_Profile_Reply') : post.replyCount.toLocaleString()}
        </button>
      {:else}
        <span class="replies" aria-label={repliesLabel}>
          <i class="icon">{icons.comment}</i>{post.replyCount === 0 ? text('Rpm_Profile_Reply') : post.replyCount.toLocaleString()}
        </span>
      {/if}
    </div>
  </div>

  {#if onMenu}
    <button class="plain more" title={text('Common_MoreOptions')} aria-label={text('Common_MoreOptions')} onclick={menu}><i class="icon">{icons.more}</i></button>
  {/if}
</div>

<style>
  .post {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    padding: 12px 14px 2px;
  }

  .opens {
    cursor: pointer;
  }

  .photo {
    align-self: start;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .by {
    display: flex;
    min-width: 0;
  }

  /* Room at the right for the corner key, so a long name ends before it. */
  .by.roomy {
    margin-right: 24px;
  }

  .body {
    margin: 0;
    color: rgb(255 255 255 / 0.9);
    font-size: var(--feed-body);
    line-height: var(--feed-line);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .song {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
    margin: 0;
    color: rgb(255 255 255 / 0.667);
    font-size: var(--feed-meta);
  }

  .song .icon {
    flex: none;
    font-size: 9px;
  }

  .song span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The thumbs start where the text starts; the reply count ends at the card's inner edge. */
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .replies {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    height: 32px;
    padding-left: 8px;
    color: rgb(255 255 255 / 0.8);
    font-size: var(--feed-meta);
  }

  .replies .icon {
    color: rgb(255 255 255 / 0.6);
    font-size: var(--feed-glyph);
  }

  /* In the corner, level with the name; the dots end at the card's inner edge, as the replies do. */
  .more {
    position: absolute;
    top: 6px;
    right: 3px;
    width: 34px;
    height: 28px;
    color: rgb(255 255 255 / 0.667);
    font-size: 13px;
  }
</style>

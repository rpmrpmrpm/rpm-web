<script lang="ts">
  // A scrolling column of feed cards: what stands above the list (a person's page top, the post box), the line that
  // says the list is empty or could not be read, and the cards. The next page is asked for when the foot of the
  // list comes near, or is already on screen.
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';

  import { session } from '../../app';
  import { text } from '../../strings/loc';
  import { feed } from './feed.svelte';
  import type { FeedList } from './feed-list.svelte';
  import PostCard from './PostCard.svelte';
  import ReviewCard from './ReviewCard.svelte';

  // How close to the foot of the list the next page is asked for.
  const MORE_WITHIN = 600;

  let { list, active, top }: { list: FeedList | null; active: boolean; top?: Snippet } = $props();

  let scroller = $state<HTMLElement | null>(null);
  let column = $state<HTMLElement | null>(null);
  const me = $derived(session.user?.userId ?? null);

  // A list behind another page asks for no pages.
  function moreIfShort() {
    if (!active || !list || !scroller || !list.hasMore || list.entries.length === 0) return;
    if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < MORE_WITHIN) void list.more();
  }

  // A page that does not fill the pane gives no scroll to ask for the next one, so a change in the column's height
  // asks too.
  onMount(() => {
    const watch = new ResizeObserver(moreIfShort);
    watch.observe(column!);
    return () => watch.disconnect();
  });
</script>

<div class="scroll" bind:this={scroller} onscroll={moreIfShort}>
  <div class="column" bind:this={column}>
    {@render top?.()}
    {#if list}
      {#if list.quiet}<p class="quiet">{text(list.quiet)}</p>{/if}
      {#each list.entries as entry (entry.key)}
        {@const item = entry.item}
        {#if item.kind === 'post'}
          <PostCard
            post={item.post}
            canVote={item.post.ownerId !== me}
            onVote={(value) => void list.vote(entry.key, value)}
            onPerson={list.everyone ? (id) => feed.openPerson(id) : null}
            onOpen={() => feed.openThread(item.post.ownerId, item.post.postId, item.post)}
            onMenu={list.postMenus && me ? (x, y) => feed.postMenu(list, entry, x, y) : null}
          />
        {:else}
          <ReviewCard
            review={item.review}
            canVote={item.review.userId !== me}
            onVote={(value) => void list.vote(entry.key, value)}
            onRead={() => feed.openReader(list, entry)}
            showAuthor={list.everyone}
            onPerson={list.everyone ? (id) => feed.openPerson(id) : null}
          />
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .scroll {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 7px 16px 40px;
  }
</style>

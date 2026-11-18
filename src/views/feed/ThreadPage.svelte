<script lang="ts">
  // A post with its replies, as the phones open it: the post's card, then every reply in reading order, indented by
  // how deep it answers, and the box to reply to the post at the foot. Reply on a reply opens a box under it. A
  // reply can be voted on, deleted by its author or by the page's owner, and reported by anyone else.
  import type { Reply } from '../../api/community';
  import { community, session } from '../../app';
  import { icons } from '../../design/icons';
  import { DEEPEST_INDENT, threadLines } from '../../social/thread';
  import { text } from '../../strings/loc';
  import { openMenu } from '../menu/menu.svelte';
  import Byline from './Byline.svelte';
  import Composer from './Composer.svelte';
  import Face from './Face.svelte';
  import { feed } from './feed.svelte';
  import type { ThreadView } from './feed-pages.svelte';
  import PostCard from './PostCard.svelte';
  import VoteKeys from './VoteKeys.svelte';

  let { thread }: { thread: ThreadView } = $props();

  const INDENT = 16;

  const me = $derived(session.user?.userId ?? null);
  const lines = $derived(threadLines(thread.postId, thread.replies, thread.opened));
  const indent = (depth: number) => Math.min(depth, DEEPEST_INDENT) * INDENT;

  function menu(event: MouseEvent, reply: Reply) {
    const key = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const mine = reply.userId === me || thread.ownerId === me;
    openMenu(
      [
        mine
          ? { label: text('Rpm_Profile_DeleteReply'), glyph: icons.trash, run: () => void thread.remove(reply) }
          : { label: text('Rpm_Profile_ReportReply'), glyph: icons.flag, run: () => void feed.report((note) => community.reportPost(thread.ownerId, thread.postId, reply.replyId, note)) },
      ],
      key.left,
      key.bottom + 4,
    );
  }
</script>

<div class="scroll">
  <div class="column">
    {#if thread.post}
      {@const post = thread.post}
      <PostCard {post} canVote={post.ownerId !== me} onVote={(value) => void thread.votePost(value)} onPerson={(id) => feed.openPerson(id)} onOpen={null} onMenu={null} />
    {/if}
    {#if thread.quiet}<p class="quiet">{text(thread.quiet)}</p>{/if}

    <div class="lines">
      {#each lines as { reply, depth, hidden } (reply.replyId)}
        {@const name = reply.authorDeleted ? text('Community_DeletedUser') : reply.authorName}
        <div class="reply" style:margin-left="{indent(depth)}px">
          {#if reply.authorDeleted}
            <span class="photo"><Face userId={null} hasAvatar={false} {name} size={28} /></span>
          {:else}
            <button class="plain photo" aria-label={name} onclick={() => feed.openPerson(reply.userId)}><Face userId={reply.userId} hasAvatar={reply.hasAvatar} {name} size={28} /></button>
          {/if}
          <div class="text">
            {#if reply.authorDeleted}
              <Byline {name} millis={reply.createdAt} gold={false} />
            {:else}
              <button class="plain by" onclick={() => feed.openPerson(reply.userId)}><Byline {name} millis={reply.createdAt} gold={reply.authorSupporter} /></button>
            {/if}
            {#if reply.deleted}
              <p class="gone">{text('Rpm_Profile_ReplyDeleted')}</p>
            {:else}
              <p class="body">{reply.body}</p>
              <div class="foot">
                <VoteKeys ups={reply.ups} downs={reply.downs} mine={reply.myVote} enabled={me !== null && reply.userId !== me} onVote={(value) => void thread.voteReply(reply.replyId, value)} />
                {#if me}<button class="plain answer" onclick={() => thread.toggleAnswer(reply.replyId)}>{text('Rpm_Profile_Reply')}</button>{/if}
              </div>
            {/if}
          </div>
          {#if me && !reply.deleted}
            <button class="plain more" title={text('Common_MoreOptions')} aria-label={text('Common_MoreOptions')} onclick={(event) => menu(event, reply)}><i class="icon">{icons.more}</i></button>
          {/if}
        </div>
        {#if me && thread.answering === reply.replyId}
          <div style:margin-left="{indent(depth + 1)}px">
            <Composer prompt={text('Rpm_Profile_ReplyPrompt')} offerSong={false} focus onSend={(body) => thread.send(reply.replyId, body)} />
          </div>
        {/if}
        {#if hidden > 0}
          <button class="feed-link more-replies" style:margin-left="{indent(depth + 1) + 38}px" onclick={() => thread.openBranch(reply.replyId)}>
            {hidden === 1 ? text('Rpm_Profile_ShowMoreRepliesOne') : text('Rpm_Profile_ShowMoreReplies', hidden)}
          </button>
        {/if}
      {/each}
      {#if me && thread.loaded}
        <Composer prompt={text('Rpm_Profile_ReplyPrompt')} offerSong={false} onSend={(body) => thread.send(null, body)} />
      {/if}
    </div>
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

  .lines {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .reply {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
  }

  .photo {
    align-self: start;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    padding-right: 26px;
  }

  .by {
    align-self: flex-start;
    max-width: 100%;
  }

  .body,
  .gone {
    margin: 0;
    font-size: var(--feed-body);
    line-height: var(--feed-line);
  }

  .body {
    color: rgb(255 255 255 / 0.9);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .gone {
    color: rgb(255 255 255 / 0.467);
    font-style: italic;
  }

  .foot {
    display: flex;
    align-items: center;
  }

  .answer {
    height: 32px;
    padding: 0 4px;
    color: #fff;
    font-size: var(--feed-body);
    font-weight: 600;
  }

  .more {
    position: absolute;
    top: -4px;
    right: -8px;
    width: 34px;
    height: 28px;
    color: rgb(255 255 255 / 0.667);
    font-size: 13px;
  }

  .more-replies {
    align-self: flex-start;
  }
</style>

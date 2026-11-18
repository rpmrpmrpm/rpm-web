<script lang="ts">
  // The reader's notifications, newest first, as on the phones: who did what, and when. Unread ones are lit. A friend
  // request carries Accept and Decline. Every entry opens what it is about: the post, or the person.
  import type { Notice } from '../../api/community';
  import { session } from '../../app';
  import { badgeOf } from '../../social/badges';
  import { written } from '../../social/written';
  import { text } from '../../strings/loc';
  import Face from './Face.svelte';
  import { feed } from './feed.svelte';
  import type { NoticesView } from './feed-pages.svelte';
  import { insideKey } from './parts';

  let { notices }: { notices: NoticesView } = $props();

  const MORE_WITHIN = 400;

  // What the notification says, in the phones' words.
  function sentence(notice: Notice): string {
    switch (notice.kind) {
      case 'reply':
        return text('Rpm_Notify_Reply', notice.fromName);
      case 'vote':
        return notice.count > 1 ? text('Rpm_Notify_Votes', notice.count) : text('Rpm_Notify_Vote', notice.fromName);
      case 'friendRequest':
        return text('Rpm_Notify_FriendRequest', notice.fromName);
      case 'friendAccepted':
        return text('Rpm_Notify_FriendAccepted', notice.fromName);
      case 'friendReview':
        return text('Rpm_Notify_FriendReview', notice.fromName, notice.albumTitle ?? '');
      case 'badge': {
        const badge = badgeOf(notice.badgeId);
        return text('Rpm_Notify_Badge', badge ? text(badge.name) : (notice.badgeId ?? ''));
      }
    }
  }

  // What a press on the notification opens.
  function open(event: MouseEvent, notice: Notice) {
    if (insideKey(event)) return;
    const me = session.user?.userId ?? '';
    if ((notice.kind === 'reply' || notice.kind === 'vote') && notice.postId) feed.openThread(notice.ownerId || me, notice.postId, null);
    else if (notice.kind === 'badge') feed.openPerson(me);
    else if (notice.fromUserId) feed.openPerson(notice.fromUserId);
  }

  function scrolled(event: Event) {
    const scroller = event.currentTarget as HTMLElement;
    if (notices.hasMore && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < MORE_WITHIN) void notices.more();
  }
</script>

<div class="scroll" onscroll={scrolled}>
  <div class="column">
    <h3 class="title">{text('Rpm_Notify_Title')}</h3>
    {#if notices.quiet}<p class="quiet">{text(notices.quiet)}</p>{/if}
    {#each notices.items as notice (notice.id)}
      <!-- The entry opens what it is about. The same is reached from the post or the person's page, so the card needs no key of its own. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="notice" class:read={notice.read} onclick={(event) => open(event, notice)}>
        <Face userId={notice.fromUserId || null} hasAvatar={notice.fromHasAvatar} name={notice.fromName} size={36} />
        <div class="text">
          <p class="says">{sentence(notice)}</p>
          <p class="when">{written(notice.createdAt)}</p>
          {#if notice.kind === 'friendRequest' && !notices.answered.has(notice.id)}
            <div class="keys">
              <button class="glass-button primary" disabled={notices.sending.has(notice.id)} onclick={() => notices.answer(notice, true)}>{text('Rpm_Profile_Accept')}</button>
              <button class="glass-button" disabled={notices.sending.has(notice.id)} onclick={() => notices.answer(notice, false)}>{text('Rpm_Profile_Decline')}</button>
            </div>
          {/if}
        </div>
      </div>
    {/each}
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
    gap: 8px;
    padding: 7px 16px 40px;
  }

  .title {
    margin: 0 0 4px;
    color: #fff;
    font-size: var(--feed-subject);
    font-weight: 600;
  }

  .notice {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 12px;
    background: rgb(255 255 255 / 0.11);
    cursor: pointer;
  }

  .notice.read {
    border-color: transparent;
    background: rgb(255 255 255 / 0.047);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-self: center;
    min-width: 0;
  }

  p {
    margin: 0;
  }

  .says {
    color: rgb(255 255 255 / 0.95);
    font-size: var(--feed-body);
    line-height: var(--feed-line);
    overflow-wrap: anywhere;
  }

  .read .says {
    color: rgb(255 255 255 / 0.733);
  }

  .when {
    color: rgb(255 255 255 / 0.467);
    font-size: var(--feed-meta);
  }

  .keys {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
</style>

<script lang="ts">
  // The Feed pane: everyone's posts and album reviews, and the pages it opens, stacked (see feed.svelte.ts). Only the
  // top page is shown; the ones under it stay laid out, so each keeps its scroll position. The cards run from the
  // heading's left edge to the same 16 margin at the right, so the column grows with the pane; the room inside a card
  // is the phones'. The text takes the sizes the rest of the app uses for the same kind of text.
  import { onMount } from 'svelte';

  import { session } from '../../app';
  import { icons } from '../../design/icons';
  import { groundPicture, hex, readGround } from '../../social/ground';
  import { text } from '../../strings/loc';
  import Window from '../import/Window.svelte';
  import EditPage from './EditPage.svelte';
  import { feed } from './feed.svelte';
  import FeedColumn from './FeedColumn.svelte';
  import NoticesPage from './NoticesPage.svelte';
  import PersonPage from './PersonPage.svelte';
  import ReviewReader from './ReviewReader.svelte';
  import ThreadPage from './ThreadPage.svelte';

  const me = $derived(session.user?.userId ?? null);
  const top = $derived(feed.top);
  const personOnTop = $derived(top?.kind === 'person' ? top.person : null);

  // What a person's page is drawn on, behind the heading row too, as on the phones: one of the app's backgrounds
  // under a veil, or a solid colour. The standard ground draws nothing, so the pane's glass shows.
  const ground = $derived(readGround(personOnTop?.profile?.pageGround));
  const groundImage = $derived(groundPicture(ground));

  let note = $state('');

  onMount(() => feed.shown());

  function menuAt(event: MouseEvent) {
    const key = (event.currentTarget as HTMLElement).getBoundingClientRect();
    feed.personMenu(key.right - 175, key.bottom + 4);
  }

  // Escape closes the top page, unless it is meant for a box being written in.
  function keyed(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !feed.top || feed.asking) return;
    if ((event.target as Element | null)?.closest('input, textarea')) return;
    event.preventDefault();
    void feed.back();
  }

  function answer(key: string | null) {
    const asking = feed.asking;
    const written = note;
    note = '';
    asking?.answered(key, written);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="feed" onkeydown={keyed}>
  {#if ground.kind === 'colour'}
    <div class="ground" style:background={hex(ground.rgb)}></div>
  {:else if groundImage}
    <div class="ground"><img src={groundImage} alt="" /><span class="veil"></span></div>
  {/if}

  <div class="pane-head head">
    <h2 class="heading">{text(feed.heading)}</h2>
    <div class="head-keys">
      {#if top}
        {#if personOnTop?.profile && me}
          <button class="round" title={text('Rpm_Profile_Menu')} aria-label={text('Rpm_Profile_Menu')} onclick={menuAt}>
            <i class="icon">{icons.more}</i>
            {#if feed.unread > 0 && personOnTop.userId === me}<span class="dot"></span>{/if}
          </button>
        {/if}
        <button class="close" title={text('Window_Close')} aria-label={text('Window_Close')} onclick={() => feed.back()}><i class="icon">{icons.close}</i></button>
      {:else if me}
        <button
          class="round"
          title={text('Rpm_Feed_MyProfile')}
          aria-label={feed.unread > 0 ? text('Rpm_Profile_UnreadCount', feed.unread) : text('Rpm_Feed_MyProfile')}
          onclick={() => feed.openPerson(me)}
        >
          <i class="icon">{icons.artist}</i>
          {#if feed.unread > 0}<span class="dot"></span>{/if}
        </button>
      {/if}
    </div>
  </div>

  {#if feed.trouble}<p class="trouble" role="alert">{text(feed.trouble)}</p>{/if}

  <div class="pages">
    <div class="page" class:under={top !== null} inert={top !== null}>
      <FeedColumn list={feed.everyone} active={top === null} />
    </div>
    {#each feed.pages as page (page.id)}
      <div class="page" class:under={page !== top} inert={page !== top}>
        {#if page.kind === 'person'}
          <PersonPage person={page.person} active={page === top} />
        {:else if page.kind === 'thread'}
          <ThreadPage thread={page.thread} />
        {:else if page.kind === 'review'}
          <ReviewReader {page} entry={page.entry} list={page.list} album={page.album} />
        {:else if page.kind === 'notices'}
          <NoticesPage notices={page.notices} />
        {:else}
          <EditPage draft={page.draft} />
        {/if}
      </div>
    {/each}
  </div>
</div>

{#if feed.asking}
  {@const asking = feed.asking}
  <Window title={asking.title} glyph={asking.glyph} minWidth={420} maxWidth={540} minHeight={260} openHeight={asking.note ? 400 : 300} onClose={() => answer(null)}>
    {#if asking.says}<p class="says">{asking.says}</p>{/if}
    {#if asking.note}
      <!-- svelte-ignore a11y_autofocus -->
      <textarea class="field note" rows="5" maxlength="2000" spellcheck="true" autofocus placeholder={asking.note.placeholder} aria-label={asking.says} bind:value={note}></textarea>
    {/if}
    {#snippet footer()}
      {#each asking.keys as key (key.answer)}
        <button class="glass-button" class:primary={key.tone === 'primary'} class:danger={key.tone === 'danger'} onclick={() => answer(key.answer)}>
          <i class="icon">{key.glyph}</i>{key.label}
        </button>
      {/each}
    {/snippet}
  </Window>
{/if}

<style>
  /* The Feed's text sizes: those the rest of the app uses for the same kind of text, as the desktop's FeedType. */
  .feed {
    --feed-gold: #ebc65a;
    --feed-title: 18px;
    --feed-subject: 14px;
    --feed-section: 12px;
    --feed-name: 12px;
    --feed-body: 12px;
    --feed-line: 18px;
    --feed-meta: 11px;
    --feed-glyph: 11px;
    --feed-stars: 12px;
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .ground {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .ground img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .veil {
    position: absolute;
    inset: 0;
    background: rgb(0 0 0 / 0.25);
  }

  .head {
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }

  /* The keys are centred on the heading's letters, not on its 36 box: the letters' middle is 13 down, and a 32 key
     with its top at -3 has its middle there too. */
  .head-keys {
    display: flex;
    gap: 8px;
    margin-top: -3px;
  }

  .round,
  .close {
    position: relative;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    color: rgb(255 255 255 / 0.933);
    cursor: pointer;
  }

  .round {
    border-radius: 50%;
    background: rgb(255 255 255 / 0.122);
    font-size: 14px;
  }

  .close {
    background: none;
    color: rgb(255 255 255 / 0.867);
    font-size: 15px;
  }

  @media (hover: hover) {
    .round:hover {
      background: rgb(255 255 255 / 0.2);
    }

    .close:hover {
      color: #fff;
    }
  }

  /* Notifications wait: a red dot on the key's corner, as on the phones. */
  .dot {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ff3b30;
  }

  .trouble {
    position: relative;
    margin: 4px 16px 0;
    color: var(--error);
    font-size: var(--feed-body);
  }

  .pages {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .page {
    position: absolute;
    inset: 0;
  }

  .page.under {
    visibility: hidden;
  }

  .says {
    margin: 0;
    color: var(--text-soft);
    font-size: 13px;
    line-height: 1.5;
  }

  .note {
    flex: none;
    resize: vertical;
  }

  /* What the cards and pages share. Only .feed gives these weight, so a component's own rules for the same element
     always win, and these still win over the page's rules for bare elements. */
  :global(.feed :where(.card)) {
    border-radius: 12px;
    background: rgb(255 255 255 / 0.071);
  }

  :global(.feed :where(.plain)) {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: inherit;
    cursor: pointer;
  }

  :global(.feed :where(.quiet)) {
    margin: 0;
    color: rgb(255 255 255 / 0.533);
    font-size: var(--feed-body);
  }

  /* A line of text that acts, as the desktop's RpmLink: cyan, no box, and it dims on press. */
  :global(.feed :where(.feed-link)) {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: var(--feed-body);
    cursor: pointer;
  }

  :global(.feed :where(.feed-link):active) {
    opacity: 0.6;
  }
</style>

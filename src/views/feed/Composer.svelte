<script lang="ts">
  // The box a post or a reply is written in, as on the phones: the text, the Post key at its right, and for a post
  // "Add the song I'm playing" while something plays. Post can be pressed while there is text and nothing is being
  // sent. A failed send keeps the text and says so under the box.
  import { onMount } from 'svelte';

  import { LONGEST_POST, type Song } from '../../api/community';
  import { playingNow } from '../../app';
  import { text } from '../../strings/loc';
  import { songLine } from './parts';

  let {
    prompt,
    onSend,
    offerSong,
    focus = false,
  }: {
    prompt: string;
    // Sends the text, with the song when it was asked for. Answers whether it was sent; the box is emptied only then.
    onSend: (body: string, song: Song | null) => Promise<boolean>;
    // Offer to add the song playing (posts only).
    offerSong: boolean;
    // Put the caret in the box when it opens (a reply under a reply).
    focus?: boolean;
  } = $props();

  let body = $state('');
  let sending = $state(false);
  let failed = $state(false);
  let withSong = $state(false);
  // What plays changes while the page is open, so it is read again when the box takes the caret.
  let song = $state<Song | null>(playingNow()?.song ?? null);
  let box = $state<HTMLTextAreaElement | null>(null);

  const canSend = $derived(!sending && body.trim().length > 0);

  onMount(() => {
    if (focus) box?.focus();
  });

  // The box grows with what is written, up to its tallest.
  function grow() {
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight}px`;
  }

  async function send() {
    const said = body.trim();
    if (!canSend) return;
    sending = true;
    failed = false;
    const sent = await onSend(said, offerSong && withSong ? (playingNow()?.song ?? null) : null);
    sending = false;
    if (sent) {
      body = '';
      withSong = false;
      queueMicrotask(grow);
    } else {
      failed = true;
    }
  }
</script>

<div class="composer">
  <div class="row">
    <textarea
      bind:this={box}
      bind:value={body}
      class="words"
      rows="1"
      maxlength={LONGEST_POST}
      spellcheck="true"
      placeholder={prompt}
      aria-label={prompt}
      oninput={grow}
      onfocus={() => (song = playingNow()?.song ?? null)}
    ></textarea>
    <button class="glass-button primary" disabled={!canSend} onclick={send}>{text('Rpm_Profile_Post')}</button>
  </div>
  {#if offerSong && song}
    <label class="song">
      <span class="words-of">
        <span>{text('Rpm_Profile_WithSong')}</span>
        <small>{songLine(song)}</small>
      </span>
      <input type="checkbox" bind:checked={withSong} />
    </label>
  {/if}
  {#if failed}<p class="trouble" role="alert">{text('Rpm_Profile_SendFailed')}</p>{/if}
</div>

<style>
  .composer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 8px 8px 14px;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 14px;
    background: rgb(255 255 255 / 0.078);
  }

  .row {
    display: flex;
    gap: 10px;
    align-items: flex-end;
  }

  .words {
    flex: 1;
    min-width: 0;
    max-height: 140px;
    padding: 7px 0;
    border: 0;
    background: none;
    color: #fff;
    font-size: var(--feed-body);
    line-height: var(--feed-line);
    resize: none;
    outline: none;
  }

  .words::placeholder {
    color: var(--text-faint);
  }

  .song {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    padding-right: 6px;
    cursor: pointer;
  }

  .words-of {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    color: rgb(255 255 255 / 0.7);
    font-size: var(--feed-body);
  }

  .words-of small {
    overflow: hidden;
    color: rgb(255 255 255 / 0.467);
    font-size: var(--feed-meta);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trouble {
    margin: 0;
    color: rgb(255 255 255 / 0.667);
    font-size: var(--feed-body);
  }
</style>

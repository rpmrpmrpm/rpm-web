<script lang="ts">
  // Send feedback, as the desktop's window has it, without the screenshot: a page cannot take one of itself.
  import { api, session } from '../../app';
  import { icons } from '../../design/icons';
  import { sendFeedback } from '../../report/report';
  import { text } from '../../strings/loc';
  import Window from '../import/Window.svelte';

  let { onClose }: { onClose: () => void } = $props();

  const KINDS = [
    ['problem', 'Feedback_KindProblem', 'Feedback_PlaceholderProblem'],
    ['idea', 'Feedback_KindIdea', 'Feedback_PlaceholderIdea'],
  ] as const;
  const AREAS = [
    ['other', 'Feedback_AreaOther'],
    ['playback', 'Feedback_AreaPlayback'],
    ['library', 'Feedback_AreaLibrary'],
    ['artwork', 'Feedback_AreaArtwork'],
    ['cloud', 'Feedback_AreaCloud'],
    ['interface', 'Feedback_AreaInterface'],
  ] as const;

  let kind = $state<'problem' | 'idea'>('problem');
  let area = $state<string>('other');
  let message = $state('');
  let note = $state('');
  let sent = $state(false);
  let busy = $state(false);

  const placeholder = $derived(text(KINDS.find(([value]) => value === kind)![2]));

  async function send(event: SubmitEvent) {
    event.preventDefault();
    if (!message.trim()) {
      note = text('Feedback_NeedWords');
      return;
    }
    busy = true;
    note = '';
    sent = await sendFeedback(api, { kind, area, message: message.trim(), replyTo: session.user?.email ?? null });
    busy = false;
    if (!sent) note = text('Feedback_Failed');
  }
</script>

<Window title={text('Feedback_Title')} glyph={icons.bug} maxWidth={620} openHeight={sent ? 340 : 600} {onClose}>
  {#if sent}
    <p>{text('Feedback_Sent')}</p>
  {:else}
    <form id="feedback" onsubmit={send}>
      <p>{text('Feedback_Body')}</p>
      <label>
        <span>{text('Feedback_KindLabel')}</span>
        <select class="field" bind:value={kind}>
          {#each KINDS as [value, label]}<option {value}>{text(label)}</option>{/each}
        </select>
      </label>
      <label>
        <span>{text('Feedback_AreaLabel')}</span>
        <select class="field" bind:value={area}>
          {#each AREAS as [value, label]}<option {value}>{text(label)}</option>{/each}
        </select>
      </label>
      <textarea class="field" rows="5" maxlength="4000" aria-label={placeholder} {placeholder} bind:value={message}></textarea>
      {#if session.user?.email}<p class="dim">{text('Feedback_RepliesTo', session.user.email)}</p>{/if}
      {#if note}<p class="note" role="alert">{note}</p>{/if}
    </form>
  {/if}

  {#snippet footer()}
    {#if sent}
      <button class="glass-button primary" onclick={onClose}><i class="icon">{icons.check}</i>{text('Settings_Close')}</button>
    {:else}
      <button class="glass-button" type="button" onclick={onClose}><i class="icon">{icons.close}</i>{text('Common_Cancel')}</button>
      <button class="glass-button primary" type="submit" form="feedback" disabled={busy}><i class="icon">{icons.bug}</i>{text('Feedback_Send')}</button>
    {/if}
  {/snippet}
</Window>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  p {
    margin: 0;
    font-size: 13px;
  }

  .dim {
    color: rgb(255 255 255 / 0.6);
    font-size: 12px;
  }

  .note {
    color: var(--error);
  }

  label span {
    display: block;
    margin-bottom: 4px;
    color: rgb(255 255 255 / 0.6);
    font-size: 12px;
  }

  textarea {
    resize: vertical;
  }

</style>

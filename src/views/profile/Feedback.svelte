<script lang="ts">
  // Send feedback, as the desktop's dialog has it, without a screenshot: a page cannot take one of itself.
  import { api, session } from '../../app';
  import { sendFeedback } from '../../report/report';
  import { text } from '../../strings/loc';

  let { onBack }: { onBack: () => void } = $props();

  const AREAS = [
    ['playback', 'Feedback_AreaPlayback'],
    ['library', 'Feedback_AreaLibrary'],
    ['artwork', 'Feedback_AreaArtwork'],
    ['cloud', 'Feedback_AreaCloud'],
    ['interface', 'Feedback_AreaInterface'],
    ['other', 'Feedback_AreaOther'],
  ] as const;

  let kind = $state<'problem' | 'idea'>('problem');
  let area = $state<string>('other');
  let message = $state('');
  let note = $state('');
  let sent = $state(false);
  let busy = $state(false);

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

<h2 class="heading">{text('Feedback_Title')}</h2>

{#if sent}
  <p>{text('Feedback_Sent')}</p>
  <button class="glass-button" onclick={onBack}>{text('Rpm_Profile_Account')}</button>
{:else}
  <p class="soft">{text('Feedback_Body')}</p>
  <form onsubmit={send}>
    <div class="kinds" role="radiogroup" aria-label={text('Feedback_KindLabel')}>
      <label><input type="radio" bind:group={kind} value="problem" /> {text('Feedback_KindProblem')}</label>
      <label><input type="radio" bind:group={kind} value="idea" /> {text('Feedback_KindIdea')}</label>
    </div>
    <select class="field" aria-label={text('Feedback_AreaLabel')} bind:value={area}>
      {#each AREAS as [value, label]}
        <option {value}>{text(label)}</option>
      {/each}
    </select>
    <textarea class="field" rows="7" placeholder={text(kind === 'problem' ? 'Feedback_PlaceholderProblem' : 'Feedback_PlaceholderIdea')} bind:value={message}></textarea>
    {#if session.user?.email}<p class="soft">{text('Feedback_RepliesTo', session.user.email)}</p>{/if}
    {#if note}<p class="note" role="alert">{note}</p>{/if}
    <div class="keys">
      <button class="glass-button primary" type="submit" disabled={busy}>{text('Feedback_Send')}</button>
      <button class="glass-button" type="button" onclick={onBack}>{text('Common_Cancel')}</button>
    </div>
  </form>
{/if}

<style>
  p {
    margin: 0;
    font-size: 13.5px;
  }

  .soft {
    color: var(--text-soft);
    font-size: 12.5px;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font-size: 13.5px;
  }

  textarea {
    height: auto;
    min-height: 140px;
    padding-block: 8px;
    resize: vertical;
    font: inherit;
  }

  .note {
    color: var(--error);
  }

  .keys {
    display: flex;
    gap: 10px;
  }
</style>

<script lang="ts">
  // The menu, in the desktop's order with its marks: from the deck on a computer, and under the settings on
  // a phone, which has no deck.
  import { HELP, PRIVACY, session, TERMS } from '../../app';
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';

  let { onSettings, onFeedback, onAbout, onLeave = () => {} }: { onSettings?: () => void; onFeedback: () => void; onAbout: () => void; onLeave?: () => void } = $props();

  const pick = (run: () => void) => () => {
    onLeave();
    run();
  };
</script>

<div class="items">
  {#if onSettings}
    <button onclick={pick(onSettings)}><i class="icon">{icons.settings}</i>{text('Settings_Title')}</button>
    <hr />
  {/if}
  <a href={HELP} target="_blank" rel="noopener" onclick={onLeave}><i class="icon">{icons.help}</i>{text('Shell_Help')}</a>
  <button onclick={pick(onFeedback)}><i class="icon">{icons.bug}</i>{text('Shell_Feedback')}</button>
  <a href={PRIVACY} target="_blank" rel="noopener" onclick={onLeave}><i class="icon">{icons.shield}</i>{text('Shell_Privacy')}</a>
  <a href={TERMS} target="_blank" rel="noopener" onclick={onLeave}><i class="icon">{icons.file}</i>{text('Shell_Terms')}</a>
  <button onclick={pick(onAbout)}><i class="icon">{icons.info}</i>{text('About_Title')}</button>
  <hr />
  <button onclick={() => session.signOut()}><i class="icon">{icons.signOut}</i>{text('Login_SignOut')}</button>
</div>

<style>
  .items {
    display: flex;
    flex-direction: column;
  }

  button,
  a {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 7px 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: #fff;
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  .icon {
    width: 14px;
    color: rgb(255 255 255 / 0.8);
    font-size: 12px;
    text-align: center;
  }

  button:hover,
  a:hover {
    background: rgb(255 255 255 / 0.1);
  }

  hr {
    width: 100%;
    margin: 4px 0;
    border: 0;
    border-top: 1px solid var(--hairline);
  }
</style>

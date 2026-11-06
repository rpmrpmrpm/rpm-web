<script lang="ts">
  import { session } from '../../app';
  import { text } from '../../strings/loc';
  import Card from './Card.svelte';

  let { onBack }: { onBack: () => void } = $props();

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let code = $state('');
  let waitingForCode = $state(false);
  let message = $state('');
  let busy = $state(false);

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      message = text('SignUp_NeedFields');
      return;
    }
    busy = true;
    message = '';
    const refused = await session.signUp(name, email, password);
    busy = false;
    if (refused) message = text(refused);
    else waitingForCode = true;
  }

  async function confirm(event: SubmitEvent) {
    event.preventDefault();
    if (!code.trim()) {
      message = text('SignUp_NeedCode');
      return;
    }
    busy = true;
    message = '';
    const refused = await session.confirmSignUp(email, code);
    if (refused) {
      busy = false;
      message = text(refused);
      return;
    }
    const failed = await session.signIn(email, password);
    busy = false;
    if (failed) message = text(failed);
  }

  async function resend() {
    message = text((await session.resendCode(email)) ?? 'SignUp_CodeResent');
  }
</script>

<Card title={text('SignUp_Button')}>
  {#if waitingForCode}
    <p class="subtitle">{text('SignUp_CodeSent', email)}</p>
    <form onsubmit={confirm}>
      <input class="field" inputmode="numeric" autocomplete="one-time-code" placeholder={text('SignUp_Code')} bind:value={code} />
      {#if message}<p class="message" role="alert">{message}</p>{/if}
      <button class="glass-button primary" type="submit" disabled={busy}>{text('SignUp_Confirm')}</button>
    </form>
    <button class="link" onclick={resend}>{text('SignUp_Resend')}</button>
  {:else}
    <p class="subtitle">{text('SignUp_Subtitle')}</p>
    <form onsubmit={create}>
      <input class="field" autocomplete="name" placeholder={text('SignUp_Name')} bind:value={name} />
      <input class="field" type="email" autocomplete="username" placeholder={text('Login_Email')} bind:value={email} />
      <input class="field" type="password" autocomplete="new-password" placeholder={text('Login_Password')} bind:value={password} />
      <p class="rule">{text('SignUp_PasswordRule')}</p>
      {#if message}<p class="message" role="alert">{message}</p>{/if}
      <button class="glass-button primary" type="submit" disabled={busy}>{text('SignUp_Create')}</button>
    </form>
    <button class="link" onclick={onBack}>{text('Login_SignIn')}</button>
  {/if}
</Card>

<style>
  p {
    margin: 0;
  }

  .subtitle,
  .rule {
    color: var(--text-soft);
    font-size: 13px;
    line-height: 1.5;
  }

  .rule {
    color: var(--text-faint);
    font-size: 12px;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .message {
    color: var(--error);
    font-size: 13px;
  }
</style>

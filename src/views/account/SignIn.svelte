<script lang="ts">
  import { BETA_FORM, FORGOT_PASSWORD, session, signUpOpen } from '../../app';
  import { text } from '../../strings/loc';
  import Card from './Card.svelte';

  let { onSignUp }: { onSignUp: () => void } = $props();

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      error = text('Login_NeedFields');
      return;
    }
    busy = true;
    error = '';
    const refused = await session.signIn(email, password);
    busy = false;
    if (refused) error = text(refused);
  }

  async function social(provider: 'Apple' | 'Google') {
    busy = true;
    error = '';
    const refused = await session.startSocialSignIn(provider);
    if (refused) {
      busy = false;
      error = text(refused);
    }
  }

  const forgot = $derived(`${FORGOT_PASSWORD}?email=${encodeURIComponent(email.trim())}`);
</script>

<Card title={text('Login_Title')}>
  <p class="subtitle">{text('Login_Subtitle')}</p>

  <p class="label">{text('Login_ContinueWith')}</p>
  <div class="providers">
    <!-- Apple comes first and the two are equal, as the store rules for the apps require. -->
    <button class="glass-button" disabled={busy} onclick={() => social('Apple')}>
      <span class="mark">&#xf179;</span>{text('Login_Apple')}
    </button>
    <button class="glass-button" disabled={busy} onclick={() => social('Google')}>
      <span class="mark">&#xf1a0;</span>{text('Login_Google')}
    </button>
  </div>

  <div class="or"><span>{text('Login_Or')}</span></div>

  <form onsubmit={signIn}>
    <input class="field" type="email" autocomplete="username" placeholder={text('Login_Email')} bind:value={email} />
    <input class="field" type="password" autocomplete="current-password" placeholder={text('Login_Password')} bind:value={password} />
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="glass-button primary" type="submit" disabled={busy}>{text('Login_SignIn')}</button>
  </form>

  <div class="foot">
    <a class="link" href={forgot}>{text('Login_Forgot')}</a>
    {#if signUpOpen}
      <button class="link" onclick={onSignUp}>{text('SignUp_Button')}</button>
    {/if}
  </div>

  {#if !signUpOpen}
    <p class="note">{text('Web_BetaClosed')} <a class="link" href={BETA_FORM}>{text('Web_BetaApply')}</a></p>
  {/if}
</Card>

<style>
  p {
    margin: 0;
  }

  .subtitle {
    color: var(--text-soft);
    font-size: 13px;
    text-align: center;
  }

  .label {
    color: var(--text-faint);
    font-size: 11px;
    letter-spacing: 0.085em;
    text-align: center;
  }

  .providers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .mark {
    margin-right: 10px;
    font: 400 16px 'FA Brands';
  }

  .or {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-faint);
    font-size: 12px;
  }

  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--hairline);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .error {
    color: var(--error);
    font-size: 13px;
  }

  .foot {
    display: flex;
    justify-content: space-between;
  }

  .note {
    color: var(--text-soft);
    font-size: 13px;
    line-height: 1.5;
  }
</style>

<script lang="ts">
  import { forgetCode, keptCode } from '../../api/beta-code';
  import { BETA_FORM, session } from '../../app';
  import { text } from '../../strings/loc';
  import BecomeSupporter from '../profile/BecomeSupporter.svelte';
  import Card from './Card.svelte';

  let code = $state(keptCode());
  let error = $state('');
  let busy = $state(false);

  async function redeem() {
    if (!code.trim()) {
      error = text('SignUp_NeedCode');
      return;
    }
    busy = true;
    error = '';
    const refused = await session.redeemCode(code);
    busy = false;
    if (refused) error = text(refused);
    else forgetCode();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    void redeem();
  }

  // Someone who came by the mail's link has nothing to type.
  if (keptCode()) void redeem();
</script>

<Card title={text('Web_CodeTitle')}>
  <p class="subtitle">{text('Web_BetaClosed')}</p>
  <form onsubmit={submit}>
    <input class="field" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder={text('SignUp_Code')} bind:value={code} />
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="glass-button primary" type="submit" disabled={busy}>{text('SignUp_Confirm')}</button>
  </form>
  <div class="support">
    <p class="subtitle">{text('Web_BetaSupporter')}</p>
    <BecomeSupporter kind="glass-button" />
  </div>
  <div class="foot">
    <a class="link" href={BETA_FORM}>{text('Web_BetaApply')}</a>
    <button class="link" onclick={() => session.signOut()}>{text('Login_SignOut')}</button>
  </div>
</Card>

<style>
  p {
    margin: 0;
  }

  .subtitle {
    color: var(--text-soft);
    font-size: 13px;
    line-height: 1.5;
    text-align: center;
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

  .support {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .foot {
    display: flex;
    justify-content: space-between;
  }
</style>

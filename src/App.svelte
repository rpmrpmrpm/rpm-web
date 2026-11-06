<script lang="ts">
  import { keptCode } from './api/beta-code';
  import { admitted, session } from './app';
  import { text } from './strings/loc';
  import EnterCode from './views/account/EnterCode.svelte';
  import SignIn from './views/account/SignIn.svelte';
  import SignUp from './views/account/SignUp.svelte';
  import Shell from './views/shell/Shell.svelte';

  let current = $state(session.state);
  let isIn = $state(admitted());
  session.onChange(() => {
    current = session.state;
    isIn = admitted();
  });

  // Someone who came by the mail's link is new here.
  let signingUp = $state(keptCode() !== '');
</script>

{#if current === 'signed-in' && isIn}
  <Shell />
{:else if current === 'signed-in'}
  <EnterCode />
{:else if current === 'unreachable'}
  <main>
    <p>{text('Rpm_Net_Offline')}</p>
    <button class="glass-button" onclick={() => session.restore()}>{text('Rpm_Library_Retry')}</button>
  </main>
{:else if current === 'signed-out' && signingUp}
  <SignUp onBack={() => (signingUp = false)} />
{:else if current === 'signed-out'}
  <SignIn onSignUp={() => (signingUp = true)} />
{/if}

<style>
  main {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
    min-height: 100dvh;
    padding: 16px;
  }

  p {
    margin: 0;
  }
</style>

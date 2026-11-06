<script lang="ts">
  import { session } from './app';
  import { text } from './strings/loc';
  import SignIn from './views/account/SignIn.svelte';
  import SignUp from './views/account/SignUp.svelte';
  import Signed from './views/Signed.svelte';

  let current = $state(session.state);
  session.onChange(() => (current = session.state));

  let signingUp = $state(false);
</script>

{#if current === 'signed-in'}
  <Signed />
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

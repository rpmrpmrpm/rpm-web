<script lang="ts">
  // One member of a band: a round photograph over their name. Until it comes, and where there is none, the
  // circle carries their initials.
  import { artistArt } from '../../app';
  import type { BandMember } from '../../library/dossier';

  let { member }: { member: BandMember } = $props();

  let photo = $state<string | null>(null);

  $effect(() => {
    const name = member.name;
    let current = true;
    photo = null;
    void artistArt.photo(name).then((url) => {
      if (current) photo = url;
    });
    return () => {
      current = false;
    };
  });

  const initials = $derived(
    member.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join(''),
  );
</script>

<div class="member">
  <span class="face" class:gone={member.hasDied}>
    {#if photo}<img src={photo} alt="" />{:else}{initials}{/if}
  </span>
  <small>{member.name}</small>
</div>

<style>
  .member {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    width: 88px;
  }

  .face {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    overflow: hidden;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.18);
    font-size: 18px;
  }

  .face img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  small {
    width: 100%;
    font-size: 11px;
    line-height: 14px;
    text-align: center;
    overflow-wrap: anywhere;
  }
</style>

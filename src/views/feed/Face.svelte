<script lang="ts">
  // A person's photo in a circle, or the first letter of their name while they have none. A supporter's ring is
  // gold.
  import { faces } from '../../app';

  let {
    userId,
    hasAvatar,
    stamp = 0,
    name,
    size,
    ring = 'none',
    picture = undefined,
  }: {
    // Null for a deleted account, which shows the letter only.
    userId: string | null;
    hasAvatar: boolean;
    // The avatarUpdatedAt where the answer carries it, so a changed photo has a new address; 0 where it does not.
    stamp?: number;
    name: string;
    size: number;
    ring?: 'none' | 'plain' | 'gold';
    // A picture to show in place of the stored one (a photo just picked on the edit page); null shows the letter.
    picture?: string | null;
  } = $props();

  let photo = $state<string | null>(null);

  $effect(() => {
    if (picture !== undefined) {
      photo = picture;
      return;
    }
    const [id, has, at] = [userId, hasAvatar, stamp];
    let current = true;
    photo = null;
    if (id && has)
      void faces.avatar(id, at).then((url) => {
        if (current) photo = url;
      });
    return () => {
      current = false;
    };
  });

  const letter = $derived(name ? name.charAt(0).toLocaleUpperCase() : '?');
</script>

<span class="face {ring}" style:--size="{size}px">
  <span class="letter" aria-hidden="true">{letter}</span>
  {#if photo}<img src={photo} alt="" />{/if}
</span>

<style>
  .face {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: rgb(255 255 255 / 0.149);
  }

  .letter {
    color: rgb(255 255 255 / 0.867);
    font-size: calc(var(--size) * 0.42);
    font-weight: 600;
    line-height: 1;
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .face.plain::after,
  .face.gold::after {
    position: absolute;
    inset: 0;
    border: 2px solid rgb(255 255 255 / 0.2);
    border-radius: 50%;
    content: '';
    pointer-events: none;
  }

  .face.gold::after {
    border: 3px solid var(--feed-gold);
  }
</style>

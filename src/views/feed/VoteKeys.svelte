<script lang="ts">
  // Thumbs up with the likes beside it, thumbs down with the dislikes, as on the phones. The reader's own vote is
  // lit, and a press on it takes the vote back. On the reader's own post or review the counts are shown and cannot
  // be pressed: nobody votes on their own.
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';

  let {
    ups,
    downs,
    mine,
    enabled,
    onVote,
  }: {
    ups: number;
    downs: number;
    // 1, -1 or 0.
    mine: number;
    enabled: boolean;
    // 1 up, -1 down, 0 to take the vote back.
    onVote: (value: number) => void;
  } = $props();
</script>

<span class="votes">
  <button class="key" class:lit={mine === 1} disabled={!enabled} aria-label={text('Rpm_Profile_Likes', ups)} aria-pressed={mine === 1} onclick={() => onVote(mine === 1 ? 0 : 1)}>
    <i class="icon">{icons.thumbsUp}</i>{ups.toLocaleString()}
  </button>
  <button class="key down" class:lit={mine === -1} disabled={!enabled} aria-label={text('Rpm_Profile_Dislikes', downs)} aria-pressed={mine === -1} onclick={() => onVote(mine === -1 ? 0 : -1)}>
    <i class="icon">{icons.thumbsDown}</i>{downs.toLocaleString()}
  </button>
</span>

<style>
  .votes {
    display: inline-flex;
    align-items: center;
  }

  .key {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    height: 32px;
    padding: 0 8px 0 0;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.6);
    font-size: var(--feed-meta);
    cursor: pointer;
  }

  .key.down {
    padding-left: 8px;
  }

  .key .icon {
    font-size: var(--feed-glyph);
  }

  .key.lit {
    color: rgb(255 255 255 / 0.933);
  }

  .key.lit .icon {
    color: #fff;
  }

  .key:disabled {
    cursor: default;
  }

  @media (hover: hover) {
    .key:not(:disabled):hover {
      color: #fff;
    }
  }
</style>

<script lang="ts">
  // What the Import pane shows in place of the list while an import runs, as the desktop's FolderProgressAnimation
  // with its filing art: notes drop into a folder, one every 0.8 s, and the folder bumps as each goes in. Under it
  // are the caption, a slim bar and the "n / total files" count. The sizes, colours and timings are the desktop's.
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';

  let { caption, through, total, note }: { caption: string; through: number; total: number; note: string } = $props();

  const share = $derived(total > 0 ? Math.min(1, through / total) : 0);

  // Each note: where it starts and lands across, its size, its white, and when it starts in the loop.
  const NOTES = [
    { from: -26, to: -10, size: 38, white: 0.95, delay: 0 },
    { from: 14, to: 4, size: 29, white: 0.8, delay: 0.8 },
    { from: 34, to: 18, size: 23, white: 0.6, delay: 1.6 },
  ];
</script>

<div class="filing">
  <div class="art" aria-hidden="true">
    <svg class="folder" viewBox="0 0 640 640">
      <defs>
        <linearGradient id="filing-folder" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0b84e0" />
          <stop offset="0.5" stop-color="#0371d0" />
          <stop offset="1" stop-color="#014680" />
        </linearGradient>
      </defs>
      <path
        fill="url(#filing-folder)"
        d="M128 512L512 512C547.3 512 576 483.3 576 448L576 208C576 172.7 547.3 144 512 144L362.7 144C355.8 144 349 141.8 343.5 137.6L305.1 108.8C294 100.5 280.5 96 266.7 96L128 96C92.7 96 64 124.7 64 160L64 448C64 483.3 92.7 512 128 512z"
      />
    </svg>
    {#each NOTES as note}
      <i
        class="icon note"
        style:--from="{note.from}px"
        style:--to="{note.to}px"
        style:font-size="{note.size}px"
        style:color="rgb(255 255 255 / {note.white})"
        style:animation-delay="{note.delay}s">{icons.music}</i
      >
    {/each}
  </div>

  <div class="words">
    <p class="caption">{caption}</p>
    <div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={through} aria-label={caption}>
      <span style:width="{share * 100}%"></span>
    </div>
    <p class="count">{text('Analyze_Progress', through, total)}</p>
    <p class="note-line">{note}</p>
  </div>
</div>

<style>
  .filing {
    display: grid;
    gap: 24px;
    place-content: center;
    justify-items: center;
    padding: 16px;
  }

  .art {
    display: grid;
    place-items: center;
    width: 240px;
    height: 180px;
  }

  .art > * {
    grid-area: 1 / 1;
  }

  /* The desktop draws the 640 square into a 160 by 120 box, so it is 120 high. */
  .folder {
    width: 120px;
    height: 120px;
    animation: bump 2.4s infinite;
  }

  .note {
    opacity: 0;
    transform: translate(var(--from), -70px);
    animation: drop 2.4s infinite backwards;
  }

  @keyframes drop {
    0% {
      opacity: 0;
      transform: translate(var(--from), -70px);
      animation-timing-function: ease-in-out;
    }
    6.25% {
      opacity: 1;
    }
    22.92% {
      opacity: 1;
    }
    29.17% {
      opacity: 0;
      transform: translate(var(--to), -4px);
    }
    100% {
      opacity: 0;
      transform: translate(var(--to), -4px);
    }
  }

  @keyframes bump {
    0%,
    25%,
    39.58%,
    72.92%,
    100% {
      transform: scale(1);
      animation-timing-function: ease-in-out;
    }
    31.25%,
    64.58%,
    97.92% {
      transform: scale(1.05);
      animation-timing-function: ease-in-out;
    }
  }

  .words {
    display: grid;
    gap: 10px;
    justify-items: center;
    min-width: 220px;
    margin-top: -4px;
  }

  p {
    margin: 0;
    text-align: center;
  }

  .caption {
    max-width: 260px;
    color: rgb(255 255 255 / 0.8);
    font-size: 13px;
  }

  .bar {
    overflow: hidden;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.15);
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: #0b84e0;
    transition: width 0.2s ease-out;
  }

  .count {
    color: rgb(255 255 255 / 0.8);
    font-size: 13px;
    font-weight: 600;
  }

  .note-line {
    max-width: 260px;
    color: rgb(255 255 255 / 0.6);
    font-size: 12px;
  }

  @media (prefers-reduced-motion: reduce) {
    .folder,
    .note {
      animation: none;
    }
  }
</style>

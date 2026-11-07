<script lang="ts">
  // The index down the right edge of the artist wall: A to Z, then everything else. A letter with no act under
  // it is faint and does nothing.
  let { letters, lit, onPick }: { letters: ReadonlySet<string>; lit: string; onPick: (letter: string) => void } = $props();

  const ALL = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

  function drag(event: PointerEvent) {
    if (event.buttons !== 1) return;
    const letter = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.dataset.letter;
    if (letter && letters.has(letter)) onPick(letter);
  }
</script>

<div class="rail" role="presentation" onpointermove={drag}>
  {#each ALL as letter}
    <button class:lit={letter === lit} disabled={!letters.has(letter)} data-letter={letter} aria-label={letter} onclick={() => onPick(letter)}>{letter}</button>
  {/each}
</div>

<style>
  .rail {
    position: absolute;
    top: 50%;
    right: 2px;
    display: flex;
    flex-direction: column;
    transform: translateY(-50%);
    touch-action: none;
  }

  button {
    width: 20px;
    height: 16.5px;
    padding: 0;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.6);
    font: inherit;
    font-size: 10.5px;
    cursor: pointer;
  }

  button:disabled {
    color: rgb(255 255 255 / 0.2);
    cursor: default;
  }

  button.lit {
    color: #fff;
    font-weight: 700;
  }
</style>

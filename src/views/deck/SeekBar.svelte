<script lang="ts">
  // The seek bar: a thin track, with a press or a drag anywhere on it.
  let { seconds, duration, onSeek }: { seconds: number; duration: number; onSeek: (seconds: number) => void } = $props();

  let bar: HTMLDivElement;
  let dragging = $state<number | null>(null);

  const position = $derived(dragging ?? seconds);
  const fraction = $derived(duration > 0 ? Math.min(position / duration, 1) : 0);

  const time = (value: number) => {
    const total = Math.max(0, Math.floor(value));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  function at(event: PointerEvent): number {
    const box = bar.getBoundingClientRect();
    return Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1) * duration;
  }

  function down(event: PointerEvent) {
    if (!duration) return;
    bar.setPointerCapture(event.pointerId);
    dragging = at(event);
  }

  function up(event: PointerEvent) {
    if (dragging === null) return;
    dragging = null;
    onSeek(at(event));
  }
</script>

<div class="seek">
  <div
    class="bar"
    bind:this={bar}
    role="slider"
    tabindex="0"
    aria-valuemin="0"
    aria-valuemax={Math.round(duration)}
    aria-valuenow={Math.round(position)}
    onpointerdown={down}
    onpointermove={(event) => dragging !== null && (dragging = at(event))}
    onpointerup={up}
    onpointercancel={() => (dragging = null)}
  >
    <div class="track"></div>
    <div class="fill" style:width="{fraction * 100}%"></div>
    <div class="knob" style:left="{fraction * 100}%"></div>
  </div>
  <span class="time">{time(position)}</span>
  <span class="time total">{time(duration)}</span>
</div>

<style>
  .seek {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    column-gap: 10px;
  }

  .bar {
    position: relative;
    grid-column: 1 / -1;
    height: 20px;
    cursor: pointer;
    touch-action: none;
  }

  .track,
  .fill {
    position: absolute;
    top: 8px;
    left: 0;
    height: 3px;
    border-radius: 2px;
  }

  .track {
    right: 0;
    background: rgb(255 255 255 / 0.2);
  }

  .fill {
    background: #fff;
  }

  .knob {
    position: absolute;
    top: 4px;
    width: 11px;
    height: 11px;
    margin-left: -5px;
    border-radius: 50%;
    background: #fff;
  }

  .time {
    color: var(--text-soft);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .total {
    text-align: right;
  }
</style>

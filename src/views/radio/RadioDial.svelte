<script lang="ts">
  // The tuning dial, as RadioDial on the desktop: the readout, the band with a mark for each station, and the needle.
  // The band's width decides how many stations get a name, and it scrolls when they do not all fit. Dragging the
  // needle moves through the band, and letting go tunes.
  import { callSign, displayOf, type RadioStation } from '../../radio/station';
  import StationLogo from './StationLogo.svelte';

  let { stations, tuned, status, reconnecting, onTune }: {
    stations: RadioStation[];
    tuned: RadioStation | null;
    status: string;
    reconnecting: boolean;
    onTune: (station: RadioStation) => void;
  } = $props();

  const DIAL_HEIGHT = 176;
  const READOUT_BOTTOM = 54;
  const SCALE_SPAN = 16;
  const POINTER_RISE = 13;
  const NAME_SIZE = 9;
  const NAME_LINE = 11;
  const NAME_GAP = 7;
  const SQUARE_SIZE = 6.5;
  const SQUARE_GAP = 4;
  const SQUARE_SLOT = SQUARE_GAP + SQUARE_SIZE;
  const MOST_ROWS = 6;
  const NAME_CHAR_WIDTH = NAME_SIZE * 0.7;
  const MOST_SCREENS = 6;
  const SCROLL_MARGIN = 56;
  const SIDE = 16;

  let width = $state(0);
  let dragIndex = $state<number | null>(null);
  let dragX = $state<number | null>(null);
  let scroll = $state(0);

  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

  const index = $derived(dragIndex ?? (tuned ? stations.findIndex((row) => row.uuid === tuned.uuid) : -1));
  const selected = $derived(index >= 0 ? (stations[index] ?? null) : null);

  // Where everything goes, for this many stations at this width.
  const laid = $derived.by(() => {
    const count = stations.length;
    const room = Math.max(0, DIAL_HEIGHT - 8 - READOUT_BOTTOM);
    const maxRows = clamp(Math.floor((room - POINTER_RISE - SCALE_SPAN) / NAME_LINE), 1, MOST_ROWS);
    const captions = stations.map((row) => callSign(displayOf(row)));
    const widths = captions.map((caption) => Math.max(8, caption.length * NAME_CHAR_WIDTH));
    const ink = widths.reduce((sum, wide) => sum + wide + SQUARE_SLOT + NAME_GAP, 0);
    const scaleWidth = clamp(ink / maxRows + 32, width, Math.max(width, width * MOST_SCREENS));
    const inset = Math.max(1, scaleWidth - 32);
    const pitch = count > 0 ? inset / count : 0;
    const perStation = count > 0 && pitch >= 4;
    const tickCount = perStation ? count : Math.max(8, Math.floor(inset / 11));
    const at = (fraction: number) => SIDE + clamp(fraction, 0, 1) * inset;
    const fraction = (row: number) => (count <= 0 ? 0.5 : (row + 0.5) / count);

    const placed: { station: number; row: number }[] = [];
    let rows = 0;
    if (perStation) {
      const rowEnd = new Array<number>(maxRows).fill(-Infinity);
      for (let station = 0; station < count; station++) {
        const mark = at(fraction(station));
        const left = mark - SQUARE_SIZE / 2 - SQUARE_GAP - widths[station]!;
        for (let row = 0; row < maxRows; row++) {
          if (left < rowEnd[row]!) continue;
          rowEnd[row] = mark + SQUARE_SIZE / 2 + NAME_GAP;
          placed.push({ station, row });
          rows = Math.max(rows, row + 1);
          break;
        }
      }
    }

    const names = rows * NAME_LINE;
    const block = POINTER_RISE + names + SCALE_SPAN;
    const namesTop = READOUT_BOTTOM + Math.max(0, (room - block) / 2) + POINTER_RISE;
    const scaleTop = namesTop + names;
    const scaleBottom = scaleTop + SCALE_SPAN;
    const needleTop = namesTop - 3;
    return { count, captions, widths, scaleWidth, inset, perStation, tickCount, at, fraction, placed, namesTop, scaleBottom, needleTop, needleHeight: scaleBottom - needleTop + 2 };
  });

  const range = $derived(Math.max(0, laid.scaleWidth - width));

  $effect(() => {
    void stations;
    scroll = 0;
  });

  const scaleX = $derived(index >= 0 ? laid.at(laid.fraction(index)) : laid.at(0));

  // Keeps the tuned station in sight when it changes from outside the dial.
  $effect(() => {
    if (dragIndex !== null || index < 0 || range <= 0) return;
    const margin = Math.min(SCROLL_MARGIN, width / 3);
    const onGlass = scaleX + scroll;
    if (onGlass < margin) scroll = clamp(margin - scaleX, -range, 0);
    else if (onGlass > width - margin) scroll = clamp(width - margin - scaleX, -range, 0);
  });

  const needle = $derived(dragX ?? scaleX + clamp(scroll, -range, 0));

  function dragTo(x: number) {
    if (range > 0) {
      const margin = Math.min(SCROLL_MARGIN, width / 4);
      const over = x < margin ? margin - x : x > width - margin ? width - margin - x : 0;
      if (over) scroll = clamp(scroll + over * 0.25, -range, 0);
    }
    const fraction = clamp((x - scroll - SIDE) / laid.inset, 0, 1);
    dragIndex = clamp(Math.floor(fraction * stations.length), 0, stations.length - 1);
    dragX = clamp(x, 0, width);
  }

  const inside = (event: PointerEvent) => event.clientX - (event.currentTarget as HTMLElement).getBoundingClientRect().left;

  function pressed(event: PointerEvent) {
    if (!stations.length) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragTo(inside(event));
  }

  function moved(event: PointerEvent) {
    if (dragIndex !== null) dragTo(inside(event));
  }

  function released() {
    const landed = dragIndex === null ? null : stations[dragIndex];
    dragIndex = null;
    dragX = null;
    if (landed) onTune(landed);
  }

  function wheeled(event: WheelEvent) {
    if (range <= 0) return;
    event.preventDefault();
    scroll = clamp(scroll - (event.deltaY || event.deltaX) * 0.4, -range, 0);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="dial" class:held={dragIndex !== null} bind:clientWidth={width} onpointerdown={pressed} onpointermove={moved} onpointerup={released} onpointercancel={released} onwheel={wheeled}>
  {#if width > 0}
    <div class="scale" style:width="{laid.scaleWidth}px" style:transform="translateX({scroll}px)">
      {#each { length: laid.tickCount } as _, tick}
        {@const lit = laid.perStation && tick === index}
        {@const major = tick % 5 === 0}
        {@const height = SCALE_SPAN * (lit ? 1 : major ? 0.62 : 0.36)}
        <span
          class="tick"
          class:lit
          style:left="{laid.at(laid.perStation ? laid.fraction(tick) : (tick + 0.5) / laid.tickCount) - 0.5}px"
          style:top="{laid.scaleBottom - height}px"
          style:height="{height}px"
          style:opacity={lit ? 1 : major ? 0.55 : 0.28}
        ></span>
      {/each}
      {#each laid.placed as { station, row } (station)}
        {@const mark = laid.at(laid.fraction(station))}
        {@const top = laid.namesTop + row * NAME_LINE}
        {@const lit = station === index}
        <span class="square" class:lit style:left="{mark - SQUARE_SIZE / 2}px" style:top="{top + (NAME_LINE - SQUARE_SIZE) / 2}px"></span>
        <span class="label" class:lit style:left="{mark - SQUARE_SIZE / 2 - SQUARE_GAP - laid.widths[station]!}px" style:top="{top}px" style:width="{laid.widths[station]}px">{laid.captions[station]}</span>
      {/each}
    </div>

    <div class="readout">
      {#if selected}<StationLogo station={selected} size={26} />{/if}
      <div class="words">
        {#if selected}<strong>{displayOf(selected)}</strong>{/if}
        <span>{status}</span>
      </div>
    </div>

    <div class="needle" class:lost={reconnecting} style:transform="translateX({needle}px)" style:top="{laid.needleTop}px" style:--tall="{laid.needleHeight}px">
      <i class="glow"></i>
      <i class="line"></i>
      <svg viewBox="-6 -1 12 9" width="12" height="9" aria-hidden="true"><polyline points="-5,0 0,7 5,0" /></svg>
    </div>
  {/if}
</div>

<style>
  .dial {
    position: relative;
    flex: none;
    height: 176px;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.13);
    border-radius: 10px;
    background: linear-gradient(rgb(0 20 34 / 0.22), rgb(4 80 112 / 0.19) 55%, rgb(0 10 20 / 0.27));
    cursor: ew-resize;
    touch-action: pan-y;
    user-select: none;
  }

  .scale {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    pointer-events: none;
  }

  .tick {
    position: absolute;
    width: 1px;
    background: #c8eeff;
  }

  .tick.lit,
  .square.lit {
    background: var(--accent);
  }

  .square {
    position: absolute;
    width: 6.5px;
    height: 6.5px;
    background: #a8d4ee;
    opacity: 0.7;
  }

  .square.lit {
    opacity: 1;
  }

  .label {
    position: absolute;
    color: #ddf2ff;
    font-size: 9px;
    letter-spacing: 0.06em;
    line-height: 11px;
    text-align: right;
    white-space: nowrap;
    opacity: 0.62;
  }

  .label.lit {
    color: var(--accent);
    opacity: 1;
  }

  .readout {
    position: absolute;
    top: 8px;
    right: 12px;
    left: 12px;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    pointer-events: none;
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding-top: 2px;
  }

  .words strong,
  .words span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .words strong {
    color: rgb(255 255 255 / 0.95);
    font-size: 14px;
    font-weight: 600;
  }

  .words span {
    color: rgb(255 255 255 / 0.6);
    font-size: 11.5px;
  }

  .needle {
    --needle: var(--accent);
    position: absolute;
    left: 0;
    width: 0;
    pointer-events: none;
    transition: transform 260ms cubic-bezier(0.33, 1, 0.68, 1);
  }

  .held .needle {
    transition: none;
  }

  .needle.lost {
    --needle: #ffa82b;
  }

  .needle .line,
  .needle .glow {
    position: absolute;
    top: 0;
    display: block;
    height: var(--tall);
    border-radius: 4px;
    background: var(--needle);
  }

  .needle .line {
    left: -1px;
    width: 2px;
  }

  .needle .glow {
    top: -2px;
    left: -4.5px;
    width: 9px;
    height: calc(var(--tall) + 4px);
    opacity: 0.2;
  }

  .needle svg {
    position: absolute;
    top: -13px;
    left: -6px;
    overflow: visible;
  }

  polyline {
    fill: none;
    stroke: var(--needle);
    stroke-linejoin: round;
    stroke-width: 2;
  }
</style>

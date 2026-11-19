<script lang="ts">
  // The size slider in a library heading: a small box, the slider, and a big box. The albums, artists and genres
  // headings use it, so all three look the same. `onchange` runs when the slider is let go, to keep the size.
  let {
    value = $bindable(),
    min,
    max,
    label,
    onchange,
  }: { value: number; min: number; max: number; label: string; onchange: () => void } = $props();
</script>

<span class="size" title={label}>
  <i class="small"></i>
  <input class="slim" style:--fill="{((value - min) / (max - min)) * 100}%" type="range" {min} {max} step="2" aria-label={label} bind:value {onchange} />
  <i class="big"></i>
</span>

<style>
  .size {
    display: flex;
    gap: 7px;
    align-items: center;
  }

  .size i {
    display: block;
    flex: none;
    background: rgb(255 255 255 / 0.6);
  }

  .small {
    width: 6.5px;
    height: 7px;
  }

  .big {
    width: 10.5px;
    height: 12px;
  }

  .slim {
    width: 96px;
    height: 14px;
    margin: 0;
    background: none;
    appearance: none;
    cursor: pointer;
  }

  .slim::-webkit-slider-runnable-track {
    height: 3px;
    background: linear-gradient(to right, #fff var(--fill, 0%), rgb(255 255 255 / 0.25) var(--fill, 0%));
  }

  .slim::-moz-range-track {
    height: 3px;
    background: rgb(255 255 255 / 0.25);
  }

  .slim::-moz-range-progress {
    height: 3px;
    background: #fff;
  }

  .slim::-webkit-slider-thumb {
    width: 3px;
    height: 14px;
    margin-top: -5.5px;
    border: 0;
    border-radius: 0;
    background: #fff;
    appearance: none;
  }

  .slim::-moz-range-thumb {
    width: 3px;
    height: 14px;
    border: 0;
    border-radius: 0;
    background: #fff;
  }
</style>

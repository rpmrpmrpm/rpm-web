<script lang="ts">
  // The equaliser: on or off, a named curve, ten bands and a pre-amp. A change is heard from the position
  // the track is at, because what is already buffered was made with the old curve.
  import { player } from '../../app';
  import { EQ_BANDS, EQ_PRESETS, MAX_GAIN_DB } from '../../audio/equalizer.js';
  import { text } from '../../strings/loc';

  let settings = $state(player.equalizer);

  const hertz = (band: number) => (band >= 1000 ? `${band / 1000}k` : String(band));
  const presetOf = () => EQ_PRESETS.findIndex(([, bands]) => (bands as number[]).every((gain, index) => gain === settings.bands[index]));

  function apply() {
    player.setEqualizer($state.snapshot(settings));
  }

  function pick(index: number) {
    settings.bands = [...(EQ_PRESETS[index]![1] as number[])];
    apply();
  }

  function flat() {
    settings.bands = new Array(EQ_BANDS.length).fill(0);
    settings.preamp = 0;
    apply();
  }
</script>

<div class="equalizer">
  <div class="head">
    <label class="on"><input type="checkbox" bind:checked={settings.on} onchange={apply} /> {text('Settings_EqOn')}</label>
    <select aria-label={text('Settings_EqPreset')} value={presetOf()} onchange={(event) => pick(Number(event.currentTarget.value))}>
      {#if presetOf() < 0}<option value={-1}>{text('Settings_EqPreset')}</option>{/if}
      {#each EQ_PRESETS as [key], index}<option value={index}>{text(key as string)}</option>{/each}
    </select>
    <button class="tool" onclick={flat}>{text('Settings_EqReset')}</button>
  </div>

  <div class="bands" class:off={!settings.on}>
    <label>
      <input type="range" aria-label={text('Settings_EqPre')} min={-MAX_GAIN_DB} max={MAX_GAIN_DB} step="0.5" bind:value={settings.preamp} onchange={apply} />
      <span>{text('Settings_EqPre')}</span>
    </label>
    {#each EQ_BANDS as band, index}
      <label>
        <input type="range" aria-label={`${band} Hz`} min={-MAX_GAIN_DB} max={MAX_GAIN_DB} step="0.5" bind:value={settings.bands[index]} onchange={apply} />
        <span>{hertz(band)}</span>
      </label>
    {/each}
  </div>
</div>

<style>
  .equalizer {
    display: grid;
    gap: 12px;
    width: min(420px, 100%);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    font-size: 12.5px;
  }

  .on {
    flex: 1;
    white-space: nowrap;
  }

  select {
    height: 28px;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    background: rgb(0 0 0 / 0.15);
    font-size: 12px;
  }

  .bands {
    display: grid;
    grid-template-columns: repeat(11, minmax(0, 1fr));
    gap: 2px;
  }

  .bands.off {
    opacity: 0.45;
  }

  .bands label {
    display: grid;
    justify-items: center;
    gap: 4px;
  }

  .bands input {
    width: 20px;
    height: 110px;
    accent-color: #fff;
    writing-mode: vertical-lr;
    direction: rtl;
  }

  .bands span {
    color: var(--text-soft);
    font-size: 9.5px;
  }
</style>

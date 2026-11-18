<script lang="ts">
  // A badge under a person's name: its name in italics on a pill in the badge's colour, lit along a diagonal band,
  // as the phones and the desktop draw it.
  import { badgeColour } from '../../social/badges';

  let { name, colour }: { name: string; colour: string } = $props();

  const mix = (from: number[], to: number, share: number) => from.map((value) => Math.round(value + (to - value) * share));
  const rgba = (rgb: number[], alpha: number) => `rgb(${rgb.join(' ')} / ${alpha})`;

  const base = $derived(badgeColour(colour));
  const dark = $derived(mix(base, 0, 0.35));
  const light = $derived(mix(base, 255, 0.55));
  const face = $derived(
    `linear-gradient(to top right, ${rgba(dark, 0.55)} 0%, ${rgba(base, 0.6)} 30%, ${rgba(light, 0.7)} 42%, ${rgba(base, 0.6)} 52%, ${rgba(dark, 0.55)} 100%)`,
  );
  const rim = $derived(`linear-gradient(to top right, ${rgba(base, 0.7)} 0%, ${rgba(light, 1)} 45%, ${rgba(base, 0.7)} 100%)`);
  const ink = $derived(rgba(mix(base, 255, 0.8), 1));
</script>

<span class="pill" style:--face={face} style:--rim={rim} style:color={ink}>{name}</span>

<style>
  .pill {
    display: inline-block;
    padding: 3px 14px;
    border: 1px solid transparent;
    border-radius: 14px;
    background:
      var(--face) padding-box,
      var(--rim) border-box;
    font-size: var(--feed-body);
    font-style: italic;
    line-height: 18px;
  }
</style>

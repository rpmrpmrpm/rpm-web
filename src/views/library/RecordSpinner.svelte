<script lang="ts">
  // The wait, shown as a record turning, as the desktop's RecordSpinner. It stands where something is being
  // fetched from the web: what is being waited for is a record, so the mark is a record. Drawn in the app's own
  // glass, translucent whites over whatever is behind, at the size the caller gives it.
  let { size = 34 }: { size?: number } = $props();
</script>

<svg class="spinner" viewBox="0 0 100 100" width={size} height={size} role="img" aria-hidden="true">
  <defs>
    <linearGradient id="rpm-disc" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.24" />
      <stop offset="0.45" stop-color="#fff" stop-opacity="0.12" />
      <stop offset="1" stop-color="#fff" stop-opacity="0.08" />
    </linearGradient>
    <linearGradient id="rpm-edge" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.55" />
      <stop offset="0.5" stop-color="#fff" stop-opacity="0.15" />
      <stop offset="1" stop-color="#fff" stop-opacity="0.37" />
    </linearGradient>
    <linearGradient id="rpm-shine" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0" />
      <stop offset="0.34" stop-color="#fff" stop-opacity="0" />
      <stop offset="0.54" stop-color="#fff" stop-opacity="0.37" />
      <stop offset="0.74" stop-color="#fff" stop-opacity="0" />
      <stop offset="1" stop-color="#fff" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="rpm-label" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.3" />
      <stop offset="1" stop-color="#fff" stop-opacity="0.12" />
    </linearGradient>
  </defs>

  <!-- The disc, lit from the top left as everywhere else in the window, and its edge. -->
  <circle cx="50" cy="50" r="50" fill="url(#rpm-disc)" />
  <circle cx="50" cy="50" r="49.5" fill="none" stroke="url(#rpm-edge)" stroke-width="1" />

  <!-- Grooves. Real grooves are round, so their turning cannot be seen: they stay still. -->
  {#each [44.5, 40, 35.5, 31, 26.5] as radius, index (radius)}
    <circle cx="50" cy="50" r={radius} fill="none" stroke="#fff" stroke-opacity={index % 2 ? 0.08 : 0.12} stroke-width="0.75" />
  {/each}

  <!-- What turns: the light on the rim and the label, with off-centre light so the turning shows. -->
  <g class="turning">
    <circle cx="50" cy="50" r="44" fill="none" stroke="url(#rpm-shine)" stroke-width="6" />
    <circle cx="50" cy="50" r="17.5" fill="url(#rpm-label)" stroke="#fff" stroke-opacity="0.3" stroke-width="1" />
  </g>

  <!-- The spindle hole, at the centre and still. -->
  <circle cx="50" cy="50" r="2" fill="#0b111a" fill-opacity="0.4" stroke="#fff" stroke-opacity="0.2" stroke-width="0.5" />
</svg>

<style>
  .spinner {
    display: block;
    flex: none;
  }

  /* Thirty-three and a third turns a minute, the speed an LP turns at. */
  .turning {
    transform-origin: 50px 50px;
    animation: turn 1.8s linear infinite;
  }

  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .turning {
      animation-duration: 6s;
    }
  }
</style>

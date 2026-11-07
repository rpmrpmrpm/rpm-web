<script lang="ts">
  // The room behind the panes: dark blue at rest, and the colour of the record while one is playing.
  import type { CloudAlbum } from '../../library/albums';
  import { catalogue, covers } from '../../app';
  import { colourOf, css, type Colour } from '../../library/colour';
  import { now, room } from '../../state.svelte';

  let colour = $state<Colour | null>(null);

  $effect(() => {
    const track = now.track;
    const album: CloudAlbum | undefined = room.album ?? catalogue.albums.find((a) => a.tracks.some((t) => t.rpmId === track?.rpmId));
    if (!album) {
      colour = null;
      return;
    }
    let current = true;
    void covers.url(album, 256).then(async (url) => {
      const found = url ? await colourOf(url) : null;
      if (current) colour = found;
    });
    return () => {
      current = false;
    };
  });
</script>

<div class="room" style:--wash={room.colour ?? (colour ? css(colour, 0.55) : '#0a2a54')}></div>

<style>
  /* A registered colour, because a gradient itself cannot be animated. */
  @property --wash {
    syntax: '<color>';
    inherits: false;
    initial-value: #0a2a54;
  }

  .room {
    position: fixed;
    inset: 0;
    transition: --wash 420ms var(--move);
    background:
      radial-gradient(90% 70% at 85% 0%, color-mix(in srgb, var(--wash) 80%, transparent), transparent 70%),
      radial-gradient(80% 80% at 0% 100%, color-mix(in srgb, var(--wash) 45%, transparent), transparent 70%),
      #05070c;
  }
</style>

<script lang="ts">
  // The room behind the panes, as the desktop's ShellGround: the app's backdrop picture (see backdrop.svelte.ts)
  // when nothing lends the room a colour, and the colour of the page that is open, or of the record that is
  // playing, when something does. The colour fades in over the picture and back out, so there is no gap
  // between the two in which the window's own black shows.
  import type { CloudAlbum } from '../../library/albums';
  import { catalogue, covers, session } from '../../app';
  import { backdrop } from '../../design/backdrop.svelte';
  import { colourOf, css, type Colour } from '../../library/colour';
  import { now, room } from '../../state.svelte';

  let colour = $state<Colour | null>(null);
  let supporter = $state(session.user?.supporter === true);
  session.onChange(() => (supporter = session.user?.supporter === true));

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

  const wash = $derived(room.colour ?? (colour ? css(colour, 0.55) : null));
  // Kept after the colour goes, so the wash fades out in its own colour rather than in a default one.
  let shown = $state('#0a2a54');
  $effect(() => {
    if (wash) shown = wash;
  });
</script>

<div class="room">
  <div class="picture" style:background-image="url({backdrop.picture(supporter)})"></div>
  <div class="wash" class:on={!!wash} style:--wash={shown}></div>
</div>

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
    background: #05070c;
  }

  .picture {
    position: absolute;
    inset: 0;
    background-position: center;
    background-size: cover;
  }

  .wash {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition:
      opacity 420ms var(--move),
      --wash 420ms var(--move);
    background:
      radial-gradient(90% 70% at 85% 0%, color-mix(in srgb, var(--wash) 80%, transparent), transparent 70%),
      radial-gradient(80% 80% at 0% 100%, color-mix(in srgb, var(--wash) 45%, transparent), transparent 70%),
      #05070c;
  }

  .wash.on {
    opacity: 1;
  }
</style>

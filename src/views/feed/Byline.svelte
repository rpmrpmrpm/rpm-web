<script lang="ts">
  // A name and when it wrote. A supporter's name is gold.
  import { written } from '../../social/written';

  let { name, millis, gold }: { name: string; millis: number; gold: boolean } = $props();
</script>

<span class="byline">
  <span class="name" class:gold>{name}</span>
  <span class="when">{written(millis)}</span>
</span>

<style>
  .byline {
    display: inline-flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
    max-width: 100%;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    color: #fff;
    font-size: var(--feed-name);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.gold {
    color: var(--feed-gold);
  }

  .when {
    flex: none;
    color: rgb(255 255 255 / 0.467);
    font-size: var(--feed-meta);
    white-space: nowrap;
  }
</style>

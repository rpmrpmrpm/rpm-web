<script lang="ts">
  // The mark beside a supporter's name: a heart and the word, struck in gold (the desktop's SupporterBadge).
  // Gold is used nowhere else in rpm, so it means one thing wherever it appears. It is the gold of the
  // supporter's backdrop. There is no "not a supporter" mark: for everybody else nothing is drawn.
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';

  let { word = text('Rpm_Profile_PlanSupporter') }: { word?: string } = $props();
</script>

<span class="badge"><i class="icon">{icons.heart}</i>{word}</span>

<style>
  .badge {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    align-self: flex-start;
    padding: 2px 8px;
    border: 1px solid transparent;
    border-radius: 9px;
    background:
      linear-gradient(45deg, rgb(154 106 24 / 0.23), rgb(239 175 18 / 0.27) 30%, rgb(235 208 122 / 0.45) 42%, rgb(239 175 18 / 0.27) 52%, rgb(154 106 24 / 0.22)) padding-box,
      linear-gradient(45deg, rgb(185 139 30 / 0.4), rgb(235 208 122 / 0.8) 45%, rgb(185 139 30 / 0.4)) border-box;
    color: #f2dc9a;
    font-size: 10px;
    line-height: 14px;
  }

  .icon {
    font-size: 9px;
  }
</style>

<script lang="ts">
  // The box of one tag field, drawn as the catalogue says: a short box for a number, a list for a choice, a box
  // with suggestions for a genre, a box a line for each person of a credit, and a text area for a comment.
  // The value is always the text in the box (see readField and writeField).
  import { icons } from '../../design/icons';
  import { soloistEntries, type TagField } from '../../library/tag-fields';
  import { text } from '../../strings/loc';

  let {
    tag,
    value = $bindable(),
    placeholder = '',
    disabled = false,
    suggestions = [],
    oninput,
  }: {
    tag: TagField;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    suggestions?: readonly string[];
    oninput?: () => void;
  } = $props();

  const list = `suggest-${Math.random().toString(36).slice(2)}`;
  // A short box is made wider when it shows a placeholder, so the words still fit, as the desktop does.
  const width = $derived.by(() => {
    const base = tag.width === 'tiny' ? 46 : tag.width === 'narrow' ? 66 : 0;
    return base ? `${base + (placeholder ? 52 : 0)}px` : null;
  });

  function typed(event: Event & { currentTarget: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement }) {
    let next = event.currentTarget.value;
    if (tag.numeric) {
      next = next.replace(/\D/g, '');
      if (next !== event.currentTarget.value) event.currentTarget.value = next;
    }
    value = next;
    oninput?.();
  }

  // A credit, one person a line. The value stays one string, the lines joined with "; ".
  let lines = $state<string[]>(['']);
  $effect.pre(() => {
    if (!tag.lines) return;
    const entries = soloistEntries(value);
    if (entries.join('; ') !== lines.filter((line) => line.trim()).join('; ')) lines = entries.length ? entries : [''];
  });

  function line(index: number, next: string) {
    lines[index] = next;
    value = lines.map((entry) => entry.trim()).filter(Boolean).join('; ');
    oninput?.();
  }
</script>

{#if tag.options}
  <select class="field" {disabled} value={value ?? ''} onchange={typed} aria-label={text(tag.label)}>
    <option value="">{text('Tag_Clear')}</option>
    {#each tag.options.filter((option) => option.value) as option (option.value)}
      <option value={option.value}>{text(option.label)}</option>
    {/each}
  </select>
{:else if tag.multiline}
  <textarea class="field" rows="4" {disabled} {placeholder} value={value ?? ''} oninput={typed} aria-label={text(tag.label)}></textarea>
{:else if tag.lines}
  <div class="lines">
    {#each lines as entry, index (index)}
      <div class="line">
        <input class="field" {disabled} placeholder={index === 0 ? placeholder : ''} value={entry} oninput={(event) => line(index, event.currentTarget.value)} aria-label={text(tag.label)} />
        {#if index === lines.length - 1}
          <button class="add" type="button" {disabled} title={text(tag.label)} aria-label={text(tag.label)} onclick={() => (lines = [...lines, ''])}><i class="icon">{icons.plus}</i></button>
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <input
    class="field"
    style:width
    {disabled}
    {placeholder}
    value={value ?? ''}
    inputmode={tag.numeric ? 'numeric' : undefined}
    list={suggestions.length ? list : undefined}
    oninput={typed}
    aria-label={text(tag.label)}
  />
  {#if suggestions.length}
    <datalist id={list}>
      {#each suggestions as suggestion (suggestion)}<option value={suggestion}></option>{/each}
    </datalist>
  {/if}
{/if}

<style>
  .field:disabled {
    opacity: 0.45;
  }

  textarea.field {
    resize: vertical;
  }

  .lines {
    display: grid;
    flex: 1;
    gap: 6px;
  }

  .line {
    display: flex;
    gap: 6px;
  }

  .add {
    display: grid;
    flex: none;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid rgb(255 255 255 / 0.09);
    border-radius: 4px;
    background: rgb(255 255 255 / 0.1);
    color: #fff;
    font-size: 10px;
    cursor: pointer;
  }

  .add:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>

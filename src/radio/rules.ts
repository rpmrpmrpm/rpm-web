// What has been decided about stations: which not to show, and which are shown with another name or tags. Asked for at
// most once an hour. A failed read changes nothing, which is the safe reading.

import type { Api } from '../api/http';
import { genresOf, type StationEdit } from './station';
import { isGenre, NO_RULES, type StationRules } from './results';

const FRESH_MS = 3_600_000;

interface StateSaid {
  logos?: string;
  hidden?: string[];
  edits?: Record<string, { name?: string | null; tags?: string[] | null; description?: string | null }>;
}

function editOf(said: { name?: string | null; tags?: string[] | null; description?: string | null }): StationEdit | null {
  const name = said.name?.trim() || null;
  const tags = [...new Set((said.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  const description = said.description?.trim() || null;
  return name || tags.length || description ? { name, tags: tags.length ? tags : null, description } : null;
}

export class RadioRules {
  rules: StationRules = NO_RULES;
  logoStamp = '';
  private askedAt = -Infinity;

  constructor(
    private readonly api: Pick<Api, 'json'>,
    private readonly now: () => number = Date.now,
  ) {}

  async refresh() {
    if (this.now() - this.askedAt < FRESH_MS) return;
    this.askedAt = this.now();
    try {
      const said = await this.api.json('radio/state', (raw) => raw as StateSaid);
      const edits = new Map<string, StationEdit>();
      for (const [uuid, wire] of Object.entries(said.edits ?? {})) {
        const edit = editOf(wire);
        if (edit) edits.set(uuid.trim().toLowerCase(), edit);
      }
      this.rules = { hidden: new Set((said.hidden ?? []).map((uuid) => uuid.toLowerCase())), edits };
      this.logoStamp = said.logos ?? '';
    } catch {
      // Nothing has changed, as far as anybody here knows.
    }
  }

  // The stations the admin filed under a genre their own tags do not name.
  retagged(genre: string): string[] {
    return [...this.rules.edits.entries()].filter(([, edit]) => edit.tags && isGenre(genresOf(edit.tags), genre)).map(([uuid]) => uuid).sort();
  }
}

// The Feed: everyone's posts and album reviews, newest first, as on the phones' Feed tab, and the pages it opens on
// top of it: a person's page, a post with its replies, a review read in full, the notifications, and the edit
// page. The pages stack, and the key at the right of the heading closes the top one. Held here and not in the
// pane, so the stack stays while the pane is put away, and the wide pane and the phone tab show the same one.
//
// What arrives out of order, beyond what each list and page keeps (FeedList, ThreadView, NoticesView):
// - A person's profile answering after their page was closed: the answer is dropped when its page is no longer
//   in the stack.
// - The unread count answering after the notifications page marked everything read: the count is taken only when
//   it was asked after the last mark (markedRead).
// - A close pressed twice while the edit page asks whether to apply: closing holds the second press until the
//   first is answered.

import type { Person, Post } from '../../api/community';
import { badgeReporter, community, session } from '../../app';
import { icons } from '../../design/icons';
import type { CloudAlbum } from '../../library/albums';
import { ownCopy } from '../../social/feed-covers';
import { library } from '../../state.svelte';
import { text } from '../../strings/loc';
import { asked } from '../library/record-menu.svelte';
import { openMenu, type MenuEntry } from '../menu/menu.svelte';
import { FeedList, type FeedEntry } from './feed-list.svelte';
import { EditDraft, NoticesView, PersonView, ThreadView } from './feed-pages.svelte';

// How many entries a page of everyone's feed asks for, as on the phones.
const PAGE_SIZE = 20;

// A feed shown again within this time is not read again; the unread count likewise.
const FRESH_MS = 60_000;

// How long a line about a failed send stays.
const TROUBLE_MS = 6000;

export type Page =
  | { id: number; kind: 'person'; person: PersonView }
  | { id: number; kind: 'thread'; thread: ThreadView }
  | { id: number; kind: 'review'; entry: FeedEntry; list: FeedList; album: CloudAlbum | null }
  | { id: number; kind: 'notices'; notices: NoticesView }
  | { id: number; kind: 'edit'; draft: EditDraft; person: PersonView };

// A page before the stack numbers it.
type Unnumbered = Page extends infer One ? (One extends Page ? Omit<One, 'id'> : never) : never;

// A question in a window over the app: what it says, an optional note to write, and its keys. The answer is the key
// pressed, or null when the window was closed.
export interface Asking {
  title: string;
  glyph: string;
  says: string;
  note?: { placeholder: string };
  keys: { label: string; glyph: string; tone: 'primary' | 'danger' | 'plain'; answer: string }[];
  answered: (answer: string | null, note: string) => void;
}

const me = (): string | null => session.user?.userId || null;

class Feed {
  readonly everyone = new FeedList((before) => community.feed(before, PAGE_SIZE), true, 'Rpm_Feed_Empty', false, community);
  pages = $state.raw<Page[]>([]);
  unread = $state(0);
  trouble = $state<string | null>(null);
  asking = $state.raw<Asking | null>(null);

  private ids = 0;
  private closing = false;
  private unreadAsked = 0;
  private markedRead = 0;
  private troubleUntil: ReturnType<typeof setTimeout> | undefined;

  readonly top = $derived(this.pages.at(-1) ?? null);

  // Profile over a person's page and over every page opened from one, Feed over everyone's feed and the pages
  // opened from it.
  readonly heading = $derived(this.pages.some((page) => page.kind === 'person') ? 'Rpm_Profile_Heading' : 'Rpm_Tab_Feed');

  // The pane was put up. Reads the feed the first time, and again when it was last read more than a minute ago;
  // the unread count likewise.
  shown() {
    if (Date.now() - this.everyone.readAt > FRESH_MS) void this.everyone.readFirst();
    if (me() && Date.now() - this.unreadAsked > FRESH_MS) void this.readUnread();
  }

  // New badges were sent, and each is a notification: the dot is counted again.
  countUnreadAgain() {
    if (me()) void this.readUnread();
  }

  private async readUnread() {
    const asked = (this.unreadAsked = Date.now());
    try {
      const unread = await community.unread();
      if (asked > this.markedRead) this.unread = unread;
    } catch {
      // No dot this time; asked again on a later show.
    }
  }

  say(key: string) {
    clearTimeout(this.troubleUntil);
    this.trouble = key;
    this.troubleUntil = setTimeout(() => (this.trouble = null), TROUBLE_MS);
  }

  ask(question: Omit<Asking, 'answered'>): Promise<{ answer: string | null; note: string }> {
    return new Promise((done) => {
      this.asking = {
        ...question,
        answered: (answer, note) => {
          this.asking = null;
          done({ answer, note });
        },
      };
    });
  }

  // ── the stack ──

  private push(page: Unnumbered) {
    this.pages = [...this.pages, { ...page, id: ++this.ids } as Page];
  }

  private close(page: Page) {
    this.pages = this.pages.filter((held) => held !== page);
  }

  private holds(page: Page): boolean {
    return this.pages.includes(page);
  }

  // Closes the top page, once it agrees to close.
  async back() {
    const top = this.top;
    if (this.closing || !top) return;
    if (top.kind === 'edit') {
      this.closing = true;
      try {
        if (!(await this.mayLeave(top.draft))) return;
      } finally {
        this.closing = false;
      }
      if (this.top !== top) return;
    }
    this.close(top);
  }

  // Without changes the edit page closes. With changes the reader chooses: apply (save, and close only when saved),
  // discard, or stay.
  private async mayLeave(draft: EditDraft): Promise<boolean> {
    if (draft.saving) return false;
    if (!draft.changed) return true;
    const { answer } = await this.ask({
      title: text('Rpm_Profile_UnsavedTitle'),
      glyph: icons.edit,
      says: '',
      keys: [
        { label: text('Common_Cancel'), glyph: icons.close, tone: 'plain', answer: 'stay' },
        { label: text('Rpm_Profile_Discard'), glyph: icons.trash, tone: 'plain', answer: 'discard' },
        { label: text('Rpm_Profile_ApplyChanges'), glyph: icons.save, tone: 'primary', answer: 'apply' },
      ],
    });
    if (answer === 'discard') return true;
    if (answer === 'apply') return this.saveEdit(draft);
    return false;
  }

  // ── a person's page ──

  private get personOnTop(): PersonView | null {
    return this.top?.kind === 'person' ? this.top.person : null;
  }

  openPerson(userId: string) {
    if (!userId || this.personOnTop?.userId === userId) return;
    const person = new PersonView(userId, userId === me());
    this.push({ kind: 'person', person });
    void this.loadPerson(person);
  }

  private pageOf(person: PersonView): Page | undefined {
    return this.pages.find((page) => page.kind === 'person' && page.person === person);
  }

  private async loadPerson(person: PersonView) {
    const profile = await person.readProfile();
    if (!this.pageOf(person)) return;
    person.profile = profile;
    person.loaded = true;
    if (profile?.blocked) {
      person.list = null;
      return;
    }
    await person.list?.readFirst();
  }

  // Sends a change to the friendship or the block, then reads the profile again so the page says where things
  // stand now. readList reads the person's posts again too (after unblocking, when they were hidden).
  async change(person: PersonView, send: () => Promise<void>, readList = false) {
    try {
      await send();
    } catch {
      this.say('Rpm_Profile_SendFailed');
      return;
    }
    if (!this.pageOf(person)) return;
    person.profile = (await person.readProfile()) ?? person.profile;
    if (!this.pageOf(person)) return;
    if (person.profile?.blocked) {
      // A blocked person's posts are left out: the page shows the blocked line alone.
      person.list = null;
      return;
    }
    if (readList) await person.listAgain().readFirst();
  }

  async block(person: PersonView, profile: Person) {
    const { answer } = await this.ask({
      title: text('Rpm_Profile_Block'),
      glyph: icons.none,
      says: text('Rpm_Profile_BlockConfirm', profile.displayName),
      keys: [
        { label: text('Common_Cancel'), glyph: icons.close, tone: 'plain', answer: 'cancel' },
        { label: text('Rpm_Profile_Block'), glyph: icons.none, tone: 'danger', answer: 'block' },
      ],
    });
    if (answer === 'block') await this.change(person, () => community.block(profile.userId));
  }

  // The menu of a person's page, from the key in the heading: notifications and the edit page on the reader's own
  // page; blocking on someone else's.
  personMenu(x: number, y: number) {
    const person = this.personOnTop;
    const profile = person?.profile;
    if (!person || !profile) return;
    const entries: MenuEntry[] =
      profile.userId === me()
        ? [
            { label: text('Rpm_Notify_Title'), glyph: icons.bell, run: () => this.openNotices() },
            { label: text('Rpm_Profile_EditPage'), glyph: icons.edit, run: () => this.openEdit(person, profile) },
          ]
        : profile.blocked
          ? [{ label: text('Rpm_Profile_Unblock'), glyph: icons.userCheck, run:() => void this.change(person, () => community.unblock(profile.userId), true) }]
          : [{ label: text('Rpm_Profile_Block'), glyph: icons.none, run: () => void this.block(person, profile) }];
    openMenu(entries, x, y);
  }

  // A post's corner menu on a person's page: Delete post on the reader's own, Report on someone else's.
  postMenu(list: FeedList, entry: FeedEntry, x: number, y: number) {
    const item = entry.item;
    if (item.kind !== 'post') return;
    const post = item.post;
    const entries: MenuEntry[] =
      post.ownerId === me()
        ? [
            {
              label: text('Rpm_Profile_DeletePost'),
              glyph: icons.trash,
              run: () =>
                void community.deletePost(post.postId).then(
                  () => list.remove(entry),
                  () => this.say('Rpm_Profile_SendFailed'),
                ),
            },
          ]
        : [{ label: text('Artists_WallReport'), glyph: icons.flag, run: () => void this.report((note) => community.reportPost(post.ownerId, post.postId, null, note)) }];
    openMenu(entries, x, y);
  }

  // The report window for a post or a reply, as the artist wall asks it.
  async report(send: (note: string | null) => Promise<void>) {
    const { answer, note } = await this.ask({
      title: text('Album_ReportTitle'),
      glyph: icons.flag,
      says: text('Album_ReportCommentPrompt'),
      note: { placeholder: text('Album_ReportPlaceholder') },
      keys: [
        { label: text('Common_Cancel'), glyph: icons.close, tone: 'plain', answer: 'cancel' },
        { label: text('Album_ReportSubmit'), glyph: icons.flag, tone: 'primary', answer: 'send' },
      ],
    });
    if (answer !== 'send') return;
    try {
      await send(note.trim() || null);
    } catch {
      this.say('Rpm_Profile_SendFailed');
    }
  }

  // ── a post with its replies ──

  openThread(ownerId: string, postId: string, post: Post | null) {
    const thread = new ThreadView(ownerId, postId, post, (changed) => {
      this.everyone.update(changed);
      for (const page of this.pages) if (page.kind === 'person') page.person.list?.update(changed);
    });
    this.push({ kind: 'thread', thread });
    void thread.load();
  }

  // ── notifications ──

  openNotices() {
    const notices = new NoticesView(() => {
      this.markedRead = Date.now();
      this.unread = 0;
    });
    this.push({ kind: 'notices', notices });
    void notices.load();
  }

  // ── the edit page ──

  openEdit(person: PersonView, profile: Person) {
    this.push({ kind: 'edit', draft: new EditDraft(profile, badgeReporter.unlocked), person });
  }

  // Saves the edit page, closes it once saved, and reads the profile again.
  async saveEdit(draft: EditDraft): Promise<boolean> {
    if (!(await draft.save())) return false;
    const page = this.pages.find((held) => held.kind === 'edit' && held.draft === draft);
    if (page) this.close(page);
    if (page?.kind === 'edit') {
      const person = page.person;
      person.profile = (await person.readProfile()) ?? person.profile;
    }
    return true;
  }

  // ── a review in full ──

  openReader(list: FeedList, entry: FeedEntry) {
    const item = entry.item;
    if (item.kind !== 'review') return;
    this.push({ kind: 'review', entry, list, album: ownCopy(library.albums, item.review.albumTitle, item.review.albumArtist) });
  }

  // Open album, on a review read in full: the page closes and the record's page opens over the library.
  openAlbum(page: Page, album: CloudAlbum) {
    if (this.holds(page)) this.close(page);
    asked.opening = album;
  }
}

export const feed = new Feed();
badgeReporter.onSent = () => feed.countUnreadAgain();

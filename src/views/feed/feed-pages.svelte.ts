// What the Feed's pages hold, outside the components that draw them, so a page keeps its state while the pane is
// put away and brought back: a person's page, a post with its replies, the notifications, and the edit page.

import {
  LONGEST_PERSON_FEED_PAGE,
  refused,
  type Notice,
  type Person,
  type Post,
  type Reply,
} from '../../api/community';
import { community, profiles } from '../../app';
import { BADGE_COLOURS, BADGES } from '../../social/badges';
import { groundWire, readGround, STANDARD, type Ground } from '../../social/ground';
import { BANNER, PHOTO, preparedPicture } from '../../social/pictures';
import { FeedList } from './feed-list.svelte';

// A person's page: their profile as last read, and their posts and reviews.
export class PersonView {
  profile = $state.raw<Person | null>(null);
  // The profile has been asked for once, so the page can say what it found.
  loaded = $state(false);
  list = $state.raw<FeedList | null>(null);

  constructor(
    readonly userId: string,
    readonly own: boolean,
  ) {
    this.list = this.newList();
  }

  private newList(): FeedList {
    return new FeedList(
      (before) => community.personFeed(this.userId, before, LONGEST_PERSON_FEED_PAGE),
      false,
      this.own ? 'Rpm_Profile_FeedEmptyOwn' : 'Rpm_Profile_FeedEmpty',
      true,
      community,
    );
  }

  // The list, made again when it was left out for a block that has since ended.
  listAgain(): FeedList {
    this.list ??= this.newList();
    return this.list;
  }

  // The profile, or null when it could not be read: the page then shows the list's own line about the connection.
  async readProfile(): Promise<Person | null> {
    try {
      return await community.person(this.userId);
    } catch {
      return null;
    }
  }
}

// A post with its replies, as the phones open it.
//
// Out of order: replies are read again after a send or a delete, and an answer that arrives after a newer read
// started is dropped (reads). A vote answer is applied only when it answers the latest vote on that reply
// (votesSent), or on the post (postVotes).
export class ThreadView {
  post = $state.raw<Post | null>(null);
  replies = $state.raw<Reply[]>([]);
  // The reply whose Reply key is open, with a box under it.
  answering = $state<string | null>(null);
  // The replies on the last shown level whose deeper answers were opened.
  opened = $state.raw<ReadonlySet<string>>(new Set());
  quiet = $state<string | null>(null);
  loaded = $state(false);

  private reads = 0;
  private postVotes = 0;
  private readonly votesSent = new Map<string, number>();

  constructor(
    readonly ownerId: string,
    readonly postId: string,
    post: Post | null,
    // The post changed here (a vote, a new reply). The lists that show it draw it again.
    private readonly onPostChanged: (post: Post) => void,
  ) {
    this.post = post;
  }

  async load() {
    if (!this.post) this.post = await this.findPost();
    await this.readReplies();
  }

  // The post, when the thread was opened from a notification that carries only its ids: looked for on the first
  // page of its owner's feed, which holds their newest posts.
  private async findPost(): Promise<Post | null> {
    try {
      const page = await community.personFeed(this.ownerId, null, LONGEST_PERSON_FEED_PAGE);
      const found = page?.items.find((item) => item.kind === 'post' && item.post.postId === this.postId);
      return found?.kind === 'post' ? found.post : null;
    } catch {
      return null;
    }
  }

  async readReplies() {
    const read = ++this.reads;
    let replies: Reply[];
    try {
      replies = await community.replies(this.ownerId, this.postId);
    } catch {
      if (read === this.reads) {
        this.quiet = 'Rpm_Profile_Offline';
        this.loaded = true;
      }
      return;
    }
    if (read !== this.reads) return;
    this.quiet = null;
    this.replies = replies;
    this.loaded = true;
  }

  async votePost(value: number) {
    const post = this.post;
    if (!post) return;
    const sent = ++this.postVotes;
    try {
      const answer = await community.votePost(post.ownerId, post.postId, value);
      if (answer && sent === this.postVotes) {
        this.post = answer;
        this.onPostChanged(answer);
      }
    } catch {
      // Signed out, offline or refused: the counts stay.
    }
  }

  // Sends a reply to the post (parentId null) or to a reply. Answers whether it was sent.
  async send(parentId: string | null, body: string): Promise<boolean> {
    try {
      const reply = await community.reply(this.ownerId, this.postId, parentId, body);
      this.replies = [...this.replies, reply];
      this.answering = null;
      if (this.post) {
        this.post = { ...this.post, replyCount: this.post.replyCount + 1 };
        this.onPostChanged(this.post);
      }
      return true;
    } catch {
      return false;
    }
  }

  async remove(reply: Reply) {
    try {
      await community.deleteReply(this.ownerId, this.postId, reply.replyId);
    } catch {
      this.quiet = 'Rpm_Profile_SendFailed';
      return;
    }
    // Read again: a reply with replies under it stays as a deleted one.
    await this.readReplies();
  }

  async voteReply(replyId: string, value: number) {
    const sent = (this.votesSent.get(replyId) ?? 0) + 1;
    this.votesSent.set(replyId, sent);
    try {
      const answer = await community.voteReply(this.ownerId, this.postId, replyId, value);
      if (!answer || this.votesSent.get(replyId) !== sent) return;
      this.replies = this.replies.map((reply) => (reply.replyId === replyId ? answer : reply));
    } catch {
      // The counts stay.
    }
  }

  toggleAnswer(replyId: string) {
    this.answering = this.answering === replyId ? null : replyId;
  }

  openBranch(replyId: string) {
    this.opened = new Set([...this.opened, replyId]);
  }
}

// The reader's notifications, newest first. Opening the page marks everything on its first page as read.
//
// Out of order: a further page is dropped when a read started since (reads), and two further pages never run
// together (readingMore).
export class NoticesView {
  items = $state.raw<Notice[]>([]);
  quiet = $state<string | null>(null);
  // The friend requests answered here, whose keys are taken away; and the ones being sent.
  answered = $state.raw<ReadonlySet<string>>(new Set());
  sending = $state.raw<ReadonlySet<string>>(new Set());

  private next: string | null = null;
  private reads = 0;
  private readingMore = false;

  constructor(private readonly onAllRead: () => void) {}

  get hasMore(): boolean {
    return this.next !== null;
  }

  async load() {
    const read = ++this.reads;
    let page;
    try {
      page = await community.notices(null);
    } catch {
      if (read === this.reads) this.quiet = 'Rpm_Profile_Offline';
      return;
    }
    if (read !== this.reads) return;
    this.items = page.items;
    this.next = page.next;
    this.quiet = page.items.length === 0 ? 'Rpm_Notify_Empty' : null;

    if (page.unread > 0 && page.newest) {
      try {
        await community.markRead(page.newest);
        this.onAllRead();
      } catch {
        // They stay unread, and are marked the next time the page opens.
      }
    }
  }

  async more() {
    if (this.readingMore || this.next === null) return;
    this.readingMore = true;
    const read = this.reads;
    try {
      const page = await community.notices(this.next);
      if (read !== this.reads) return;
      this.items = [...this.items, ...page.items];
      this.next = page.next;
    } catch {
      // The list ends here until the page is opened again.
      this.next = null;
    } finally {
      this.readingMore = false;
    }
  }

  // Sends an answer to a friend request and takes the keys away once it is sent.
  async answer(notice: Notice, accept: boolean) {
    this.sending = new Set([...this.sending, notice.id]);
    try {
      await (accept ? community.acceptFriend(notice.fromUserId) : community.removeFriend(notice.fromUserId));
      this.answered = new Set([...this.answered, notice.id]);
    } catch {
      // The keys stay, to try again.
    } finally {
      this.sending = new Set([...this.sending].filter((id) => id !== notice.id));
    }
  }
}

interface PickedPicture {
  bytes: Uint8Array;
  url: string;
}

// The reader's edit page, as on the phones: the name, the photo, the banner, what the page is drawn on, and the
// badge with its colour. Nothing is sent until Save.
export class EditDraft {
  name = $state('');
  newPhoto = $state.raw<PickedPicture | null>(null);
  removePhoto = $state(false);
  newBanner = $state.raw<PickedPicture | null>(null);
  removeBanner = $state(false);
  bannerFollows = $state(false);
  badge = $state('');
  // #RRGGBB, or empty for the default colour.
  colour = $state('');
  ground = $state.raw<Ground>(STANDARD);
  saving = $state(false);
  // The string key of what went wrong, shown under Save.
  trouble = $state<string | null>(null);

  // Every badge the reader holds: the server's, and the ones this collection unlocks that it may not have sent
  // yet. Save sends them all, so a badge unlocked here can be chosen at once.
  readonly held: string[];

  constructor(
    readonly person: Person,
    unlockedHere: readonly string[],
  ) {
    const held = new Set([...person.badges, ...unlockedHere]);
    this.held = BADGES.map((badge) => badge.id).filter((id) => held.has(id));
    this.name = person.displayName;
    this.bannerFollows = person.bannerFollowsListening;
    this.badge = person.badge;
    this.colour = /^#[0-9a-fA-F]{6}$/.test(person.badgeColour) ? person.badgeColour : '';
    this.ground = readGround(person.pageGround);
  }

  get changed(): boolean {
    const person = this.person;
    return (
      this.name.trim() !== person.displayName ||
      this.newPhoto !== null ||
      this.removePhoto ||
      this.newBanner !== null ||
      this.removeBanner ||
      this.bannerFollows !== person.bannerFollowsListening ||
      this.badge !== person.badge ||
      this.colour !== person.badgeColour ||
      groundWire(this.ground) !== groundWire(readGround(person.pageGround))
    );
  }

  get canSave(): boolean {
    return !this.saving && this.changed && this.name.trim().length >= 2;
  }

  // The default colour is stored as empty.
  pickColour(colour: string) {
    this.colour = colour === BADGE_COLOURS[0] ? '' : colour;
  }

  async pick(file: File, banner: boolean) {
    const bytes = await preparedPicture(file, banner ? BANNER : PHOTO);
    if (!bytes) {
      this.trouble = 'Rpm_Profile_PictureFailed';
      return;
    }
    const picked = { bytes, url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' })) };
    if (banner) {
      this.newBanner = picked;
      this.removeBanner = false;
    } else {
      this.newPhoto = picked;
      this.removePhoto = false;
    }
    this.trouble = null;
  }

  dropPhoto() {
    this.newPhoto = null;
    this.removePhoto = true;
  }

  dropBanner() {
    this.newBanner = null;
    this.removeBanner = true;
  }

  // Sends what changed, one call at a time. Answers whether all of it was saved.
  async save(): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    this.trouble = null;
    const person = this.person;
    try {
      const name = this.name.trim();
      if (name !== person.displayName) {
        const outcome = await profiles.rename(name);
        if (outcome !== 'saved') return this.failed(outcome === 'taken' ? 'Profile_NameTaken' : outcome === 'invalid' ? 'Profile_NameInvalid' : 'Rpm_Profile_SaveFailed');
      }
      if (this.newPhoto) await profiles.setAvatar(this.newPhoto.bytes);
      else if (this.removePhoto && person.hasAvatar) await profiles.clearAvatar();
      if (this.newBanner) await community.setBanner(this.newBanner.bytes);
      else if (this.removeBanner && person.hasBanner) await community.clearBanner();
      if (this.bannerFollows !== person.bannerFollowsListening) await community.setBannerSource(this.bannerFollows);
      if (groundWire(this.ground) !== groundWire(readGround(person.pageGround))) await community.setPageGround(groundWire(this.ground));
      if (this.badge !== person.badge || this.colour !== person.badgeColour) await community.setBadges(this.held, this.badge, this.colour);
    } catch (error) {
      return this.failed(refused(error) ? 'Rpm_Profile_PictureFailed' : 'Rpm_Profile_SaveFailed');
    }
    this.saving = false;
    return true;
  }

  private failed(key: string): boolean {
    this.saving = false;
    this.trouble = key;
    return false;
  }
}

// How a post's thread is laid out: every reply in reading order, indented by how deep it answers. Six levels are
// shown. The answers under a reply on the sixth level wait behind a "Show more" key under it, which opens that
// branch. The same rules as the desktop's FeedThread.

import { replyTree, type Reply } from '../api/community';

// How many levels a thread shows before a reply's deeper answers wait behind "Show more".
export const SHOWN_LEVELS = 6;

// The deepest a reply is indented. Deeper replies stay at this depth, so the text keeps its width in a narrow pane.
export const DEEPEST_INDENT = 6;

export interface ThreadLine {
  reply: Reply;
  depth: number;
  // How many answers under this reply wait behind its "Show more" key; 0 for none.
  hidden: number;
}

// The lines to draw. opened holds the replies on the last shown level whose deeper answers were opened.
export function threadLines(postId: string, replies: readonly Reply[], opened: ReadonlySet<string>): ThreadLine[] {
  const lines = replyTree(postId, replies);

  // Every reply deeper than the shown levels sits under one reply on the last shown level: its gate. The tree is
  // in reading order, so the gate is the latest reply seen on that level.
  const gates: (string | null)[] = [];
  const hidden = new Map<string, number>();
  let gate: string | null = null;
  for (const { reply, depth } of lines) {
    if (depth === SHOWN_LEVELS - 1) gate = reply.replyId;
    if (depth < SHOWN_LEVELS || gate === null) {
      gates.push(null);
      continue;
    }
    gates.push(gate);
    if (!opened.has(gate)) hidden.set(gate, (hidden.get(gate) ?? 0) + 1);
  }

  return lines.flatMap(({ reply, depth }, index) => {
    const closed = gates[index];
    if (closed && !opened.has(closed)) return [];
    return [{ reply, depth, hidden: hidden.get(reply.replyId) ?? 0 }];
  });
}

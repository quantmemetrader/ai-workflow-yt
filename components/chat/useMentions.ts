"use client";

import * as React from "react";
import { isTagStart } from "@/lib/agents/catalog";
import { filterTargets, mentionTargets, type MentionPerson, type MentionTarget } from "./MentionMenu";

/**
 * Typing `@` and getting the right colleague, wherever the box is.
 *
 * The chat composer grew this first; the home screen needs exactly the same
 * behaviour, and a second implementation of "where does this tag start" is a
 * second set of rules for what routes — which is how one box ends up tagging
 * somebody the other would not. So the rule lives here once:
 *
 *   — a tag starts at an `@` that begins a word (`isTagStart`, the same test
 *     the message list pills by, so the picker writes what the router reads);
 *   — it runs until whitespace;
 *   — it is recomputed from the value and the caret on every keystroke rather
 *     than tracked, which is the only way it survives pasting, deleting and
 *     clicking about.
 *
 * The caller owns the textarea and the draft; this owns the menu.
 */
export function useMentions({
  people,
  zh,
  draft,
  setDraft,
  box,
}: {
  people: MentionPerson[] | undefined;
  zh: boolean;
  draft: string;
  setDraft: (next: string) => void;
  box: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const targets = React.useMemo(() => mentionTargets(people ?? [], zh), [people, zh]);
  const [mention, setMention] = React.useState<{ at: number; query: string } | null>(null);
  const [active, setActive] = React.useState(0);

  const matches = React.useMemo(
    () => (mention ? filterTargets(targets, mention.query) : []),
    [mention, targets],
  );

  const read = React.useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0) return null;
    if (!isTagStart(value, at)) return null;
    const query = before.slice(at + 1);
    if (/\s/.test(query)) return null;
    return { at, query };
  }, []);

  /** Call from the textarea's onChange, after setting the draft. */
  const onValue = React.useCallback(
    (value: string, caret: number) => {
      setMention(read(value, caret));
      setActive(0);
    },
    [read],
  );

  const close = React.useCallback(() => setMention(null), []);

  const pick = React.useCallback(
    (target: MentionTarget) => {
      const el = box.current;
      if (!mention || !el) return;
      const caret = el.selectionStart ?? draft.length;
      const next = `${draft.slice(0, mention.at)}@${target.tag} ${draft.slice(caret)}`;
      const to = mention.at + target.tag.length + 2;
      setDraft(next);
      setMention(null);
      // The caret belongs after the tag, not at the end of a message somebody
      // is still in the middle of.
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(to, to);
      });
    },
    [box, draft, mention, setDraft],
  );

  /**
   * The arrows, Enter and Escape, while the menu is open.
   *
   * Returns true when it consumed the key, so the caller knows not to also
   * send the message — which is the bug this shape exists to prevent.
   */
  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!mention || !matches.length) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[active] ?? matches[0]);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return true;
      }
      return false;
    },
    [active, matches, mention, pick],
  );

  return { matches, active, setActive, onValue, onKeyDown, pick, close, open: Boolean(mention && matches.length) };
}

"use client";

import { Markdown } from "@/components/ui/Markdown";

/**
 * What the message will look like, above the box you are typing it in.
 *
 * The formatting buttons wrap the selection in Markdown, which is correct —
 * it is what the renderer and the agent both read — but a textarea can only
 * ever show `**bold**`, so pressing B looked like it had inserted punctuation.
 * You could not see the bold until after you had sent it.
 *
 * A textarea cannot render rich text, and swapping it for a contenteditable
 * would cost the caret behaviour, the paste behaviour and the IME behaviour
 * that Chinese input depends on. So the box stays a textarea and the rendered
 * version sits directly above it, appearing only once there is formatting to
 * show: no strip on a plain line of text.
 */
export const HAS_MARKUP = /(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\n]*\))|(^|\n)- /;

export function FormattedPreview({ text, zh }: { text: string; zh: boolean }) {
  if (!text.trim() || !HAS_MARKUP.test(text)) return null;

  return (
    <div
      aria-hidden
      style={{
        padding: "8px 13px 7px",
        borderBottom: "1px solid #f3f3f3",
        background: "#fcfcfc",
        maxHeight: 132,
        overflowY: "auto",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 500, color: "#c7c7c7", marginBottom: 4 }}>
        {zh ? "预览" : "Preview"}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: "#383838" }}>
        <Markdown text={text} />
      </div>
    </div>
  );
}

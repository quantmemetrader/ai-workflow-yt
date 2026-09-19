/**
 * The composer's formatting buttons, doing what they look like they do.
 *
 * The artboards drew bold / italic / link / list / code above both composers.
 * They were decoration in the mock; here they wrap the current selection in
 * Markdown, which is what both the chat renderer and the agent understand.
 */
export type Format = "bold" | "italic" | "link" | "list" | "code";

const WRAP: Record<Exclude<Format, "list" | "link">, string> = {
  bold: "**",
  italic: "*",
  code: "`",
};

/**
 * Returns the new value and where to put the caret. Pure, so it can be tested
 * and so neither composer has to know how the other one works.
 */
export function applyFormat(
  value: string,
  start: number,
  end: number,
  format: Format,
): { value: string; selectionStart: number; selectionEnd: number } {
  const selected = value.slice(start, end);

  if (format === "list") {
    // Prefix every line of the selection, or start a bullet on an empty one.
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const body = value.slice(lineStart, end) || "";
    const bulleted = body
      .split("\n")
      .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
      .join("\n");
    return {
      value: value.slice(0, lineStart) + bulleted + value.slice(end),
      selectionStart: lineStart + bulleted.length,
      selectionEnd: lineStart + bulleted.length,
    };
  }

  if (format === "link") {
    const label = selected || "text";
    const inserted = `[${label}](url)`;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      // Land on `url` so the next keystroke replaces it.
      selectionStart: start + label.length + 3,
      selectionEnd: start + label.length + 6,
    };
  }

  const mark = WRAP[format];
  // Toggle: wrapping something already wrapped unwraps it.
  const already =
    value.slice(start - mark.length, start) === mark && value.slice(end, end + mark.length) === mark;

  if (already) {
    return {
      value: value.slice(0, start - mark.length) + selected + value.slice(end + mark.length),
      selectionStart: start - mark.length,
      selectionEnd: end - mark.length,
    };
  }

  const inserted = `${mark}${selected || ""}${mark}`;
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    selectionStart: start + mark.length,
    selectionEnd: start + mark.length + selected.length,
  };
}

/** Applies a format to a live textarea and keeps the caret sensible. */
export function formatTextarea(
  el: HTMLTextAreaElement | null,
  format: Format,
  onChange: (value: string) => void,
) {
  if (!el) return;
  const { value, selectionStart, selectionEnd } = applyFormat(
    el.value,
    el.selectionStart,
    el.selectionEnd,
    format,
  );
  onChange(value);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(selectionStart, selectionEnd);
  });
}

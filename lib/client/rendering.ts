/**
 * The render you started, remembered across pages.
 *
 * "Make the video" and "Render" are minutes on the worker, and the strip that
 * shows their progress is the editor's own. Leave the page and it is gone,
 * while the work carries on unseen. This keeps the project id in the browser
 * so a component above every page can keep asking after it and say, wherever
 * you are, that it finished — and where the file is.
 */
export type Rendering = { projectId: string; title: string; at: number };

const KEY = "aura:rendering";
const EVENT = "aura:rendering";
/** A render nobody has seen finish in two hours is not going to. */
const GIVE_UP_AFTER = 2 * 60 * 60_000;

function parse(raw: string | null): Rendering | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Rendering>;
    if (typeof v.projectId !== "string" || !v.projectId) return null;
    const at = typeof v.at === "number" ? v.at : 0;
    if (Date.now() - at > GIVE_UP_AFTER) return null;
    return { projectId: v.projectId, title: typeof v.title === "string" ? v.title : "", at };
  } catch {
    return null;
  }
}

let cachedRaw: string | null = null;
let cachedValue: Rendering | null = null;

export function readRendering(): Rendering | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

export const serverRendering = (): Rendering | null => null;

export function writeRendering(value: Omit<Rendering, "at"> | null) {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify({ ...value, at: Date.now() }));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode, or storage full: the strip on the page still shows it.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeRendering(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

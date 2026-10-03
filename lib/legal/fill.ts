/**
 * Filling a template, kept apart from the database so it can be checked on
 * its own (`draftContract` and `reviewContract` are the callers).
 *
 * QA, 3 Oct: a release drafted with 授权地区 left blank came out reading
 * "in {{ territory }}" — the field's hint says it is worldwide unless the
 * contributor asks otherwise, but nothing applied that. And a review of a
 * draft nobody had touched listed every filled-in clause as a change,
 * because it compared against the template's placeholders.
 */

export type TemplateField = { key: string; label: string; hint?: string };

/** What a blank optional field means, by key. Only the ones whose hint
 * promises a default; anything else left blank has to be filled. */
export const FIELD_DEFAULTS: Record<string, string> = {
  territory: "全球",
};

/** The Chinese names of the starter fields, for a refusal that names them. */
const FIELD_ZH: Record<string, string> = {
  contributor: "出镜人姓名",
  production: "节目或哪一集",
  recorded_on: "拍摄日期",
  territory: "授权地区",
  contractor: "合作方姓名",
  role: "负责什么",
  services: "具体工作内容",
  fee: "费用",
  starts_on: "开始日期",
  delivery: "交付日期",
};

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** `{{ key }}` filled from `values`. A key with no value stays as its own
 * placeholder — which a draft never keeps (`resolveDraft` refuses first). */
export function fillTemplate(body: string, values: Record<string, string>, studio: string): string {
  return body.replace(PLACEHOLDER, (whole, key: string) => {
    if (key === "studio") return studio;
    const v = values[key];
    return v && v.trim() ? v : whole;
  });
}

/** The placeholder keys still in a text. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/**
 * The values a draft is made from — blanks given their documented default —
 * and its text; or, when something would be left as `{{ … }}`, the Chinese
 * refusal that names what is missing.
 */
export function resolveDraft(
  body: string,
  fields: TemplateField[],
  input: Record<string, string>,
  studio: string,
): { values: Record<string, string>; text: string } | { error: string } {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) if (typeof v === "string" && v.trim()) values[k] = v.trim();

  const needed = new Set([...fields.map((f) => f.key), ...placeholdersIn(body)].filter((k) => k !== "studio"));
  const missing: string[] = [];
  for (const key of needed) {
    if (values[key]) continue;
    if (FIELD_DEFAULTS[key]) values[key] = FIELD_DEFAULTS[key];
    else missing.push(key);
  }
  if (missing.length) {
    const name = (key: string) => FIELD_ZH[key] ?? fields.find((f) => f.key === key)?.label ?? key;
    return { error: `还有没填的：${missing.map(name).join("、")}` };
  }

  const text = fillTemplate(body, values, studio);
  const left = placeholdersIn(text);
  if (left.length) return { error: `模板里还有没法填的占位：${left.join("、")}` };
  return { values, text };
}

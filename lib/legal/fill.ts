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

export type TemplateLanguage = "zh" | "en";

/**
 * Which language a template is written in: by its builtin key when it has one
 * ('release.en', 'release.zh'), otherwise by whether its text is mostly
 * Chinese. Decides what a blank optional field reads as (QA, 4 Oct: the
 * English release with 授权地区 left blank said "in 全球").
 */
export function templateLanguage(template: { builtinKey?: string | null; body: string }): TemplateLanguage {
  const key = template.builtinKey ?? "";
  if (/\.zh$/.test(key)) return "zh";
  if (/\.en$/.test(key)) return "en";
  const han = (template.body.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (template.body.match(/[A-Za-z]/g) ?? []).length;
  return han * 3 >= latin ? "zh" : "en";
}

/** A line to sign or write over, for an optional field left blank. */
export const BLANK_LINE = "____________________";

const HAS_HAN = /[\u3400-\u9fff]/;

/**
 * What a blank optional field means, by key and language. Only the ones whose
 * hint promises a default; anything else left blank has to be filled.
 * `studio` is the studio's name as drafting knows it (the tenant's name): the
 * Chinese text uses it as the legal name by default; the English text only
 * when it is not written in Chinese, and a line to fill in otherwise.
 */
export function fieldDefaults(lang: TemplateLanguage, studio: string): Record<string, string> {
  const zh = lang === "zh";
  return {
    territory: zh ? "全球" : "worldwide",
    consideration: zh
      ? "参与本节目拍摄的机会，以及象征性对价港币1元（HK$1）"
      : "the opportunity to take part in the Production and the nominal sum of HK$1",
    contributor_id: BLANK_LINE,
    contributor_address: BLANK_LINE,
    guardian: BLANK_LINE,
    studio_legal_name: zh ? studio || BLANK_LINE : studio && !HAS_HAN.test(studio) ? studio : BLANK_LINE,
    studio_registration_no: BLANK_LINE,
    studio_signatory: BLANK_LINE,
    studio_signatory_title: BLANK_LINE,
    data_contact: zh ? "被授权方" : "the Studio",
  };
}

/** The Chinese names of the starter fields, for a refusal that names them. */
const FIELD_ZH: Record<string, string> = {
  contributor: "出镜人姓名",
  production: "节目或哪一集",
  recorded_on: "拍摄日期",
  territory: "授权地区",
  consideration: "对价",
  contributor_id: "出镜人身份证或护照号码",
  contributor_address: "出镜人地址",
  guardian: "监护人姓名",
  studio_legal_name: "制作方法定名称",
  studio_registration_no: "制作方商业登记号码",
  studio_signatory: "制作方签署人姓名",
  studio_signatory_title: "制作方签署人职位",
  data_contact: "个人资料查阅及更正的联络人",
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
  lang: TemplateLanguage = templateLanguage({ body }),
): { values: Record<string, string>; text: string } | { error: string } {
  const defaults = fieldDefaults(lang, studio);
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) if (typeof v === "string" && v.trim()) values[k] = v.trim();

  const needed = new Set([...fields.map((f) => f.key), ...placeholdersIn(body)].filter((k) => k !== "studio"));
  const missing: string[] = [];
  for (const key of needed) {
    if (values[key]) continue;
    if (defaults[key]) values[key] = defaults[key];
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

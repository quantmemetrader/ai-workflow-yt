/**
 * The non-advice notice (contract clause 8.4), on its own.
 *
 * It lived in `./service`, which is `server-only` and pulls in the database.
 * 法务's lane (`lib/agents/lanes.ts`) has to carry the same sentence, and that
 * file is plain text a script loads without the app around it — so the words
 * live here, where both can import them, and the service re-exports them for
 * the screens that already read it from there.
 */
export const NON_ADVICE = {
  en: "This is drafting and comparison, not legal advice. A qualified adviser decides what any of it means.",
  zh: "这里提供的是起草与比对，不是法律意见。具体含义请咨询有资质的法律顾问。",
};

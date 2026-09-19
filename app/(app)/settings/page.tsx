import { requireViewer } from "@/lib/auth/dal";
import { budgetState, formatUsd } from "@/lib/ai/ledger";
import { makeT } from "@/lib/i18n";
import { NAV_BY_MODULE } from "@/lib/nav";
import { signOut } from "@/app/login/actions";
import { LocaleSwitch } from "./locale-switch";
import { PasswordCard } from "./password";

/** The person's own account: what they hold, what they have spent, and the way
 * out. Spend is shown to the employee, not only to an admin (spec §5). */
export default async function SettingsPage() {
  const viewer = await requireViewer();
  const locale = viewer.locale ?? "zh-CN";
  const t = makeT(locale);
  const budget = await budgetState(viewer);
  const zh = locale.startsWith("zh");

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <header
        style={{
          height: 56,
          flexShrink: 0,
          borderBottom: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          padding: "0 22px",
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        {t("Settings")}
      </header>

      <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "22px 26px" }}>
        <div className="flex max-w-[720px] flex-col gap-4">
          <section className="rounded-xl border border-outline-gray-1 p-4">
            <div className="flex items-center gap-3">
              {viewer.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={viewer.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-gray-3 text-sm text-ink-gray-7">
                  {viewer.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <div>
                <p className="text-sm font-semibold text-ink-gray-9">
                  {zh && viewer.nameLocal ? viewer.nameLocal : viewer.name}
                </p>
                <p className="text-xs text-ink-gray-5">
                  {viewer.email} · {viewer.title ?? t(viewer.role)}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-outline-gray-1 p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-gray-9">{t("AI spend")}</h2>
            <p className="text-p-2xl font-semibold text-ink-gray-9">{formatUsd(budget.usedMicros)}</p>
            <p className="mt-1 text-xs text-ink-gray-5">
              {budget.capMicros === null
                ? t("No cap set")
                : `${t("of")} ${formatUsd(budget.capMicros)} ${t("this period")}`}
            </p>
            {budget.capMicros !== null && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-gray-3">
                <div
                  className={`h-full ${budget.stopped ? "bg-surface-red-5" : "bg-surface-gray-7"}`}
                  style={{ width: `${Math.round(budget.fraction * 100)}%` }}
                />
              </div>
            )}
            {budget.stopped && (
              <p className="mt-3 rounded-lg border border-outline-red-1 bg-surface-red-1 px-3 py-2 text-xs text-ink-red-3">
                {t("Budget reached — the assistant has stopped")}
              </p>
            )}
          </section>

          <section className="rounded-xl border border-outline-gray-1 p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-gray-9">
              {zh ? "你的模块" : "Your modules"}
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {viewer.modules.map((m) => {
                const item = NAV_BY_MODULE.get(m);
                return (
                  <span
                    key={m}
                    className="rounded-md border border-outline-gray-1 bg-surface-gray-1 px-2 py-1 text-xs text-ink-gray-7"
                  >
                    {zh ? item?.labelZh : item?.label}
                  </span>
                );
              })}
            </div>
          </section>

          <LocaleSwitch current={locale} />

          <PasswordCard zh={zh} />

          <form action={signOut}>
            <button
              type="submit"
              className="h-9 rounded-lg border border-outline-gray-2 px-4 text-sm font-medium text-ink-gray-7 hover:bg-surface-gray-2"
            >
              {t("Sign out")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

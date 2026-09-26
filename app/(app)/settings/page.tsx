import { requireViewer } from "@/lib/auth/dal";
import { budgetState, formatUsd } from "@/lib/ai/ledger";
import { makeT } from "@/lib/i18n";
import { NAV_BY_MODULE } from "@/lib/nav";
import { signOut } from "@/app/login/actions";
import { LocaleSwitch } from "./locale-switch";
import { AutomationsCard } from "./automations";
import { PasswordCard } from "./password";
import { ProfileCard } from "./profile";
import { TwoStepCard } from "./two-step";
import { PeopleCard } from "./people";
import { canInvite, listInvites } from "@/lib/invites/service";
import { AUTOMATIONS, readAutomations } from "@/lib/automations/service";
import { listTrustedDevices } from "@/lib/auth/second-factor";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { AgentDock } from "@/components/shell/AgentDock";
import { answeringModel } from "@/lib/ai/models";

export const metadata = { title: "设置 · Settings" };

/** The person's own account: what they hold, what they have spent, and the way
 * out. Spend is shown to the employee, not only to an admin (spec §5). */
export default async function SettingsPage() {
  const viewer = await requireViewer();
  const locale = viewer.locale ?? "zh-CN";
  const t = makeT(locale);
  const budget = await budgetState(viewer);
  const zh = locale.startsWith("zh");
  // Until Admin ships, this is where an owner adds their own staff.
  const invites = canInvite(viewer) ? await listInvites(viewer) : [];
  /* What the AI employees do on their own. Everyone can see the switch —
     work happening in the studio's channels without a person asking for it
     should not be a thing only an admin knows about — but only an owner or
     an admin can move it. */
  const automations = await readAutomations();

  /* Two-step verification, read here rather than in the card so the card can
     stay a client component without a round trip of its own. */
  const [account] = await db
    .select({ confirmedAt: users.totpConfirmedAt, recovery: users.totpRecovery })
    .from(users)
    .where(eq(users.id, viewer.id))
    .limit(1);
  const devices = account?.confirmedAt ? await listTrustedDevices(viewer.id) : [];
  const day = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex" }}>
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
          <ProfileCard
            zh={zh}
            userId={viewer.id}
            name={viewer.name}
            nameLocal={viewer.nameLocal}
            title={viewer.title}
            email={viewer.email}
            avatarUrl={viewer.avatarUrl}
          />

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

          {canInvite(viewer) && (
            <PeopleCard
              zh={zh}
              initialInvites={invites.map((i) => ({
                id: i.id,
                email: i.email,
                role: i.role,
                modules: i.modules,
                expiresAt: i.expiresAt.toISOString(),
                acceptedAt: i.acceptedAt?.toISOString() ?? null,
              }))}
            />
          )}

          <LocaleSwitch current={locale} />

          <AutomationsCard
            zh={zh}
            canEdit={viewer.role === "owner" || viewer.role === "admin"}
            rows={AUTOMATIONS.map((def) => ({
              key: def.key,
              name: def.name,
              nameEn: def.nameEn,
              what: def.what,
              whatEn: def.whatEn,
              scheduled: def.scheduled,
              value: automations[def.key],
            }))}
          />

          <PasswordCard zh={zh} />

          <TwoStepCard
            zh={zh}
            enabled={Boolean(account?.confirmedAt)}
            enrolledAt={account?.confirmedAt ? day(account.confirmedAt) : null}
            recoveryLeft={(account?.recovery ?? []).length}
            devices={devices.map((d) => ({
              id: d.id,
              label: d.label,
              ip: d.ip,
              lastSeenAt: day(d.lastSeenAt),
              expiresAt: day(d.expiresAt),
            }))}
          />

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

    {/* "What am I allowed to open, and what have I spent" is a question in
        words, on a screen made of numbers. */}
    <AgentDock
      zh={zh}
      model={answeringModel()}
      scope={zh ? "你的账号" : "Your account"}
      note={
        zh
          ? "可以问它你能打开哪些模块、这个月花了多少，或者这里的设置怎么改。"
          : "Ask what you can open, what you have spent this month, or how to change anything here."
      }
      placeholder={zh ? "询问你的账号…" : "Ask about your account…"}
    />
    </div>
  );
}

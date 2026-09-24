"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AGENT_KEYS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import type { Automation, AutomationKey } from "@/lib/automations/service";
import { setAutomationAction } from "./actions";

/**
 * 自动化 — the switch on the work the AI employees do without being asked.
 *
 * An employee that acts by itself and cannot be told to stop is not an
 * employee, so everything autonomous in the product is on this one page:
 * whether it runs, what time in Hong Kong it runs, and which colleague signs
 * it. Nothing here is hidden behind a feature flag or a cron line; what the
 * page says is what the box does.
 */
export type AutomationRow = {
  key: AutomationKey;
  name: string;
  nameEn: string;
  what: string;
  whatEn: string;
  scheduled: boolean;
  value: Automation;
};

export function AutomationsCard({
  rows,
  zh,
  canEdit,
}: {
  rows: AutomationRow[];
  zh: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function save(key: AutomationKey, patch: Partial<Automation>) {
    start(async () => {
      await setAutomationAction(key, patch);
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-outline-gray-1 p-5">
      <h2 className="mb-1 text-sm font-semibold text-ink-gray-9">{zh ? "自动化" : "Automations"}</h2>
      <p className="mb-4 text-xs leading-relaxed text-ink-gray-6">
        {zh
          ? "AI 员工在没人吩咐的时候做的事。时间是香港时间。"
          : "What the AI employees do without being asked. Times are Hong Kong."}
      </p>

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div
            key={row.key}
            className="rounded-lg border border-outline-gray-1 p-4"
            style={{ opacity: row.value.enabled ? 1 : 0.62 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span className="text-[13px] font-medium text-ink-gray-9">{zh ? row.name : row.nameEn}</span>
              <span style={{ flexGrow: 1 }} />
              <button
                type="button"
                disabled={!canEdit || pending}
                onClick={() => save(row.key, { enabled: !row.value.enabled })}
                className="h-7 rounded-lg border px-3 text-xs font-medium"
                style={{
                  borderColor: row.value.enabled ? "#171717" : "#e2e2e2",
                  background: row.value.enabled ? "#171717" : "#ffffff",
                  color: row.value.enabled ? "#ffffff" : "#525252",
                  cursor: canEdit ? "pointer" : "default",
                }}
              >
                {row.value.enabled ? (zh ? "已开启" : "On") : zh ? "已关闭" : "Off"}
              </button>
            </div>

            <p className="mt-1.5 text-xs leading-relaxed text-ink-gray-6">{zh ? row.what : row.whatEn}</p>

            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 7 }} className="text-xs text-ink-gray-6">
                {zh ? "由谁来做" : "Who does it"}
                <select
                  value={row.value.agent}
                  disabled={!canEdit || pending}
                  onChange={(e) => save(row.key, { agent: e.target.value as AgentKey })}
                  className="h-7 rounded-lg border border-outline-gray-2 px-2 text-xs"
                >
                  {AGENT_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {zh ? AGENT_LABELS[key].nameLocal : AGENT_LABELS[key].name}
                    </option>
                  ))}
                </select>
              </label>

              {row.scheduled ? (
                <label style={{ display: "flex", alignItems: "center", gap: 7 }} className="text-xs text-ink-gray-6">
                  {zh ? "每天" : "Every day at"}
                  <input
                    type="time"
                    value={`${String(row.value.hour ?? 8).padStart(2, "0")}:${String(row.value.minute ?? 0).padStart(2, "0")}`}
                    disabled={!canEdit || pending}
                    onChange={(e) => {
                      const [h, m] = e.target.value.split(":").map(Number);
                      if (Number.isInteger(h) && Number.isInteger(m)) save(row.key, { hour: h, minute: m });
                    }}
                    className="h-7 rounded-lg border border-outline-gray-2 px-2 text-xs"
                  />
                  <span>{zh ? "香港时间" : "HKT"}</span>
                </label>
              ) : (
                <span className="text-xs text-ink-gray-5">
                  {zh ? "素材转写完成后触发" : "Runs when an upload has been transcribed"}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {!canEdit && (
        <p className="mt-3 text-xs text-ink-gray-5">
          {zh ? "只有所有者和管理员可以修改。" : "Only an owner or an administrator can change these."}
        </p>
      )}
    </section>
  );
}

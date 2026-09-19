import { requireModule } from "@/lib/auth/dal";
import { DesignPreview } from "@/components/shell/DesignPreview";

/** Approved design, not yet wired to data. Entitlement is still enforced:
 * someone without the module is sent away, exactly as for a live one. */
export default async function Page() {
  const viewer = await requireModule("legal");
  return <DesignPreview module="legal" zh={(viewer.locale ?? "zh-CN").startsWith("zh")} />;
}

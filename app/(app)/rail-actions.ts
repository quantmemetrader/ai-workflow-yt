"use server";

import { getViewer } from "@/lib/auth/dal";
import { cleanRailLayout } from "@/lib/nav-layout";
import { setRailLayout } from "@/lib/rail-layout";

/** Saving this person's rail arrangement; `null` puts the studio's default back. */
export async function saveRailLayoutAction(layout: unknown): Promise<{ ok: boolean }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false };
  await setRailLayout(viewer.id, layout === null ? null : cleanRailLayout(layout));
  return { ok: true };
}

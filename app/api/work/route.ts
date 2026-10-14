import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { listWork } from "@/lib/work/tracker";

export const dynamic = "force-dynamic";

/** The task tracker's poll: every job and AI turn in flight for this person (15 Oct). */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ items: [] }, { status: 401 });
  const items = await listWork(viewer).catch((err) => {
    console.error("[work] list failed", err);
    return [];
  });
  return NextResponse.json({ at: new Date().toISOString(), items }, { headers: { "Cache-Control": "no-store" } });
}

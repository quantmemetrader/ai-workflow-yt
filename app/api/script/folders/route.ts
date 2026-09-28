import { getViewer } from "@/lib/auth/dal";
import { scriptPickerGroups } from "@/lib/script/folders";

/** The script picker's list (`components/projects/ScriptPicker.tsx`): every script this person may open, by project folder. */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return new Response("Not signed in", { status: 401 });
  if (!viewer.modules.includes("script")) return Response.json({ groups: [] });
  const groups = await scriptPickerGroups(viewer);
  return Response.json({ groups }, { headers: { "cache-control": "no-store" } });
}

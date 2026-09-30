import { getViewer } from "@/lib/auth/dal";
import { providerModels } from "@/lib/ai/catalog";

/** Every model the studio's key can call, for the model pickers. */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Not signed in" }, { status: 401 });
  const models = await providerModels();
  return Response.json({ models }, { headers: { "Cache-Control": "private, max-age=600" } });
}

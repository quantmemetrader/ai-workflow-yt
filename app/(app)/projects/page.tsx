import { requireModule } from "@/lib/auth/dal";
import { listProjectStages } from "@/lib/projects/service";
import { ProjectsList } from "@/components/projects/ProjectsList";

export const metadata = { title: "项目 · Projects" };

/**
 * Every project the person may see, newest activity first.
 *
 * Read with `listProjectStages` rather than `listWorkProjects`: the cards here
 * are Home's project cards (the five steps, where it has got to, whose turn it
 * is, a picture from the first clip), and that one query already works out
 * the steps for every project with the same `buildSteps` the project page
 * uses. Two hundred is the most it returns; a studio with more than that has
 * the search box.
 */
export default async function ProjectsPage() {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const rows = await listProjectStages(viewer, { limit: 200, zh });
  return (
    <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", backgroundColor: "#f4f3f0", backgroundImage: "radial-gradient(#d8d5cf 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
      <ProjectsList
        zh={zh}
        rows={rows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          mode: r.mode,
          updatedAt: r.updatedAt,
          when: stamp(r.updatedAt, zh),
          mine: r.createdBy === viewer.id,
          access: r.access,
          steps: r.steps,
          frontier: r.frontier,
          thumbFileId: r.thumbFileId,
        }))}
      />
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "9月26日 03:39", in the studio's own clock (Hong Kong, UTC+8, no summer
 * time), worked out here on the server and handed down as text.
 *
 * The list used to format this with `Intl.DateTimeFormat` inside the client
 * component, which is formatting that depends on the ICU data of whichever
 * runtime draws it — Node on the server, the browser on hydration — and the
 * two do not always agree on the spacing or the month word. Plain arithmetic
 * on a fixed offset says the same thing everywhere.
 */
function stamp(iso: string, zh: boolean): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const d = new Date(at + 8 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return zh ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${time}` : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${time}`;
}

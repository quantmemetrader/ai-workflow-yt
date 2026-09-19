import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/dal";

export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  // Land on the first module this person actually holds: a member with two
  // modules must get a complete product, not a broken default.
  const first = ["chat", "files", "research", "script", "video", "publish"].find((m) =>
    viewer.modules.includes(m as never),
  );
  redirect(first ? `/${first}` : "/settings");
}

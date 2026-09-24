import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/dal";

export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  /* 首页 if they have Chat, which is where the day is. Otherwise the first
     module this person actually holds: somebody with two modules must get a
     complete product, not a broken default. */
  if (viewer.modules.includes("chat")) redirect("/home");

  const first = ["files", "research", "script", "video", "publish"].find((m) =>
    viewer.modules.includes(m as never),
  );
  redirect(first ? `/${first}` : "/settings");
}

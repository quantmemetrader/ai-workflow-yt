import { ScriptDocPage } from "@/components/script/doc/ScriptDocPage";

export const metadata = { title: "脚本" };

/** The project's 脚本 tab. */
export default async function ProjectScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScriptDocPage id={id} />;
}

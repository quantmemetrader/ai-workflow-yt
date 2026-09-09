import { ModuleStub } from "@/components/ModuleStub";

export default function VideoPage() {
  return (
    <ModuleStub
      title="Video Edit"
      spec="Build-Spec §4.5"
      summary="Locked script drives a shot list against the media bin. Render queue tracks generation and render jobs (Veo 3.1 via Vertex). Preview, audio panel, and multi-format export."
      screens={[
        "Project workspace",
        "Media bin",
        "Render queue",
        "Preview",
        "Audio panel",
        "Export",
      ]}
    />
  );
}

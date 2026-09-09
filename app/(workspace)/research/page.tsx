import { ModuleStub } from "@/components/ModuleStub";

export default function ResearchPage() {
  return (
    <ModuleStub
      title="Market Research"
      spec="Build-Spec §4.3"
      summary="Trends, search and compare, content performance, comment inbox, and topic backlog — sourced from GDELT, YouTube mostPopular, and Google Trends."
      screens={[
        "Trends dashboard",
        "Search and compare",
        "Content performance",
        "Comment inbox",
        "Topic backlog",
      ]}
    />
  );
}

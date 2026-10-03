import PageSkeleton from "@/components/canvas/PageSkeleton";

/* Only the lists stream behind this skeleton. A folder or file page renders
   whole before sending, so an unknown or purged id answers with a real 404
   status (QA, 4 Oct); under a loading boundary the 200 has already gone out. */
export default function Loading() {
  return <PageSkeleton />;
}

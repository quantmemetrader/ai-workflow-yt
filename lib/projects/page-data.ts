import { cache } from "react";
import type { Viewer } from "@/lib/auth/dal";
import { workProjectDetail } from "@/lib/projects/service";

/**
 * The project for its pages, read once per request: the layout (header and
 * tabs) and the page under it both call this, and React's `cache` hands the
 * second caller the first one's result.
 */
export const projectForPage = cache((viewer: Viewer, id: string, zh: boolean) => workProjectDetail(viewer, id, zh));

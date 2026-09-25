import "server-only";
import type { Viewer } from "@/lib/auth/types";
import type { Idea } from "@/lib/ideas/types";

/**
 * The ideas Home shows: the latest batch 研究员 generated for this studio,
 * newest first, without the dismissed ones.
 *
 * Placeholder until the ideas service lands; the signature is the contract.
 */
export async function latestIdeas(viewer: Viewer, limit = 6): Promise<Idea[]> {
  void viewer;
  void limit;
  return [];
}

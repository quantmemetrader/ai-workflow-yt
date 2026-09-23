import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { readChallenge } from "@/lib/auth/second-factor";
import { VerifyForm } from "./verify-form";

export const metadata = { title: "Two-step verification — Aura Farmers" };

/**
 * The second step, transcribed from design/canvas/Login-Totp.dc.html.
 *
 * Reachable only while a challenge cookie is live: without one there is
 * nothing to verify *against*, so it sends you back to the password screen
 * rather than showing a code box that can never be right.
 */
export default async function VerifyPage() {
  const userId = await readChallenge();
  if (!userId) redirect("/login");

  const [user] = await db
    .select({ email: users.email, recovery: users.totpRecovery })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) redirect("/login");

  return <VerifyForm email={user.email} recoveryLeft={(user.recovery ?? []).length} />;
}

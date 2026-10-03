/**
 * Who the browser checks sign in as.
 *
 * OWNER_EMAIL + OWNER_PASSWORD from the environment when both are set;
 * otherwise the QA admin account in /home/ubuntu/lead_tools/.qa-cred (one line,
 * "email:password"; override the path with QA_CRED_FILE). No password lives in
 * this repository — it is public.
 */
import fs from "node:fs";

export function ownerCred() {
  const email = process.env.OWNER_EMAIL?.trim();
  const password = process.env.OWNER_PASSWORD;
  if (email && password) return { email, password };

  const file = process.env.QA_CRED_FILE || "/home/ubuntu/lead_tools/.qa-cred";
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8").trim();
  } catch {
    /* fall through to the message below */
  }
  const m = raw.match(/^(\S+?)[:\s]+(\S+)$/);
  if (m) return { email: m[1], password: m[2] };

  console.error(
    `No sign-in credentials: set OWNER_EMAIL and OWNER_PASSWORD, or put "email:password" in ${file}.`,
  );
  process.exit(1);
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/dal";
import { LANG_COOKIE, type Locale } from "@/lib/i18n";
import { safeNext } from "@/lib/auth/next-path";
import { LoginForm } from "./login-form";

export const metadata = { title: "登录" };

const LOCALES: Locale[] = ["zh-CN", "en"];

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next);
  if (await getViewer()) redirect(next ?? "/home");

  /* Whatever this browser's last signed-in person reads in. Without it the
     screen opened in Chinese for everybody, every time. */
  const remembered = (await cookies()).get(LANG_COOKIE)?.value;
  const locale = LOCALES.includes(remembered as Locale) ? (remembered as Locale) : null;

  return <LoginForm locale={locale} next={next} />;
}

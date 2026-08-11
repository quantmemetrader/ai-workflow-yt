import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LANGS, isLang, type Lang } from "@/lib/i18n";
import { resolveSession } from "@/lib/server/origin";
import { LoginForm } from "@/components/app/LoginForm";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang = raw as Lang;

  const session = await resolveSession();
  if (session) redirect(`/${lang}/workspace`);

  return <LoginForm lang={lang} />;
}

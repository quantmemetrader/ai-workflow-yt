import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LANGS, isLang, type Lang } from "@/lib/i18n";
import { resolveSession } from "@/lib/server/origin";
import { Workspace } from "@/components/app/Workspace";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export const metadata: Metadata = { title: "Workspace" };

/* The app is the whole page. No marketing chrome above it. */
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang = raw as Lang;

  const session = await resolveSession();
  if (!session) redirect(`/${lang}/login`);

  return <Workspace lang={lang} session={session} />;
}

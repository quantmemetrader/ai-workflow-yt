import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-neutral-500">Aura Farmers, Inc. · internal</p>
      <h1 className="text-3xl font-semibold text-neutral-900">Video Agent Platform</h1>
      <p className="max-w-md text-neutral-600">
        Scaffold stage. Built against{" "}
        <code className="rounded bg-neutral-100 px-1 py-0.5">01_Build-Spec 2.pdf</code>
        , the project&apos;s source of truth.
      </p>
      <Link
        href="/chat"
        className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Enter workspace
      </Link>
    </main>
  );
}

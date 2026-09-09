type ModuleStubProps = {
  title: string;
  spec: string;
  summary: string;
  screens?: string[];
};

export function ModuleStub({ title, spec, summary, screens }: ModuleStubProps) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm text-neutral-500">{spec}</p>
      <h1 className="mt-1 text-2xl font-semibold text-neutral-900">{title}</h1>
      <p className="mt-3 text-neutral-600">{summary}</p>
      {screens && screens.length > 0 && (
        <ul className="mt-6 space-y-2 text-sm text-neutral-700">
          {screens.map((screen) => (
            <li key={screen} className="rounded-md border border-neutral-200 px-3 py-2">
              {screen}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-8 text-sm text-neutral-400">Not implemented yet.</p>
    </div>
  );
}

import fs from "fs/promises";
import path from "path";
import Link from "next/link";

type Subpage = {
  href: string;
  label: string;
  segments: string[];
};

const PAGE_REGEX = /^page\.(tsx|ts|js|jsx|mdx)$/;
const EXCLUDED_DIRS = new Set(["api"]);

// Discover page routes by walking the app directory. Skips the root page and dynamic/api routes.
async function discoverSubpages(dir: string, segments: string[] = []): Promise<Subpage[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const hasPageFile = entries.some((entry) => entry.isFile() && PAGE_REGEX.test(entry.name));
  const isRoot = segments.length === 0;
  const subpages: Subpage[] = [];

  if (hasPageFile && !isRoot) {
    const href = `/${segments.join("/")}`;
    subpages.push({
      href,
      label: formatLabel(segments[segments.length - 1]),
      segments,
    });
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith("[") || entry.name.startsWith("_") || entry.name.startsWith("(")) continue;

    const childDir = path.join(dir, entry.name);
    const childSegments = [...segments, entry.name];
    const childPages = await discoverSubpages(childDir, childSegments);
    subpages.push(...childPages);
  }

  return subpages;
}

function formatLabel(slug: string) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function Home() {
  const subpages = await discoverSubpages(path.join(process.cwd(), "app"));

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-sky-50 text-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-16 md:px-10 lg:px-12">
        <header className="space-y-4">
          <p className="text-sm uppercase tracking-[0.3em] text-sky-600 dark:text-sky-300">Navigation Hub</p>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <h1 className="text-4xl font-semibold leading-tight text-slate-900 dark:text-white md:text-5xl">
              Explore every corner
            </h1>
            <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              {subpages.length} active subpage{subpages.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="max-w-2xl text-base text-slate-600 dark:text-slate-300">
            The site map below pulls straight from the folder structure, so new sections show up here automatically.
            Jump into any workspace to continue where you left off.
          </p>
        </header>

        <section
          className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
          aria-label="Available subpages"
        >
          {subpages.length === 0 ? (
            <div className="col-span-full rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              No subpages detected yet. Add a <code className="font-mono">page.tsx</code> under <code className="font-mono">app/</code>{" "}
              to have it appear here.
            </div>
          ) : (
            subpages.map((page, index) => (
              <Link
                key={page.href}
                href={page.href}
                className={`group relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-7 shadow-xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_80px_-30px_rgba(15,23,42,0.35)] dark:border-slate-700 dark:bg-slate-900 ${index % 5 === 0 ? "md:col-span-2" : ""}`}
              >
                <div className="pointer-events-none absolute -left-6 -top-6 h-28 w-28 rounded-full bg-gradient-to-br from-sky-400/30 via-teal-300/20 to-transparent blur-3xl transition duration-500 group-hover:scale-110" />
                <div className="pointer-events-none absolute -right-10 -bottom-10 h-32 w-32 rounded-full bg-gradient-to-br from-amber-300/25 via-pink-300/15 to-transparent blur-3xl transition duration-500 group-hover:scale-110" />

                <div className="relative flex items-start justify-between">
                  <div className="flex flex-col gap-2">
                    <span className="text-sm uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">{page.href}</span>
                    <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">{page.label}</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-300">
                      {page.segments.length > 1
                        ? `Nested under ${page.segments.slice(0, -1).join(" / ")}`
                        : "Top-level experience"}
                    </p>
                  </div>
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-lg text-sky-700 transition duration-300 group-hover:rotate-6 group-hover:bg-sky-100 dark:bg-sky-900/50 dark:text-sky-200 dark:group-hover:bg-sky-900/70">
                    ↗
                  </span>
                </div>
              </Link>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

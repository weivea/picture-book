import { mkdir, writeFile, readFile } from "fs/promises";
import { basename, join } from "path";
import { spawnSync } from "child_process";
import { loadVolumeContext } from "./load-context";
import { composePagePrompt, type PageInput } from "./compose-prompt";
import { verifyPages } from "./verify-pages";
import { updateState } from "../../series-bible-creator/scripts/lib/state";
import { parseOutline, serializeOutline } from "../../series-season-planner/scripts/outline-parse";

export interface OrchestrateOptions {
  seriesRoot: string;
  volumeId: string;
  pages: PageInput[];          // pre-parsed per-page script (cover + body)
  title: string;
  /** Caller-supplied image generator. Tests pass in a mock; real callers shell out. */
  generateImage: (prompt: string, outputPath: string) => Promise<void>;
  /** Caller-supplied EPUB builder; defaults to invoking generate-epub.ts. */
  buildEpub?: (volumeDir: string, title: string, lang: string) => Promise<string>;
}

export async function orchestrateVolume(opts: OrchestrateOptions): Promise<{ phase: string; epubPath: string }> {
  if (opts.pages.length === 0) throw new Error("orchestrateVolume requires at least one page");
  if (!opts.title.trim()) throw new Error("orchestrateVolume requires a non-empty title");
  const seenPages = new Set<number>();
  for (const p of opts.pages) {
    if (!Number.isInteger(p.pageNumber) || p.pageNumber < 0) {
      throw new Error(`page.pageNumber must be a non-negative integer, got ${p.pageNumber}`);
    }
    if (seenPages.has(p.pageNumber)) {
      throw new Error(`duplicate page.pageNumber ${p.pageNumber}`);
    }
    seenPages.add(p.pageNumber);
  }

  const ctx = await loadVolumeContext(opts.seriesRoot, opts.volumeId);
  const volumeDir = join(opts.seriesRoot, "volumes", opts.volumeId);
  await mkdir(join(volumeDir, "prompts"), { recursive: true });

  // Step 5: write per-page prompts.
  for (const page of opts.pages) {
    const prompt = composePagePrompt({ ctx, page });
    await writeFile(join(volumeDir, "prompts", `${page.pageNumber}.txt`), prompt, "utf-8");
  }

  // Step 6: generate images (caller controls actual mechanism; tests mock).
  for (const page of opts.pages) {
    const prompt = await readFile(join(volumeDir, "prompts", `${page.pageNumber}.txt`), "utf-8");
    await opts.generateImage(prompt, join(volumeDir, `${page.pageNumber}.png`));
  }

  // Step 6.3: verify.
  const totalPages = opts.pages.length;
  const v = await verifyPages(volumeDir, totalPages);
  if (v.failed.length > 0) {
    throw new Error(`page generation failures: ${JSON.stringify(v.failed)}`);
  }
  await updateState(opts.seriesRoot, (s) => {
    s.volumes[opts.volumeId] = { ...(s.volumes[opts.volumeId] ?? { season: ctx.season?.id ?? null }), phase: "imaged" };
  });

  // Step 7: build EPUB.
  const builder = opts.buildEpub ?? defaultBuildEpub;
  const epubPath = await builder(volumeDir, opts.title, ctx.meta.language);

  // Step 7 (cont.): write per-volume meta.json (spec §4.7).
  const meta = {
    volume_id: opts.volumeId,
    season: ctx.season?.id ?? null,
    title: opts.title,
    pages: totalPages,
    built_at: new Date().toISOString(),
    outputs: {
      epub: basename(epubPath),
    },
  };
  await writeFile(join(volumeDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf-8");

  // Step 9: update state + outline if pages changed.
  await updateState(opts.seriesRoot, (s) => {
    s.volumes[opts.volumeId] = {
      ...(s.volumes[opts.volumeId] ?? {}),
      season: ctx.season?.id ?? null,
      phase: "packaged",
      pages: totalPages,
      built_at: new Date().toISOString(),
    };
  });
  if (ctx.outlineEntry && ctx.outlineEntry.planned_pages !== totalPages && ctx.season) {
    const outlinePath = join(opts.seriesRoot, "seasons", ctx.season.id, "volumes-outline.md");
    const outline = parseOutline(await readFile(outlinePath, "utf-8"));
    const entry = outline.volumes.find((v) => v.id === opts.volumeId);
    if (entry) entry.planned_pages = totalPages;
    outline.revision++;
    await writeFile(outlinePath, serializeOutline(outline), "utf-8");
  }

  return { phase: "packaged", epubPath };
}

async function defaultBuildEpub(volumeDir: string, title: string, lang: string): Promise<string> {
  const script = join(import.meta.dir, "..", "..", "picture-book-creator", "scripts", "generate-epub.ts");
  const r = spawnSync("bun", ["run", script, "--input", volumeDir, "--title", title, "--lang", lang], {
    encoding: "utf-8", stdio: ["ignore", "inherit", "inherit"],
  });
  if (r.status !== 0) throw new Error(`generate-epub.ts exited ${r.status}`);
  return join(volumeDir, `${title}.epub`);
}

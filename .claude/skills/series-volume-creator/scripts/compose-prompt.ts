export interface BibleStyle {
  promptPrefix: string;
  negative: string;
}

export interface BibleCharacter {
  name: string;
  prompt_anchor: string;
  negative?: string;
}

export interface PatchEntry {
  name: string;
  anchor: string;
}

export interface PageSpec {
  page_number: number;
  text: string;
  scene: string;
  action: string;
  emotion: string;
  composition: string;
}

export interface ComposeInput {
  style: BibleStyle;
  characters: BibleCharacter[];
  patches: PatchEntry[];
  page: PageSpec;
}

const BOILERPLATE_NEGATIVE =
  "no watermark, no signature, no realistic photo, no anatomically incorrect features";

export function composePrompt(input: ComposeInput): string {
  const { style, characters, patches, page } = input;

  // 1. STYLE
  const styleSection = `[STYLE]\n${style.promptPrefix}`;

  // 2. CHARACTERS
  const charLines = characters.map((c) => {
    const patch = patches.find((p) => p.name === c.name);
    const anchor = patch ? `${c.prompt_anchor}, ${patch.anchor}` : c.prompt_anchor;
    return `${c.name}: ${anchor} (mood: ${page.emotion})`;
  });
  const charSection = `[CHARACTERS]\n${charLines.join("\n")}`;

  // 3. SCENE
  const sceneSection =
    `[SCENE]\nscene: ${page.scene}\naction: ${page.action}\ncomposition: ${page.composition}`;

  // 4. TEXT
  const textSection =
    `[TEXT]\nRender the following children's-book line into the page in a position that suits the composition, in the style of the bible: "${page.text}"`;

  // 5. NEGATIVE
  const charNegatives = characters
    .map((c) => c.negative)
    .filter((s): s is string => Boolean(s && s.trim().length > 0));
  const negative = [style.negative, ...charNegatives, BOILERPLATE_NEGATIVE].join(", ");
  const negativeSection = `[NEGATIVE]\n${negative}`;

  return [styleSection, charSection, sceneSection, textSection, negativeSection].join("\n\n");
}

// ----- High-level adapter used by series-volume-creator orchestrator -----

/**
 * Per-page input the orchestrator passes in. Equivalent to PageSpec but
 * named for the orchestrator's vocabulary, plus a `characters` field that
 * lists which character names appear on this page (so the composer doesn't
 * need to grep the scene text).
 */
export interface PageInput {
  pageNumber: number;
  text: string;
  scene: string;
  action: string;
  emotion: string;
  composition: string;
  characters: string[];          // character names from script.md for this page
}

/**
 * Convenience adapter that pulls style/characters/patch out of a loaded
 * VolumeContext and delegates to composePrompt. The orchestrator (Task 9)
 * calls this — keeping VolumeContext-typed dependencies isolated to one
 * function makes composePrompt itself easy to unit-test in isolation.
 */
export interface ComposePageArgs {
  ctx: {
    style: string;                                    // raw style.md text
    characters: Map<string, { prompt_anchor: string; negative?: string }>;
    patch: Map<string, string> | null;
  };
  page: PageInput;
}

export function composePagePrompt(args: ComposePageArgs): string {
  const { ctx, page } = args;
  const style = parseStyle(ctx.style);
  const charactersOnPage: BibleCharacter[] = page.characters.map((name) => {
    const c = ctx.characters.get(name);
    if (!c) throw new Error(`character "${name}" not found in bible characters.md`);
    return { name, prompt_anchor: c.prompt_anchor, negative: c.negative };
  });
  const patches: PatchEntry[] = ctx.patch
    ? page.characters
        .map((name) => {
          const a = ctx.patch!.get(name);
          return a ? { name, anchor: a } : null;
        })
        .filter((p): p is PatchEntry => p !== null)
    : [];
  const pageSpec: PageSpec = {
    page_number: page.pageNumber,
    text: page.text,
    scene: page.scene,
    action: page.action,
    emotion: page.emotion,
    composition: page.composition,
  };
  return composePrompt({ style, characters: charactersOnPage, patches, page: pageSpec });
}

/**
 * Extract `style_prompt` and `negative_prompt` from a bible/style.md.
 * Format (per series-bible-creator output):
 *   - style_prompt: <english phrase>
 *   - negative_prompt: <english phrase>
 */
function parseStyle(md: string): BibleStyle {
  const promptPrefix = field(md, "style_prompt") ?? "";
  const negative = field(md, "negative_prompt") ?? "";
  if (!promptPrefix) throw new Error("style.md missing `- style_prompt: ...` line");
  return { promptPrefix, negative };
}

function field(md: string, key: string): string | undefined {
  const re = new RegExp(`^- ${key}:\\s*(.+)$`, "m");
  const m = md.match(re);
  return m ? m[1]!.trim() : undefined;
}

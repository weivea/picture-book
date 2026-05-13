// .claude/skills/image-generation/scripts/lib/input-fidelity.ts
//
// Parser for IMAGE_GEN_INPUT_FIDELITY env. Returns one of "high"|"low"|"auto"|"off".
// Default = "high". Throws on invalid value (caller should die() on the message).

export type InputFidelity = "high" | "low" | "auto" | "off";

const ALLOWED = new Set<InputFidelity>(["high", "low", "auto", "off"]);

export function readInputFidelity(): InputFidelity {
  const raw = process.env.IMAGE_GEN_INPUT_FIDELITY;
  if (raw === undefined) return "high";
  const v = raw.trim();
  if (v === "") return "high";
  if (ALLOWED.has(v as InputFidelity)) return v as InputFidelity;
  throw new Error(
    `IMAGE_GEN_INPUT_FIDELITY 必须是 high|low|auto|off，收到 "${raw}"`,
  );
}

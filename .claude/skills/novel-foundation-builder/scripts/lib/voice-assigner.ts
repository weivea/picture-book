// .claude/skills/novel-foundation-builder/scripts/lib/voice-assigner.ts

export interface CharacterForVoice {
  name: string;
  role: string; // 主角 / 对手 / 导师 / 配角 / 反派 / 盟友 / 旁白
  gender_hint: "male" | "female";
}

interface VoiceEntry {
  id: string;
  gender: "male" | "female";
  notes: string;
}

interface ParsedCatalog {
  protagonist: VoiceEntry[]; // 主角池
  supporting: VoiceEntry[]; // 配角池
  narrator: VoiceEntry | null;
}

function parseCatalog(catalog: string): ParsedCatalog {
  const sections: Record<string, VoiceEntry[]> = {};
  let current = "";
  for (const line of catalog.split("\n")) {
    const head = line.match(/^##\s+(.+)/);
    if (head) {
      current = head[1].trim();
      sections[current] = [];
      continue;
    }
    const item = line.match(/^-\s+([\w-]+)\s*\|\s*(male|female)\s*\|\s*(.+)$/);
    if (item && current) {
      sections[current].push({ id: item[1], gender: item[2] as "male" | "female", notes: item[3] });
    }
  }
  return {
    protagonist: sections["主角推荐"] ?? [],
    supporting: sections["配角池"] ?? [],
    narrator: sections["旁白"]?.[0] ?? null,
  };
}

export function assignVoices(
  chars: CharacterForVoice[],
  catalog: string,
): Record<string, string> {
  const parsed = parseCatalog(catalog);
  const result: Record<string, string> = {};
  const usedSupporting = new Set<string>();

  // 排序保证确定性：先主角，再按角色名字典序
  const sorted = [...chars].sort((a, b) => {
    const roleOrder = (r: string) =>
      r === "主角" ? 0 : r === "旁白" ? 1 : 2;
    const ra = roleOrder(a.role);
    const rb = roleOrder(b.role);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  for (const c of sorted) {
    if (c.role === "旁白") {
      if (!parsed.narrator) throw new Error("catalog 缺旁白池");
      result[c.name] = parsed.narrator.id;
      continue;
    }

    if (c.role === "主角") {
      const pick = parsed.protagonist.find((v) => v.gender === c.gender_hint);
      if (pick) {
        result[c.name] = pick.id;
        usedSupporting.add(pick.id);
        continue;
      }
    }

    // 配角：按 gender 取第一个未用的
    let pick = parsed.supporting.find(
      (v) => v.gender === c.gender_hint && !usedSupporting.has(v.id),
    );
    // 池耗尽兜底：允许跨性别，最后允许复用
    pick ??= parsed.supporting.find((v) => !usedSupporting.has(v.id));
    pick ??= parsed.supporting[0];
    if (!pick) throw new Error("catalog 配角池为空");
    result[c.name] = pick.id;
    usedSupporting.add(pick.id);
  }

  return result;
}

# Edge-TTS 中文 Voice 目录（用于多角色配音映射）

> 由 `novel-foundation-builder/scripts/lib/voice-assigner.ts` 在生成 `voices.json` 时消费。
> `audio-novel-packager/scripts/lib/speaker-attribution.ts` 在解析对话后查表。

## Schema

每条记录必须可被 `voice-assigner.ts` 直接 import：

```typescript
export interface VoiceProfile {
  id: string;           // edge-tts voice id（zh-CN-... Neural）
  gender: "male" | "female";
  ageBand: "child" | "young" | "adult" | "elder";
  timbre: string;       // 中文一句话定位
  bestFor: string[];    // 适配角色类型
  rate?: string;        // 推荐语速覆写（默认 +0%）
  notes?: string;
}
```

## 旁白 NARRATOR（默认）

| id | 定位 |
|---|---|
| `zh-CN-YunyangNeural` | 男声沉稳，适合第三人称限定 POV 旁白；可读性强、停顿自然 |

备选：`zh-CN-YunjianNeural`（更厚重，适合史诗 / 严肃题材）。

## 男声

| id | gender | age | timbre | bestFor |
|---|---|---|---|---|
| `zh-CN-YunyangNeural` | male | adult | 沉稳新闻播报 | 旁白 / 中年男性 |
| `zh-CN-YunjianNeural` | male | adult | 厚重磁性 | 父亲 / 军人 / 反派 |
| `zh-CN-YunxiNeural` | male | young | 清亮温和 | 男主角 / 学生 / 温柔型 |
| `zh-CN-YunxiaNeural` | male | child | 童声活泼 | 小男孩 |
| `zh-CN-YunfengNeural` | male | adult | 文艺低沉 | 学者 / 文人 / 内省型 |
| `zh-CN-YunhaoNeural` | male | adult | 解说风格 | 配角 / 副 NARRATOR |

## 女声

| id | gender | age | timbre | bestFor |
|---|---|---|---|---|
| `zh-CN-XiaoxiaoNeural` | female | adult | 标准甜美 | 女主角 / 都市女性 |
| `zh-CN-XiaoyiNeural` | female | child | 童声 | 小女孩 / 儿童（picture-book 默认） |
| `zh-CN-XiaohanNeural` | female | adult | 温润成熟 | 母亲 / 师姐 / 知识女性 |
| `zh-CN-XiaomoNeural` | female | adult | 清冷理性 | 女反派 / 冷淡型 / 高知 |
| `zh-CN-XiaoxuanNeural` | female | adult | 古风 | 古装 / 仙侠女主 |
| `zh-CN-XiaoruiNeural` | female | elder | 老年女性 | 奶奶 / 长辈 |
| `zh-CN-XiaoshuangNeural` | female | child | 萌系童声 | 小女孩备选 |
| `zh-CN-XiaoqiuNeural` | female | elder | 沉稳长辈 | 母亲 / 教师 |

## 自动分配策略（voice-assigner.ts）

1. NARRATOR 永远 = `zh-CN-YunyangNeural`（除非 user 在 voice.md 显式覆盖）
2. 主角先匹配 gender + ageBand → 同档随机选 1 个，记入 voices.json
3. 配角与主角同 gender + ageBand 时，从剩余池里挑（避免重复 voice）
4. 全角色超过 8 个时：长尾配角共用一个"群众 voice"（NARRATOR 备选 `zh-CN-YunhaoNeural`）
5. 性别 / 年龄段不明 → 由 LLM 在生成 characters.md 时填补，再分配

## 限制

- edge-tts 不支持音色克隆。需要复刻特定演员声线 → 切到 CosyVoice 2 / GPT-SoVITS（v2 候选）
- audio_tag（如 `[whisper]`）目前在 edge-tts 上效果有限，主要靠 rate / pitch 微调（保留接口，渲染时自适配）

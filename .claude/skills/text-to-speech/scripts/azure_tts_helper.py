#!/usr/bin/env python3
"""
Azure Speech helper：把一段文本合成为 mp3 + WordBoundary 序列。

与 generate-audio.ts 的契约（与原 edge_tts_helper.py 完全一致，可无缝替换）：
  - 文本从 stdin 读
  - 参数从 argv 解析: --voice / --rate / --volume / --pitch
  - mp3 二进制 → stdout
  - WordBoundary 事件 → stderr，每行一个 JSON：
      {"offset_us": 1230000, "duration_us": 320000, "text": "毛毛"}
  - 完成后 stderr 末行：{"type":"done"}
  - 出错：stderr 单行 {"type":"error","message":"..."}，exit 1

鉴权（复用项目 .env 模式）：
  AZURE_SPEECH_KEY       必需
  AZURE_SPEECH_ENDPOINT  必需，形如 https://<resource>.cognitiveservices.azure.com/
两者从 process env 或 <repo>/.env（从本脚本所在 venv 推导 repo root）加载。
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
from xml.sax.saxutils import escape as xml_escape, quoteattr


def _emit_error(message: str) -> int:
    print(json.dumps({"type": "error", "message": message}, ensure_ascii=False),
          file=sys.stderr, flush=True)
    return 1


def load_env() -> None:
    """
    加载 .env：起点优先用本脚本所在的 venv 推导 repo root（.venv/bin/python ->
    repo root），避免调用方 cwd 漂移导致找错/找不到 .env。再兜底从 cwd 向上找。
    已存在的环境变量不覆盖。
    """
    candidates = []
    # 1) 由 venv python 推导：sys.executable = <repo>/.venv/bin/python
    try:
        exe = Path(sys.executable).resolve()
        # parents: bin -> .venv -> repo root
        if exe.parent.name == "bin" and exe.parent.parent.name == ".venv":
            candidates.append(exe.parent.parent.parent / ".env")
    except Exception:
        pass
    # 2) 从 cwd 向上递归
    d = Path.cwd().resolve()
    while True:
        candidates.append(d / ".env")
        if d.parent == d:
            break
        d = d.parent

    for cand in candidates:
        if cand.exists():
            for raw in cand.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip()
                if (v.startswith('"') and v.endswith('"')) or (
                    v.startswith("'") and v.endswith("'")
                ):
                    v = v[1:-1]
                os.environ.setdefault(k, v)
            return


# prosody 取值白名单（防止非法值导致整段 SSML 被服务拒绝）
_RATE_RE = re.compile(r"^([+-]?\d+(\.\d+)?%|x-slow|slow|medium|fast|x-fast|default)$")
_VOLUME_RE = re.compile(
    r"^([+-]?\d+(\.\d+)?%|\d+(\.\d+)?|silent|x-soft|soft|medium|loud|x-loud|default)$"
)
_PITCH_RE = re.compile(
    r"^([+-]?\d+(\.\d+)?(Hz|st|%)|x-low|low|medium|high|x-high|default)$"
)

# 视为「中性、可省略」的默认值
_NEUTRAL_VOLUME = {"+0%", "+0.00%", "0%", "default", ""}
_NEUTRAL_PITCH = {"+0Hz", "+0.00Hz", "+0%", "0Hz", "default", ""}
_NEUTRAL_RATE = {"+0%", "+0.00%", "0%", "default", ""}


def derive_xml_lang(voice: str) -> str:
    """从 voice 前缀推导 xml:lang，如 zh-CN-XiaoyiNeural -> zh-CN。失败回退 zh-CN。"""
    parts = voice.split("-")
    if len(parts) >= 2 and parts[0] and parts[1]:
        return f"{parts[0]}-{parts[1]}"
    return "zh-CN"


def build_ssml(text: str, voice: str, rate: str, volume: str, pitch: str) -> str:
    """构造 SSML：正文 XML 转义，属性走白名单校验 + quoteattr，省略中性 prosody 属性。"""
    lang = derive_xml_lang(voice)
    body = xml_escape(text)

    attrs = []
    if rate not in _NEUTRAL_RATE:
        if not _RATE_RE.match(rate):
            raise ValueError(f"非法 rate: {rate}")
        attrs.append(f"rate={quoteattr(rate)}")
    if volume not in _NEUTRAL_VOLUME:
        if not _VOLUME_RE.match(volume):
            raise ValueError(f"非法 volume: {volume}")
        attrs.append(f"volume={quoteattr(volume)}")
    if pitch not in _NEUTRAL_PITCH:
        if not _PITCH_RE.match(pitch):
            raise ValueError(f"非法 pitch: {pitch}")
        attrs.append(f"pitch={quoteattr(pitch)}")

    inner = f"<prosody {' '.join(attrs)}>{body}</prosody>" if attrs else body

    return (
        f'<speak version="1.0" '
        f'xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xmlns:mstts="https://www.w3.org/2001/mstts" '
        f'xml:lang="{lang}">'
        f"<voice name={quoteattr(voice)}>{inner}</voice></speak>"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", default="zh-CN-XiaoyiNeural")
    parser.add_argument("--rate", default="-10%")
    parser.add_argument("--volume", default="+0%")
    parser.add_argument("--pitch", default="+0Hz")
    args = parser.parse_args()

    text = sys.stdin.read()
    if not text.strip():
        return _emit_error("text 为空")

    load_env()
    key = os.environ.get("AZURE_SPEECH_KEY")
    endpoint = os.environ.get("AZURE_SPEECH_ENDPOINT")
    if not key or not endpoint:
        return _emit_error(
            "Azure Speech 未配置：缺少 AZURE_SPEECH_KEY / AZURE_SPEECH_ENDPOINT。"
            "请在项目根 .env 填入（参考 .env.example）"
        )

    try:
        import azure.cognitiveservices.speech as speechsdk
    except ModuleNotFoundError:
        return _emit_error(
            "azure-cognitiveservices-speech 未安装。请在项目根运行："
            "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
        )

    try:
        ssml = build_ssml(text, args.voice, args.rate, args.volume, args.pitch)
    except ValueError as e:
        return _emit_error(f"参数非法：{e}")

    parsed = urlparse(endpoint)
    base_endpoint = f"{parsed.scheme}://{parsed.netloc}"

    try:
        speech_config = speechsdk.SpeechConfig(subscription=key, endpoint=base_endpoint)
        speech_config.speech_synthesis_voice_name = args.voice
        # 24kHz 96kbps 单声道 mp3：音质够用，且短音频（封面/标题）也稳超 5KB 验证阈值
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3
        )
        # audio_config=None → 音频走 result.audio_data（内存 buffer）
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=speech_config, audio_config=None
        )
    except Exception as e:
        return _emit_error(f"初始化失败：{e}")

    events = []

    def on_word_boundary(evt):
        dur = getattr(evt, "duration", None)
        duration_us = 0
        if dur is not None:
            try:
                duration_us = int(dur.total_seconds() * 1_000_000)
            except Exception:
                duration_us = 0
        events.append({
            # audio_offset 是 100ns ticks（微软标准），//10 转微秒
            "offset_us": int(evt.audio_offset) // 10,
            "duration_us": duration_us,
            "text": evt.text,
        })

    synthesizer.synthesis_word_boundary.connect(on_word_boundary)

    try:
        result = synthesizer.speak_ssml_async(ssml).get()
    except Exception as e:
        return _emit_error(f"网络错误：{e}")

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        audio = result.audio_data or b""
        if len(audio) == 0:
            return _emit_error("合成失败：服务未返回音频")
        # 按 offset 排序，避免回调乱序影响下游顺序 indexOf 匹配
        events.sort(key=lambda e: e["offset_us"])
        for ev in events:
            print(json.dumps(ev, ensure_ascii=False), file=sys.stderr, flush=True)
        sys.stdout.buffer.write(audio)
        sys.stdout.buffer.flush()
        print(json.dumps({"type": "done"}), file=sys.stderr, flush=True)
        return 0

    if result.reason == speechsdk.ResultReason.Canceled:
        cd = result.cancellation_details
        detail = cd.error_details or ""
        reason_name = str(cd.reason)
        low = detail.lower()
        if "429" in detail or "throttl" in low or "quota" in low or "rate limit" in low:
            return _emit_error(f"限流：Azure Speech 429（{detail}）")
        if "401" in detail or "403" in detail or "auth" in low or "forbidden" in low \
                or "subscription" in low:
            return _emit_error(f"鉴权失败：检查 AZURE_SPEECH_KEY / ENDPOINT（{detail}）")
        if "connection" in low or "timeout" in low or "timed out" in low \
                or "dns" in low or "network" in low:
            return _emit_error(f"网络错误：{detail}")
        return _emit_error(f"合成失败：{reason_name} {detail}".strip())

    return _emit_error(f"合成失败：未知 reason {result.reason}")


if __name__ == "__main__":
    sys.exit(main())

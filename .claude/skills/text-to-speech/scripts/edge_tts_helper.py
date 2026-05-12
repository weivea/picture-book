#!/usr/bin/env python3
"""
edge-tts helper: 把一段文本合成为 mp3 + WordBoundary 序列。

调用方约定（与 generate-audio.ts 配套）：
  - 文本从 stdin 读
  - 参数从 argv 解析: --voice / --rate / --volume / --pitch
  - mp3 二进制 chunks → stdout
  - WordBoundary 事件 → stderr，每行一个 JSON：
      {"offset_us": 1230000, "duration_us": 320000, "text": "毛毛"}
  - 完成后 stderr 末行：{"type":"done"}
  - 出错：stderr 单行 {"type":"error","message":"..."}，exit 1
"""
import asyncio
import json
import sys
import argparse

try:
    import edge_tts
except ModuleNotFoundError:
    import json as _json
    print(
        _json.dumps({
            "type": "error",
            "message": "edge-tts 未安装。请在项目根运行：python3 -m venv .venv && .venv/bin/pip install edge-tts",
        }),
        file=sys.stderr,
    )
    sys.exit(1)


async def synth(text: str, voice: str, rate: str, volume: str, pitch: str) -> int:
    try:
        communicate = edge_tts.Communicate(
            text, voice, rate=rate, volume=volume, pitch=pitch,
            boundary="WordBoundary",
        )
    except Exception as e:
        print(json.dumps({"type": "error", "message": f"参数非法: {e}"}), file=sys.stderr)
        return 1

    try:
        async for chunk in communicate.stream():
            t = chunk.get("type")
            if t == "audio":
                sys.stdout.buffer.write(chunk["data"])
            elif t == "WordBoundary":
                # offset / duration are in 100ns ticks (微软标准)
                # 转换为微秒：ticks / 10
                event = {
                    "offset_us": chunk["offset"] // 10,
                    "duration_us": chunk["duration"] // 10,
                    "text": chunk["text"],
                }
                print(json.dumps(event, ensure_ascii=False), file=sys.stderr, flush=True)
    except edge_tts.exceptions.NoAudioReceived:
        print(json.dumps({"type": "error", "message": "合成失败：服务未返回音频，可能是文本含未支持字符"}), file=sys.stderr)
        return 1
    except Exception as e:
        msg = str(e)
        if "429" in msg:
            print(json.dumps({"type": "error", "message": "edge-tts 限流"}), file=sys.stderr)
        elif "ConnectError" in type(e).__name__ or "Timeout" in type(e).__name__:
            print(json.dumps({"type": "error", "message": "网络错误"}), file=sys.stderr)
        else:
            print(json.dumps({"type": "error", "message": f"合成失败：{msg}"}), file=sys.stderr)
        return 1

    sys.stdout.buffer.flush()
    print(json.dumps({"type": "done"}), file=sys.stderr, flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", default="zh-CN-XiaoyiNeural")
    parser.add_argument("--rate", default="-10%")
    parser.add_argument("--volume", default="+0%")
    parser.add_argument("--pitch", default="+0Hz")
    args = parser.parse_args()

    text = sys.stdin.read()
    if not text.strip():
        print(json.dumps({"type": "error", "message": "text 为空"}), file=sys.stderr)
        return 1

    return asyncio.run(synth(text, args.voice, args.rate, args.volume, args.pitch))


if __name__ == "__main__":
    sys.exit(main())

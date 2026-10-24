#!/usr/bin/env python3
# Narration TTS for a video project: one Edge TTS request per line, written to assets/voice/<shot>.mp3.
#   python scripts/synth-voice.py <video-dir>
# Reads  : <video-dir>/narration.json = {"voice": "zh-CN-XiaoxiaoNeural", "rate": "+5%", "lines": {"<shot id>": "<text>"}}
# Writes : <video-dir>/assets/voice/<shot>.mp3
# Needs  : pip install -r scripts/requirements-voice.txt (edge-tts)
# Text is sent to Microsoft's online TTS service; keep narration to product copy only.
# scripts/make-voice.mjs runs this and then times, mixes and subtitles the clips.
import asyncio
import json
import sys
from pathlib import Path

import edge_tts


async def main(root: Path) -> None:
    cfg = json.loads((root / "narration.json").read_text(encoding="utf-8"))
    voice = cfg.get("voice", "zh-CN-XiaoxiaoNeural")
    rate = cfg.get("rate", "+5%")
    voice_dir = root / "assets" / "voice"
    voice_dir.mkdir(parents=True, exist_ok=True)
    for sid, text in cfg["lines"].items():
        out = voice_dir / f"{sid}.mp3"
        await edge_tts.Communicate(text, voice, rate=rate).save(str(out))
        print(f"{sid}: {out.stat().st_size} bytes")


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()))

#!/usr/bin/env node
// Narration for a video project: Edge TTS voice (scripts/synth-voice.py), ASS and SRT subtitles, ducked mix, burned-in subtitles.
//   node scripts/make-voice.mjs <video-dir>
// Reads  : <video-dir>/plan.json (shot start/end), <video-dir>/narration.json, <video-dir>/renders/final.mp4
//          narration.json = {"voice": "zh-CN-XiaoxiaoNeural", "rate": "+5%", "lines": {"<shot id>": "<text>"}}
// Writes : assets/voice/<shot>.mp3, assets/voice/narration.wav, assets/voice/narration.ass (+ .srt for reference),
//          renders/final-narrated.mp4 (voice mixed in, music ducked),
//          renders/final-narrated-sub.mp4 (subtitles burned in; this is the deliverable)
// Needs  : Python 3 with edge-tts (pip install -r scripts/requirements-voice.txt), ffmpeg with libass and sidechaincompress.
//          PYTHON=<interpreter> overrides the default python / python3.
// Text is sent to Microsoft's online TTS service; keep narration to product copy only.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {encodeWav} from '../templates/music/audio-kit.mjs';
import {capture, run, succeeds} from './lib/run.mjs';

const SYNTH = path.join(import.meta.dirname, 'synth-voice.py');
const PYTHON = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const SR = 44100;
const LEAD = 0.45;          // speak after the headline has started to appear
const TAIL = 0.25;          // keep the subtitle on screen a little after speech ends
const MAX_OVERRUN = 0.2;    // seconds of slack before a shot end
const UTF8_BOM = '\uFEFF';  // libass reads the ASS file as UTF-8 only when it starts with a BOM

const pad = (n, width) => String(n).padStart(width, '0');

function tsAss(sec) {
  let cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  cs %= 360000;
  const m = Math.floor(cs / 6000);
  cs %= 6000;
  const s = Math.floor(cs / 100);
  cs %= 100;
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`;
}

function tsSrt(sec) {
  let ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  ms %= 3600000;
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  ms %= 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

// Subtitle style in the video's own pixel grid. Landscape: bottom band. Portrait: sits above the app's
// caption and like overlays (~380 px) and keeps 90 px side margins so long lines wrap inside the frame.
function assHead(plan, cfg) {
  const w = Number(plan.width);
  const h = Number(plan.height);
  const landscape = w >= h;
  const sub = cfg.subtitle ?? {};
  const font = sub.font_size ?? (landscape ? 40 : 46);
  const marginV = sub.margin_v ?? (landscape ? 70 : 380);
  const marginLR = sub.margin_lr ?? (landscape ? 200 : 90);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Microsoft YaHei,${font},&H00FFFFFF,&H000000FF,&H00101010,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,${marginLR},${marginLR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

// Decodes an audio file to interleaved stereo float32 samples at SR.
function decode(file) {
  const raw = capture('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-']);
  const aligned = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length);   // copy: the view must be 4-byte aligned
  return new Float32Array(aligned);
}

function checkPrivacy(root, texts) {
  const termsFile = path.join(root, '.privacy-terms');
  if (!existsSync(termsFile)) return;
  const terms = readFileSync(termsFile, 'utf8').split(/\r?\n/).map(t => t.trim()).filter(Boolean);
  for (const text of texts) {
    for (const term of terms) {
      if (text.toLowerCase().includes(term.toLowerCase())) {
        throw new Error(`privacy: narration contains "${term}": ${JSON.stringify(text)}. Edit narration.json and rerun.`);
      }
    }
  }
}

// NVIDIA GPU encoder when this ffmpeg has it and it actually opens here; VIDEO_ENCODER=libx264 forces CPU.
function encoderArgs() {
  const cpu = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium'];
  const gpu = ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '18', '-b:v', '0'];
  const choice = process.env.VIDEO_ENCODER;
  if (choice === 'libx264') return cpu;
  if (choice === 'h264_nvenc') return gpu;
  const ok = succeeds('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.2',
    '-c:v', 'h264_nvenc', '-f', 'null', '-']);
  console.log(`encoder: ${ok ? 'h264_nvenc (GPU)' : 'libx264 (CPU)'}`);
  return ok ? gpu : cpu;
}

function main(rootArg) {
  const root = path.resolve(rootArg);
  const cfg = JSON.parse(readFileSync(path.join(root, 'narration.json'), 'utf8'));
  const lines = cfg.lines;
  const plan = JSON.parse(readFileSync(path.join(root, 'plan.json'), 'utf8'));
  const dur = Number(plan.duration);
  const shots = Object.fromEntries(plan.shots.map(s => [s.id, s]));
  for (const sid of Object.keys(lines)) {
    if (!shots[sid]) throw new Error(`narration.json: unknown shot id "${sid}" (plan.json has ${Object.keys(shots).join(', ')})`);
  }
  checkPrivacy(root, Object.values(lines));

  const voiceDir = path.join(root, 'assets', 'voice');
  mkdirSync(voiceDir, {recursive: true});
  // one TTS request per line, written to assets/voice/<shot>.mp3 by the Python script
  run(PYTHON, [SYNTH, root]);
  const frames = Math.round(dur * SR);
  const track = [new Float32Array(frames), new Float32Array(frames)];
  const assEvents = [];
  const srtBlocks = [];

  let n = 0;
  for (const [sid, text] of Object.entries(lines)) {
    n += 1;
    const shot = shots[sid];
    const mp3 = path.join(voiceDir, `${sid}.mp3`);
    const clip = decode(mp3);
    const clipFrames = clip.length / 2;
    const start = shot.start + LEAD;
    const length = clipFrames / SR;
    if (start + length > shot.end - MAX_OVERRUN) {
      console.log(`WARNING ${sid}: narration ${length.toFixed(2)}s runs past shot end ${shot.end}; shorten the line`);
    }
    const i0 = Math.round(start * SR);
    const i1 = Math.min(frames, i0 + clipFrames);
    for (let i = i0; i < i1; i++) {
      track[0][i] += clip[(i - i0) * 2];
      track[1][i] += clip[(i - i0) * 2 + 1];
    }
    const end = start + length + TAIL;
    assEvents.push(`Dialogue: 0,${tsAss(start)},${tsAss(end)},Sub,,0,0,0,,${text}`);
    srtBlocks.push(`${n}\n${tsSrt(start)} --> ${tsSrt(end)}\n${text}\n`);
    console.log(`${sid}: ${length.toFixed(2)}s at ${start.toFixed(2)}s`);
  }

  let peak = 0;
  for (const channel of track) for (const x of channel) peak = Math.max(peak, Math.abs(x));
  const gain = 0.8 / Math.max(peak, 1e-9);
  const scaled = track.map(channel => channel.map(x => x * gain));
  const wav = path.join(voiceDir, 'narration.wav');
  writeFileSync(wav, encodeWav(scaled, SR));
  writeFileSync(path.join(voiceDir, 'narration.ass'), UTF8_BOM + assHead(plan, cfg) + assEvents.join('\n') + '\n');
  writeFileSync(path.join(voiceDir, 'narration.srt'), srtBlocks.join('\n'));

  const src = path.join(root, 'renders', 'final.mp4');
  const mixed = path.join(root, 'renders', 'final-narrated.mp4');
  // duck the music bed under the voice, then add the voice on top
  run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-i', wav, '-filter_complex',
    '[1:a]asplit=2[key][vm];' +
    '[0:a][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[bg];' +
    '[bg][vm]amix=inputs=2:duration=first:weights=1 1.3:normalize=0[a]',
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', mixed]);

  const subbed = path.join(root, 'renders', 'final-narrated-sub.mp4');
  // run inside assets/voice so the subtitles filter gets a plain relative path (no drive-letter colon)
  run('ffmpeg', ['-y', '-v', 'error', '-i', mixed, '-vf', 'subtitles=narration.ass', ...encoderArgs(),
    '-pix_fmt', 'yuv420p', '-c:a', 'copy', subbed], {cwd: voiceDir});
  console.log(`wrote ${path.basename(mixed)} and ${path.basename(subbed)}`);
}

try {
  main(process.argv[2] ?? '.');
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}

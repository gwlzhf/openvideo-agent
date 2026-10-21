// Chooses the capture and encode path once per run: NVIDIA GPU when one answers, otherwise CPU.
//   RENDER_GPU=0            force the CPU path everywhere
//   VIDEO_ENCODER=libx264   or h264_nvenc, to pick the encoder explicitly
import {spawn} from 'node:child_process';

/** Resolves true when the command exits with status 0; never rejects. */
export function succeeds(command, argv) {
  return new Promise(resolve => {
    const child = spawn(command, argv, {stdio: 'ignore'});
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0));
  });
}

/** Runs a command with its output shown; rejects on a non-zero exit. */
export function run(command, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {stdio: 'inherit'});
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

const gpu = process.env.RENDER_GPU !== '0' && (await succeeds('nvidia-smi', ['-L']));
const nvenc = gpu && (await succeeds('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-']));
const encoder = process.env.VIDEO_ENCODER ?? (nvenc ? 'h264_nvenc' : 'libx264');

export const hardware = {gpu, encoder};

/** Video encoder arguments. NVENC at constant quality 17 is close to libx264 CRF 17. */
export const encodeArgs = encoder === 'h264_nvenc'
  ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '17', '-b:v', '0']
  : ['-c:v', 'libx264', '-crf', '17'];

/** Chromium flags for WebGL. Direct3D 11 uses the GPU on Windows; SwiftShader is the CPU fallback. */
export const browserArgs = gpu && process.platform === 'win32'
  ? ['--use-angle=d3d11', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export const describeHardware = () =>
  `encoder ${encoder} · NVIDIA GPU ${gpu ? 'yes' : 'no'} · WebGL ${gpu && process.platform === 'win32' ? 'D3D11' : 'SwiftShader'}`;

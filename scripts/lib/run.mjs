// Child-process helpers shared by the scripts. A non-zero exit throws, so a failed step stops the pipeline.
import {spawnSync} from 'node:child_process';

/** Runs a command with its output shown in the terminal. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

/** Runs a command and returns its stdout as a Buffer (stderr is captured, not shown). */
export function capture(command, args, options = {}) {
  // decoded audio is large; the default 1 MB pipe limit would fail the spawn
  const result = spawnSync(command, args, {stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30, ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}: ${result.stderr.toString().trim()}`);
  }
  return result.stdout;
}

/** True when the command runs and exits with status 0. Never throws. */
export function succeeds(command, args) {
  const result = spawnSync(command, args, {stdio: 'ignore'});
  return !result.error && result.status === 0;
}

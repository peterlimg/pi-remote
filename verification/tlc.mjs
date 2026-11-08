import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

// Pinned TLC shared by the formal checks.
export const version = '1.7.4';
const checksum = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
const sha = value => createHash('sha256').update(value).digest('hex');

export async function toolsJar() {
  const file = process.env.TLA2TOOLS || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'tla2tools', version, 'tla2tools.jar');
  if (!existsSync(file)) {
    if (process.env.TLA2TOOLS) throw new Error('TLA2TOOLS does not exist: ' + file);
    const response = await fetch('https://github.com/tlaplus/tlaplus/releases/download/v' + version + '/tla2tools.jar', { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Cannot download pinned TLC: HTTP ' + response.status);
    const body = Buffer.from(await response.arrayBuffer()); assert.equal(sha(body), checksum, 'TLC checksum mismatch');
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
  }
  assert.equal(sha(readFileSync(file)), checksum, 'Use the pinned TLC ' + version + ' jar');
  return resolve(file);
}
export function javaBinary() {
  if (process.env.JAVA) return process.env.JAVA;
  if (spawnSync('java', ['-version'], { encoding: 'utf8' }).status === 0) return 'java';
  const installed = spawnSync('mise', ['where', 'java@temurin-21'], { encoding: 'utf8' });
  if (installed.status === 0 && installed.stdout.trim()) return join(installed.stdout.trim(), 'bin/java');
  throw new Error('Install Java 11+ and put it on PATH, or set JAVA to its executable. TLC is pinned and downloaded automatically.');
}

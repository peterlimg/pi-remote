import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
for (const dir of ['src', 'bin', 'web']) {
  for (const name of readdirSync(dir).filter(x => /\.(mjs|js)$/.test(x))) {
    const result = spawnSync(process.execPath, ['--check', dir + '/' + name], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}

import { readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, dataDir } from '../src/config.mjs';
import { hostStatus, restartHost } from '../src/control.mjs';

// Like `pi-remote restart`, this stops current work. Run only when sessions are idle.
export async function restartAndResume(config = loadConfig(), dir = dataDir()) {
  const before = await hostStatus(config);
  if (before) {
    // Upgrade path for hosts predating the shutdown restore list. New hosts save
    // their own final list during shutdown. Never adopt terminal-owned sessions.
    const ids = readdirSync(join(dir, 'locks')).flatMap(name => {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) return [];
      let owner;
      try { owner = JSON.parse(readFileSync(join(dir, 'locks', name), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      return owner.pid === before.pid && owner.kind === 'rpc' ? [name.slice(0, -5)] : [];
    });
    const file = join(dir, 'resume-sessions.json');
    writeFileSync(file + '.tmp', JSON.stringify(ids), { mode: 0o600 });
    renameSync(file + '.tmp', file);
  }
  // Recovery belongs to restartHost: a failed stop must never skip startup.
  return restartHost(config, dir);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await restartAndResume(); console.log('Pi Remote running; session restoration starts automatically.'); }
  catch (error) { console.error(error); process.exitCode = 1; }
}

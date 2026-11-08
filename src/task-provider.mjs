import { realpathSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// Admit only a declared entry of the SDK package already loaded by the parent.
export function claudeWorkerSource(source) {
  try {
    if (source?.origin !== 'package' || !isAbsolute(source.path)) throw new Error();
    const path = realpathSync(source.path), baseDir = realpathSync(source.baseDir || dirname(path));
    const rel = relative(baseDir, path), manifest = JSON.parse(readFileSync(join(baseDir, 'package.json'), 'utf8'));
    const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version || '');
    const compatible = version && (+version[1] > 0 || +version[2] > 1 || +version[2] === 1 && +version[3] >= 1);
    if (!compatible || !rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || !statSync(path).isFile() || manifest.name !== 'pi-claude-sdk' ||
      !Array.isArray(manifest.pi?.extensions) || !manifest.pi.extensions.some(entry => typeof entry === 'string' && realpathSync(resolve(baseDir, entry)) === path)) throw new Error();
    return { path, baseDir, origin: 'package' };
  } catch {
    throw Object.assign(new Error('Claude SDK workers need pi-claude-sdk 0.1.1 or newer loaded in this parent. Update the package and reload the session.'), { public: true, status: 400 });
  }
}

export function loadedClaudeWorkerSource(commands) {
  for (const command of commands || []) {
    if (command.source !== 'extension') continue;
    try { return claudeWorkerSource(command.sourceInfo); } catch {}
  }
}

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const restartScript = fileURLToPath(new URL('../scripts/restart-and-resume.mjs', import.meta.url));
const stable = value => typeof value === 'string' && /^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(value);
const newer = (version, current) => stable(version) && stable(current) && version.localeCompare(current, 'en', { numeric: true }) > 0;

export function piUpdater(service) {
  const bin = process.env.PI_REMOTE_PI_BIN || 'pi';
  const pi = (args, timeout) => run(bin, args, { cwd: service.dir, timeout, maxBuffer: 1024 * 1024 });
  const installed = async () => (await pi(['--version'], 10000)).stdout.trim();
  let cached, expires = 0, job, failure, needsRestart = false;
  async function check() {
    const current = await installed();
    if (!stable(current)) return {};
    const response = await fetch('https://pi.dev/api/latest-version', { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Release check failed');
    const { version } = await response.json();
    return newer(version, current) ? { current, latest: version } : {};
  }
  async function status() {
    if (job || needsRestart) return { job, needsRestart, failure };
    if (!cached || Date.now() >= expires) {
      expires = Date.now() + 30 * 60000;
      cached = check().catch(() => { expires = Date.now() + 60000; return {}; });
    }
    return { ...await cached, failure };
  }
  async function update(version) {
    const offer = await status();
    if (job) return { job };
    if (service.busyWorkers) throw new Error('Wait for active sessions to finish, then try again.');
    if (!needsRestart && (!offer.latest || version !== offer.latest)) throw new Error('This update offer has changed. Refresh Sessions.');
    failure = undefined;
    job = needsRestart ? 'Restarting Pi Remote…' : 'Updating Pi…';
    void (async () => {
      if (!needsRestart) {
        const before = await installed();
        if (before !== offer.current) throw new Error('Installed version changed');
        await pi(['update', '--self', '--no-approve'], 180000);
        if (!newer(await installed(), before)) throw new Error('Pi version did not advance');
        needsRestart = true;
      }
      job = 'Waiting for a safe restart…';
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [restartScript, '--run'], { detached: true, stdio: 'ignore', env: { ...process.env, PI_REMOTE_HOME: service.dir } });
        child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Restart did not finish'))); child.unref();
      });
    })().catch(error => {
      console.error('Pi update:', error.message);
      failure = needsRestart ? 'Pi updated, but restart did not finish.' : 'Pi update failed. Check host.log on your computer.';
      cached = undefined;
    }).finally(() => { job = undefined; });
    return { job };
  }
  return { status, update, get installing() { return !!job && !needsRestart; } };
}

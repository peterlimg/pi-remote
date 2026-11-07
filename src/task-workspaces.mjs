import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpathSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { devNull } from 'node:os';

const execute = promisify(execFile);
const fail = message => Object.assign(new Error(message), { public: true, status: 409 });
async function git(cwd, args, extra = {}) {
  const env = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[name];
  try {
    return (await execute('git', ['-c', 'core.hooksPath=' + devNull, '-C', cwd, ...args], {
      env: { ...env, ...extra }, timeout: 30000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8'
    })).stdout;
  } catch (error) { console.error('Task workspace Git operation failed:', error); throw fail('The workspace operation failed. Inspect the task and repository before retrying.'); }
}
export async function planWorkspace(cwd, dir, id) {
  const repository = realpathSync((await git(cwd, ['rev-parse', '--show-toplevel'])).trim());
  const base = (await git(repository, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  const path = join(dirname(dir), basename(dir) + '-workspaces', id);
  return { repository, base, path, cwd: join(path, relative(repository, realpathSync(cwd))), status: 'preparing' };
}
export async function createWorkspace(workspace) {
  mkdirSync(dirname(workspace.path), { recursive: true, mode: 0o700 });
  await git(workspace.repository, ['worktree', 'add', '--detach', workspace.path, workspace.base]);
}
async function validate(workspace) {
  if (realpathSync((await git(workspace.path, ['rev-parse', '--show-toplevel'])).trim()) !== realpathSync(workspace.path)) throw fail('The task workspace moved. Inspect it before continuing.');
  const common = async cwd => realpathSync((await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
  if (await common(workspace.path) !== await common(workspace.repository)) throw fail('The task workspace belongs to a different repository.');
}
export async function reviewWorkspace(workspace, dir) {
  await validate(workspace);
  const temp = mkdtempSync(join(dir, 'task-index-'));
  try {
    const env = { GIT_INDEX_FILE: join(temp, 'index') };
    await git(workspace.path, ['read-tree', 'HEAD'], env);
    await git(workspace.path, ['add', '-A', '--', '.'], env);
    const revision = (await git(workspace.path, ['write-tree'], env)).trim();
    const diff = await git(workspace.path, ['diff', '--binary', '--no-ext-diff', '--no-textconv', workspace.base, revision, '--']);
    const summary = await git(workspace.path, ['diff', '--stat', workspace.base, revision, '--']);
    return { revision, summary: summary.slice(0, 8000), diff: diff.slice(0, 50000), truncated: diff.length > 50000 || summary.length > 8000 };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export async function integrateWorkspace(workspace, revision, dir, beforeApply) {
  const current = await reviewWorkspace(workspace, dir);
  if (current.revision !== revision) throw fail('Worker changes differ from the reviewed revision. Inspect and review the task again.');
  if (realpathSync((await git(workspace.repository, ['rev-parse', '--show-toplevel'])).trim()) !== realpathSync(workspace.repository)) throw fail('The destination repository moved.');
  const patch = await git(workspace.path, ['diff', '--binary', '--no-ext-diff', '--no-textconv', workspace.base, revision, '--']);
  if (!patch) return;
  // An exclusive temporary patch avoids shell interpolation and never changes the parent's index.
  const temp = mkdtempSync(join(dir, 'task-patch-'));
  try {
    const file = join(temp, 'changes.patch'); writeFileSync(file, patch, { mode: 0o600 });
    try { await git(workspace.repository, ['apply', '--check', file]); }
    catch (error) {
      // A coordinator may already have applied this exact reviewed patch manually.
      await git(workspace.repository, ['apply', '--reverse', '--check', file]); return;
    }
    beforeApply();
    await git(workspace.repository, ['apply', file]);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

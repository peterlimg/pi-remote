#!/usr/bin/env node
// A real Git operation can succeed while its caller loses the completion receipt.
import { spawnSync } from 'node:child_process';
import { existsSync, appendFileSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.PI_RECOVERY_FIXTURE_ROOT;
if (!root || JSON.parse(readFileSync(join(root, '.coordinator-fixture.json'), 'utf8')).version !== 1 || !process.env.PI_RECOVERY_REAL_GIT) throw new Error('An owned recovery fixture is required');
const args = process.argv.slice(2);
if (args.includes('status') && existsSync(join(root, 'hold-workspace-check'))) {
  writeFileSync(join(root, 'workspace-check-waiting'), 'waiting');
  const deadline = Date.now() + 15000;
  while (existsSync(join(root, 'hold-workspace-check')) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
}
const result = spawnSync(process.env.PI_RECOVERY_REAL_GIT, args, { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status === 0 && args.includes('apply') && !args.includes('--check')) {
  appendFileSync(join(root, 'git-apply.log'), 'applied\n');
  const fault = join(root, 'lose-apply-receipt');
  if (existsSync(fault)) { unlinkSync(fault); process.exit(7); }
}
process.exit(result.status ?? 1);

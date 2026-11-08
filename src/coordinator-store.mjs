import { readFileSync, writeFileSync, readdirSync, renameSync, mkdirSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sessionKey } from './locks.mjs';

function validate(data) {
  if (data?.version !== 1 || !Array.isArray(data.coordinators) || !Array.isArray(data.tasks)) throw new Error('Invalid coordinator state');
  const owners = new Set(), tasks = new Set(), sessions = new Set();
  for (const owner of data.coordinators) {
    if (!owner?.file || sessionKey(owner.file) !== owner.id || typeof owner.token !== 'string' || owner.token.length < 32 || !owner.cwd || owners.has(owner.id)) throw new Error('Invalid coordinator record');
    owners.add(owner.id);
  }
  for (const task of data.tasks) {
    if (!task?.file || sessionKey(task.file) !== task.sessionId || !owners.has(task.coordinatorId) || typeof task.id !== 'string' ||
      tasks.has(task.id) || sessions.has(task.sessionId) || typeof task.token !== 'string' || task.token.length < 32 || !Array.isArray(task.events)) throw new Error('Invalid task record');
    if (task.protocol === 2 && (!Array.isArray(task.inputs) || task.inputs.some(input => typeof input.id !== 'string' || typeof input.text !== 'string'))) throw new Error('Invalid task mailbox');
    tasks.add(task.id); sessions.add(task.sessionId);
  }
  return data;
}

function readState(dir) {
  const folder = join(dir, 'coordinator-tasks'), data = { version: 1, coordinators: [], tasks: [] };
  let names;
  try { names = readdirSync(folder); } catch (error) { if (error.code === 'ENOENT') return data; throw error; }
  for (const name of names.filter(name => name.endsWith('.json')).sort()) {
    const record = JSON.parse(readFileSync(join(folder, name), 'utf8'));
    if (record.version !== 1 || !/^[a-f0-9]{64}\.json$/.test(name) || record.coordinator?.id !== name.slice(0, -5) ||
      !Array.isArray(record.tasks) || record.tasks.some(task => task.coordinatorId !== record.coordinator.id)) throw new Error('Invalid session task state');
    data.coordinators.push(record.coordinator); data.tasks.push(...record.tasks);
  }
  return validate(data);
}

export function saveCoordinatorState(dir, coordinator, tasks) {
  if (!/^[a-f0-9]{64}$/.test(coordinator.id) || tasks.some(task => task.coordinatorId !== coordinator.id)) throw new Error('Invalid session task owner');
  const folder = join(dir, 'coordinator-tasks'), file = join(folder, coordinator.id + '.json');
  mkdirSync(folder, { recursive: true, mode: 0o700 }); chmodSync(folder, 0o700);
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, JSON.stringify({ version: 1, coordinator, tasks }), { flag: 'wx', mode: 0o600 });
    renameSync(temp, file);
  } finally { rmSync(temp, { force: true }); }
}

export function loadCoordinatorState(dir) {
  const state = readState(dir), legacyFile = join(dir, 'coordinator-tasks.json');
  let legacy;
  try { legacy = validate(JSON.parse(readFileSync(legacyFile, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return state; throw error; }
  const backup = legacyFile + '.migrated';
  if (existsSync(backup)) throw new Error('Shared coordinator state reappeared after migration; inspect both stores');
  const records = legacy.coordinators.map(coordinator => ({ coordinator, tasks: legacy.tasks.filter(task => task.coordinatorId === coordinator.id) }));
  // A failed split may leave matching files; never overwrite a newer or conflicting session.
  for (const coordinator of state.coordinators) {
    const existing = { coordinator, tasks: state.tasks.filter(task => task.coordinatorId === coordinator.id) };
    if (!isDeepStrictEqual(existing, records.find(record => record.coordinator.id === coordinator.id))) throw new Error('Session task state conflicts with the shared migration');
  }
  for (const record of records) if (!state.coordinators.some(coordinator => coordinator.id === record.coordinator.id)) saveCoordinatorState(dir, record.coordinator, record.tasks);
  chmodSync(legacyFile, 0o600); renameSync(legacyFile, backup);
  return readState(dir);
}

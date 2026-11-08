import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Read the persisted files independently of the production loader and migration.
export function coordinatorState(dir) {
  let names;
  const folder = join(dir, 'coordinator-tasks');
  try { names = readdirSync(folder); } catch (error) { if (error.code === 'ENOENT') return { coordinators: [], tasks: [] }; throw error; }
  const records = names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort().map(name => JSON.parse(readFileSync(join(folder, name), 'utf8')));
  return { coordinators: records.map(record => record.coordinator), tasks: records.flatMap(record => record.tasks) };
}

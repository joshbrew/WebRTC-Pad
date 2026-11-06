import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
export const parseSettings = parseEnv;
export function mergeSettings(text, updates) {
  const pending = new Map(Object.entries(updates));
  const lines = text.split(/\r?\n/).flatMap(line => {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (!key || !Object.hasOwn(updates, key)) return [line];
    if (!pending.has(key)) return [];
    const value = encodeSetting(pending.get(key)); pending.delete(key); return [`${key}=${value}`];
  });
  for (const [key, value] of pending) lines.push(`${key}=${encodeSetting(value)}`);
  return lines.join('\n').replace(/\n*$/, '\n');
}
function encodeSetting(value) {
  value = String(value);
  if (/[\r\n]/.test(value)) throw new Error('Settings must be on one line');
  if (!/[\s#'"`]/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  throw new Error('A setting containing both quote styles must be edited manually in .env');
}
export async function saveSettings(root, updates) {
  const file = path.join(root, '.env');
  let previous;
  try { previous = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; previous = await fs.readFile(path.join(root, '.env.example'), 'utf8'); }
  const next = mergeSettings(previous, updates);
  // Validate the serialized result before touching the original file.
  for (const [key, value] of Object.entries(updates)) if (parseEnv(next)[key] !== String(value)) throw new Error(`Could not serialize ${key}; edit it manually`);
  const backups = path.join(root, '.local/config-backups'); await fs.mkdir(backups, { recursive: true });
  await fs.writeFile(path.join(backups, `${Date.now()}-${process.pid}.env`), previous, { flag: 'wx', mode: 0o600 });
  const temporary = path.join(root, `.local/settings-${process.pid}.env`);
  await fs.writeFile(temporary, next, { mode: 0o600 }); await fs.rename(temporary, file);
}

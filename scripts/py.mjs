// Run the project venv's Python on Windows (.venv\Scripts) or macOS/Linux (.venv/bin).
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.platform === 'win32'
  ? path.join(root, '.venv', 'Scripts', 'python.exe')
  : path.join(root, '.venv', 'bin', 'python');
if (!existsSync(python)) {
  console.error(`No virtualenv at ${python}. Run: npm run setup`);
  process.exit(1);
}
const result = spawnSync(python, process.argv.slice(2), {cwd: root, stdio: 'inherit'});
process.exit(result.status ?? 1);

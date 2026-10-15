// Stamps a new version token into index.html and js/*.js so every deploy
// loads a matching set of files (cache-busting for raw.githack and browsers).
// Usage: npm run stamp [-- TOKEN]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const token = process.argv[2] || new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);

const files = ['index.html', ...readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`)];

for (const file of files) {
  const path = join(root, file);
  const before = readFileSync(path, 'utf8');
  const after = before
    // Local references: href/src in index.html and relative imports in js/*.js.
    .replace(/((?:href|src)="(?:css|js)\/[^"?]+\.(?:css|js)|from '\.\/[^'?]+\.js)\?v=[^'"]*/g, `$1?v=${token}`)
    .replace(/(<meta name="app-version" content=")[^"]*/, `$1${token}`)
    .replace(/(const APP_VERSION = ')[^']*/, `$1${token}`);
  if (after !== before) writeFileSync(path, after);
}
console.log(`Stamped version ${token}`);

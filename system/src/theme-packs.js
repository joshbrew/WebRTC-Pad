import fs from 'node:fs';
import path from 'node:path';

const idPattern = /^[a-z][a-z0-9-]{0,39}$/;
const assetPattern = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/;
const assetTypes = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.woff2', 'font/woff2'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.avif', 'image/avif'],
]);

function collectAssets(directory, prefix = '', assets = new Map()) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!assetPattern.test(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    const relative = prefix + entry.name;
    if (entry.isDirectory()) collectAssets(filename, relative + '/', assets);
    else if (entry.isFile() && assetTypes.has(path.extname(entry.name))) assets.set(relative, filename);
  }
  return assets;
}

export function discoverThemePacks(directory) {
  const themes = [], files = new Map();
  if (!fs.existsSync(directory)) return { themes, files };
  for (const folder of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!folder.isDirectory() || !idPattern.test(folder.name)) continue;
    try {
      const base = path.join(directory, folder.name);
      const manifest = path.join(base, 'theme.json');
      const stat = fs.lstatSync(manifest);
      if (!stat.isFile() || stat.size > 8192) continue;
      const value = JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''));
      const { id, name, colorScheme, stylesheet, preview, description, order } = value;
      if (value.version !== 1 || id !== folder.name || typeof name !== 'string' || !name.trim() || name.length > 48 || !['dark', 'light'].includes(colorScheme)) continue;
      if (typeof stylesheet !== 'string' || !stylesheet.endsWith('.css')) continue;
      const assets = collectAssets(base);
      if (!assets.has(stylesheet)) continue;
      const prefix = `/themes/${id}/`;
      const theme = { id, name, colorScheme, stylesheet: prefix + stylesheet, description: typeof description === 'string' ? description.slice(0, 140) : '', order: Number.isFinite(order) ? order : 100 };
      if (assets.has(preview) && assetTypes.get(path.extname(preview)).startsWith('image/')) theme.preview = prefix + preview;
      themes.push(theme);
      for (const [relative, filename] of assets) files.set(prefix + relative, { filename, contentType: assetTypes.get(path.extname(filename)) });
    } catch { /* An incomplete pack does not affect the other appearances. */ }
  }
  themes.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return { themes, files };
}

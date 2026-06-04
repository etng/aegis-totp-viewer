import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDistDir = resolve(rootDir, 'dist/web');
const distHtmlPath = resolve(webDistDir, 'index.html');
const rootHtmlPath = resolve(rootDir, 'aegis-totp.html');
const webStandalonePath = resolve(webDistDir, 'aegis-totp.html');

function normalizeAssetPath(assetPath) {
  return assetPath.replace(/^\.\//, '');
}

async function inlineAssets(html) {
  let output = html;

  const scriptMatch = output.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/);
  if (scriptMatch) {
    const scriptPath = resolve(webDistDir, normalizeAssetPath(scriptMatch[1]));
    const script = await readFile(scriptPath, 'utf8');
    output = output.replace(scriptMatch[0], `<script type="module">\n${script}\n</script>`);
  }

  const cssMatch = output.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/);
  if (cssMatch) {
    const cssPath = resolve(webDistDir, normalizeAssetPath(cssMatch[1]));
    const css = await readFile(cssPath, 'utf8');
    output = output.replace(cssMatch[0], `<style>\n${css}\n</style>`);
  }

  return output;
}

const distHtml = await readFile(distHtmlPath, 'utf8');
const standaloneHtml = await inlineAssets(distHtml);

await mkdir(dirname(webStandalonePath), { recursive: true });
await writeFile(rootHtmlPath, standaloneHtml);
await writeFile(webStandalonePath, standaloneHtml);

console.log(`Wrote ${rootHtmlPath}`);
console.log(`Wrote ${webStandalonePath}`);

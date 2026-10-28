import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function normalizeVersion(input) {
  const version = input.replace(/^v/, '');
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match || match[0] !== version || match.slice(1, 4).some(n => Number(n) > 65535)
      || match[4]?.split('.').some(n => /^\d+$/.test(n) && n.length > 1 && n.startsWith('0'))) {
    throw new Error('Version must be SemVer, e.g. 0.2.0 or v0.2.0-rc.1; Windows version components must be <= 65535.');
  }
  return version;
}

function scalar(block, key) {
  const matches = [...block.matchAll(new RegExp(`^${key}\\s*=\\s*"([^"\\r\\n]+)"`, 'gm'))];
  if (matches.length !== 1) throw new Error(`Expected one ${key} field in package section`);
  return matches[0][1];
}

function replaceScalar(block, version) {
  return block.replace(/^(version\s*=\s*")[^"\r\n]+(")/m, (_, prefix, suffix) => `${prefix}${version}${suffix}`);
}

// Update only the root package; registry dependencies and lockfile checksums
// must remain byte-for-byte unchanged. No cargo update / dependency resolution.
export async function synchronizeVersion({ root = process.cwd(), version, check = false } = {}) {
  const files = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
  const contents = await Promise.all(files.map(file => readFile(path.join(root, file), 'utf8')));
  const pkg = JSON.parse(contents[0]);
  const config = JSON.parse(contents[1]);
  version = normalizeVersion(version ?? pkg.version);

  const manifestSections = contents[2].split(/(?=^\[)/m);
  const packageSections = manifestSections.filter(block => /^\[package\]\s*\r?$/m.test(block));
  if (packageSections.length !== 1) throw new Error('Expected one Cargo [package] section');
  const manifest = packageSections[0];
  const name = scalar(manifest, 'name');
  const lockSections = contents[3].split(/(?=^\[\[package\]\])/m);
  const rootPackages = lockSections.filter(block => /^\[\[package\]\]/.test(block) && scalar(block, 'name') === name);
  if (rootPackages.length !== 1) throw new Error(`Expected one ${name} package in Cargo.lock`);
  const lock = rootPackages[0];
  const current = [pkg.version, config.version, scalar(manifest, 'version'), scalar(lock, 'version')];
  const mismatches = files.filter((_, i) => current[i] !== version);
  if (check) {
    if (mismatches.length) throw new Error(`Version mismatch (expected ${version}): ${mismatches.join(', ')}. Run pnpm version:set ${version}.`);
    return { version, changed: [] };
  }

  pkg.version = config.version = version;
  const replacements = [
    `${JSON.stringify(pkg, null, 2)}\n`, `${JSON.stringify(config, null, 2)}\n`,
    contents[2].replace(manifest, replaceScalar(manifest, version)),
    contents[3].replace(lock, replaceScalar(lock, version)),
  ];
  const changed = [];
  for (let i = 0; i < files.length; i++) {
    if (replacements[i] !== contents[i]) {
      await writeFile(path.join(root, files[i]), replacements[i]);
      changed.push(files[i]);
    }
  }
  return { version, changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const positional = args.filter(arg => arg !== '--check');
    if ((!check && positional.length !== 1) || positional.length > 1) {
      throw new Error('Usage: node scripts/sync-version.mjs <version|v-tag> [--check], or --check');
    }
    const result = await synchronizeVersion({ version: positional[0], check });
    console.log(`${check ? 'Verified' : 'Synchronized'} version ${result.version}`);
    if (result.changed.length) console.log(`Updated: ${result.changed.join(', ')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

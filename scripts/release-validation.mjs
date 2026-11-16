import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);

async function versionFromCargo() {
  const cargo = await readFile(new URL('src-tauri/Cargo.toml', root), 'utf8');
  const packageSection = cargo.match(/^\[package\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  return packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
}

export async function readVersions() {
  const [packageJson, tauriJson, cargoVersion] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8').then(JSON.parse),
    readFile(new URL('src-tauri/tauri.conf.json', root), 'utf8').then(JSON.parse),
    versionFromCargo(),
  ]);
  return [packageJson.version, tauriJson.version, cargoVersion];
}

export async function validateVersions(tag, versions) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error(`Invalid release tag: ${tag}`);
  versions ??= await readVersions();
  const expected = tag.slice(1);
  if (versions.some((version) => !version || version !== expected)) {
    throw new Error(`Release tag ${tag} must match package, Cargo, and Tauri versions; found ${versions.join(', ')}`);
  }
  return expected;
}

export async function validateArtifacts(tag, metadata, assets, signature, versions) {
  const version = await validateVersions(tag, versions);
  const installer = `Saku_${version}_x64-setup.exe`;
  const names = new Set(assets.map(({ name }) => name));
  if (!names.has(installer) || !names.has(`${installer}.sig`) || !names.has('latest.json')) {
    throw new Error('Draft release must contain the NSIS installer, its .sig file, and latest.json');
  }
  const updater = metadata.platforms?.['windows-x86_64'];
  if (metadata.version !== version || !updater?.signature || !updater?.url) {
    throw new Error('latest.json is missing the matching version or Windows updater metadata');
  }
  if (basename(new URL(updater.url).pathname) !== installer || !updater.url.includes(`/releases/download/${tag}/`)) {
    throw new Error('latest.json does not point to this tag’s NSIS installer');
  }
  if (updater.signature.trim() !== signature.trim()) throw new Error('latest.json signature does not match the uploaded .sig file');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'versions') {
    await validateVersions(process.argv[3]);
  } else if (process.argv[2] === 'artifacts') {
    const [tag, metadataPath, assetsPath, signaturePath] = process.argv.slice(3);
    await validateArtifacts(
      tag,
      JSON.parse(await readFile(metadataPath, 'utf8')),
      JSON.parse(await readFile(assetsPath, 'utf8')),
      await readFile(signaturePath, 'utf8'),
    );
  } else {
    throw new Error('Usage: release-validation.mjs versions <tag> | artifacts <tag> <latest.json> <assets.json> <installer.sig>');
  }
}

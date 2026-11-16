import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVersions, validateArtifacts, finalizeMetadata } from './release-validation.mjs';

test('release tag must match the package, Cargo, and Tauri versions', async () => {
  assert.equal(await validateVersions('v0.3.0', ['0.3.0', '0.3.0', '0.3.0']), '0.3.0');
  await assert.rejects(validateVersions('v0.3.0', ['0.3.0', '0.2.1', '0.3.0']), /must match/);
  await assert.rejects(validateVersions('0.3.0', ['0.3.0', '0.3.0', '0.3.0']), /Invalid release tag/);
});

test('finalize only rewrites the API URL of the exact uploaded installer', async () => {
  const apiUrl = 'https://api.github.com/repos/farhanfath/saku-dev/releases/assets/123';
  const assets = [{ name: 'Saku_0.3.0_x64-setup.exe', apiUrl }, { name: 'Saku_0.3.0_x64-setup.exe.sig' }, { name: 'latest.json' }];
  const metadata = { version: '0.3.0', platforms: { 'windows-x86_64': { url: apiUrl, signature: 'signed' } } };
  const versions = ['0.3.0', '0.3.0', '0.3.0'];
  const result = await finalizeMetadata('v0.3.0', metadata, assets, 'signed', versions);
  assert.equal(result.platforms['windows-x86_64'].url, 'https://github.com/farhanfath/saku-dev/releases/download/v0.3.0/Saku_0.3.0_x64-setup.exe');
  assert.equal(metadata.platforms['windows-x86_64'].url, apiUrl);
  await assert.rejects(finalizeMetadata('v0.3.0', metadata, assets, 'different', versions), /does not match/);
  await assert.rejects(finalizeMetadata('v0.3.0', { ...metadata, platforms: { 'windows-x86_64': { url: `${apiUrl}4`, signature: 'signed' } } }, assets, 'signed', versions), /does not point/);
});

test('draft metadata must reference the uploaded NSIS installer and signature', async () => {
  const installer = 'Saku_0.3.0_x64-setup.exe';
  const assets = [{ name: installer }, { name: `${installer}.sig` }, { name: 'latest.json' }];
  const metadata = {
    version: '0.3.0',
    platforms: {
      'windows-x86_64': {
        url: `https://github.com/farhanfath/saku-dev/releases/download/v0.3.0/${installer}`,
        signature: 'signed-payload',
      },
    },
  };
  const versions = ['0.3.0', '0.3.0', '0.3.0'];
  await validateArtifacts('v0.3.0', metadata, assets, 'signed-payload\n', versions);
  await assert.rejects(validateArtifacts('v0.3.0', metadata, assets.slice(1), 'signed-payload', versions), /must contain/);
  await assert.rejects(validateArtifacts('v0.3.0', metadata, assets, 'different', versions), /does not match/);
  await assert.rejects(validateArtifacts('v0.3.0', {
    ...metadata,
    platforms: { 'windows-x86_64': { ...metadata.platforms['windows-x86_64'], url: `https://attacker.example/releases/download/v0.3.0/${installer}` } },
  }, assets, 'signed-payload', versions), /does not point/);
});

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

function fail(message) {
  throw new Error(message);
}

function parseArgs() {
  const dirFlagIndex = process.argv.findIndex((arg) => arg === '--pack-dir');
  if (dirFlagIndex === -1 || !process.argv[dirFlagIndex + 1]) {
    fail('Usage: node scripts/check-pack-contracts.mjs --pack-dir <directory>');
  }
  return {
    packDir: path.resolve(ROOT, process.argv[dirFlagIndex + 1]),
  };
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function assertFile(filePath) {
  await fs.access(filePath).catch(() => fail(`Missing required file: ${filePath}`));
}

async function main() {
  const { packDir } = parseArgs();
  const registryPath = path.join(packDir, 'registry.json');
  await assertFile(registryPath);

  const registry = await loadJson(registryPath);
  if (!registry || typeof registry !== 'object' || !Array.isArray(registry.protocols)) {
    fail(`Invalid registry shape: ${registryPath}`);
  }

  for (const protocol of registry.protocols) {
    if (!protocol || typeof protocol !== 'object') {
      fail('Registry contains a non-object protocol entry.');
    }
    if (typeof protocol.id !== 'string' || protocol.id.trim().length === 0) {
      fail('Registry protocol entry is missing id.');
    }
    if (typeof protocol.idlPath !== 'string' || !protocol.idlPath.startsWith('/idl/')) {
      fail(`Protocol ${protocol.id} has invalid idlPath.`);
    }

    for (const key of ['idlPath', 'metaPath', 'metaCorePath', 'appPath']) {
      const value = protocol[key];
      if (value == null) {
        continue;
      }
      if (typeof value !== 'string' || !value.startsWith('/idl/')) {
        fail(`Protocol ${protocol.id} has invalid ${key}.`);
      }
      const filePath = path.join(packDir, value.slice('/idl/'.length));
      await assertFile(filePath);
      const parsed = await loadJson(filePath);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        fail(`${filePath} did not parse as a JSON object.`);
      }
      if (key === 'metaPath' || key === 'metaCorePath') {
        if (typeof parsed.schema !== 'string' || !parsed.schema.startsWith('meta-idl')) {
          fail(`${filePath} has invalid meta schema marker.`);
        }
      }
      if (key === 'appPath') {
        if (typeof parsed.schema !== 'string' || !parsed.schema.startsWith('meta-app')) {
          fail(`${filePath} has invalid app schema marker.`);
        }
      }
    }
  }

  console.log(`Pack contract validation succeeded for ${registry.protocols.length} protocol(s) in ${packDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

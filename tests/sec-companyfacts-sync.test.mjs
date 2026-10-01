import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';

test('Company Facts sync dry-run covers all CIK-linked listings once per issuer without network or writes', () => {
  const output = execFileSync(process.execPath, ['scripts/sync-company-facts.mjs', '--dry-run'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, SEC_USER_AGENT: 'SmallCapRadar test identity' },
    timeout: 15_000,
  });
  assert.match(output, /7675 listing rows/);
  assert.match(output, /7675 CIK-linked rows/);
  assert.match(output, /6059 unique issuers/);
  assert.match(output, /no network calls or files changed/);
  assert.match(output, /Contact identity configured: true/);
});

test('Company Facts sync refuses SEC requests without a contact-bearing User-Agent', () => {
  const result = spawnSync(process.execPath, ['scripts/sync-company-facts.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, SEC_USER_AGENT: '' },
    timeout: 15_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reachable email/);
  assert.doesNotMatch(result.stdout, /[0-9]+\/[0-9]+ · success/);
});

test('SEC Frames sync dry-run measures its universe and request budget without mutation', () => {
  const output = execFileSync(process.execPath, ['scripts/sync-sec-frames.mjs', '--dry-run'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, SEC_USER_AGENT: '' },
    timeout: 15_000,
  });
  assert.match(output, /7675 listings/);
  assert.match(output, /6059 distinct issuer CIKs/);
  assert.match(output, /16 bounded frame requests/);
  assert.match(output, /no network calls or files changed/);
});

test('SEC Frames sync refuses requests when the contact-bearing User-Agent is absent', () => {
  const result = spawnSync(process.execPath, ['scripts/sync-sec-frames.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, SEC_USER_AGENT: '' },
    timeout: 15_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reachable email/);
});

test('quick-cache updater refuses all provider requests before writing when SEC contact identity is absent', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'quick-cache-sec-agent-'));
  const output = path.join(directory, 'quick.json');
  try {
    const result = spawnSync(process.execPath, ['scripts/update-quick-cache.mjs', 'lib/universe.generated.json', output], {
      cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, SEC_USER_AGENT: '' }, timeout: 15_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /reachable email/);
    await assert.rejects(fs.access(output), { code: 'ENOENT' });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

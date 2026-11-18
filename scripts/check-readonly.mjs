// Phase 5 safety check: fails if the source contains anything that could write to the database
// or use privileged credentials. Run with: npm run check:readonly
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const banned = [
  [/\.insert\s*\(/, 'insert()'],
  [/\.update\s*\(/, 'update()'],
  [/\.upsert\s*\(/, 'upsert()'],
  [/\.delete\s*\(/, 'delete()'],
  [/\.rpc\s*\(/, 'rpc() (functions can write)'],
  [/service_role/i, 'service_role'],
  [/auth\.admin/, 'auth.admin'],
  [/\.storage\b/, 'storage'],
  [/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE|CREATE\s+TABLE)\b/i, 'SQL mutation keyword'],
  [/otp_hash/, 'otp_hash'],
  [/id_proof_(details|number)|guest_address/, 'sensitive ID proof / address column'],
];

const ignore = new Set(['check-readonly.mjs']);
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !ignore.has(name) && !/\.test\./.test(name)) {
      const text = readFileSync(p, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (line.trim().startsWith('//')) return;
        for (const [re, label] of banned) {
          if (re.test(line)) {
            // id_proof_* and guest_address are allowed ONLY inside src/pages/GrcPrint.tsx
            const isGrcPrint = p.replace(/\\/g, '/').endsWith('src/pages/GrcPrint.tsx');
            if (isGrcPrint && label.includes('sensitive ID proof')) {
              continue;
            }
            problems.push(`${p}:${i + 1}  ${label}`);
          }
        }
      });
    }
  }
}
walk('src');

if (problems.length) {
  console.error('READ-ONLY CHECK FAILED:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('Read-only check passed: no write calls, no service key, no otp_hash, no ID-proof columns in src/.');

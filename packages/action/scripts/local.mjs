// Runs the built action on your machine the way GitHub does: inputs arrive as INPUT_* environment
// variables, outputs and the job summary are written to files. Nothing is sent anywhere.
//
//   npm run build -w @k8s-manifestlens/action
//   npm run local -w @k8s-manifestlens/action -- --workspace . --paths examples/risky.yaml --fail-on warning
//
// Every --name value pair becomes the input of that name. --workspace sets the folder to check.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/index.js', import.meta.url));
if (!existsSync(dist)) {
  console.error('dist/index.js is missing. Run: npm run build -w @k8s-manifestlens/action');
  process.exit(2);
}

const env = { ...process.env, GITHUB_ACTIONS: '' };
let workspace = process.cwd();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const name = args[i]?.replace(/^--/, '');
  const value = args[i + 1];
  if (!name || value === undefined) {
    console.error(`Expected --name value pairs, got: ${args.slice(i).join(' ')}`);
    process.exit(2);
  }
  if (name === 'workspace') workspace = resolve(value);
  else env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = value;
}

const scratch = mkdtempSync(join(tmpdir(), 'manifestlens-local-'));
env.GITHUB_WORKSPACE = workspace;
env.GITHUB_OUTPUT = join(scratch, 'output');
env.GITHUB_STEP_SUMMARY = join(scratch, 'summary.md');
for (const file of [env.GITHUB_OUTPUT, env.GITHUB_STEP_SUMMARY]) writeFileSync(file, '');

const run = spawnSync(process.execPath, [dist], { env, stdio: 'inherit' });

console.log('\n--- outputs ---');
console.log(
  readFileSync(env.GITHUB_OUTPUT, 'utf8')
    .replace(/<<ghadelimiter_[^\n]*\n/g, ': ')
    .replace(/\nghadelimiter_[^\n]*/g, '')
    .trim() || '(none)',
);
console.log('\n--- job summary (markdown) ---');
console.log(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8') || '(none)');
console.log(
  `--- exit code ${run.status} (${run.status === 0 ? 'the build would pass' : 'the build would fail'}) ---`,
);
process.exit(run.status ?? 1);

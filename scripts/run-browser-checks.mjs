// Runs browser checks a few at a time, each in its own process:
//
//   node scripts/run-browser-checks.mjs [--concurrency 2] check-a-browser.mjs ...
//
// Each slot keeps one browser (scripts/browser.mjs joins it through
// BROWSER_WS_ENDPOINT), so a check does not start Chromium, and slots do not
// share a GPU process: software rendering spreads over the runner's cores.
// Checks run in the order given (longest first keeps the slots even), every
// check runs even after a failure, and the exit status is non-zero if any
// failed. Output lines carry the check's name; timings are printed at the end
// and written to browser-review/timings-<label>.json.
import {spawn} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {chromium} from 'playwright';
import {BROWSER_ARGS} from './browser.mjs';

export function parseArguments(argv) {
  const options = {concurrency: Number(process.env.BROWSER_CONCURRENCY) || 2, label: 'checks', checks: []};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--concurrency') options.concurrency = Number(argv[++i]);
    else if (argv[i] === '--label') options.label = argv[++i];
    else options.checks.push(argv[i].replace(/^(\.\/)?scripts\//, ''));
  }
  if (!(options.concurrency >= 1)) throw new Error('--concurrency must be at least 1');
  for (const check of options.checks) if (!/^check-[\w-]+-browser\.mjs$/.test(check)) throw new Error(`Not a browser check: ${check}`);
  return options;
}

// run(check, endpoint) resolves {code}; launch() starts a browser server.
export async function runChecks(checks, {concurrency, run, launch, log = console.log}) {
  const queue = [...checks], results = [];
  const slot = async () => {
    let server = await launch();
    while (queue.length) {
      const check = queue.shift(), started = Date.now();
      const {code} = await run(check, server.wsEndpoint());
      results.push({check, code, seconds: Math.round((Date.now() - started) / 100) / 10});
      log(`${code === 0 ? 'PASS' : 'FAIL'} ${check} in ${results.at(-1).seconds} s`);
      // A crashed or wedged browser is not handed to the next check.
      if (!server.process?.() || server.process().exitCode !== null) { await server.close().catch(() => {}); server = await launch(); }
    }
    await server.close().catch(() => {});
  };
  await Promise.all(Array.from({length: Math.min(concurrency, checks.length)}, slot));
  return results.sort((a, b) => checks.indexOf(a.check) - checks.indexOf(b.check));
}

function runProcess(check, endpoint) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [`scripts/${check}`], {env: {...process.env, BROWSER_WS_ENDPOINT: endpoint}, stdio: ['ignore', 'pipe', 'pipe']});
    const name = basename(check, '.mjs').replace(/^check-|-browser$/g, '');
    for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      let rest = '';
      stream.on('data', chunk => { const lines = (rest + chunk).split('\n'); rest = lines.pop(); for (const line of lines) out.write(`[${name}] ${line}\n`); });
      stream.on('end', () => { if (rest) out.write(`[${name}] ${rest}\n`); });
    }
    child.on('close', code => resolve({code: code ?? 1}));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const {concurrency, label, checks} = parseArguments(process.argv.slice(2));
  const results = await runChecks(checks, {concurrency, run: runProcess, launch: () => chromium.launchServer({headless: true, args: BROWSER_ARGS})});
  await mkdir('browser-review', {recursive: true});
  await writeFile(`browser-review/timings-${label}.json`, JSON.stringify(results, null, 2) + '\n');
  console.log('\nBrowser checks:');
  for (const {check, code, seconds} of results) console.log(`  ${code === 0 ? 'pass' : 'FAIL'}  ${String(seconds).padStart(7)} s  ${check}`);
  process.exit(results.every(r => r.code === 0) ? 0 : 1);
}

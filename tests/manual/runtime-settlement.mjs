import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { ConvexHttpClient } from 'convex/browser';
import { rpc } from '../../lib/settlement/rpc.ts';
import { inspectReceipt } from '../../lib/settlement/policy.ts';
const port = 3230, markerPort = 3239;
const nearPath = 'convex/nearSettlement.ts', controlPath = 'convex/runtimeGateControl.ts';
const original = await readFile(nearPath, 'utf8');
// Opt-in destructive test: use only an isolated local checkout/backend and a dedicated
// free testnet signer. No production entry point or test hook is installed permanently.
if (process.argv[2] !== '--confirm-disposable-backend-and-testnet-transfer') {
    console.error('Not run: requires a disposable backend, dedicated testnet credentials and explicit --confirm-disposable-backend-and-testnet-transfer.');
    process.exit(2);
}
if (process.versions.node.split('.')[0] !== '24')
    throw new Error('NODE_24_REQUIRED');
const backendEnv = await readFile('.convex/runtime-gate/backend.env', 'utf8');
if (!/^NEAR_OPERATOR_ACCOUNT_ID=guildzero-restart-[a-z0-9]+\.testnet$/m.test(backendEnv) || !/^NEAR_NETWORK=testnet$/m.test(backendEnv))
    throw new Error('DEDICATED_RESTART_TESTNET_ACCOUNT_REQUIRED');
const projectEnv = await readFile('.env.local', 'utf8');
if (!/^CONVEX_DEPLOYMENT=anonymous:/m.test(projectEnv) || !/^NEXT_PUBLIC_CONVEX_URL=http:\/\/127\.0\.0\.1:3230$/m.test(projectEnv))
    throw new Error('DISPOSABLE_LOCAL_BACKEND_REQUIRED');
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
if (!branch || branch === 'main' || branch === 'master')
    throw new Error('ISOLATED_TEST_BRANCH_REQUIRED');
if (original.includes('runtime-gate') || original.includes('3239'))
    throw new Error('WORKER_ALREADY_INSTRUMENTED');
await assert.rejects(readFile(controlPath), { code: 'ENOENT' });
// Refuse an existing service: this test may kill only processes it starts.
try {
    await fetch('http://127.0.0.1:3230/version', { signal: AbortSignal.timeout(1000) });
    throw new Error('BACKEND_ALREADY_RUNNING');
}
catch (e) {
    if (e.message === 'BACKEND_ALREADY_RUNNING')
        throw e;
}
const originalApi = await readFile('convex/_generated/api.d.ts', 'utf8');
const sourceSha = createHash('sha256').update(original).digest('hex');
const counts = { entry: 0, sign_attempt: 0, sign_complete: 0, broadcast_attempt: 0, broadcast_final: 0 };
const marker = createServer((req, res) => { let body = ''; req.on('data', c => { body += c; if (body.length > 100)
    req.destroy(); }); req.on('end', () => { if (!Object.hasOwn(counts, body)) {
    res.writeHead(400).end();
    return;
} counts[body]++; res.end('ok'); }); });
await new Promise(resolve => marker.listen(markerPort, '127.0.0.1', resolve));
const mark = name => `await fetch('http://127.0.0.1:${markerPort}', {method:'POST',body:'${name}',signal:AbortSignal.timeout(3000)});`;
let source = original;
for (const [old, changed] of [
    ['    let config;', `    ${mark('entry')}\n    let config;`],
    ['      const signed = await signer.signTransaction(transaction);', `      ${mark('sign_attempt')}\n      const signed = await signer.signTransaction(transaction);\n      ${mark('sign_complete')}`],
    ['      const receipt = await rpc("send_tx", {', `      ${mark('broadcast_attempt')}\n      const receipt = await rpc("send_tx", {`],
    ['      await ctx.runMutation(internal.paymentWorker.outcome, {', `      ${mark('broadcast_final')}\n      await new Promise(resolve => setTimeout(resolve, 120000));\n      await ctx.runMutation(internal.paymentWorker.outcome, {`],
]) {
    assert(source.includes(old));
    source = source.replace(old, changed);
}
await writeFile(nearPath, source);
await writeFile(controlPath, `import {internalMutation,internalQuery} from './_generated/server';\nimport {internal} from './_generated/api';\nimport {v} from 'convex/values';\nexport const redeliver=internalMutation({args:{intentId:v.id('paymentIntents')},handler:async(ctx,args):Promise<string[]>=>{return Promise.all([ctx.scheduler.runAfter(0,internal.nearSettlement.settle,args),ctx.scheduler.runAfter(0,internal.nearSettlement.settle,args)]);}});\nexport const snapshot=internalQuery({args:{},handler:async(ctx)=>({locks:await ctx.db.query('signerLocks').collect(),intents:await ctx.db.query('paymentIntents').collect(),scheduled:await ctx.db.system.query('_scheduled_functions').collect()})});\n`);
let backend;
const boundedFetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) });
const admin = new ConvexHttpClient(`http://127.0.0.1:${port}`, { logger: false, fetch: boundedFetch });
const client = new ConvexHttpClient(`http://127.0.0.1:${port}`, { logger: false, fetch: boundedFetch });
let credentials;
const progress = message => console.log(message);
async function until(fn, ms = 60000) { const end = Date.now() + ms; let value; while (Date.now() < end) {
    try {
        value = await fn();
        if (value)
            return value;
    }
    catch { }
    await delay(250);
} throw new Error('BOUNDED_WAIT_EXPIRED'); }
async function start() {
    let deployedReady = false;
    backend = spawn(process.execPath, ['node_modules/convex/bin/main.js', 'dev', '--local-cloud-port', String(port), '--local-site-port', '3231', '--tail-logs', 'disable'], { env: { ...process.env, CONVEX_AGENT_MODE: 'anonymous' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [backend.stdout, backend.stderr])
        stream.on('data', chunk => { if (chunk.toString().includes('Convex functions ready!'))
            deployedReady = true; });
    await until(async () => { const c = JSON.parse(await readFile('.convex/local/default/config.json', 'utf8')); admin.setAdminAuth(c.adminKey); return admin.query('runtimeGateControl:snapshot', {}); });
    await until(() => deployedReady);
    progress('ACTUAL_BACKEND_READY');
}
async function stop() {
    if (!backend)
        return;
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,pgid=,comm='], { encoding: 'utf8' }).trim().split('\n').map(s => s.trim().split(/\s+/));
    const owned = new Set([backend.pid]);
    let n = 0;
    while (n !== owned.size) {
        n = owned.size;
        for (const [pid, parent] of rows)
            if (owned.has(Number(parent)))
                owned.add(Number(pid));
    }
    for (const pid of [...owned].reverse())
        try {
            process.kill(pid, 'SIGKILL');
        }
        catch { }
    try {
        process.kill(-backend.pid, 'SIGKILL');
    }
    catch { }
    await until(() => backend.exitCode !== null || backend.signalCode !== null, 5000);
    backend = undefined;
    await delay(1000);
    progress('ACTUAL_BACKEND_SIGKILL_COMPLETE');
}
async function auth(flow = 'signIn') {
    const result = await client.mutation('auth:signIn', { flow, ...credentials });
    assert.equal(result.status, 'complete');
    client.setAuth(result.tokens.accessToken);
}
const snapshot = () => admin.query('runtimeGateControl:snapshot', {});
const evidence = { sourceSha, startedAt: new Date().toISOString(), runtime: process.version, network: 'testnet', observations: [] };
const alarm = setTimeout(() => { progress('RUNTIME_GATE_TIMEOUT'); void stop(); }, 360000);
// The local RPC requests, polling, pause and process stop each also have finite bounds.
try {
    await start();
    await new Promise((resolve, reject) => {
        execFile(process.execPath, ['node_modules/convex/bin/main.js', 'env', 'set', '--from-file', '.convex/runtime-gate/backend.env'], {timeout:30000,killSignal:'SIGKILL',maxBuffer:65536}, error => error ? reject(new Error('ENV_IMPORT_FAILED')) : resolve());
    });
    credentials = { email: `runtime-${randomBytes(8).toString('hex')}@example.com`, password: randomBytes(24).toString('base64url') };
    await auth('signUp');
    const mission = await client.mutation('missions:create', { title: 'Synthetic durable settlement check', serviceType: 'csv_summary', inputCsv: 'product,units,price\nA,2,12.5\nB,5,4\nA,3,12.5', options: { columns: ['units', 'price'] }, maxBudgetYocto: '1000000000000000000000000', acceptanceCriteria: 'Verify computed summary of this synthetic CSV.', deadlineAt: Date.now() + 86400000, requiresHumanReview: false, cleanBeforeProcessing: true });
    const jobId = await client.mutation('jobs:start', { missionId: mission });
    const detail = await until(async () => { const d = await client.query('jobs:detail', { id: jobId }); return d.job.state === 'approved' ? d : null; });
    assert.equal(detail.children.length, 1);
    assert(detail.bids.length > 1);
    assert.equal(detail.deliverables[0].content, null);
    const childId = detail.children[0]._id;
    const childDetail = await client.query('jobs:detail', { id: childId });
    assert.equal(childDetail.job.state, 'approved');
    const parentIntentId = (await client.mutation('payments:prepare', { jobId })).intentId;
    const childIntentId = (await client.mutation('payments:prepare', { jobId: childId })).intentId;
    assert(parentIntentId && childIntentId);
    let parentIntent = await client.query('payments:forJob', { jobId });
    let childIntent = await client.query('payments:forJob', { jobId: childId });
    const publicKey = (await rpc('query', { request_type: 'view_access_key_list', account_id: parentIntent.sender, finality: 'final' })).keys[0].public_key;
    const nonceBefore = (await rpc('query', { request_type: 'view_access_key', account_id: parentIntent.sender, public_key: publicKey, finality: 'final' })).nonce;
    // Real public mutations refuse the substitutions; no worker is scheduled.
    for (const args of [{ recipient: 'substitution.testnet', amountYocto: parentIntent.amountYocto }, { recipient: parentIntent.recipient, amountYocto: (BigInt(parentIntent.amountYocto) + 1n).toString() }])
        assert.equal((await client.mutation('payments:authorize', { intentId: parentIntentId, ...args })).ok, false);
    for (const scenario of ['overspend', 'recipient', 'reputation', 'subcontract'])
        assert.equal((await client.mutation('security:run', { jobId, scenario })).decision, 'reject');
    assert.equal(counts.sign_attempt, 0);
    assert.equal(counts.broadcast_attempt, 0);
    assert.equal((await client.mutation('payments:authorize', { intentId: parentIntentId, recipient: parentIntent.recipient, amountYocto: parentIntent.amountYocto })).ok, true);
    await until(() => counts.broadcast_final === 1);
    const before = await snapshot();
    parentIntent = before.intents.find(i => i._id === parentIntentId);
    assert.equal(parentIntent.status, 'CONFIRMING');
    assert(parentIntent.txHash && parentIntent.nonce);
    assert.equal(before.locks.length, 1);
    assert.equal((await client.query('jobs:detail', { id: jobId })).delivery.released, false);
    evidence.observations.push({ stage: 'before_real_backend_kill', intentId: parentIntentId, jobId, txHash: parentIntent.txHash, nonce: parentIntent.nonce, status: parentIntent.status, lock: before.locks[0], counts: { ...counts } });
    await stop();
    await start();
    await auth();
    const after = await snapshot();
    const persisted = after.intents.find(i => i._id === parentIntentId);
    assert.equal(persisted.txHash, parentIntent.txHash);
    assert.equal(persisted.nonce, parentIntent.nonce);
    assert.equal(persisted.status, 'CONFIRMING');
    assert.deepEqual(after.locks, before.locks);
    const duplicateIds = await admin.mutation('runtimeGateControl:redeliver', { intentId: parentIntentId });
    await until(async () => { const s = await snapshot(); return duplicateIds.every(id => s.scheduled.some(row => row._id === id && row.state.kind === 'success')); });
    assert.equal(counts.sign_attempt, 1);
    assert.equal(counts.broadcast_attempt, 1);
    assert.equal((await client.mutation('payments:authorize', { intentId: parentIntentId, recipient: parentIntent.recipient, amountYocto: parentIntent.amountYocto })).ok, false);
    assert.equal((await client.mutation('security:run', { jobId, scenario: 'duplicate' })).decision, 'reject');
    // A second approved obligation cannot sign while the uncertain parent's lock survives.
    await client.mutation('payments:authorize', { intentId: childIntentId, recipient: childIntent.recipient, amountYocto: childIntent.amountYocto });
    await until(async () => { const c = await client.query('payments:forJob', { jobId: childId }); return c.lastReason === 'SIGNER_BUSY_REAUTHORIZE_LATER'; });
    assert.equal(counts.sign_attempt, 1);
    await client.mutation('payments:reconcile', { intentId: parentIntentId });
    await until(async () => { const p = await client.query('payments:forJob', { jobId }); return p.status === 'CONFIRMED'; });
    assert.equal(counts.sign_attempt, 1);
    assert.equal(counts.broadcast_attempt, 1);
    assert.equal((await client.query('jobs:detail', { id: jobId })).delivery.released, false);
    evidence.observations.push({ stage: 'after_restart_redelivery_reconciliation', duplicateIds, counts: { ...counts }, snapshot: await snapshot() });
    // Restore the real production worker before the second, separately authorized allocation.
    await stop();
    await writeFile(nearPath, original);
    await start();
    await auth();
    assert.equal((await client.mutation('payments:authorize', { intentId: childIntentId, recipient: childIntent.recipient, amountYocto: childIntent.amountYocto })).ok, true);
    childIntent = await until(async () => { const p = await client.query('payments:forJob', { jobId: childId }); return p.status === 'CONFIRMED' ? p : null; });
    parentIntent = await client.query('payments:forJob', { jobId });
    const completed = await client.query('jobs:detail', { id: jobId });
    assert.equal(completed.delivery.released, true);
    assert(completed.deliverables[0].content);
    assert.equal(completed.events.filter(e => e.type === 'DELIVERABLE_RELEASED').length, 1);
    assert.equal(BigInt(parentIntent.amountYocto) + BigInt(childIntent.amountYocto), BigInt(completed.job.reservedYocto));
    assert.notEqual(parentIntent.txHash, childIntent.txHash);
    assert(BigInt(childIntent.nonce) > BigInt(parentIntent.nonce));
    for (const intent of [parentIntent, childIntent]) {
        const receipt = await rpc('tx', { tx_hash: intent.txHash, sender_account_id: intent.sender, wait_until: 'FINAL' });
        assert.equal(inspectReceipt(receipt, intent).status, 'CONFIRMED');
    }
    const nonceAfter = (await rpc('query', { request_type: 'view_access_key', account_id: parentIntent.sender, public_key: publicKey, finality: 'final' })).nonce;
    assert.equal(String(nonceAfter), childIntent.nonce);
    const final = await snapshot();
    assert.equal(final.locks.length, 0);
    evidence.completedAt = new Date().toISOString();
    evidence.parent = parentIntent;
    evidence.child = childIntent;
    evidence.nonceBefore = String(nonceBefore);
    evidence.nonceAfter = String(nonceAfter);
    evidence.released = true;
    evidence.oneReleaseEvent = true;
    await writeFile('.convex/runtime-gate/evidence.json', JSON.stringify(evidence, null, 2), { mode: 0o600 });
    progress(JSON.stringify({ result: 'PASS', parentHash: parentIntent.txHash, childHash: childIntent.txHash, nonceBefore: String(nonceBefore), nonceAfter: String(nonceAfter), counts }));
}
catch (error) {
    progress(`RUNTIME_GATE_FAILED:${error instanceof assert.AssertionError ? 'ASSERTION_FAILED' : 'CHECK_FAILED'}`);
    await writeFile('.convex/runtime-gate/failure-evidence.json', JSON.stringify(evidence, null, 2), { mode: 0o600 });
    process.exitCode = 1;
}
finally {
    clearTimeout(alarm);
    await stop();
    await writeFile(nearPath, original);
    await rm(controlPath, { force: true });
    await writeFile('convex/_generated/api.d.ts', originalApi);
    await new Promise(resolve => marker.close(resolve));
}

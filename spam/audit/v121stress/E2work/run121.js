// Runner (v1.21): loads an engine file into an isolated vm context, exposes MODELS.x1 (SP/spam/v121/model.json,
// or model_dead.json with --dead), JOB and OUT, then runs driver121.js inside the context.
// usage: node run121.js <engineFile> <jobFile.json> <outFile.json> [--dead]
const fs = require('fs'), vm = require('vm'), path = require('path');
const [engineFile, jobFile, outFile, flag] = process.argv.slice(2);
const V121 = path.join(__dirname, '..', '..', '..', 'v121');
const model = JSON.parse(fs.readFileSync(path.join(V121, flag === '--dead' ? 'model_dead.json' : 'model.json'), 'utf8'));
const JOB = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
const OUT = {};
const ctx = vm.createContext({ self: { postMessage() {} }, console, Date, MODELS: { x1: model }, JOB, OUT,
  fetch: async () => ({ ok: true, json: async () => model }) });
vm.runInContext(fs.readFileSync(engineFile, 'utf8'), ctx, { filename: path.basename(engineFile) });
const t0 = Date.now();
vm.runInContext(fs.readFileSync(path.join(__dirname, 'driver121.js'), 'utf8'), ctx, { filename: 'driver121.js', timeout: 3600000 });
OUT.wallMs = Date.now() - t0;
fs.writeFileSync(outFile, JSON.stringify(OUT));
console.log('done', path.basename(outFile), 'decks', (OUT.res || []).length, 'ms', OUT.wallMs, OUT.err ? 'ERR ' + OUT.err : '');

// Runner: loads an engine file into an isolated vm context (same globals as SP/scripts/sim_lab2.js),
// exposes MODELS.x1 (model.json, or model_dead.json with --dead), JOB (parsed job file) and OUT, then runs driver_stress.js.
// usage: node run.js <engineFile> <jobFile.json> <outFile.json> [--dead]
const fs = require('fs'), vm = require('vm'), path = require('path');
const [engineFile, jobFile, outFile, flag] = process.argv.slice(2);
const SPAM = path.join(__dirname, '..', '..');
const modelFile = path.join(SPAM, 'js', flag === '--dead' ? 'model_dead.json' : 'model.json');
const model = JSON.parse(fs.readFileSync(modelFile, 'utf8'));
const JOB = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
const OUT = {};
const ctx = vm.createContext({ self: { postMessage() {} }, console, Date, MODELS: { x1: model }, JOB, OUT,
  fetch: async () => ({ ok: true, json: async () => model }) });
vm.runInContext(fs.readFileSync(engineFile, 'utf8'), ctx, { filename: path.basename(engineFile) });
const t0 = Date.now();
vm.runInContext(fs.readFileSync(path.join(__dirname, 'driver_stress.js'), 'utf8'), ctx, { filename: 'driver_stress.js', timeout: 3600000 });
OUT.wallMs = Date.now() - t0;
fs.writeFileSync(outFile, JSON.stringify(OUT));
console.log('done', path.basename(outFile), 'decks', (OUT.res || []).length, 'ms', OUT.wallMs, OUT.err ? 'ERR ' + OUT.err : '');

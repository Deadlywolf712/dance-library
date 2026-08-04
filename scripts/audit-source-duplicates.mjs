import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readOption(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredPath(name) {
  const value = readOption(name);
  if (!value) throw new Error(`Missing required option: ${name}`);
  return path.resolve(value);
}

const offlineRoot = requiredPath('--offline-root');
const ffmpegPath = requiredPath('--ffmpeg');
const inventoryPath = path.resolve(readOption(
  '--inventory',
  path.join(root, 'audit', 'offline-inventory-audit.json')
));
const reportPath = path.resolve(readOption(
  '--report',
  path.join(root, 'audit', 'source-duplicate-audit-local.json')
));
const concurrency = Math.max(1, Math.min(12, Number.parseInt(readOption('--concurrency', '4'), 10) || 4));
const limit = Math.max(0, Number.parseInt(readOption('--limit', '0'), 10) || 0);
const resume = process.argv.includes('--resume');
const width = 33;
const height = 18;
const sampleFractions = [0.17, 0.53, 0.83];
const frameBytes = width * height;

for (const [label, filename] of [['offline root', offlineRoot], ['ffmpeg', ffmpegPath], ['inventory', inventoryPath]]) {
  if (!fs.existsSync(filename)) throw new Error(`Missing ${label}: ${filename}`);
}

const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const allLessons = (inventory.lessons || []).filter(lesson => lesson.local?.durationSeconds > 0);
const lessons = limit ? allLessons.slice(0, limit) : allLessons;
if (!lessons.length) throw new Error('Inventory contains no measurable offline lessons.');

function localFilename(legacyPath) {
  const segments = legacyPath.split('/');
  if (!segments.length || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe catalog path: ${legacyPath}`);
  }
  const filename = path.resolve(offlineRoot, ...segments);
  const relative = path.relative(offlineRoot, filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Catalog path escapes offline root: ${legacyPath}`);
  }
  return filename;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('ffmpeg timed out after 90 seconds.'));
    }, 90_000);
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 1024 * 1024) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill();
        reject(new Error('ffmpeg fingerprint output exceeded 1 MiB.'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `ffmpeg exited with code ${code}.`));
        return;
      }
      resolve(Buffer.concat(stdout));
    });
  });
}

function differenceHash(frame) {
  const bytes = Buffer.alloc(Math.ceil((width - 1) * height / 8));
  let bitIndex = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const offset = y * width + x;
      if (frame[offset] > frame[offset + 1]) bytes[Math.floor(bitIndex / 8)] |= 1 << (bitIndex % 8);
      bitIndex += 1;
    }
  }
  return bytes.toString('base64');
}

async function fingerprintLesson(lesson) {
  const filename = localFilename(lesson.path);
  if (!fs.existsSync(filename)) throw new Error('Offline source is missing.');
  const duration = lesson.local.durationSeconds;
  const timestamps = sampleFractions.map(fraction => Math.max(0, Math.min(duration - 0.25, duration * fraction)));
  const inputs = timestamps.flatMap(timestamp => ['-ss', timestamp.toFixed(3), '-i', filename]);
  const filterInputs = timestamps.map((_, index) => `[${index}:v]scale=${width}:${height},format=gray[f${index}]`).join(';');
  const stackInputs = timestamps.map((_, index) => `[f${index}]`).join('');
  const output = await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', ...inputs,
    '-filter_complex', `${filterInputs};${stackInputs}hstack=inputs=${timestamps.length}[out]`,
    '-map', '[out]', '-frames:v', '1', '-an', '-sn', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'
  ]);
  const expectedBytes = frameBytes * timestamps.length;
  if (output.length < expectedBytes) throw new Error(`Decoded ${output.length} fingerprint bytes; expected ${expectedBytes}.`);
  const frames = timestamps.map((_, index) => {
    const frame = Buffer.allocUnsafe(frameBytes);
    for (let y = 0; y < height; y += 1) {
      const sourceStart = y * width * timestamps.length + index * width;
      output.copy(frame, y * width, sourceStart, sourceStart + width);
    }
    return frame;
  });
  return {
    legacyPath: lesson.path,
    sizeBytes: lesson.local.sizeBytes,
    durationSeconds: duration,
    timestampsSeconds: timestamps,
    hashes: frames.map(differenceHash),
    status: 'fingerprinted'
  };
}

function bitCount(value) {
  let count = 0;
  for (let cursor = value; cursor; cursor &= cursor - 1) count += 1;
  return count;
}

function hashSimilarity(leftBase64, rightBase64) {
  const left = Buffer.from(leftBase64, 'base64');
  const right = Buffer.from(rightBase64, 'base64');
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different += bitCount(left[index] ^ right[index]);
  return 1 - different / ((width - 1) * height);
}

function sha256File(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filename);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

let fingerprints = [];
if (resume && fs.existsSync(reportPath)) {
  const previous = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (Array.isArray(previous.fingerprints)) fingerprints = previous.fingerprints;
}
const fingerprintByPath = new Map(fingerprints.map(record => [record.legacyPath, record]));
const queue = lessons.filter(lesson => !fingerprintByPath.has(lesson.path));
let completed = fingerprintByPath.size;

function writeProgress() {
  const ordered = lessons.map(lesson => fingerprintByPath.get(lesson.path)).filter(Boolean);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    completedLessons: ordered.length,
    expectedLessons: lessons.length,
    fingerprints: ordered,
    exactDuplicateGroups: [],
    perceptualReviewPairs: []
  }, null, 2)}\n`, 'utf8');
}

async function worker() {
  while (queue.length) {
    const lesson = queue.shift();
    let record;
    try {
      record = await fingerprintLesson(lesson);
    } catch (error) {
      record = { legacyPath: lesson.path, status: 'failed', error: error?.message || String(error) };
    }
    fingerprintByPath.set(lesson.path, record);
    completed += 1;
    console.log(`[${String(completed).padStart(3, '0')}/${lessons.length}] ${record.status.toUpperCase()} ${lesson.path}`);
    if (completed % 20 === 0 || completed === lessons.length) writeProgress();
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, () => worker()));

const ordered = lessons.map(lesson => fingerprintByPath.get(lesson.path)).filter(Boolean);
const failures = ordered.filter(record => record.status === 'failed');
const valid = ordered.filter(record => record.status === 'fingerprinted');
const perceptualReviewPairs = [];
for (let leftIndex = 0; leftIndex < valid.length; leftIndex += 1) {
  const left = valid[leftIndex];
  for (let rightIndex = leftIndex + 1; rightIndex < valid.length; rightIndex += 1) {
    const right = valid[rightIndex];
    const durationDelta = Math.abs(left.durationSeconds - right.durationSeconds);
    const durationTolerance = Math.max(1, Math.min(left.durationSeconds, right.durationSeconds) * 0.0025);
    if (durationDelta > durationTolerance) continue;
    const similarities = left.hashes.map((hash, index) => hashSimilarity(hash, right.hashes[index]));
    const averageSimilarity = similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
    const minimumSimilarity = Math.min(...similarities);
    if (averageSimilarity >= 0.94 && minimumSimilarity >= 0.88) {
      perceptualReviewPairs.push({
        left: left.legacyPath,
        right: right.legacyPath,
        durationDeltaSeconds: durationDelta,
        similarities,
        averageSimilarity,
        minimumSimilarity
      });
    }
  }
}

const sameSizeGroups = new Map();
for (const record of valid) {
  if (!sameSizeGroups.has(record.sizeBytes)) sameSizeGroups.set(record.sizeBytes, []);
  sameSizeGroups.get(record.sizeBytes).push(record);
}
const exactDuplicateGroups = [];
for (const group of sameSizeGroups.values()) {
  if (group.length < 2) continue;
  const byDigest = new Map();
  for (const record of group) {
    const digest = await sha256File(localFilename(record.legacyPath));
    if (!byDigest.has(digest)) byDigest.set(digest, []);
    byDigest.get(digest).push(record.legacyPath);
  }
  for (const [sha256, paths] of byDigest) {
    if (paths.length > 1) exactDuplicateGroups.push({ sha256, sizeBytes: group[0].sizeBytes, paths });
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method: 'Three distributed difference-hash frames per source, duration-gated cross-catalog comparison, and SHA-256 for equal-size files.',
  thresholds: {
    durationTolerance: 'max(1 second, 0.25% of shorter video)',
    averageHashSimilarity: 0.94,
    minimumFrameHashSimilarity: 0.88
  },
  expectedLessons: lessons.length,
  completedLessons: ordered.length,
  counts: {
    fingerprinted: valid.length,
    failed: failures.length,
    exactDuplicateGroups: exactDuplicateGroups.length,
    perceptualReviewPairs: perceptualReviewPairs.length
  },
  fingerprints: ordered,
  exactDuplicateGroups,
  perceptualReviewPairs
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Source duplicate audit: ${valid.length}/${lessons.length} fingerprinted; ${failures.length} failed.`);
console.log(`Exact duplicate groups: ${exactDuplicateGroups.length}; perceptual review pairs: ${perceptualReviewPairs.length}.`);
console.log(`Report: ${path.relative(root, reportPath).replaceAll('\\', '/')}`);
if (failures.length || valid.length !== lessons.length) process.exitCode = 1;

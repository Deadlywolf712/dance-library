import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readOption(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredOption(name) {
  const value = readOption(name);
  if (!value) throw new Error(`Missing required option: ${name}`);
  return path.resolve(value);
}

const offlineRoot = requiredOption('--offline-root');
const ffmpegPath = requiredOption('--ffmpeg');
const inventoryPath = path.resolve(readOption(
  '--inventory',
  path.join(root, 'audit', 'offline-inventory-audit.json')
));
const reportPath = path.resolve(readOption(
  '--report',
  path.join(root, 'audit', 'bunny-frame-parity-local.json')
));
const concurrency = Math.max(1, Math.min(16, Number.parseInt(readOption('--concurrency', '4'), 10) || 4));
const limit = Math.max(0, Number.parseInt(readOption('--limit', '0'), 10) || 0);
const resume = process.argv.includes('--resume');

const width = 33;
const height = 18;
const frameBytes = width * height;
const allowedExtensions = new Set(['.mp4', '.m4v', '.mov', '.mkv']);

for (const [label, filename] of [['offline root', offlineRoot], ['ffmpeg', ffmpegPath], ['inventory', inventoryPath]]) {
  if (!fs.existsSync(filename)) throw new Error(`Missing ${label}: ${filename}`);
}

const catalog = JSON.parse(fs.readFileSync(
  path.join(root, 'android', 'app', 'src', 'main', 'assets', 'catalog.json'),
  'utf8'
));
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const inventoryByPath = new Map((inventory.lessons || []).map(lesson => [lesson.path, lesson]));
const allLessons = limit ? catalog.lessons.slice(0, limit) : catalog.lessons;

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
  if (!allowedExtensions.has(path.extname(filename).toLowerCase())) {
    throw new Error(`Unsupported video extension: ${legacyPath}`);
  }
  return filename;
}

async function decodeFramesFromFile(filename, timestamp, duration) {
  const output = await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-ss', timestamp.toFixed(3), '-i', filename,
    '-t', duration.toFixed(3), '-vf', `fps=4,scale=${width}:${height},format=gray`,
    '-an', '-sn', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'
  ]);
  return decodeResult(output, `offline source at ${timestamp.toFixed(3)}s`);
}

async function decodeFramesFromSegment(segment, timestamp, duration) {
  const output = await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ss', timestamp.toFixed(3),
    '-t', duration.toFixed(3), '-vf', `fps=4,scale=${width}:${height},format=gray`,
    '-an', '-sn', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'
  ], segment);
  return decodeResult(output, `Bunny segment at ${timestamp.toFixed(3)}s`);
}

function runFfmpeg(args, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
      if (stdoutBytes > 8 * 1024 * 1024) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill();
        reject(new Error('ffmpeg output exceeded 8 MiB.'));
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
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

function decodeResult(output, description) {
  const frames = [];
  for (let offset = 0; offset + frameBytes <= output.length; offset += frameBytes) {
    frames.push(output.subarray(offset, offset + frameBytes));
  }
  if (frames.length < 3) throw new Error(`${description} decoded only ${frames.length} frame(s).`);
  return frames;
}

function correlation(left, right) {
  let leftMean = 0;
  let rightMean = 0;
  for (let index = 0; index < left.length; index += 1) {
    leftMean += left[index];
    rightMean += right[index];
  }
  leftMean /= left.length;
  rightMean /= right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator ? covariance / denominator : (Math.abs(leftMean - rightMean) < 2 ? 1 : 0);
}

function hashSimilarity(left, right) {
  let equal = 0;
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const offset = y * width + x;
      if ((left[offset] > left[offset + 1]) === (right[offset] > right[offset + 1])) equal += 1;
      total += 1;
    }
  }
  return equal / total;
}

function meanAbsoluteError(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += Math.abs(left[index] - right[index]);
  return total / left.length;
}

function frameDifference(current, previous) {
  const difference = Buffer.allocUnsafe(current.length);
  for (let index = 0; index < current.length; index += 1) {
    difference[index] = Math.abs(current[index] - previous[index]);
  }
  return difference;
}

function motionEnergy(frames) {
  const energies = [];
  for (let index = 1; index < frames.length; index += 1) {
    energies.push(meanAbsoluteError(frames[index], frames[index - 1]));
  }
  return energies.reduce((sum, value) => sum + value, 0) / Math.max(1, energies.length);
}

function compareSequences(localFrames, bunnyFrames) {
  let best = null;
  for (let shift = -6; shift <= 6; shift += 1) {
    const pairs = [];
    for (let localIndex = 0; localIndex < localFrames.length; localIndex += 1) {
      const bunnyIndex = localIndex + shift;
      if (bunnyIndex < 0 || bunnyIndex >= bunnyFrames.length) continue;
      pairs.push({
        correlation: correlation(localFrames[localIndex], bunnyFrames[bunnyIndex]),
        hashSimilarity: hashSimilarity(localFrames[localIndex], bunnyFrames[bunnyIndex]),
        meanAbsoluteError: meanAbsoluteError(localFrames[localIndex], bunnyFrames[bunnyIndex])
      });
    }
    if (pairs.length < 3) continue;

    const motionCorrelations = [];
    for (let localIndex = 1; localIndex < localFrames.length; localIndex += 1) {
      const bunnyIndex = localIndex + shift;
      if (bunnyIndex < 1 || bunnyIndex >= bunnyFrames.length) continue;
      motionCorrelations.push(correlation(
        frameDifference(localFrames[localIndex], localFrames[localIndex - 1]),
        frameDifference(bunnyFrames[bunnyIndex], bunnyFrames[bunnyIndex - 1])
      ));
    }

    const average = key => pairs.reduce((sum, pair) => sum + pair[key], 0) / pairs.length;
    const candidate = {
      shiftFrames: shift,
      comparedFrames: pairs.length,
      correlation: average('correlation'),
      hashSimilarity: average('hashSimilarity'),
      meanAbsoluteError: average('meanAbsoluteError'),
      motionCorrelation: motionCorrelations.length
        ? motionCorrelations.reduce((sum, value) => sum + value, 0) / motionCorrelations.length
        : 0
    };
    candidate.score = (Math.max(0, candidate.correlation) * 0.25)
      + (candidate.hashSimilarity * 0.2)
      + (Math.max(0, candidate.motionCorrelation) * 0.25)
      + (Math.max(0, 1 - (candidate.meanAbsoluteError / 20)) * 0.3);
    if (!best || candidate.score > best.score) best = candidate;
  }
  if (!best) throw new Error('Could not align decoded local and Bunny frame sequences.');
  best.localMotionEnergy = motionEnergy(localFrames);
  best.bunnyMotionEnergy = motionEnergy(bunnyFrames);
  best.status = best.correlation >= 0.985
      && best.hashSimilarity >= 0.86
      && best.meanAbsoluteError <= 3.5
    ? 'aligned'
    : 'review';
  return best;
}

function parseMediaPlaylist(source, mediaUrl) {
  const lines = source.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  const segments = [];
  let duration = null;
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      duration = Number.parseFloat(line.slice('#EXTINF:'.length).split(',')[0]);
      continue;
    }
    if (line.startsWith('#')) continue;
    if (duration === null || !Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Playlist segment has no valid EXTINF duration: ${mediaUrl}`);
    }
    segments.push({ duration, url: new URL(line, mediaUrl).href });
    duration = null;
  }
  if (!segments.length) throw new Error(`Media playlist has no segments: ${mediaUrl}`);
  return segments;
}

async function fetchWithRetry(url, binary = false) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`Fetch failed after 3 attempts (${url}): ${lastError?.message || lastError}`);
}

function candidateSegmentIndexes(segments) {
  const lastUsable = Math.max(0, segments.length - 2);
  const firstUsable = Math.min(lastUsable, segments.length > 12 ? 5 : 0);
  return [...new Set([0.57, 0.37, 0.73].map(fraction => {
    const raw = Math.floor((segments.length - 1) * fraction);
    return Math.min(lastUsable, Math.max(firstUsable, raw));
  }))];
}

function segmentStartTime(segments, index) {
  let total = 0;
  for (let cursor = 0; cursor < index; cursor += 1) total += segments[cursor].duration;
  return total;
}

async function auditLesson(lesson) {
  const inventoryLesson = inventoryByPath.get(lesson.legacyPath);
  if (!inventoryLesson?.durationAligned) {
    throw new Error('Lesson lacks a successful local/Bunny duration alignment in the inventory audit.');
  }
  const filename = localFilename(lesson.legacyPath);
  if (!fs.existsSync(filename)) throw new Error('Offline source is missing.');

  const mediaUrl = new URL('480p/video.m3u8', lesson.hlsUrl).href;
  const mediaPlaylist = await fetchWithRetry(mediaUrl);
  const segments = parseMediaPlaylist(mediaPlaylist, mediaUrl);
  const attempts = [];

  for (const segmentIndex of candidateSegmentIndexes(segments)) {
    const segment = segments[segmentIndex];
    const sampleOffset = Math.min(0.75, Math.max(0.1, segment.duration * 0.2));
    const sampleDuration = Math.max(0.75, Math.min(2.5, segment.duration - sampleOffset - 0.1));
    const sampleTimeSeconds = segmentStartTime(segments, segmentIndex) + sampleOffset;
    const segmentBytes = await fetchWithRetry(segment.url, true);
    const [localFrames, bunnyFrames] = await Promise.all([
      decodeFramesFromFile(filename, sampleTimeSeconds, sampleDuration),
      decodeFramesFromSegment(segmentBytes, sampleOffset, sampleDuration)
    ]);
    const comparison = compareSequences(localFrames, bunnyFrames);
    const attempt = {
      segmentIndex,
      segmentDurationSeconds: segment.duration,
      sampleTimeSeconds,
      localFrameCount: localFrames.length,
      bunnyFrameCount: bunnyFrames.length,
      ...comparison
    };
    attempts.push(attempt);
    if (comparison.status === 'aligned' && comparison.localMotionEnergy >= 0.35) break;
  }

  const best = [...attempts].sort((left, right) => right.score - left.score)[0];
  return {
    legacyPath: lesson.legacyPath,
    bunnyId: lesson.bunnyId,
    category: lesson.categoryTitle,
    course: lesson.course,
    status: best?.status || 'review',
    best,
    attempts
  };
}

let records = [];
if (resume && fs.existsSync(reportPath)) {
  const previous = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (Array.isArray(previous.records)) records = previous.records;
}
const resultsByPath = new Map(records.map(record => [record.legacyPath, record]));
const queue = allLessons.filter(lesson => !resultsByPath.has(lesson.legacyPath));
let completed = resultsByPath.size;

function writeReport() {
  const orderedRecords = allLessons.map(lesson => resultsByPath.get(lesson.legacyPath)).filter(Boolean);
  const aligned = orderedRecords.filter(record => record.status === 'aligned').length;
  const review = orderedRecords.filter(record => record.status === 'review').length;
  const failed = orderedRecords.filter(record => record.status === 'failed').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    method: 'Per-lesson 480p Bunny HLS segment versus authoritative offline-source frame-sequence alignment.',
    thresholds: { correlation: 0.985, hashSimilarity: 0.86, meanAbsoluteError: 3.5 },
    expectedLessons: allLessons.length,
    completedLessons: orderedRecords.length,
    counts: { aligned, review, failed },
    records: orderedRecords
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function worker() {
  while (queue.length) {
    const lesson = queue.shift();
    let record;
    try {
      record = await auditLesson(lesson);
    } catch (error) {
      record = {
        legacyPath: lesson.legacyPath,
        bunnyId: lesson.bunnyId,
        category: lesson.categoryTitle,
        course: lesson.course,
        status: 'failed',
        error: error?.message || String(error),
        attempts: []
      };
    }
    resultsByPath.set(lesson.legacyPath, record);
    completed += 1;
    console.log(`[${String(completed).padStart(3, '0')}/${allLessons.length}] ${record.status.toUpperCase()} ${lesson.legacyPath}`);
    if (completed % 10 === 0 || completed === allLessons.length) writeReport();
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, () => worker()));
writeReport();

const finalRecords = allLessons.map(lesson => resultsByPath.get(lesson.legacyPath)).filter(Boolean);
const alignedCount = finalRecords.filter(record => record.status === 'aligned').length;
const reviewCount = finalRecords.filter(record => record.status === 'review').length;
const failedCount = finalRecords.filter(record => record.status === 'failed').length;
console.log(`Bunny frame parity: ${alignedCount}/${allLessons.length} aligned; ${reviewCount} review; ${failedCount} failed.`);
console.log(`Report: ${path.relative(root, reportPath).replaceAll('\\', '/')}`);
if (reviewCount || failedCount || finalRecords.length !== allLessons.length) process.exitCode = 1;

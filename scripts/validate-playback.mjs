import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const playback = require(path.join(root, 'playback-core.js'));
const playbackSource = fs.readFileSync(path.join(root, 'playback-core.js'), 'utf8');

const browserContext = {};
vm.createContext(browserContext);
vm.runInContext(playbackSource, browserContext, { filename: 'playback-core.js' });
assert.equal(browserContext.DanceLibraryPlayback.safeResumeTime(6, 20), 6, 'browser-global playback helpers must load');
assert.equal(Object.isFrozen(browserContext.DanceLibraryPlayback), true, 'browser-global playback helpers must be immutable');

assert.equal(playback.safeResumeTime(6, 20), 6, 'a valid saved position should resume');
assert.equal(playback.safeResumeTime(14.9, 20), 14.9, 'a position before the end guard should resume');
assert.equal(playback.safeResumeTime(15, 20), null, 'the end guard boundary must restart safely');
assert.equal(playback.safeResumeTime(11.6, 12), null, 'a near-end position must not briefly play and end');
assert.equal(playback.safeResumeTime(9999, 12), null, 'an out-of-range position must be discarded');
assert.equal(playback.safeResumeTime(Number.NaN, 12), null, 'a non-numeric position must be discarded');
assert.equal(playback.safeResumeTime(6, Number.NaN), null, 'resume requires a known finite duration');
assert.equal(playback.clampSeekTime(9999, 12), 11.75, 'explicit seeks must stay before the media end');
assert.equal(playback.clampSeekTime(-2, 12), 0, 'negative seeks must clamp to zero');

const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.match(index, /<video[^>]+playsinline[^>]+webkit-playsinline/i, 'mobile video must play inline');
assert.match(index, /id="video-retry-btn"[^>]+hidden/i, 'a hidden retry action must be available');
assert.match(app, /if \(!HlsRuntime\.isSupported\(\)\)/, 'hls.js must be preferred when supported');
assert.match(app, /sourceIsCurrent\(requestId, requestedVideo, sessionHls\)/, 'HLS callbacks must be session-bound');
assert.match(app, /recoverMediaError\(\)/, 'fatal media errors need bounded recovery');
assert.match(app, /sessionHls\.startLoad\(\)/, 'fatal network errors need bounded recovery');
assert.match(app, /HLS_RUNTIME_TIMEOUT_MS\s*=\s*8000/, 'the lazy HLS runtime must have a bounded timeout');
assert.match(app, /dataset\.action\s*=\s*'play'/, 'autoplay denial must expose a direct play action');
assert.match(app, /playbackCore\.safeResumeTime\(saved, v\.duration\)/, 'resume validation must use media duration');
assert.doesNotMatch(app, /\.play\(\)\.catch\(\(\) => \{\}\)/, 'playback failures must not be swallowed');

console.log('Validated mobile playback policy, resume boundaries, source isolation, recovery, and retry behavior.');

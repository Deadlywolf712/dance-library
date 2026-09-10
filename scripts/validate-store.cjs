const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const Store = require('../practice-store.js');

function memoryStorage(initial = {}, fail = () => false) {
    const values = new Map(Object.entries(initial));
    const operations = [];
    return {
        values, operations,
        getItem(key) {
            const operation = { type: 'get', key };
            operations.push(operation);
            if (fail(operation)) throw new Error('Read unavailable');
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            const operation = { type: 'set', key, value: String(value) };
            operations.push(operation);
            if (fail(operation)) throw new Error('Write unavailable');
            values.set(key, operation.value);
        },
        removeItem(key) {
            const operation = { type: 'remove', key };
            operations.push(operation);
            if (fail(operation)) throw new Error('Removal unavailable');
            values.delete(key);
        },
    };
}

function fakeEvents() {
    const listeners = new Set();
    return {
        listeners,
        addEventListener(type, listener) { if (type === 'storage') listeners.add(listener); },
        removeEventListener(type, listener) { if (type === 'storage') listeners.delete(listener); },
        emit(event) { for (const listener of [...listeners]) listener(event); },
    };
}

function fakeLocks() {
    let tail = Promise.resolve();
    const calls = [];
    return {
        calls,
        held: false,
        request(name, options, callback) {
            calls.push({ name, options });
            const run = async () => {
                this.held = true;
                try { return await callback(); } finally { this.held = false; }
            };
            const result = tail.then(run, run);
            tail = result.then(() => undefined, () => undefined);
            return result;
        },
    };
}

const repoFor = (storage, extra = {}) => Store.createRepository({ storage, eventTarget: null, locks: null, ...extra });
const number = value => typeof value === 'number' && Number.isFinite(value);
const validSegment = () => ({ id: 'frame-1', path: 'Bachata/Frame.mp4', title: 'Practice frame', start: 5, end: 12.5, speed: 0.75, createdAt: 100 });

test('missing values use independent fallbacks and read never changes storage', () => {
    const storage = memoryStorage();
    const repo = repoFor(storage);
    const fallback = Store.emptyPracticeData();
    repo.read('practiceData', fallback, Store.validatePracticeData).queue.push('Local change');
    assert.deepEqual(repo.read('practiceData', fallback, Store.validatePracticeData), Store.emptyPracticeData());
    assert.deepEqual(fallback, Store.emptyPracticeData());
    assert.equal(storage.operations.every(operation => operation.type === 'get'), true);
    assert.equal(repo.supportsCrossTabLock, false);
});

test('updates run real transforms against newly read state and preserve optional metadata', async () => {
    const initial = { ...Store.emptyPracticeData(), futureMetadata: { favoriteMove: 'turn' } };
    const storage = memoryStorage({ practiceData: JSON.stringify(initial) });
    const repo = repoFor(storage);
    const result = await repo.update('practiceData', Store.emptyPracticeData(), value => ({
        ...value,
        queue: [...value.queue, 'Bachata/Frame.mp4'],
        segments: [{ ...validSegment(), annotation: { counts: '1,2,3' } }],
        reflections: { 'Bachata/Frame.mp4': { text: 'Frame first\nThen timing', updatedAt: 500, futureTag: 'practice' } },
    }), Store.validatePracticeData);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.queue, ['Bachata/Frame.mp4']);
    assert.equal(result.value.futureMetadata.favoriteMove, 'turn');
    const restored = repo.read('practiceData', null, Store.validatePracticeData);
    assert.equal(restored.segments[0].annotation.counts, '1,2,3');
    assert.equal(restored.reflections['Bachata/Frame.mp4'].futureTag, 'practice');
});

test('same-tab fallback serializes mutations across repository instances', async () => {
    const storage = memoryStorage({ count: '0' });
    const first = repoFor(storage);
    const second = repoFor(storage);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const left = first.update('count', 0, async value => { await gate; return value + 1; }, number);
    const right = second.update('count', 0, value => value + 1, number);
    release();
    const results = await Promise.all([left, right]);
    assert.equal(results.every(result => result.ok), true);
    assert.equal(first.read('count', 0), 2);
});

test('independent realms use the shared exclusive Web Lock and avoid lost updates', async () => {
    const moduleSource = fs.readFileSync(require.resolve('../practice-store.js'), 'utf8');
    const otherRealm = { module: { exports: {} } };
    vm.runInNewContext(moduleSource, otherRealm);
    const locks = fakeLocks();
    const storage = memoryStorage({ count: '0' }, operation => {
        if (operation.type === 'get' && operation.key !== Store.RECOVERY_REQUIRED_KEY) assert.equal(locks.held, true, 'transaction reads must happen inside the lock');
        return false;
    });
    const first = repoFor(storage, { locks });
    const second = otherRealm.module.exports.createRepository({ storage, eventTarget: null, locks });
    const results = await Promise.all([
        first.update('count', 0, async value => { await Promise.resolve(); return value + 1; }, number),
        second.update('count', 0, value => value + 1, number),
    ]);
    assert.equal(results.every(result => result.ok), true);
    assert.equal(storage.values.get('count'), '2');
    assert.equal(first.supportsCrossTabLock, true);
    assert.equal(second.supportsCrossTabLock, true);
    assert.equal(locks.calls.length, 2);
    for (const call of locks.calls) {
        assert.equal(call.name, 'dance-library-personal-data');
        assert.equal(call.options.mode, 'exclusive');
    }
});

test('corrupted JSON is retained and blocks mutation before the updater is called', async () => {
    const raw = '{unfinished original notes';
    const storage = memoryStorage({ notes: raw });
    const repo = repoFor(storage);
    assert.throws(() => repo.read('notes', {}), SyntaxError);
    let called = false;
    const result = await repo.update('notes', {}, () => { called = true; return {}; });
    assert.equal(result.ok, false);
    assert.equal(called, false);
    assert.equal(storage.values.get('notes'), raw);
    assert.equal(storage.operations.some(operation => operation.type !== 'get'), false);
});

test('invalid saved shape and storage read failure cannot be mistaken for empty data', async () => {
    const invalid = memoryStorage({ count: 'false' });
    const invalidResult = await repoFor(invalid).update('count', 0, value => value + 1, number);
    assert.equal(invalidResult.ok, false);
    assert.equal(invalid.values.get('count'), 'false');
    assert.equal(invalid.operations.some(operation => operation.type !== 'get'), false);
    const unreadable = memoryStorage({ count: '7' }, operation => operation.type === 'get');
    const result = await repoFor(unreadable).update('count', 0, () => 1, number);
    assert.equal(result.ok, false);
    assert.equal(unreadable.values.get('count'), '7');
    assert.equal(unreadable.operations.some(operation => operation.type !== 'get'), false);
});

test('transform and validation failures never produce writes and do not poison the queue', async () => {
    const storage = memoryStorage({ count: '3' });
    const repo = repoFor(storage);
    assert.equal((await repo.update('count', 0, () => { throw new Error('Cannot calculate'); }, number)).ok, false);
    assert.equal((await repo.update('count', 0, () => NaN, number)).ok, false);
    assert.equal(storage.operations.some(operation => operation.type !== 'get'), false);
    assert.equal((await repo.update('count', 0, value => value + 1, number)).value, 4);
});

test('multi-key transaction snapshots exact raw values and commits an interdependent transform', async () => {
    const raw = ' ["first lesson"]\n';
    const storage = memoryStorage({ queue: raw });
    const repo = repoFor(storage);
    const result = await repo.transact({ queue: { fallback: [], validate: Array.isArray }, completed: { fallback: {} } }, values => ({
        queue: values.queue.slice(1), completed: { ...values.completed, [values.queue[0]]: 500 },
    }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.queue, []);
    assert.equal(repo.read('completed', {})['first lesson'], 500);
    const recovery = JSON.parse(storage.values.get(Store.RECOVERY_KEY));
    assert.equal(recovery.before.queue, raw);
    assert.equal(recovery.before.completed, null);
    assert.equal(recovery.after.queue, '[]');
    assert.equal(typeof recovery.createdAt, 'number');
    assert.equal(storage.operations.find(operation => operation.type === 'set').key, Store.RECOVERY_KEY);
});

test('undeclared and reserved writes are rejected without touching any key', async () => {
    const storage = memoryStorage();
    const repo = repoFor(storage);
    const extra = await repo.transact({ count: { fallback: 0 } }, () => ({ surprise: true }));
    const reserved = await repo.transact({ [Store.RECOVERY_KEY]: { fallback: {} } }, () => ({}));
    assert.equal(extra.ok, false);
    assert.equal(reserved.ok, false);
    assert.equal(storage.operations.some(operation => operation.type !== 'get'), false);
});

test('recovery snapshot quota failure prevents all personal-data writes', async () => {
    const storage = memoryStorage({ count: '4' }, operation => operation.type === 'set' && operation.key === Store.RECOVERY_KEY);
    const result = await repoFor(storage).update('count', 0, value => value + 1);
    assert.equal(result.ok, false);
    assert.equal(result.rollbackOk, true);
    assert.equal(storage.values.get('count'), '4');
    assert.equal(storage.operations.some(operation => operation.type === 'set' && operation.key === 'count'), false);
});

test('partial write failure restores exact old values and removes newly created keys', async () => {
    let failed = false;
    const raw = '  {"old":true}\n';
    const storage = memoryStorage({ first: raw, last: '1' }, operation => {
        if (!failed && operation.type === 'set' && operation.key === 'last') { failed = true; return true; }
        return false;
    });
    const result = await repoFor(storage).transact({ first: { fallback: {} }, newKey: { fallback: null }, last: { fallback: 0 } }, () => ({ first: {}, newKey: 'created', last: 2 }));
    assert.equal(result.ok, false);
    assert.equal(result.rollbackOk, true);
    assert.equal(storage.values.get('first'), raw);
    assert.equal(storage.values.get('last'), '1');
    assert.equal(storage.values.has('newKey'), false);
    assert.equal(JSON.parse(storage.values.get(Store.RECOVERY_KEY)).before.first, raw);
});

test('failed rollback is exposed while retaining the raw recovery snapshot', async () => {
    let failed = false;
    const storage = memoryStorage({ first: '1', last: '2' }, operation => {
        if (operation.type === 'set' && operation.key === 'last' && operation.value === '4') { failed = true; return true; }
        return failed && operation.type === 'set' && operation.key === 'first' && operation.value === '1';
    });
    const result = await repoFor(storage).transact({ first: { fallback: 0 }, last: { fallback: 0 } }, () => ({ first: 3, last: 4 }));
    assert.equal(result.ok, false);
    assert.equal(result.rollbackOk, false);
    assert.equal(storage.values.get('first'), '3');
    assert.equal(JSON.parse(storage.values.get(Store.RECOVERY_KEY)).before.first, '1');
});

test('successful mutations notify same-tab repositories, failures do not, and unsubscribe cleans up', async () => {
    const storage = memoryStorage({ count: '0' });
    const events = fakeEvents();
    const first = repoFor(storage, { eventTarget: events });
    const second = repoFor(storage, { eventTarget: events });
    const seen = [];
    const off = second.subscribe(event => seen.push(event));
    const offThrowing = first.subscribe(() => { throw new Error('Broken observer'); });
    assert.equal((await first.update('count', 0, value => value + 1)).ok, true);
    assert.deepEqual(seen, [{ source: 'local', keys: ['count'] }]);
    await first.update('count', 0, () => { throw new Error('Abort'); });
    assert.equal(seen.length, 1);
    off(); off(); offThrowing();
    assert.equal(events.listeners.size, 0);
    await first.update('count', 0, value => value + 1);
    assert.equal(seen.length, 1);
});

test('storage events notify subscribers of cross-tab writes and clears while ignoring recovery and other storage areas', () => {
    const storage = memoryStorage();
    const events = fakeEvents();
    const repo = repoFor(storage, { eventTarget: events });
    const seen = [];
    const off = repo.subscribe(event => seen.push(event));
    events.emit({ key: 'practiceData', storageArea: storage });
    events.emit({ key: Store.RECOVERY_KEY, storageArea: storage });
    events.emit({ key: 'elsewhere', storageArea: memoryStorage() });
    events.emit({ key: null, storageArea: storage });
    assert.deepEqual(seen, [{ source: 'storage', keys: ['practiceData'] }, { source: 'storage', keys: null }]);
    off();
});

test('lock rejection returns a failure without touching data', async () => {
    const storage = memoryStorage({ count: '1' });
    const repo = repoFor(storage, { locks: { request: () => Promise.reject(new Error('Lock unavailable')) } });
    const result = await repo.update('count', 0, value => value + 1);
    assert.equal(result.ok, false);
    assert.equal(storage.operations.every(operation => operation.type === 'get' && operation.key === Store.RECOVERY_REQUIRED_KEY), true);
});

test('prototype-like keys remain ordinary stored data', async () => {
    const storage = memoryStorage();
    const repo = repoFor(storage);
    const value = JSON.parse('{"__proto__":{"safe":"literal"},"constructor":"literal"}');
    const result = await repo.update('__proto__', {}, () => value);
    assert.equal(result.ok, true);
    assert.equal(repo.read('__proto__', {}).__proto__.safe, 'literal');
    assert.equal(Object.prototype.safe, undefined);
    assert.equal(JSON.parse(storage.values.get(Store.RECOVERY_KEY)).before.__proto__, null);
});

test('schema accepts boundary values, optional reflections, and unknown metadata', () => {
    const data = Store.emptyPracticeData();
    data.queue = Array.from({ length: 1000 }, (_, index) => `Course/Lesson ${index}.mp4`);
    data.segments = [validSegment(), { ...validSegment(), id: 'second', start: 0, end: 1, speed: 0.25, title: 'x'.repeat(120), createdAt: 0 }];
    data.completed = { 'Bachata/Frame.mp4': 0 };
    data.reflections = { 'Bachata/Frame.mp4': { text: 'x'.repeat(10000), updatedAt: 0, tags: ['optional'] } };
    data.extra = { future: true };
    assert.equal(Store.validatePracticeData(data), true);
    delete data.reflections;
    assert.equal(Store.validatePracticeData(data), true);
});

test('schema rejects malformed queues, segments, timestamps, and reflection records', () => {
    const mutations = [
        data => { data.version = 2; },
        data => { data.queue = ['same', 'same']; },
        data => { data.queue = ['']; },
        data => { data.queue = [null]; },
        data => { data.queue = Array.from({ length: 1001 }, (_, index) => String(index)); },
        data => { data.segments = Array.from({ length: 1001 }, (_, index) => ({ ...validSegment(), id: String(index) })); },
        data => { data.segments = [validSegment(), validSegment()]; },
        data => { data.segments = [{ ...validSegment(), title: 'x'.repeat(121) }]; },
        data => { data.segments = [{ ...validSegment(), start: -1 }]; },
        data => { data.segments = [{ ...validSegment(), end: 5 }]; },
        data => { data.segments = [{ ...validSegment(), end: Infinity }]; },
        data => { data.segments = [{ ...validSegment(), speed: '1' }]; },
        data => { data.segments = [{ ...validSegment(), speed: 2.1 }]; },
        data => { data.segments = [{ ...validSegment(), createdAt: null }]; },
        data => { data.completed = []; },
        data => { data.completed = { lesson: false }; },
        data => { data.completed = { lesson: NaN }; },
        data => { data.reflections = []; },
        data => { data.reflections = { lesson: null }; },
        data => { data.reflections = { lesson: { text: 'x'.repeat(10001), updatedAt: 0 } }; },
        data => { data.reflections = { lesson: { text: 'Cue', updatedAt: -1 } }; },
    ];
    for (const mutate of mutations) {
        const data = Store.emptyPracticeData();
        mutate(data);
        assert.equal(Store.validatePracticeData(data), false, mutate.toString());
    }
    for (const value of [null, false, [], 'data', {}]) assert.equal(Store.validatePracticeData(value), false);
});

test('legacy restore atomically combines plaintext preferences with JSON data and keeps the original backup', async () => {
    const storage = memoryStorage({ theme: 'night-owl', favoriteVideos: ' ["old lesson"]\n' });
    const repo = repoFor(storage);
    const incomingBackup = { theme: 'arctic', favoriteVideos: ['new lesson'], futureField: { preserved: true } };
    const result = await repo.transact({
        theme: { fallback: 'arctic', raw: true, validate: value => ['arctic', 'night-owl'].includes(value) },
        favoriteVideos: { fallback: [], validate: Array.isArray },
        notesBadgeSeen: { fallback: '0', raw: true, validate: value => typeof value === 'string' && /^\d+$/.test(value) },
    }, values => {
        assert.equal(values.theme, 'night-owl');
        assert.equal(values.notesBadgeSeen, '0');
        return { theme: incomingBackup.theme, favoriteVideos: [...values.favoriteVideos, ...incomingBackup.favoriteVideos], notesBadgeSeen: 2 };
    }, { recoveryKey: 'danceLibraryRestoreRecovery', incomingBackup });

    assert.equal(result.ok, true);
    assert.equal(result.value.theme, 'arctic');
    assert.equal(result.value.notesBadgeSeen, '2');
    assert.equal(storage.values.get('theme'), 'arctic', 'raw values must not gain JSON quotes');
    assert.equal(storage.values.get('notesBadgeSeen'), '2');
    assert.deepEqual(repo.read('favoriteVideos', []), ['old lesson', 'new lesson']);
    const recovery = JSON.parse(storage.values.get('danceLibraryRestoreRecovery'));
    assert.deepEqual(Object.keys(recovery).sort(), ['before', 'createdAt', 'incomingBackup', 'version']);
    assert.equal(recovery.before.theme, 'night-owl');
    assert.equal(recovery.before.favoriteVideos, ' ["old lesson"]\n');
    assert.equal(recovery.before.notesBadgeSeen, null);
    assert.deepEqual(recovery.incomingBackup, incomingBackup);
    assert.equal(storage.values.has(Store.RECOVERY_KEY), false);
});

test('failed legacy restore rolls plaintext back exactly and removes missing raw preferences', async () => {
    let failed = false;
    const storage = memoryStorage({ theme: ' night-owl\n', favorites: '[]' }, operation => {
        if (!failed && operation.type === 'set' && operation.key === 'favorites') { failed = true; return true; }
        return false;
    });
    const incomingBackup = { theme: 'arctic', favorites: ['lesson'] };
    const result = await repoFor(storage).transact({
        theme: { fallback: '', raw: true },
        preference: { fallback: '', raw: true },
        favorites: { fallback: [], validate: Array.isArray },
    }, () => ({ theme: 'arctic', preference: true, favorites: ['lesson'] }), {
        recoveryKey: 'danceLibraryRestoreRecovery', incomingBackup,
    });

    assert.equal(result.ok, false);
    assert.equal(result.rollbackOk, true);
    assert.equal(storage.values.get('theme'), ' night-owl\n');
    assert.equal(storage.values.has('preference'), false);
    assert.equal(storage.values.get('favorites'), '[]');
    const recovery = JSON.parse(storage.values.get('danceLibraryRestoreRecovery'));
    assert.equal(recovery.before.theme, ' night-owl\n');
    assert.equal(recovery.before.preference, null);
    assert.deepEqual(recovery.incomingBackup, incomingBackup);
});

test('raw validators reject invalid saved values and invalid serialized replacements without writing', async () => {
    const validate = value => ['arctic', 'night-owl'].includes(value);
    const invalid = memoryStorage({ theme: 'unknown-theme' });
    let called = false;
    const first = await repoFor(invalid).transact({ theme: { raw: true, fallback: 'arctic', validate } }, () => {
        called = true;
        return { theme: 'arctic' };
    });
    assert.equal(first.ok, false);
    assert.equal(called, false);
    assert.equal(invalid.operations.some(operation => operation.type !== 'get'), false);
    const storage = memoryStorage({ theme: 'arctic' });
    const second = await repoFor(storage).transact({ theme: { raw: true, fallback: 'arctic', validate } }, () => ({ theme: false }));
    assert.equal(second.ok, false);
    assert.equal(storage.values.get('theme'), 'arctic');
    assert.equal(storage.operations.some(operation => operation.type !== 'get'), false);
});

test('custom recovery keys cannot be written by the same transaction', async () => {
    const storage = memoryStorage();
    const result = await repoFor(storage).transact({ customRestoreSnapshot: { fallback: {} } }, () => ({ customRestoreSnapshot: {} }), {
        recoveryKey: 'customRestoreSnapshot', incomingBackup: {},
    });
    assert.equal(result.ok, false);
    assert.equal(storage.operations.every(operation => operation.type === 'get' && operation.key === Store.RECOVERY_REQUIRED_KEY), true);
});

test('recovery storage events are ignored for known names and custom transaction keys', async () => {
    const storage = memoryStorage();
    const events = fakeEvents();
    const repo = repoFor(storage, { eventTarget: events });
    const seen = [];
    const off = repo.subscribe(event => seen.push(event));
    await repo.transact({ count: { fallback: 0 } }, () => ({ count: 1 }), { recoveryKey: 'customRestoreSnapshot' });
    events.emit({ key: 'danceLibraryRestoreRecovery', storageArea: storage });
    events.emit({ key: 'danceLibraryDeleteRecovery', storageArea: storage });
    events.emit({ key: 'customRestoreSnapshot', storageArea: storage });
    events.emit({ key: 'theme', storageArea: storage });
    assert.deepEqual(seen, [{ source: 'local', keys: ['count'] }, { source: 'storage', keys: ['theme'] }]);
    off();
});

test('practice merge preserves local queue order, appends unseen paths, and keeps local metadata', () => {
    const local = { ...Store.emptyPracticeData(), queue: ['second', 'first'], preference: { local: true }, localOnly: 'retain' };
    const incoming = { ...Store.emptyPracticeData(), queue: ['first', 'third', 'second', 'fourth'], preference: { incoming: true }, incomingOnly: 'retain too' };
    const localBefore = JSON.stringify(local);
    const incomingBefore = JSON.stringify(incoming);
    const merged = Store.mergePracticeData(local, incoming);
    assert.deepEqual(merged.queue, ['second', 'first', 'third', 'fourth']);
    assert.deepEqual(merged.preference, { local: true });
    assert.equal(merged.localOnly, 'retain');
    assert.equal(merged.incomingOnly, 'retain too');
    assert.equal(JSON.stringify(local), localBefore);
    assert.equal(JSON.stringify(incoming), incomingBefore);
    assert.deepEqual(Store.mergePracticeData(merged, incoming), merged);
});

test('segment merge chooses newest known fields, preserves nested metadata, and keeps local on ties', () => {
    const local = { ...Store.emptyPracticeData(), segments: [
        { ...validSegment(), id: 'newer', title: 'Local old title', createdAt: 100, metadata: { owner: 'local' }, localFlag: true },
        { ...validSegment(), id: 'tie', title: 'Local tie winner', createdAt: 200 },
        { ...validSegment(), id: 'older', title: 'Local newer title', createdAt: 300 },
    ] };
    const incoming = { ...Store.emptyPracticeData(), segments: [
        { ...validSegment(), id: 'newer', title: 'Incoming new title', start: 6, end: 15, speed: 1, createdAt: 200, metadata: { owner: 'incoming' }, futureFlag: { preserve: true } },
        { ...validSegment(), id: 'tie', title: 'Incoming tie loser', createdAt: 200, additional: 'retained' },
        { ...validSegment(), id: 'older', title: 'Incoming older title', createdAt: 200 },
        { ...validSegment(), id: 'added', title: 'New segment', createdAt: 400 },
    ] };
    const merged = Store.mergePracticeData(local, incoming);
    assert.deepEqual(merged.segments.map(segment => segment.id), ['newer', 'tie', 'older', 'added']);
    assert.equal(merged.segments[0].title, 'Incoming new title');
    assert.equal(merged.segments[0].start, 6);
    assert.equal(merged.segments[0].speed, 1);
    assert.deepEqual(merged.segments[0].metadata, { owner: 'local' });
    assert.deepEqual(merged.segments[0].futureFlag, { preserve: true });
    assert.equal(merged.segments[0].localFlag, true);
    assert.equal(merged.segments[1].title, 'Local tie winner');
    assert.equal(merged.segments[1].additional, 'retained');
    assert.equal(merged.segments[2].title, 'Local newer title');
});

test('completion timestamps use max and reflections use newest text with local tie precedence', () => {
    const local = { ...Store.emptyPracticeData(), completed: { a: 300, b: 100 }, reflections: {
        a: { text: 'Old local reflection', updatedAt: 100, metadata: { kept: 'local' } },
        b: { text: 'Keep local on tie', updatedAt: 200 },
        c: { text: 'Keep newer local', updatedAt: 300 },
    } };
    const incoming = { ...Store.emptyPracticeData(), completed: { a: 100, b: 300, c: 0 }, reflections: {
        a: { text: 'New imported reflection\nSecond line', updatedAt: 200, metadata: { dropped: 'incoming' }, extra: { kept: true } },
        b: { text: 'Ignore incoming tie', updatedAt: 200 },
        c: { text: 'Ignore older incoming', updatedAt: 200 },
        d: { text: 'New reflection', updatedAt: 0 },
    } };
    const merged = Store.mergePracticeData(local, incoming);
    assert.deepEqual({ ...merged.completed }, { a: 300, b: 300, c: 0 });
    assert.equal(merged.reflections.a.text, 'New imported reflection\nSecond line');
    assert.deepEqual(merged.reflections.a.metadata, { kept: 'local' });
    assert.deepEqual(merged.reflections.a.extra, { kept: true });
    assert.equal(merged.reflections.b.text, 'Keep local on tie');
    assert.equal(merged.reflections.c.text, 'Keep newer local');
    assert.equal(merged.reflections.d.text, 'New reflection');
});

test('empty practice data and legacy records without reflections merge safely', () => {
    const local = Store.emptyPracticeData();
    delete local.reflections;
    const incoming = Store.emptyPracticeData();
    const merged = Store.mergePracticeData(local, incoming);
    assert.equal(Store.validatePracticeData(merged), true);
    assert.equal(JSON.stringify(merged), JSON.stringify(Store.emptyPracticeData()));
    assert.deepEqual(Store.mergePracticeData(merged, incoming), merged);
});

test('merge rejects either invalid input and oversized unions without changing the source', () => {
    assert.throws(() => Store.mergePracticeData({}, Store.emptyPracticeData()), TypeError);
    assert.throws(() => Store.mergePracticeData(Store.emptyPracticeData(), null), TypeError);
    const local = { ...Store.emptyPracticeData(), queue: Array.from({ length: 1000 }, (_, index) => `local-${index}`) };
    const incoming = { ...Store.emptyPracticeData(), queue: ['extra lesson'] };
    const before = JSON.stringify(local);
    assert.throws(() => Store.mergePracticeData(local, incoming), RangeError);
    assert.equal(JSON.stringify(local), before);
    const localSegments = { ...Store.emptyPracticeData(), segments: Array.from({ length: 1000 }, (_, index) => ({ ...validSegment(), id: `segment-${index}` })) };
    const incomingSegments = { ...Store.emptyPracticeData(), segments: [{ ...validSegment(), id: 'extra' }] };
    assert.throws(() => Store.mergePracticeData(localSegments, incomingSegments), RangeError);
});

test('oversized practice merge aborts an encompassing restore without any writes', async () => {
    const local = { ...Store.emptyPracticeData(), queue: Array.from({ length: 1000 }, (_, index) => `local-${index}`) };
    const raw = JSON.stringify(local);
    const storage = memoryStorage({ practiceData: raw, theme: 'night-owl' });
    const result = await repoFor(storage).transact({
        practiceData: { fallback: Store.emptyPracticeData(), validate: Store.validatePracticeData },
        theme: { fallback: 'arctic', raw: true },
    }, values => ({
        practiceData: Store.mergePracticeData(values.practiceData, { ...Store.emptyPracticeData(), queue: ['extra'] }),
        theme: 'arctic',
    }));
    assert.equal(result.ok, false);
    assert.equal(storage.values.get('practiceData'), raw);
    assert.equal(storage.values.get('theme'), 'night-owl');
    assert.equal(storage.operations.some(operation => operation.type !== 'get'), false);
});

test('prototype-like paths and metadata remain data throughout practice merging', () => {
    const local = JSON.parse('{"version":1,"queue":["__proto__"],"segments":[],"completed":{"__proto__":50},"reflections":{"__proto__":{"text":"Local","updatedAt":50}},"__proto__":{"localMetadata":true}}');
    const incoming = JSON.parse('{"version":1,"queue":["constructor"],"segments":[],"completed":{"__proto__":100},"reflections":{"__proto__":{"text":"Incoming","updatedAt":100}}}');
    const merged = Store.mergePracticeData(local, incoming);
    assert.equal(merged.completed.__proto__, 100);
    assert.equal(merged.reflections.__proto__.text, 'Incoming');
    assert.equal(Object.hasOwn(merged, '__proto__'), true);
    assert.deepEqual(merged.__proto__, { localMetadata: true });
    assert.equal(Object.prototype.localMetadata, undefined);
    assert.equal(Store.validatePracticeData(merged), true);
});

test('failed rollback quarantines all mutations and preserves the original recovery snapshot', async () => {
    let failed = false;
    const storage = memoryStorage({ first: '1', last: '2', unrelated: '10' }, operation => {
        if (operation.type === 'set' && operation.key === 'last' && operation.value === '4') { failed = true; return true; }
        return failed && operation.type === 'set' && operation.key === 'first' && operation.value === '1';
    });
    const repo = repoFor(storage);
    const failure = await repo.transact({ first: { fallback: 0 }, last: { fallback: 0 } }, () => ({ first: 3, last: 4 }));
    assert.equal(failure.rollbackOk, false);
    assert.equal(failure.recoveryRequired, true);
    assert.equal(failure.quarantinePersisted, true);
    const snapshot = storage.values.get(Store.RECOVERY_KEY);
    const marker = JSON.parse(storage.values.get(Store.RECOVERY_REQUIRED_KEY));
    assert.deepEqual(marker.keys, ['first', 'last']);
    assert.equal(marker.recoveryKey, Store.RECOVERY_KEY);
    const before = storage.operations.length;
    let transformCalled = false;
    const blocked = await repo.update('unrelated', 0, () => { transformCalled = true; return 20; });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.recoveryRequired, true);
    assert.equal(blocked.error.code, 'RECOVERY_REQUIRED');
    assert.equal(transformCalled, false);
    assert.equal(storage.operations.slice(before).some(operation => operation.type !== 'get'), false);
    assert.equal(storage.values.get(Store.RECOVERY_KEY), snapshot);
    assert.equal(repo.read('unrelated', 0), 10, 'quarantine must leave ordinary reads available');
    assert.equal(repoFor(storage).getRecoveryStatus().required, true);
});

test('a fresh realm loads quarantine and cannot overwrite a custom failed-restore recovery', async () => {
    const recoveryKey = 'danceLibraryRestoreRecovery';
    const snapshot = JSON.stringify({ version: 1, before: { notes: 'original raw' }, incomingBackup: { notes: 'incoming' }, createdAt: 100 });
    const marker = JSON.stringify({ version: 1, keys: ['notes'], recoveryKey, createdAt: 100 });
    const storage = memoryStorage({ notes: '[]', unrelated: '10', [recoveryKey]: snapshot, [Store.RECOVERY_REQUIRED_KEY]: marker });
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../practice-store.js'), 'utf8'), sandbox);
    const repo = sandbox.module.exports.createRepository({ storage, eventTarget: null, locks: null });
    assert.equal(repo.getRecoveryStatus().required, true);
    assert.equal(repo.getRecoveryStatus().recoveryKey, recoveryKey);
    assert.equal(repo.read('unrelated', 0), 10);
    const blocked = await repo.transact({ notes: { fallback: [] } }, () => ({ notes: ['overwritten'] }), { recoveryKey, incomingBackup: {} });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.recoveryRequired, true);
    assert.equal(storage.values.get(recoveryKey), snapshot);
    assert.equal(storage.operations.some(operation => operation.type !== 'get'), false);
});

test('quarantine remains active in memory when persistence of its marker also fails', async () => {
    let failed = false;
    const storage = memoryStorage({ first: '1', last: '2' }, operation => {
        if (operation.type === 'set' && operation.key === 'last' && operation.value === '4') { failed = true; return true; }
        return failed && operation.type === 'set' && (operation.key === Store.RECOVERY_REQUIRED_KEY
            || operation.key === 'first' && operation.value === '1');
    });
    const repo = repoFor(storage);
    const failure = await repo.transact({ first: { fallback: 0 }, last: { fallback: 0 } }, () => ({ first: 3, last: 4 }));
    assert.equal(failure.rollbackOk, false);
    assert.equal(failure.quarantinePersisted, false);
    assert.equal(storage.values.has(Store.RECOVERY_REQUIRED_KEY), false);
    assert.equal(repo.getRecoveryStatus().required, true);
    assert.equal((await repoFor(storage).update('unrelated', 0, () => 1)).recoveryRequired, true);
});

test('invalid and inaccessible recovery markers keep browsing available but prevent mutation', async () => {
    const malformed = memoryStorage({ count: '7', [Store.RECOVERY_REQUIRED_KEY]: '{incomplete marker' });
    const first = repoFor(malformed);
    assert.equal(first.read('count', 0), 7);
    assert.equal(first.getRecoveryStatus().required, true);
    assert.equal((await first.update('count', 0, value => value + 1)).recoveryRequired, true);
    assert.equal(malformed.values.get(Store.RECOVERY_REQUIRED_KEY), '{incomplete marker');
    assert.equal(malformed.operations.some(operation => operation.type !== 'get'), false);
    const inaccessible = memoryStorage({ count: '8' }, operation => operation.type === 'get' && operation.key === Store.RECOVERY_REQUIRED_KEY);
    const second = repoFor(inaccessible);
    assert.equal(second.read('count', 0), 8);
    assert.equal((await second.update('count', 0, value => value + 1)).recoveryRequired, true);
    assert.equal(inaccessible.values.get('count'), '8');
});

test('quarantine detected from another tab blocks the next mutation under the lock', async () => {
    const storage = memoryStorage({ count: '1' });
    const repo = repoFor(storage);
    assert.equal(repo.getRecoveryStatus().required, false);
    storage.values.set(Store.RECOVERY_REQUIRED_KEY, JSON.stringify({ version: 1, keys: ['elsewhere'], recoveryKey: 'danceLibraryRestoreRecovery', createdAt: 100 }));
    assert.equal((await repo.update('count', 0, () => 2)).recoveryRequired, true);
    storage.values.delete(Store.RECOVERY_REQUIRED_KEY);
    assert.equal((await repo.update('count', 0, () => 2)).recoveryRequired, true, 'live repository must not silently clear a known quarantine');
    assert.equal(storage.values.get('count'), '1');
});

test('ordinary transactions cannot alter or reuse the quarantine marker key', async () => {
    const storage = memoryStorage();
    const repo = repoFor(storage);
    const first = await repo.transact({ [Store.RECOVERY_REQUIRED_KEY]: { fallback: null } }, () => ({ [Store.RECOVERY_REQUIRED_KEY]: null }));
    const second = await repo.transact({ count: { fallback: 0 } }, () => ({ count: 1 }), { recoveryKey: Store.RECOVERY_REQUIRED_KEY });
    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.equal(storage.operations.some(operation => operation.type !== 'get'), false);
});

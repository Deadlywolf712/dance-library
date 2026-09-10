// Standalone regression tests for the proposed notes data layer.
// Run after the implementation is ready: node --test audit/notes-core.test.cjs
// NOTES_CORE_PATH can point to a different candidate module without changing tests.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const modulePath = process.env.NOTES_CORE_PATH
    ? path.resolve(process.env.NOTES_CORE_PATH)
    : path.resolve(__dirname, '../notes-core.js');
const Notes = require(modulePath);
const RECOVERY_KEY = 'danceLibraryRestoreRecovery';
const LESSON = 'Bachata/Course/Frame.mp4';
const OTHER_LESSON = 'Salsa/Course/Timing.mp4';

function entriesFor(records, lesson = LESSON) {
    return { [lesson]: records };
}

function storedValues(initial = {}, failWrite = () => false) {
    const values = new Map(Object.entries(initial));
    const operations = [];
    return {
        values,
        operations,
        getItem(key) {
            operations.push({ type: 'get', key });
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            const operation = { type: 'set', key, value: String(value) };
            operations.push(operation);
            if (failWrite(operation, operations)) throw new Error('Simulated storage write failure');
            values.set(key, operation.value);
        },
        removeItem(key) {
            const operation = { type: 'remove', key };
            operations.push(operation);
            if (failWrite(operation, operations)) throw new Error('Simulated storage removal failure');
            values.delete(key);
        },
    };
}

test('mixed legacy and current notes survive normalization without losing other lessons', () => {
    const source = {
        [LESSON]: [5, '7.5', { t: 10, n: 'Keep frame', ts: 200 }],
        [OTHER_LESSON]: [{ t: 2, n: 'Keep this independent note', ts: 100 }],
    };
    const result = Notes.normalizeBookmarks(source);

    assert.equal(Object.getPrototypeOf(result.bookmarks), null);
    assert.equal(result.invalid, 0);
    assert.deepEqual(result.bookmarks[LESSON], [
        { t: 5, n: '' },
        { t: 7.5, n: '' },
        { t: 10, n: 'Keep frame', ts: 200 },
    ]);
    assert.deepEqual(result.bookmarks[OTHER_LESSON], source[OTHER_LESSON]);
    assert.deepEqual(Notes.normalizeBookmarks(result.bookmarks), result);
});

test('one bad entry does not discard valid notes, and coercible non-times are rejected', () => {
    const result = Notes.normalizeBookmarks({
        [LESSON]: [
            null, false, '', '   ', -1, 'NaN', Infinity,
            { t: null, n: 'Bad timestamp' },
            { t: 4, n: 123 },
            { t: 5, n: 'x'.repeat(2001) },
            { t: 8, n: 'Recovered lesson note' },
        ],
        [OTHER_LESSON]: [{ t: 9, n: 'Unaffected lesson note' }],
    });

    assert.equal(result.invalid, 10);
    assert.deepEqual(result.bookmarks[LESSON], [{ t: 8, n: 'Recovered lesson note' }]);
    assert.deepEqual(result.bookmarks[OTHER_LESSON], [{ t: 9, n: 'Unaffected lesson note' }]);
});

test('zero and numeric-string timestamps remain valid, with absent notes normalized', () => {
    const result = Notes.normalizeBookmarks(entriesFor([
        0,
        '1.25',
        { t: '2.5', n: 'String timestamp from older backup' },
        { t: 4 },
    ]));

    assert.equal(result.invalid, 0);
    assert.deepEqual(result.bookmarks[LESSON], [
        { t: 0, n: '' },
        { t: 1.25, n: '' },
        { t: 2.5, n: 'String timestamp from older backup' },
        { t: 4, n: '' },
    ]);
});

test('a maximum-length multiline note survives normalize and merge verbatim', () => {
    const note = ('First line\nSecond line & <literal markup>\n' + 'x'.repeat(2000)).slice(0, 2000);
    const input = entriesFor([{ t: 12.5, n: note, ts: 500 }]);
    const normalized = Notes.normalizeBookmarks(input);
    const merged = Notes.mergeBookmarks({}, input);

    assert.equal(normalized.invalid, 0);
    assert.equal(normalized.bookmarks[LESSON][0].n, note);
    assert.equal(merged[LESSON][0].n, note);
});

test('prototype-like catalog keys are preserved as data without changing map prototypes', () => {
    const source = JSON.parse('{"__proto__":[{"t":5,"n":"Recover this note"}],"constructor":[{"t":7,"n":"Another note"}]}');
    const normalized = Notes.normalizeBookmarks(source);
    const merged = Notes.mergeBookmarks({}, source);

    for (const result of [normalized.bookmarks, merged]) {
        assert.equal(Object.getPrototypeOf(result), null);
        assert.ok(Object.hasOwn(result, '__proto__'));
        assert.ok(Object.hasOwn(result, 'constructor'));
        assert.equal(result.__proto__[0].n, 'Recover this note');
        assert.equal(result.constructor[0].n, 'Another note');
    }
    assert.equal(Object.prototype.n, undefined);
});

test('newer nonempty Android note updates the matching web timestamp', () => {
    const merged = Notes.mergeBookmarks(
        entriesFor([{ t: 10, n: 'Old cue', ts: 100 }]),
        entriesFor([{ t: 10.5, n: 'Updated frame cue', ts: 200 }]),
    );

    assert.equal(Object.getPrototypeOf(merged), null);
    assert.deepEqual(merged[LESSON], [{ t: 10, n: 'Updated frame cue', ts: 200 }]);
});

test('an older incoming note fills an empty bookmark but cannot overwrite a newer local note', () => {
    const merged = Notes.mergeBookmarks(
        entriesFor([{ t: 5, n: '', ts: 300 }, { t: 10, n: 'Newer local cue', ts: 300 }]),
        entriesFor([{ t: 5, n: 'Recovered cue', ts: 100 }, { t: 10, n: 'Older remote cue', ts: 100 }]),
    );

    assert.equal(merged[LESSON][0].n, 'Recovered cue');
    assert.equal(merged[LESSON][0].ts, 300);
    assert.deepEqual(merged[LESSON][1], { t: 10, n: 'Newer local cue', ts: 300 });
});

test('empty incoming notes preserve saved text, and identical text retains its newest timestamp', () => {
    const merged = Notes.mergeBookmarks(
        entriesFor([{ t: 5, n: 'Keep me', ts: 100 }, { t: 10, n: 'Same cue', ts: 100 }]),
        entriesFor([{ t: 5, n: '', ts: 900 }, { t: 10, n: 'Same cue', ts: 500 }]),
    );

    assert.equal(merged[LESSON][0].n, 'Keep me');
    assert.deepEqual(merged[LESSON][1], { t: 10, n: 'Same cue', ts: 500 });
});

test('duplicate incoming bookmarks collapse and repeated restores are idempotent', () => {
    const incoming = entriesFor([
        5,
        { t: 5, n: 'First cue', ts: 100 },
        { t: 5.5, n: 'Refined cue', ts: 200 },
        { t: 20, n: 'Another practice moment', ts: 300 },
    ]);
    const once = Notes.mergeBookmarks({}, incoming);
    const twice = Notes.mergeBookmarks(once, incoming);

    assert.equal(once[LESSON].length, 2);
    assert.equal(once[LESSON][0].n, 'Refined cue');
    assert.deepEqual(twice, once);
});

test('timestamps exactly one second apart remain separate, matching Android', () => {
    const merged = Notes.mergeBookmarks(
        entriesFor([{ t: 10, n: 'First moment', ts: 100 }]),
        entriesFor([{ t: 11, n: 'Next moment', ts: 200 }]),
    );

    assert.equal(merged[LESSON].length, 2);
    assert.deepEqual(merged[LESSON].map(bookmark => bookmark.t), [10, 11]);
});

test('successful restore records exact previous raw values before changing practice keys', () => {
    const before = '{ "old": true }';
    const storage = storedValues({ videoBookmarks: before, untouched: 'retain me' });
    const incoming = { videoBookmarks: entriesFor([{ t: 1, n: 'Imported' }]) };
    const updates = { videoBookmarks: JSON.stringify(incoming.videoBookmarks), favoriteVideos: '[]' };
    const result = Notes.commitStorage(storage, updates, incoming);

    assert.equal(result.ok, true);
    assert.equal(result.rollbackOk, true);
    assert.equal(storage.values.get('videoBookmarks'), updates.videoBookmarks);
    assert.equal(storage.values.get('favoriteVideos'), '[]');
    assert.equal(storage.values.get('untouched'), 'retain me');
    const recovery = JSON.parse(storage.values.get(RECOVERY_KEY));
    assert.equal(recovery.before.videoBookmarks, before);
    assert.equal(recovery.before.favoriteVideos, null);
    assert.deepEqual(recovery.incoming, incoming);
    assert.notEqual(recovery.createdAt, undefined);
    const writes = storage.operations.filter(operation => operation.type !== 'get');
    assert.equal(writes[0].key, RECOVERY_KEY);
});

test('recovery snapshot failure prevents any practice-data updates', () => {
    const storage = storedValues(
        { videoBookmarks: 'original notes', favoriteVideos: 'original favorites' },
        operation => operation.type === 'set' && operation.key === RECOVERY_KEY,
    );
    const result = Notes.commitStorage(storage, { videoBookmarks: 'new notes', favoriteVideos: 'new favorites' }, {});

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.equal(storage.values.get('videoBookmarks'), 'original notes');
    assert.equal(storage.values.get('favoriteVideos'), 'original favorites');
    assert.equal(storage.operations.some(operation => operation.type === 'set' && operation.key !== RECOVERY_KEY), false);
});

test('quota failure rolls back exact raw values and removes newly created keys', () => {
    let failed = false;
    const before = '  ["original favorite"]\n';
    const storage = storedValues({ favoriteVideos: before, watchedVideos: 'original history' }, operation => {
        if (!failed && operation.type === 'set' && operation.key === 'watchedVideos') {
            failed = true;
            return true;
        }
        return false;
    });
    const incoming = { watchedVideos: ['Imported lesson'] };
    const result = Notes.commitStorage(storage, {
        favoriteVideos: 'new favorites',
        videoBookmarks: 'new notes',
        watchedVideos: 'new history',
    }, incoming);

    assert.equal(result.ok, false);
    assert.equal(result.rollbackOk, true);
    assert.ok(result.error);
    assert.equal(storage.values.get('favoriteVideos'), before);
    assert.equal(storage.values.has('videoBookmarks'), false);
    assert.equal(storage.values.get('watchedVideos'), 'original history');
    const recovery = JSON.parse(storage.values.get(RECOVERY_KEY));
    assert.equal(recovery.before.favoriteVideos, before);
    assert.equal(recovery.before.videoBookmarks, null);
    assert.deepEqual(recovery.incoming, incoming);
});

test('rollback failure is reported honestly and recovery remains available', () => {
    let importFailed = false;
    const storage = storedValues({ first: 'original first', second: 'original second' }, operation => {
        if (operation.type === 'set' && operation.key === 'second' && operation.value === 'new second') {
            importFailed = true;
            return true;
        }
        return importFailed && operation.type === 'set' && operation.key === 'first' && operation.value === 'original first';
    });
    const result = Notes.commitStorage(storage, { first: 'new first', second: 'new second' }, { example: true });

    assert.equal(result.ok, false);
    assert.equal(result.rollbackOk, false);
    assert.ok(result.error);
    const recovery = JSON.parse(storage.values.get(RECOVERY_KEY));
    assert.equal(recovery.before.first, 'original first');
    assert.equal(recovery.before.second, 'original second');
    assert.equal(storage.values.get('first'), 'new first');
});

test('failure to read the old data prevents a restore from overwriting it', () => {
    const storage = storedValues({ videoBookmarks: 'unreadable existing notes' });
    storage.getItem = () => { throw new Error('Storage access denied'); };
    const result = Notes.commitStorage(storage, { videoBookmarks: 'replacement notes' }, {});

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.equal(storage.values.get('videoBookmarks'), 'unreadable existing notes');
    assert.equal(storage.operations.some(operation => operation.type === 'set'), false);
});

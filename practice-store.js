/* Personal data persistence. No rendering or UI dependencies. */
(function (root) {
    'use strict';

    const LOCK_NAME = 'dance-library-personal-data';
    const RECOVERY_KEY = 'danceLibraryTransactionRecovery';
    const RECOVERY_REQUIRED_KEY = 'danceLibraryRecoveryRequired';
    const recoveryKeys = new Set([RECOVERY_KEY]);
    const channels = new WeakMap();
    const recoveryStates = new WeakMap();
    // Shared by every repository in this JavaScript realm, even without Web Locks.
    let mutationTail = Promise.resolve();
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    const timestamp = value => finite(value) && value >= 0;
    const catalogPath = value => typeof value === 'string' && value.trim().length > 0;
    const isRecoveryKey = key => typeof key === 'string'
        && (recoveryKeys.has(key) || /^danceLibrary.*Recovery$/.test(key));

    function emptyPracticeData() {
        return { version: 1, queue: [], segments: [], completed: {}, reflections: {} };
    }

    // Validate known fields without stripping unknown JSON metadata.
    // Catalog membership requires a separate catalog lookup by the application.
    function validatePracticeData(value) {
        if (!record(value) || value.version !== 1 || !Array.isArray(value.queue)
            || value.queue.length > 1000 || !value.queue.every(catalogPath)
            || new Set(value.queue).size !== value.queue.length
            || !Array.isArray(value.segments) || value.segments.length > 1000
            || !record(value.completed)) return false;
        const ids = new Set();
        for (const segment of value.segments) {
            if (!record(segment) || !catalogPath(segment.id) || ids.has(segment.id)
                || !catalogPath(segment.path) || typeof segment.title !== 'string'
                || segment.title.length > 120 || !timestamp(segment.start)
                || !finite(segment.end) || segment.end <= segment.start
                || !finite(segment.speed) || segment.speed < 0.25 || segment.speed > 2
                || !timestamp(segment.createdAt)) return false;
            ids.add(segment.id);
        }
        if (!Object.entries(value.completed).every(([path, time]) => catalogPath(path) && timestamp(time))) return false;
        if (own(value, 'reflections')) {
            if (!record(value.reflections) || !Object.entries(value.reflections).every(([path, reflection]) =>
                catalogPath(path) && record(reflection) && typeof reflection.text === 'string'
                && reflection.text.length <= 10000 && timestamp(reflection.updatedAt))) return false;
        }
        return true;
    }

    function mergePracticeData(local, incoming) {
        if (!validatePracticeData(local)) throw new TypeError('Local practice data is invalid.');
        if (!validatePracticeData(incoming)) throw new TypeError('Incoming practice data is invalid.');

        // Unknown fields keep local precedence, even when known fields come from
        // a newer incoming record. Newly introduced metadata is retained.
        function mergeRecord(existing, added, fields, timestampField) {
            const latest = added[timestampField] > existing[timestampField] ? added : existing;
            const merged = { ...added, ...existing };
            for (const field of fields) merged[field] = latest[field];
            return merged;
        }

        const queue = [...new Set([...local.queue, ...incoming.queue])];
        const segmentsById = new Map(local.segments.map(segment => [segment.id, { ...segment }]));
        const segmentFields = ['id', 'path', 'title', 'start', 'end', 'speed', 'createdAt'];
        for (const segment of incoming.segments) {
            const existing = segmentsById.get(segment.id);
            segmentsById.set(segment.id, existing
                ? mergeRecord(existing, segment, segmentFields, 'createdAt')
                : { ...segment });
        }
        const segments = [...segmentsById.values()];
        if (queue.length > 1000 || segments.length > 1000) {
            throw new RangeError('Merged practice data exceeds the 1000-item queue or segment limit.');
        }

        const completed = Object.assign(Object.create(null), local.completed);
        for (const [path, time] of Object.entries(incoming.completed)) {
            completed[path] = own(completed, path) ? Math.max(completed[path], time) : time;
        }
        const reflections = Object.create(null);
        for (const [path, reflection] of Object.entries(local.reflections || {})) reflections[path] = { ...reflection };
        for (const [path, reflection] of Object.entries(incoming.reflections || {})) {
            reflections[path] = own(reflections, path)
                ? mergeRecord(reflections[path], reflection, ['text', 'updatedAt'], 'updatedAt')
                : { ...reflection };
        }
        const merged = { ...incoming, ...local, version: 1, queue, segments, completed, reflections };
        if (!validatePracticeData(merged)) throw new TypeError('Merged practice data is invalid.');
        return merged;
    }

    function freshFallback(value) {
        if (value === undefined || value === null || typeof value !== 'object') return value;
        return JSON.parse(JSON.stringify(value));
    }

    function createRepository(options = {}) {
        const storage = options.storage === undefined ? root.localStorage : options.storage;
        if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function'
            || typeof storage.removeItem !== 'function') throw new TypeError('A Storage-compatible adapter is required.');
        const eventTarget = options.eventTarget === undefined ? root : options.eventTarget;
        const locks = options.locks === undefined ? root.navigator?.locks : options.locks;
        const supportsCrossTabLock = !!locks && typeof locks.request === 'function';
        const listeners = new Set();
        if (!channels.has(storage)) channels.set(storage, new Set());
        const channel = channels.get(storage);
        if (!recoveryStates.has(storage)) recoveryStates.set(storage, { required: null });
        const recoveryState = recoveryStates.get(storage);

        function getRecoveryStatus() {
            let error;
            try {
                const raw = storage.getItem(RECOVERY_REQUIRED_KEY);
                if (raw !== null) {
                    const marker = JSON.parse(raw);
                    if (!record(marker) || marker.version !== 1 || !Array.isArray(marker.keys)
                        || !marker.keys.every(key => typeof key === 'string')
                        || typeof marker.recoveryKey !== 'string' || !marker.recoveryKey
                        || !timestamp(marker.createdAt)) throw new TypeError('The recovery-required marker is invalid.');
                    recoveryState.required = marker;
                }
                // Once quarantined, this live repository never clears itself just
                // because another writer removed the marker. Recovery needs an
                // explicit repair and a fresh page/realm.
            } catch (caught) { error = caught; }
            const marker = recoveryState.required;
            return {
                required: !!marker || !!error,
                keys: marker ? [...marker.keys] : [],
                recoveryKey: marker?.recoveryKey || null,
                ...(error ? { error } : {}),
            };
        }
        // A broken or inaccessible marker must not prevent read-only browsing.
        getRecoveryStatus();

        function readRaw(key) {
            if (typeof key !== 'string') throw new TypeError('Storage keys must be strings.');
            return storage.getItem(key);
        }

        function parseRaw(key, raw, fallback, validate, rawMode = false) {
            const value = raw === null ? freshFallback(fallback) : rawMode ? raw : JSON.parse(raw);
            if (validate !== undefined && typeof validate !== 'function') throw new TypeError(`Invalid validator for ${key}.`);
            if (validate && validate(value) !== true) throw new TypeError(`Invalid saved data for ${key}.`);
            return value;
        }

        function read(key, fallback, validate) {
            return parseRaw(key, readRaw(key), fallback, validate);
        }

        function notify(event) {
            for (const listener of [...listeners]) {
                // Observer failures must not turn a completed commit into a failure.
                try { listener(event); } catch (_) { /* Isolate subscriber errors. */ }
            }
        }

        function onStorage(event) {
            if (event.storageArea && event.storageArea !== storage) return;
            if (isRecoveryKey(event.key)) return;
            notify({ source: 'storage', keys: event.key === null ? null : [event.key] });
        }

        function subscribe(listener) {
            if (typeof listener !== 'function') throw new TypeError('A subscriber must be a function.');
            if (listeners.size === 0) {
                channel.add(notify);
                eventTarget?.addEventListener?.('storage', onStorage);
            }
            listeners.add(listener);
            let active = true;
            return () => {
                if (!active) return;
                active = false;
                listeners.delete(listener);
                if (listeners.size === 0) {
                    channel.delete(notify);
                    eventTarget?.removeEventListener?.('storage', onStorage);
                }
            };
        }

        async function performTransaction(specs, transform, options) {
            const before = Object.create(null);
            const values = Object.create(null);
            const written = [];
            let recoveryKey = RECOVERY_KEY;
            try {
                if (!record(specs) || typeof transform !== 'function') throw new TypeError('A transaction needs read specifications and a transform.');
                if (!record(options)) throw new TypeError('Transaction options must be an object.');
                const recoveryStatus = getRecoveryStatus();
                if (recoveryStatus.required) {
                    const error = new Error('Personal data needs recovery before further changes can be saved. Download the recovery data and repair the saved state first.');
                    error.code = 'RECOVERY_REQUIRED';
                    error.recoveryKey = recoveryStatus.recoveryKey;
                    if (recoveryStatus.error) error.cause = recoveryStatus.error;
                    throw error;
                }
                recoveryKey = options.recoveryKey === undefined ? RECOVERY_KEY : options.recoveryKey;
                if (typeof recoveryKey !== 'string' || !recoveryKey.trim()) throw new TypeError('A recovery key must be a nonempty string.');
                if (recoveryKey === RECOVERY_REQUIRED_KEY) throw new TypeError('The recovery-required marker is reserved.');
                for (const [key, spec] of Object.entries(specs)) {
                    if (key === RECOVERY_REQUIRED_KEY || key === recoveryKey || isRecoveryKey(key) || !record(spec)
                        || spec.raw !== undefined && typeof spec.raw !== 'boolean') throw new TypeError(`Invalid transaction specification for ${key}.`);
                    before[key] = readRaw(key);
                    values[key] = parseRaw(key, before[key], spec.fallback, spec.validate, spec.raw === true);
                }
                const updates = await transform(values);
                if (!record(updates)) throw new TypeError('The transaction transform must return an updates object.');
                const serialized = Object.create(null);
                const nextValues = Object.assign(Object.create(null), values);
                for (const [key, value] of Object.entries(updates)) {
                    if (!own(specs, key)) throw new TypeError(`Transaction did not declare ${key}.`);
                    const raw = specs[key].raw === true ? String(value) : JSON.stringify(value);
                    if (raw === undefined) throw new TypeError(`Cannot store an undefined value for ${key}.`);
                    // Validate the representation that will actually survive reload.
                    nextValues[key] = parseRaw(key, raw, specs[key].fallback, specs[key].validate, specs[key].raw === true);
                    if (raw !== before[key]) serialized[key] = raw;
                }
                const changedKeys = Object.keys(serialized);
                if (changedKeys.length === 0) return { ok: true, value: nextValues, rollbackOk: true };
                const recovery = { version: 1, before, createdAt: Date.now() };
                if (own(options, 'incomingBackup')) recovery.incomingBackup = options.incomingBackup;
                else recovery.after = serialized;
                recoveryKeys.add(recoveryKey);
                storage.setItem(recoveryKey, JSON.stringify(recovery));
                for (const key of changedKeys) {
                    storage.setItem(key, serialized[key]);
                    written.push(key);
                }
                const event = { source: 'local', keys: changedKeys };
                for (const notifyRepository of [...channel]) notifyRepository(event);
                return { ok: true, value: nextValues, rollbackOk: true };
            } catch (error) {
                let rollbackOk = true;
                for (const key of written.reverse()) {
                    try {
                        if (before[key] === null) storage.removeItem(key);
                        else storage.setItem(key, before[key]);
                    } catch (_) { rollbackOk = false; }
                }
                if (!rollbackOk) {
                    const marker = { version: 1, keys: Object.keys(specs), recoveryKey, createdAt: Date.now() };
                    recoveryState.required = marker;
                    let quarantinePersisted = true;
                    try { storage.setItem(RECOVERY_REQUIRED_KEY, JSON.stringify(marker)); }
                    catch (_) { quarantinePersisted = false; }
                    return { ok: false, value: undefined, error, rollbackOk, recoveryRequired: true, recoveryKey, quarantinePersisted };
                }
                return {
                    ok: false, value: undefined, error, rollbackOk,
                    ...(error?.code === 'RECOVERY_REQUIRED' ? { recoveryRequired: true, recoveryKey: error.recoveryKey } : {}),
                };
            }
        }

        function transact(specs, transform, options = {}) {
            const run = () => supportsCrossTabLock
                ? locks.request(LOCK_NAME, { mode: 'exclusive' }, () => performTransaction(specs, transform, options))
                : performTransaction(specs, transform, options);
            const pending = mutationTail.then(run, run).catch(error => ({ ok: false, value: undefined, error, rollbackOk: true }));
            mutationTail = pending.then(() => undefined, () => undefined);
            return pending;
        }

        async function update(key, fallback, updater, validate) {
            const specs = Object.create(null);
            specs[key] = { fallback, validate };
            const result = await transact(specs, async values => {
                if (typeof updater !== 'function') throw new TypeError('An update needs an updater function.');
                return { [key]: await updater(values[key]) };
            });
            return result.ok ? { ...result, value: result.value[key] } : result;
        }

        return Object.freeze({ read, readRaw, get: read, update, transact, subscribe, getRecoveryStatus, supportsCrossTabLock });
    }

    const api = Object.freeze({ createRepository, validatePracticeData, emptyPracticeData, mergePracticeData, LOCK_NAME, RECOVERY_KEY, RECOVERY_REQUIRED_KEY });
    root.DanceLibraryStore = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

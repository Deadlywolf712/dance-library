/* Personal-data rules shared by the UI and deterministic regression tests. */
(function (root) {
    'use strict';
    const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const isTime = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
        && Number.isFinite(Number(value)) && Number(value) >= 0;
    function normalizeBookmarks(value) {
        const bookmarks = Object.create(null);
        let invalid = 0;
        if (!isRecord(value)) return { bookmarks, invalid: 1 };
        for (const [path, entries] of Object.entries(value)) {
            if (!Array.isArray(entries)) { invalid++; continue; }
            bookmarks[path] = [];
            for (const entry of entries) {
                const object = isRecord(entry);
                const time = object ? entry.t : entry;
                if (!isTime(time) || (object && (entry.n !== undefined && (typeof entry.n !== 'string' || entry.n.length > 2000)
                    || entry.ts !== undefined && !isTime(entry.ts)))) { invalid++; continue; }
                const note = { t: Number(time), n: object ? entry.n || '' : '' };
                if (object && entry.ts !== undefined) note.ts = Number(entry.ts);
                bookmarks[path].push(note);
            }
            bookmarks[path].sort((a, b) => a.t - b.t);
        }
        return { bookmarks, invalid };
    }
    function mergeBookmarks(existing, incoming) {
        const merged = normalizeBookmarks(existing).bookmarks;
        for (const [path, entries] of Object.entries(normalizeBookmarks(incoming).bookmarks)) {
            const target = merged[path] || (merged[path] = []);
            for (const note of entries) {
                const prior = target.find(item => Math.abs(item.t - note.t) < 1);
                if (!prior) { target.push({ ...note }); continue; }
                if (note.n && (!prior.n || Number(note.ts || 0) > Number(prior.ts || 0))) {
                    prior.n = note.n;
                    if (note.ts !== undefined) prior.ts = Math.max(Number(prior.ts || 0), note.ts);
                } else if (prior.n === note.n && Number(note.ts || 0) > Number(prior.ts || 0)) {
                    prior.ts = note.ts;
                }
            }
            target.sort((a, b) => a.t - b.t);
        }
        return merged;
    }
    // localStorage is not transactional. Keep a durable recovery file, and roll
    // back every completed write if one fails. Never report a partial restore as success.
    function commitStorage(storage, updates, incomingBackup, recoveryKey = 'danceLibraryRestoreRecovery') {
        const before = Object.create(null);
        const written = [];
        try {
            for (const key of Object.keys(updates)) before[key] = storage.getItem(key);
            storage.setItem(recoveryKey, JSON.stringify({ before, incoming: incomingBackup, createdAt: Date.now() }));
            for (const [key, value] of Object.entries(updates)) {
                storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                written.push(key);
            }
            return { ok: true, rollbackOk: true };
        } catch (error) {
            let rollbackOk = true;
            for (const key of written.reverse()) {
                try {
                    if (before[key] === null) storage.removeItem(key);
                    else storage.setItem(key, before[key]);
                } catch (_) { rollbackOk = false; }
            }
            return { ok: false, rollbackOk, error };
        }
    }
    const api = Object.freeze({ normalizeBookmarks, mergeBookmarks, commitStorage, isTime });
    root.DanceLibraryNotes = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

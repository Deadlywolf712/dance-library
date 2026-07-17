(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.DanceLibraryPlayback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MINIMUM_RESUME_SECONDS = 5;
    const RESUME_END_GUARD_SECONDS = 5;
    const SEEK_END_GUARD_SECONDS = 0.25;

    function safeResumeTime(savedTime, duration) {
        const saved = Number(savedTime);
        const length = Number(duration);
        if (!Number.isFinite(saved) || saved <= MINIMUM_RESUME_SECONDS) return null;
        if (!Number.isFinite(length) || length <= 0) return null;
        if (saved >= length - RESUME_END_GUARD_SECONDS) return null;
        return saved;
    }

    function clampSeekTime(requestedTime, duration) {
        const requested = Number(requestedTime);
        if (!Number.isFinite(requested) || requested < 0) return 0;

        const length = Number(duration);
        if (!Number.isFinite(length) || length <= 0) return requested;
        return Math.min(requested, Math.max(0, length - SEEK_END_GUARD_SECONDS));
    }

    return Object.freeze({
        MINIMUM_RESUME_SECONDS,
        RESUME_END_GUARD_SECONDS,
        safeResumeTime,
        clampSeekTime
    });
});

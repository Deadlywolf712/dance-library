/* Practice workspace DOM controller. Requires DanceLibraryStore and a repository.
 * All personal-data writes use fresh repository updates/transactions.
 * Route ownership and playback source ownership remain with the host app.
 * Public API: DanceLibraryWorkspace.create(options), parseTime(text), formatTime(seconds).
 * create returns {render, lessonChanged, readPractice, getRecoveryDrafts, destroy}.
 */
(function (root) {
    'use strict';
    const PRACTICE_KEY = 'practiceData';
    const DRAFT_KEY = 'danceLibraryReflectionDrafts';
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const finiteTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const emptyDrafts = () => ({ version: 1, entries: {} });
    const freshId = () => root.crypto?.randomUUID?.()
        || `practice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

    function parseTime(value) {
        if (typeof value === 'number') return finiteTime(value) && value <= Number.MAX_SAFE_INTEGER ? value : null;
        if (typeof value !== 'string') return null;
        const parts = value.trim().split(':');
        if (parts.length > 3 || parts.length === 0) return null;
        if (!parts.every((part, index) => (index === parts.length - 1 ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(part))) return null;
        const values = parts.map(Number);
        if (parts.length > 1 && values.at(-1) >= 60) return null;
        if (parts.length === 3 && values[1] >= 60) return null;
        const seconds = values.reduce((total, part) => total * 60 + part, 0);
        return finiteTime(seconds) && seconds <= Number.MAX_SAFE_INTEGER ? seconds : null;
    }

    function formatTime(value) {
        if (!finiteTime(value)) return '0:00';
        const milliseconds = Math.round(value * 1000);
        const hours = Math.floor(milliseconds / 3600000);
        const minutes = Math.floor(milliseconds / 60000) % 60;
        const seconds = (milliseconds % 60000) / 1000;
        const secondsText = String(seconds).padStart(seconds < 10 ? String(seconds).length + 1 : 2, '0');
        return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`
            : `${Math.floor(milliseconds / 60000)}:${secondsText}`;
    }

    function validateDrafts(value) {
        return record(value) && value.version === 1 && record(value.entries)
            && Object.entries(value.entries).every(([id, draft]) => id.length > 0 && record(draft)
                && typeof draft.path === 'string' && draft.path.length > 0
                && typeof draft.text === 'string' && draft.text.length <= 10000
                && typeof draft.baseText === 'string' && draft.baseText.length <= 10000
                && finiteTime(draft.baseUpdatedAt) && finiteTime(draft.updatedAt));
    }

    function create(options) {
        const { repository, catalog, getCurrentVideo, getVideoElement, openVideo, showHome, showQueue,
            setLoop, getLoop, getSpeed, showToast = () => {}, onPracticeChange = () => {} } = options;
        const store = root.DanceLibraryStore;
        if (!store || !repository || !catalog) throw new TypeError('The workspace needs a store, repository, and catalog.');
        const document = root.document;
        const byId = id => document.getElementById(id);
        const elements = {
            overview: byId('practice-overview'), queue: byId('queue-list'), header: byId('video-header-container'),
            reflection: byId('lesson-reflection-input'), reflectionStatus: byId('reflection-status'),
            reflectionIndicator: byId('reflection-saved-indicator'), saveReflection: byId('save-reflection'),
            form: byId('segment-form'), title: byId('segment-title'), start: byId('segment-start'),
            end: byId('segment-end'), segmentStatus: byId('segment-status'), segments: byId('saved-segments-list')
        };
        for (const [name, element] of Object.entries(elements)) {
            if (!element) throw new Error(`The practice workspace is missing ${name}.`);
        }
        const abort = new root.AbortController();
        const on = (element, event, callback) => element?.addEventListener(event, callback, { signal: abort.signal });
        const make = (tag, text, className) => {
            const element = document.createElement(tag);
            if (text !== undefined) element.textContent = text;
            if (className) element.className = className;
            return element;
        };
        const button = (label, action, path, className = 'workspace-button') => {
            const result = make('button', label, className);
            result.type = 'button';
            result.dataset.workspaceAction = action;
            if (path !== undefined) result.dataset.path = path;
            return result;
        };
        let alive = true;
        let activePath = null;
        let activeTab = 'notes';
        let lastPublishedPractice = null;
        let rendering = false;
        let persistPending = 0;
        const editors = new Map();
        const memoryDrafts = new Map();
        const unsafeDrafts = new Set();
        const deletedSegments = [];

        const actions = make('div', undefined, 'lesson-actions');
        actions.id = 'workspace-lesson-actions';
        const queueToggle = button('Add to queue', 'toggle-queue');
        queueToggle.id = 'lesson-queue-toggle';
        const completeToggle = button('Mark complete', 'toggle-complete');
        completeToggle.id = 'lesson-complete-toggle';
        actions.append(queueToggle, completeToggle);
        const footer = byId('lesson-footer-controls');
        const sequence = elements.header.querySelector('.prev-next-controls');
        const sequenceParent = sequence?.parentNode;
        if (footer && sequence) footer.append(sequence);
        (footer || elements.header).append(actions);

        const recoveryActions = make('div', undefined, 'segment-form-actions');
        const recoveryDisclosure = make('details', undefined, 'reflection-recovery-options');
        recoveryDisclosure.append(make('summary', 'Recovery options'), recoveryActions);
        const loadSaved = button('Load saved version', 'load-saved');
        loadSaved.id = 'reflection-load-saved';
        loadSaved.hidden = true;
        const downloadDrafts = button('Download reflection drafts', 'download-drafts');
        downloadDrafts.id = 'reflection-download-drafts';
        downloadDrafts.title = 'Download a recovery copy of saved and in-memory reflection drafts';
        recoveryActions.append(loadSaved, downloadDrafts);
        elements.reflection.closest('.lesson-reflection').append(recoveryDisclosure);

        const undoSegment = button('Undo segment deletion', 'undo-segment');
        undoSegment.id = 'segment-undo-delete';
        undoSegment.hidden = true;
        elements.segments.before(undoSegment);

        function readPractice() {
            return repository.read(PRACTICE_KEY, store.emptyPracticeData(), store.validatePracticeData);
        }
        function readDrafts() { return repository.read(DRAFT_KEY, emptyDrafts(), validateDrafts); }
        function readRecord(key) {
            try { return repository.read(key, {}, record); } catch (_) { return {}; }
        }
        function reflectionFor(data, path) {
            const value = data.reflections && own(data.reflections, path) ? data.reflections[path] : null;
            return value || { text: '', updatedAt: 0 };
        }
        function currentPath() { return getCurrentVideo()?.path || null; }
        function sameBase(editor, reflection) {
            return editor.baseText === reflection.text && editor.baseUpdatedAt === reflection.updatedAt;
        }
        function draftSnapshot(editor) {
            return { path: editor.path, text: editor.text, baseText: editor.baseText,
                baseUpdatedAt: editor.baseUpdatedAt, updatedAt: editor.updatedAt };
        }
        function status(message, needsRecovery = false) {
            if (!alive) return;
            elements.reflectionStatus.textContent = message;
            if (needsRecovery) {
                recoveryDisclosure.open = true;
                elements.reflection.closest('details').open = true;
            }
        }
        function setReflectionStatus(editor, data) {
            if (!editor || editor.path !== activePath) return;
            const changed = !sameBase(editor, reflectionFor(data, editor.path));
            loadSaved.hidden = !(editor.dirty && changed);
            elements.reflectionIndicator.textContent = editor.dirty ? ' · Unsaved' : editor.baseText ? ' · Saved' : '';
            if (editor.dirty && changed) status('The saved reflection changed in another tab. Your draft is kept. Download it or load the saved version to merge your changes.', true);
            else if (editor.dirty) status(editor.persisted ? 'Unsaved changes · draft saved on this device.'
                : 'Unsaved changes · keep this page open or download your draft until it can be saved.', !editor.persisted && persistPending === 0);
            else status(editor.baseText ? 'Reflection saved.' : 'Save a general note about this lesson.');
        }
        function editorFor(path, data) {
            if (editors.has(path)) return editors.get(path);
            const saved = reflectionFor(data, path);
            let recovered = null;
            try {
                recovered = Object.entries(readDrafts().entries)
                    .filter(([, draft]) => draft.path === path && draft.text !== saved.text)
                    .sort((first, second) => second[1].updatedAt - first[1].updatedAt)[0] || null;
            } catch (_) { /* Do not replace malformed draft storage; recovery export can retain it. */ }
            const editor = {
                id: freshId(), path, text: recovered ? recovered[1].text : saved.text,
                baseText: recovered ? recovered[1].baseText : saved.text,
                baseUpdatedAt: recovered ? recovered[1].baseUpdatedAt : saved.updatedAt,
                updatedAt: Date.now(), dirty: !!recovered, persisted: !!recovered, revision: 0,
                recovered: recovered ? { id: recovered[0], value: recovered[1] } : null
            };
            editors.set(path, editor);
            if (editor.dirty) memoryDrafts.set(editor.id, draftSnapshot(editor));
            return editor;
        }
        async function persistEditor(editor) {
            if (!editor?.dirty) return true;
            const snapshot = draftSnapshot(editor);
            memoryDrafts.set(editor.id, snapshot);
            unsafeDrafts.add(editor.id);
            const revision = editor.revision;
            persistPending += 1;
            let result;
            try {
                result = await repository.update(DRAFT_KEY, emptyDrafts(), data => ({
                    ...data, entries: { ...data.entries, [editor.id]: snapshot }
                }), validateDrafts);
            } catch (error) { result = { ok: false, error }; }
            persistPending -= 1;
            if (result.ok && memoryDrafts.get(editor.id) === snapshot) unsafeDrafts.delete(editor.id);
            if (editor.revision === revision) editor.persisted = result.ok;
            if (alive && editor.path === activePath && editors.get(editor.path) === editor) {
                try { setReflectionStatus(editor, readPractice()); }
                catch (_) { status('Your draft is kept in this page. Download it before closing.', true); }
            }
            return result.ok;
        }
        async function mutate(transform, message) {
            let result;
            try { result = await repository.update(PRACTICE_KEY, store.emptyPracticeData(), transform, store.validatePracticeData); }
            catch (error) { result = { ok: false, error }; }
            if (!alive) return result;
            if (result.ok) { render(); if (message) showToast(message); }
            else showToast('The change could not be saved. Your existing practice data was kept.');
            return result;
        }
        function completed(data, path) { return own(data.completed, path); }
        async function toggleQueue(path) {
            if (!catalog.find(path)) return;
            await mutate(data => ({ ...data, queue: data.queue.includes(path)
                ? data.queue.filter(item => item !== path) : [...data.queue, path] }));
        }
        async function toggleComplete(path) {
            await mutate(data => {
                const next = { ...data.completed };
                if (own(next, path)) delete next[path];
                else next[path] = Date.now();
                return { ...data, completed: next };
            });
        }

        function renderOverview(data) {
            elements.overview.replaceChildren();
            const lastWatched = readRecord('videoLastWatched');
            const positions = readRecord('videoPositions');
            const latest = Object.entries(lastWatched).filter(([path, time]) => catalog.find(path) && Number.isFinite(Number(time)))
                .sort((first, second) => Number(second[1]) - Number(first[1]))[0];
            const next = data.queue.find(path => catalog.find(path) && !completed(data, path));
            const path = latest?.[0] || next;
            if (!path) return;
            const first = make('article', undefined, 'practice-overview-card');
            first.append(make('p', latest ? 'Continue practicing' : 'Start practicing', 'eyebrow'));
            const lesson = catalog.find(path);
            const position = Number(positions[path]);
            const copy = make('div', undefined, 'practice-overview-copy');
            copy.append(make('h2', lesson.title), make('p', lesson.folderPath));
            const resume = button(finiteTime(position) && position > 0 ? `Resume at ${formatTime(position)}` : 'Practice lesson', 'open', path, 'workspace-button primary');
            if (finiteTime(position) && position > 0) resume.dataset.time = String(position);
            const links = make('div', undefined, 'practice-overview-actions');
            links.append(resume);
            if (data.queue.length) {
                links.append(button(`View queue · ${data.queue.length} ${data.queue.length === 1 ? 'lesson' : 'lessons'}`, 'queue', undefined, 'workspace-button practice-queue-link'));
            }
            first.append(copy, links);
            elements.overview.append(first);
        }

        function renderQueue(data) {
            const openRows = new Set([...elements.queue.querySelectorAll('.queue-options[open]')].map(details => details.closest('[data-path]').dataset.path));
            elements.queue.replaceChildren();
            if (!data.queue.length) {
                const empty = make('div', undefined, 'workspace-empty');
                empty.append(make('p', 'Your queue is ready for a first lesson.'), button('Browse lessons', 'home'));
                elements.queue.append(empty);
            }
            data.queue.forEach((path, index) => {
                const lesson = catalog.find(path);
                const row = make('article', undefined, 'queue-lesson');
                row.dataset.path = path;
                const copy = make('div', undefined, 'queue-lesson-copy');
                copy.append(make('h2', lesson?.title || 'Unavailable lesson'),
                    make('p', lesson?.folderPath || path), make('p', completed(data, path) ? 'Completed' : 'Ready to practice'));
                const rowActions = make('div', undefined, 'queue-actions');
                const play = button('Play', 'open', path, 'workspace-button primary');
                play.disabled = !lesson;
                const up = button('Move up', 'up', path); up.disabled = index === 0;
                const down = button('Move down', 'down', path); down.disabled = index === data.queue.length - 1;
                const done = button(completed(data, path) ? 'Mark incomplete' : 'Mark complete', 'complete', path);
                done.setAttribute('aria-pressed', String(completed(data, path)));
                for (const control of [play, up, down, done]) control.setAttribute('aria-label', `${control.textContent}: ${lesson?.title || path}`);
                const more = make('details', undefined, 'queue-options');
                more.open = openRows.has(path);
                const summary = make('summary', 'Options', 'workspace-button');
                summary.setAttribute('aria-label', `Options for ${lesson?.title || path}`);
                const controls = make('div', undefined, 'queue-management');
                const remove = button('Remove from queue', 'remove', path);
                remove.setAttribute('aria-label', `Remove from queue: ${lesson?.title || path}`);
                controls.append(up, down, done, remove);
                more.append(summary, controls);
                rowActions.append(play, more);
                row.append(make('span', String(index + 1).padStart(2, '0'), 'queue-order'), copy, rowActions);
                elements.queue.append(row);
            });
            const queueCount = byId('nav-queue-count');
            if (queueCount) {
                queueCount.textContent = String(data.queue.length);
                queueCount.hidden = data.queue.length === 0;
                queueCount.setAttribute('aria-label', `${data.queue.length} ${data.queue.length === 1 ? 'lesson' : 'lessons'} in queue`);
            }
            if (byId('mobile-queue-count')) byId('mobile-queue-count').textContent = String(data.queue.length);
        }

        function renderSegments(data) {
            elements.segments.replaceChildren();
            const segments = data.segments.filter(segment => segment.path === activePath);
            if (!segments.length) elements.segments.append(make('p', 'Save a short section to return to the part you want to practice.'));
            for (const segment of segments) {
                const row = make('article', undefined, 'saved-segment');
                const copy = make('div');
                copy.append(make('strong', segment.title || 'Practice segment'),
                    make('small', `${formatTime(segment.start)}–${formatTime(segment.end)} · ${segment.speed}×`));
                const play = button('Practice', 'play-segment', segment.path);
                play.dataset.segmentId = segment.id;
                play.setAttribute('aria-label', `Practice ${segment.title || 'segment'}`);
                const remove = button('Delete', 'delete-segment', segment.path);
                remove.dataset.segmentId = segment.id;
                remove.setAttribute('aria-label', `Delete ${segment.title || 'segment'}`);
                row.append(copy, play, remove);
                elements.segments.append(row);
            }
            undoSegment.hidden = deletedSegments.length === 0;
        }

        function selectTab(name, focus = false) {
            activeTab = name;
            for (const tab of document.querySelectorAll('[data-practice-tab]')) {
                const selected = tab.dataset.practiceTab === name;
                tab.setAttribute('aria-selected', String(selected));
                tab.tabIndex = selected ? 0 : -1;
                const panel = byId(tab.getAttribute('aria-controls'));
                if (panel) { panel.hidden = !selected; panel.tabIndex = 0; }
                if (selected && focus) tab.focus();
            }
        }

        function updateCaptureTime() {
            const video = getVideoElement();
            const ready = !!currentPath() && finiteTime(video?.currentTime) && Number.isFinite(video?.duration) && video.duration > 0 && !byId('add-bookmark-btn')?.disabled;
            const label = `Add note at ${formatTime(Math.floor(video?.currentTime || 0))}`;
            if (byId('add-bookmark-btn')) byId('add-bookmark-btn').textContent = label;
            if (byId('quick-note-btn')) {
                byId('quick-note-btn').textContent = label;
                byId('quick-note-btn').disabled = !ready;
            }
        }

        function render() {
            if (!alive || rendering) return;
            rendering = true;
            try {
                const data = readPractice();
                const focused = document.activeElement;
                const restore = focused?.dataset.workspaceAction && (elements.queue.contains(focused) || elements.segments.contains(focused))
                    ? { action: focused.dataset.workspaceAction, path: focused.dataset.path, id: focused.dataset.segmentId }
                    : focused?.matches('.queue-options > summary') && elements.queue.contains(focused)
                        ? { options: true, path: focused.closest('[data-path]').dataset.path } : null;
                renderOverview(data);
                renderQueue(data);
                const path = currentPath();
                actions.hidden = !path;
                queueToggle.textContent = path && data.queue.includes(path) ? 'Remove from queue' : 'Add to queue';
                queueToggle.setAttribute('aria-pressed', String(!!path && data.queue.includes(path)));
                completeToggle.textContent = path && completed(data, path) ? 'Mark incomplete' : 'Mark complete';
                completeToggle.setAttribute('aria-pressed', String(!!path && completed(data, path)));
                updateCaptureTime();
                renderSegments(data);
                const editor = activePath ? editors.get(activePath) : null;
                if (editor) {
                    if (!editor.dirty) {
                        const saved = reflectionFor(data, activePath);
                        editor.text = editor.baseText = saved.text;
                        editor.baseUpdatedAt = saved.updatedAt;
                        if (elements.reflection.value !== saved.text) elements.reflection.value = saved.text;
                    }
                    setReflectionStatus(editor, data);
                }
                if (restore) {
                    const summary = [...elements.queue.querySelectorAll('.queue-lesson')].find(row => row.dataset.path === restore.path)?.querySelector('.queue-options > summary');
                    const replacement = restore.options ? summary : [...document.querySelectorAll('[data-workspace-action]')].find(element =>
                        element.dataset.workspaceAction === restore.action && element.dataset.path === restore.path
                        && element.dataset.segmentId === restore.id && !element.disabled);
                    const fallback = elements.queue.querySelector('button:not([disabled])');
                    (replacement || summary || fallback)?.focus({ preventScroll: true });
                }
                const serialized = JSON.stringify(data);
                if (serialized !== lastPublishedPractice) {
                    lastPublishedPractice = serialized;
                    onPracticeChange(data);
                }
            } catch (_) {
                status('Practice data could not be read. Existing data has not been replaced. You can download reflection drafts for recovery.', true);
            } finally { rendering = false; }
        }

        function lessonChanged() {
            const previous = activePath ? editors.get(activePath) : null;
            if (previous?.dirty && !previous.persisted) void persistEditor(previous);
            const next = currentPath();
            const changed = next !== activePath;
            activePath = next;
            elements.reflection.disabled = !next;
            elements.saveReflection.disabled = !next;
            if (changed) {
                elements.form.reset();
                elements.segmentStatus.textContent = '';
                if (next) {
                    try {
                        const editor = editorFor(next, readPractice());
                        elements.reflection.value = editor.text;
                        if (editor.dirty) elements.reflection.closest('details').open = true;
                    } catch (_) {
                        // A broken saved record must not disable draft capture. Saves
                        // still validate the real record and therefore cannot replace it.
                        const editor = editorFor(next, store.emptyPracticeData());
                        elements.reflection.value = editor.text;
                    }
                } else elements.reflection.value = '';
            }
            selectTab(activeTab);
            render();
        }

        async function saveReflection() {
            const editor = activePath ? editors.get(activePath) : null;
            if (!editor || !editor.dirty) return;
            const text = editor.text;
            const revision = editor.revision;
            const snapshot = draftSnapshot(editor);
            memoryDrafts.set(editor.id, snapshot);
            const expectedBase = { text: editor.baseText, updatedAt: editor.baseUpdatedAt };
            elements.saveReflection.disabled = true;
            status('Saving reflection…');
            const specs = {
                [PRACTICE_KEY]: { fallback: store.emptyPracticeData(), validate: store.validatePracticeData },
                [DRAFT_KEY]: { fallback: emptyDrafts(), validate: validateDrafts }
            };
            let saved;
            let conflict = false;
            const result = await repository.transact(specs, values => {
                const data = values[PRACTICE_KEY];
                const existing = reflectionFor(data, editor.path);
                if (existing.text !== expectedBase.text || existing.updatedAt !== expectedBase.updatedAt) {
                    conflict = true;
                    throw new Error('The reflection changed since this draft began.');
                }
                saved = { ...existing, text, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) };
                const entries = { ...values[DRAFT_KEY].entries };
                const stored = entries[editor.id];
                if (stored && stored.text === text && stored.updatedAt === snapshot.updatedAt) delete entries[editor.id];
                if (editor.recovered) {
                    const recovery = entries[editor.recovered.id];
                    if (recovery && JSON.stringify(recovery) === JSON.stringify(editor.recovered.value)) delete entries[editor.recovered.id];
                }
                return {
                    [PRACTICE_KEY]: { ...data, reflections: { ...data.reflections, [editor.path]: saved } },
                    [DRAFT_KEY]: { ...values[DRAFT_KEY], entries }
                };
            });
            if (result.ok) {
                editor.baseText = text;
                editor.baseUpdatedAt = saved.updatedAt;
                editor.recovered = null;
                if (editor.revision === revision) {
                    editor.dirty = false;
                    editor.persisted = true;
                    memoryDrafts.delete(editor.id);
                    unsafeDrafts.delete(editor.id);
                } else {
                    editor.updatedAt = Date.now();
                    editor.persisted = false;
                    void persistEditor(editor);
                }
            } else {
                await persistEditor(editor);
            }
            if (!alive) return;
            elements.saveReflection.disabled = !activePath;
            render();
            if (editor.path === activePath && !result.ok) {
                status(conflict ? 'The saved reflection changed in another tab. Your draft is kept. Download it or load the saved version to merge.'
                    : 'Reflection could not be saved. Your draft is kept in this page; download a recovery copy before closing.', true);
                loadSaved.hidden = !conflict;
            }
        }

        function getRecoveryDrafts() {
            const entries = new Map();
            let raw = null;
            try {
                raw = repository.readRaw(DRAFT_KEY);
                for (const [id, draft] of Object.entries(readDrafts().entries)) entries.set(id, draft);
            } catch (_) { /* Include raw stored text in recovery if its schema cannot be read. */ }
            for (const [id, draft] of memoryDrafts) entries.set(id, draft);
            for (const editor of editors.values()) if (editor.dirty) entries.set(editor.id, draftSnapshot(editor));
            return { format: 'dance-library-reflection-drafts', version: 1, exportedAt: new Date().toISOString(),
                drafts: Object.fromEntries(entries), originalStoredDrafts: raw };
        }

        function downloadReflectionDrafts() {
            const payload = getRecoveryDrafts();
            const url = root.URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
            const link = make('a');
            link.href = url;
            link.download = `dance-library-reflection-drafts-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.append(link); link.click(); link.remove();
            root.setTimeout(() => root.URL.revokeObjectURL(url), 10000);
            status('Reflection drafts downloaded as a recovery copy.');
        }

        async function saveSegment(event) {
            event.preventDefault();
            const path = currentPath();
            if (!path) return;
            const title = elements.title.value.trim();
            const start = parseTime(elements.start.value);
            const end = parseTime(elements.end.value);
            const duration = getVideoElement()?.duration;
            if (!title || title.length > 120 || start === null || end === null || end <= start) {
                elements.segmentStatus.textContent = 'Enter a name and valid times such as 0:20 and 1:05. The end must be after the start.';
                return;
            }
            if (Number.isFinite(duration) && duration > 0 && end > duration) {
                elements.segmentStatus.textContent = `The end must be within this ${formatTime(duration)} lesson.`;
                return;
            }
            const speedValue = Number(getSpeed());
            const speed = Number.isFinite(speedValue) && speedValue >= 0.25 && speedValue <= 2 ? speedValue : 1;
            const segment = { id: freshId(), path, title, start, end, speed, createdAt: Date.now() };
            const submitted = [elements.title.value, elements.start.value, elements.end.value];
            const submit = elements.form.querySelector('[type="submit"]');
            submit.disabled = true;
            const result = await mutate(data => ({ ...data, segments: [...data.segments, segment] }));
            if (!alive) return;
            submit.disabled = false;
            if (path === currentPath()) {
                elements.segmentStatus.textContent = result.ok ? 'Practice segment saved.' : 'Segment could not be saved. Your form is unchanged.';
                if (result.ok && submitted.every((value, index) => value === [elements.title.value, elements.start.value, elements.end.value][index])) elements.form.reset();
            }
        }

        async function handleAction(event) {
            const target = event.target.closest('[data-workspace-action]');
            if (!target || target.disabled) return;
            const action = target.dataset.workspaceAction;
            const path = target.dataset.path || currentPath();
            if (action === 'home') { showHome(); return; }
            if (action === 'queue') { if (showQueue) showQueue(); else byId('nav-queue')?.click(); return; }
            if (action === 'open') {
                if (catalog.find(path)) openVideo(path, target.dataset.time ? { seekTime: Number(target.dataset.time) } : {});
                return;
            }
            if (action === 'download-drafts') { downloadReflectionDrafts(); return; }
            if (action === 'load-saved') {
                const previous = editors.get(activePath);
                if (!previous) return;
                await persistEditor(previous);
                if (activePath !== previous.path || !alive) return;
                let saved;
                try { saved = reflectionFor(readPractice(), activePath); }
                catch (_) { status('The saved reflection cannot be read. Your current draft is kept.', true); return; }
                editors.set(activePath, { id: freshId(), path: activePath, text: saved.text, baseText: saved.text,
                    baseUpdatedAt: saved.updatedAt, updatedAt: Date.now(), dirty: false, persisted: true, revision: 0, recovered: null });
                elements.reflection.value = saved.text;
                render();
                status('Saved version loaded. Your previous draft remains available in Download reflection drafts.');
                elements.reflection.focus();
                return;
            }
            target.disabled = true;
            try {
                if (action === 'toggle-queue') await toggleQueue(path);
                else if (action === 'toggle-complete' || action === 'complete') await toggleComplete(path);
                else if (action === 'remove') await mutate(data => ({ ...data, queue: data.queue.filter(item => item !== path) }));
                else if (action === 'up' || action === 'down') await mutate(data => {
                    const queue = [...data.queue];
                    const index = queue.indexOf(path);
                    const other = index + (action === 'up' ? -1 : 1);
                    if (index >= 0 && other >= 0 && other < queue.length) [queue[index], queue[other]] = [queue[other], queue[index]];
                    return { ...data, queue };
                });
                else if (action === 'play-segment') {
                    const segment = readPractice().segments.find(item => item.id === target.dataset.segmentId && item.path === currentPath());
                    if (segment) {
                        const duration = getVideoElement()?.duration;
                        if (Number.isFinite(duration) && duration > 0 && segment.end > duration) showToast('This segment extends beyond the available lesson. Save a new range.');
                        else await setLoop({ ...segment });
                    }
                } else if (action === 'delete-segment') {
                    let removed;
                    const result = await mutate(data => {
                        const index = data.segments.findIndex(segment => segment.id === target.dataset.segmentId);
                        if (index < 0) return data;
                        removed = { segment: data.segments[index], index };
                        return { ...data, segments: data.segments.filter((_, current) => current !== index) };
                    });
                    if (result.ok && removed) { deletedSegments.push(removed); render(); undoSegment.focus(); }
                } else if (action === 'undo-segment') {
                    const removed = deletedSegments.at(-1);
                    if (removed) {
                        const result = await mutate(data => {
                            if (data.segments.some(segment => segment.id === removed.segment.id)) return data;
                            const segments = [...data.segments];
                            segments.splice(Math.min(removed.index, segments.length), 0, removed.segment);
                            return { ...data, segments };
                        });
                        if (result.ok) { deletedSegments.pop(); render(); }
                    }
                }
            } catch (_) { showToast('That action could not be completed. Your saved practice data was kept.'); }
            finally { if (alive && target.isConnected) target.disabled = false; }
        }

        for (const container of [elements.overview, elements.queue, actions, elements.segments, recoveryActions]) on(container, 'click', handleAction);
        on(undoSegment, 'click', handleAction);
        on(byId('queue-browse'), 'click', () => showHome());
        on(byId('quick-note-btn'), 'click', () => {
            selectTab('notes');
            byId('add-bookmark-btn')?.click();
        });
        const video = getVideoElement();
        if (typeof video?.addEventListener === 'function') {
            for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied']) on(video, event, updateCaptureTime);
        }
        on(elements.form, 'submit', saveSegment);
        for (const [id, field, label] of [['segment-start-now', elements.start, 'Start'], ['segment-end-now', elements.end, 'End']]) {
            on(byId(id), 'click', () => {
                const video = getVideoElement();
                if (!currentPath() || !finiteTime(video?.currentTime) || !Number.isFinite(video?.duration) || video.duration <= 0) {
                    elements.segmentStatus.textContent = 'Wait for the video to load before capturing a time.';
                    return;
                }
                // Capture within the recording, including a fractional final
                // frame. Rounding to a tenth can put the end past duration.
                const limit = Math.min(video.currentTime, video.duration);
                let milliseconds = Math.floor(limit * 1000);
                let captured = formatTime(milliseconds / 1000);
                // Multiplication/division near a floating-point boundary can
                // round up; validate the serialized time used by saveSegment.
                if (parseTime(captured) > limit) captured = formatTime(Math.max(0, --milliseconds) / 1000);
                field.value = captured;
                elements.segmentStatus.textContent = `${label} set to ${field.value}. You can edit the time before saving.`;
            });
        }
        on(byId('segment-use-loop'), 'click', () => {
            const loop = getLoop() || {};
            const start = loop.start ?? loop.a ?? loop.loopA;
            const end = loop.end ?? loop.b ?? loop.loopB;
            if (!finiteTime(start) || !finiteTime(end) || end <= start) {
                elements.segmentStatus.textContent = 'Set both A and B in the player first, or enter a range above.';
                return;
            }
            elements.start.value = formatTime(start); elements.end.value = formatTime(end);
            elements.segmentStatus.textContent = 'Current A–B range added. Give it a name to save it.';
            if (!elements.title.value) elements.title.focus();
        });
        on(elements.reflection, 'input', () => {
            const editor = activePath ? editors.get(activePath) : null;
            if (!editor) return;
            editor.text = elements.reflection.value;
            editor.dirty = true;
            editor.persisted = false;
            editor.updatedAt = Date.now();
            editor.revision += 1;
            void persistEditor(editor);
            try { setReflectionStatus(editor, readPractice()); } catch (_) { status('Your draft is kept in this page. Download it for recovery.', true); }
        });
        on(elements.saveReflection, 'click', () => { void saveReflection(); });
        on(elements.reflection, 'keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void saveReflection(); }
        });
        for (const tab of document.querySelectorAll('[data-practice-tab]')) {
            on(tab, 'click', () => selectTab(tab.dataset.practiceTab));
            on(tab, 'keydown', event => {
                const tabs = [...document.querySelectorAll('[data-practice-tab]')];
                const index = tabs.indexOf(tab);
                let next;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                if (next !== undefined) { event.preventDefault(); selectTab(tabs[next].dataset.practiceTab, true); }
            });
        }
        on(root, 'beforeunload', event => {
            if (persistPending || unsafeDrafts.size || [...editors.values()].some(editor => editor.dirty && !editor.persisted)) {
                event.preventDefault(); event.returnValue = '';
            }
        });
        const unsubscribe = repository.subscribe(event => {
            if (!event.keys || event.keys.some(key => [PRACTICE_KEY, DRAFT_KEY, 'videoLastWatched', 'videoPositions'].includes(key))) render();
        });
        lessonChanged();
        return Object.freeze({ render, lessonChanged, readPractice, getRecoveryDrafts,
            destroy() {
                alive = false; abort.abort(); unsubscribe(); actions.remove(); recoveryDisclosure.remove(); undoSegment.remove();
                if (sequence && sequenceParent) sequenceParent.append(sequence);
            } });
    }

    const api = Object.freeze({ create, parseTime, formatTime, validateDrafts, PRACTICE_KEY, DRAFT_KEY });
    root.DanceLibraryWorkspace = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

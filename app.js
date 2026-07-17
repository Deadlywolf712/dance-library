document.addEventListener('DOMContentLoaded', () => {
    const loader = document.getElementById('app-loader');

    function showFatalError(message) {
        console.error(message);
        if (!loader) return;
        loader.classList.add('app-loader-error');
        loader.setAttribute('role', 'alert');
        loader.innerHTML = '';

        const inner = document.createElement('div');
        inner.className = 'app-loader-inner';
        const title = document.createElement('strong');
        title.textContent = 'Dance Library could not start';
        const copy = document.createElement('p');
        copy.className = 'app-loader-copy';
        copy.textContent = message;
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'loader-retry-btn';
        retry.textContent = 'Reload library';
        retry.addEventListener('click', () => location.reload());
        inner.append(title, copy, retry);
        loader.appendChild(inner);
    }

    // Check if videoData exists from data.js
    if (typeof videoData === 'undefined') {
        showFatalError('The lesson catalog did not load. Check your connection, then reload the library.');
        return;
    }
    const playbackCore = globalThis.DanceLibraryPlayback;
    if (!playbackCore) {
        showFatalError('The video playback helpers did not load. Check your connection, then reload the library.');
        return;
    }

    const compactLayoutQuery = window.matchMedia('(max-width: 900px)');
    const usesCompactLayout = () => compactLayoutQuery.matches;
    const checkIsMobile = () => usesCompactLayout() || /Mobi|Android/i.test(navigator.userAgent);
    const isHosted = location.hostname.includes('github.io') || location.protocol === 'https:';
    const canUseLocalMedia = location.protocol === 'file:' || ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    const HLS_RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js';
    const HLS_RUNTIME_INTEGRITY = 'sha384-5E8B0pTlZZJMabWpC0fyYf6OUpe15jJij34BqBAh4NXoHAlLNOjCPRrwtOXOQFAn';
    const HLS_RUNTIME_TIMEOUT_MS = 8000;
    const SUMMARY_ASSET_VERSION = 11;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preferredScrollBehavior = () => reducedMotionQuery.matches ? 'auto' : 'smooth';

    document.documentElement.classList.toggle('hosted-site', isHosted);

    let storageWarningShown = false;
    let storageAccessFailed = false;

    function warnStorage(key, error) {
        storageAccessFailed = true;
        const firstWarning = !storageWarningShown;
        if (!storageWarningShown) {
            storageWarningShown = true;
            console.warn('Browser storage is unavailable:', key, error);
        }
        return firstWarning;
    }

    function safeGet(key, fallback = null) {
        try {
            const value = localStorage.getItem(key);
            return value === null ? fallback : value;
        } catch (error) {
            warnStorage(key, error);
            return fallback;
        }
    }

    function safeRemove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            warnStorage(key, error);
            return false;
        }
    }

    const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
    const isFiniteTime = value => Number.isFinite(Number(value)) && Number(value) >= 0;
    const storageValidators = {
        watchedVideos: value => Array.isArray(value) && value.every(item => typeof item === 'string'),
        favoriteVideos: value => Array.isArray(value) && value.every(item => typeof item === 'string'),
        favoriteThemes: value => Array.isArray(value) && value.every(item => typeof item === 'string'),
        collapsedSections: value => isRecord(value) && Object.values(value).every(item => typeof item === 'boolean'),
        videoPositions: value => isRecord(value) && Object.values(value).every(isFiniteTime),
        videoLastWatched: value => isRecord(value) && Object.values(value).every(isFiniteTime),
        videoBookmarks: value => isRecord(value) && Object.values(value).every(items =>
            Array.isArray(items) && items.every(item =>
                isFiniteTime(item)
                || (isRecord(item)
                    && isFiniteTime(item.t)
                    && (item.n === undefined || (typeof item.n === 'string' && item.n.length <= 2000))
                    && (item.ts === undefined || isFiniteTime(item.ts)))
            )
        )
    };

    // Safe JSON parse with schema validation (never crashes on corrupt or wrong-shaped data).
    function safeLoad(key, fallback, validate = null) {
        const raw = safeGet(key);
        if (raw === null) return fallback;
        try {
            const parsed = JSON.parse(raw);
            const validator = validate || storageValidators[key] || (() => true);
            if (!validator(parsed)) throw new TypeError(`Unexpected data shape for ${key}`);
            return parsed;
        } catch (error) {
            console.warn('Ignoring invalid browser storage:', key, error);
            safeRemove(key);
            return fallback;
        }
    }

    // Safe localStorage write (handles quota exceeded, private mode, disabled storage)
    function safeStore(key, value) {
        try {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            localStorage.setItem(key, serialized);
            return true;
        }
        catch(e) {
            if (warnStorage(key, e)) {
                showToast('Practice progress cannot be saved in this browser session.', 5000, true);
            }
            return false;
        }
    }

    const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    function compareNatural(a, b) {
        return naturalCollator.compare(String(a || ''), String(b || ''));
    }

    function compareVideos(a, b) {
        return compareNatural(a.title, b.title) || compareNatural(a.path, b.path);
    }

    const VIDEO_EXTENSION_RE = /\.(mp4|mov|m4v)$/i;

    function titleFromFilename(filename) {
        return String(filename || '').replace(VIDEO_EXTENSION_RE, '');
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async function copyText(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (_) {
                // Fall through for file:// and browsers without clipboard permission.
            }
        }

        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
        input.remove();
        return copied;
    }

    function makeKeyboardAccessible(element, activate, label) {
        if (!element) return;
        if (element.matches('button, a[href], input, select, textarea')) {
            if (label) element.setAttribute('aria-label', label);
            return;
        }
        element.tabIndex = 0;
        if (!element.hasAttribute('role')) element.setAttribute('role', 'button');
        if (label) element.setAttribute('aria-label', label);
        element.addEventListener('keydown', (event) => {
            if (event.target !== element || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            activate(event);
        });
    }

    // State
    const state = {
        tree: {},
        currentVideo: null,
        watched: new Set(safeLoad('watchedVideos', [], Array.isArray)),
        useBunny: isHosted || checkIsMobile() ? true : (safeGet('useBunny', 'false') === 'true'),
        theme: safeGet('theme', 'arctic'),
        bunnyPullZone: safeGet('bunny_pull_zone', typeof BUNNY_PULL_ZONE !== 'undefined' ? BUNNY_PULL_ZONE : ''),
        loopA: null,
        loopB: null,
        playbackSpeed: 1.0,
        mirrored: false,
        favorites: new Set(safeLoad('favoriteVideos', [], Array.isArray)),
        lastWatched: safeLoad('videoLastWatched', {}, value => value && typeof value === 'object' && !Array.isArray(value))
    };

    // Elements
    const elements = {
        mainContent: document.getElementById('main-content'),
        sidebar: document.getElementById('sidebar'),
        menuToggle: document.getElementById('menu-toggle-btn'),
        closeSidebarBtn: document.getElementById('close-sidebar-btn'),
        openSidebarBtn: document.getElementById('open-sidebar-btn'),
        nav: document.getElementById('library-nav'),
        searchInput: document.getElementById('search-input'),
        homeView: document.getElementById('home-view'),
        videoView: document.getElementById('video-view'),
        courseGrid: document.getElementById('course-grid'),
        videoPlayer: document.getElementById('video-player'),
        videoRetryBtn: document.getElementById('video-retry-btn'),
        
        videoTitle: document.getElementById('video-title'),
        videoSummary: document.getElementById('video-summary'),
        speedDropdownBtns: document.querySelectorAll('#speed-dropdown [data-speed]'),
        currentSpeedBtn: document.getElementById('current-speed-btn'),
        sourceToggle: document.getElementById('source-toggle-cb'),
        collapseAllBtn: document.getElementById('collapse-all-btn'),
        settingsBtn: document.getElementById('open-settings'),
        settingsModal: document.getElementById('settings-modal'),
        closeSettings: document.getElementById('close-settings'),
        saveSettings: document.getElementById('save-settings'),
        themeSelect: document.getElementById('theme-select'),
        bunnyLibInput: document.getElementById('bunny-lib-id'),
        homeBreadcrumb: document.getElementById('home-breadcrumb'),
        videoBreadcrumb: document.getElementById('video-breadcrumb'),
        prevBtn: document.getElementById('prev-video-btn'),
        nextBtn: document.getElementById('next-video-btn'),
        prevOverlayBtn: document.getElementById('prev-video-overlay'),
        nextOverlayBtn: document.getElementById('next-video-overlay'),
        abLoopBtn: document.getElementById('ab-loop-btn'),
        mirrorBtn: document.getElementById('mirror-btn'),
        skipBackBtn: document.getElementById('skip-back-btn'),
        skipFwdBtn: document.getElementById('skip-fwd-btn'),
        addBookmarkBtn: document.getElementById('add-bookmark-btn'),
        bookmarksList: document.getElementById('bookmarks-list'),
        bookmarksBar: document.getElementById('bookmarks-bar'),
        favBtn: document.getElementById('fav-btn'),
        favIcon: document.getElementById('fav-icon'),
        speedPresetBtns: document.querySelectorAll('.speed-preset-btn'),
        playerContainer: document.querySelector('.player-container')
    };

    const missingCoreElements = Object.entries(elements)
        .filter(([, value]) => !value || (value instanceof NodeList && value.length === 0))
        .map(([name]) => name);
    if (missingCoreElements.length) {
        showFatalError(`The interface is incomplete (${missingCoreElements.join(', ')}). Reload the library.`);
        return;
    }

    // Dance style accent colors
    const styleColors = {
        "Salsa": "#e74c3c",
        "Salsa Masterclass": "#c0392b",
        "Bachata": "#3498db",
        "Zouk": "#2ecc71",
        "Kizomba": "#9b59b6",
        "Kizomba Masterclass": "#8e44ad",
        "Other": "#95a5a6"
    };

    // Global HLS instance (declared early to avoid temporal dead zone)
    let hls = null;
    let hlsRuntimePromise = null;

    function ensureHlsRuntime() {
        if (typeof globalThis.Hls !== 'undefined') return Promise.resolve(globalThis.Hls);
        if (hlsRuntimePromise) return hlsRuntimePromise;

        hlsRuntimePromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            let settled = false;
            let timeoutId = null;
            const settle = (callback, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                callback(value);
            };
            script.id = 'hls-runtime';
            script.async = true;
            script.crossOrigin = 'anonymous';
            script.referrerPolicy = 'no-referrer';
            script.integrity = HLS_RUNTIME_INTEGRITY;
            script.src = HLS_RUNTIME_URL;
            script.addEventListener('load', () => {
                if (typeof globalThis.Hls === 'undefined') {
                    settle(reject, new Error('The HLS runtime loaded without exposing Hls.'));
                    return;
                }
                settle(resolve, globalThis.Hls);
            }, { once: true });
            script.addEventListener('error', () => settle(reject, new Error('The HLS runtime could not be loaded.')), { once: true });
            timeoutId = setTimeout(() => {
                settle(reject, new Error('The HLS runtime took too long to load.'));
            }, HLS_RUNTIME_TIMEOUT_MS);
            document.head.appendChild(script);
        }).catch(error => {
            document.getElementById('hls-runtime')?.remove();
            hlsRuntimePromise = null;
            throw error;
        });

        return hlsRuntimePromise;
    }

    // Soft-delete tracking for tile unfavorites (cleared on navigation)
    let tilePendingUnfavs = new Set();
    // Notes manager search state (used in renderNotesView)
    let notesSearchQuery = '';

    function init() {
        document.body.dataset.view = 'home';
        parseDataToTree();
        const knownThemes = new Set([...elements.themeSelect.options].map(option => option.value));
        if (!knownThemes.has(state.theme)) state.theme = 'arctic';
        applyTheme(state.theme);
        renderNavigation();
        renderHomeTiles(); // start at root
        setupEventListeners();
        setupDialogAccessibility();
        window.addEventListener('popstate', restoreRoute);
        queueMicrotask(restoreRoute);
        
        // Init UI state
        elements.sourceToggle.checked = isHosted ? true : state.useBunny;
        elements.sourceToggle.disabled = isHosted;
        elements.themeSelect.value = state.theme;
        updateNotesBadge();

        // Hide loading spinner
        if (loader) { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 300); }
        if (storageAccessFailed) showToast('Practice progress will not persist in this browser session.', 5000, true);
    }

    // Parse Data into Hierarchical Tree
    function parseDataToTree() {
        const styleMap = {
            "Salsa Masterclass": ["salsa masterclass"],
            "Kizomba Masterclass": ["kizomba masterclass"],
            "Salsa": ["adolfo", "fernando", "carolina", "marco"],
            "Bachata": ["alex", "desirée", "korke", "pablo", "kike"],
            "Zouk": ["arthur", "oksana"],
            "Kizomba": ["isabelle"]
        };

        // Initialize top level styles
        Object.keys(styleMap).forEach(s => state.tree[s] = { name: s, subfolders: {}, videos: [] });
        state.tree["Other"] = { name: "Other", subfolders: {}, videos: [] };

        for (const [path, info] of Object.entries(videoData)) {
            const parts = path.split('/');
            const filename = parts.pop();
            const topFolder = parts[0];
            
            let style = "Other";
            let topFolderLower = topFolder.toLowerCase();
            for (const [k, v] of Object.entries(styleMap)) {
                if (v.some(keyword => topFolderLower.includes(keyword))) {
                    style = k;
                    break;
                }
            }
            
            let currentLevel = state.tree[style];
            
            for (const folder of parts) {
                if (!currentLevel.subfolders[folder]) {
                    currentLevel.subfolders[folder] = { name: folder, subfolders: {}, videos: [] };
                }
                currentLevel = currentLevel.subfolders[folder];
            }
            
            const title = titleFromFilename(filename);
            currentLevel.videos.push({
                title,
                path,
                ...info
            });
        }
    }

    function sortFolders(folders, isRoot) {
        if (!isRoot) return folders.sort();
        const order = ["Salsa", "Bachata", "Zouk", "Kizomba", "Salsa Masterclass", "Kizomba Masterclass", "Other"];
        return folders.sort((a, b) => {
            const iA = order.indexOf(a);
            const iB = order.indexOf(b);
            if (iA !== -1 && iB !== -1) return iA - iB;
            if (iA !== -1) return -1;
            if (iB !== -1) return 1;
            return compareNatural(a, b);
        });
    }

    // Helper to recursively count videos in a folder
    function countVideos(node) {
        let count = node.videos.length;
        for (const sub of Object.values(node.subfolders)) {
            count += countVideos(sub);
        }
        return count;
    }

    function countWatchedInFolder(node) {
        let count = 0;
        for (const v of node.videos) {
            if (state.watched.has(v.path)) count++;
        }
        for (const sub of Object.values(node.subfolders)) {
            count += countWatchedInFolder(sub);
        }
        return count;
    }

    function updateHomeStats() {
        const totalVideos = Object.keys(videoData).length;
        const activeStyles = Object.values(state.tree).filter(node => countVideos(node) > 0).length;
        const watched = [...state.watched].filter(path => videoData[path]).length;
        const favorites = [...state.favorites].filter(path => videoData[path]).length;
        const values = { videos: totalVideos, styles: activeStyles, watched, favorites };
        const formatter = new Intl.NumberFormat();

        for (const [name, value] of Object.entries(values)) {
            const target = document.querySelector(`[data-stat="${name}"]`);
            if (target) target.textContent = formatter.format(value);
        }

        const searchLabel = document.getElementById('home-search-label');
        if (searchLabel) searchLabel.textContent = `Search ${formatter.format(totalVideos)} lessons`;
    }

    const dialogFocusRestoreSuppressed = new WeakSet();
    const visibleDialogs = new WeakSet();
    const openDialogStack = [];
    let sidebarReturnFocus = null;

    function hasOpenDialog() {
        return [...document.querySelectorAll('[role="dialog"]')]
            .some(dialog => getComputedStyle(dialog).display !== 'none');
    }

    function sidebarIsOpen() {
        return usesCompactLayout()
            ? elements.sidebar.classList.contains('open')
            : !document.body.classList.contains('sidebar-closed');
    }

    function syncSidebarAccessibility(dialogOpen = hasOpenDialog()) {
        const mobile = usesCompactLayout();
        const closed = mobile
            ? !elements.sidebar.classList.contains('open')
            : document.body.classList.contains('sidebar-closed');
        const mobileOpen = mobile && !closed;
        const mainContent = document.getElementById('main-content');
        const skipLink = document.querySelector('.skip-link');

        elements.sidebar.inert = dialogOpen || closed;
        elements.sidebar.setAttribute('aria-hidden', String(dialogOpen || closed));
        if (mainContent) mainContent.inert = dialogOpen || mobileOpen;
        if (skipLink) skipLink.inert = dialogOpen || mobileOpen;
        const expanded = usesCompactLayout()
            ? elements.sidebar.classList.contains('open')
            : !document.body.classList.contains('sidebar-closed');
        for (const button of [elements.menuToggle, elements.openSidebarBtn]) {
            if (button) button.setAttribute('aria-expanded', String(expanded));
        }
    }

    function setSidebarOpen(open, { restoreFocus = true, focusSearch = false } = {}) {
        const wasOpen = sidebarIsOpen();
        if (open && !wasOpen && document.activeElement instanceof HTMLElement) {
            sidebarReturnFocus = document.activeElement;
        }

        if (usesCompactLayout()) {
            elements.sidebar.classList.toggle('open', open);
            document.body.classList.toggle('sidebar-open', open);
        } else {
            document.body.classList.toggle('sidebar-closed', !open);
        }
        syncSidebarAccessibility();

        if (open && !wasOpen) {
            requestAnimationFrame(() => {
                const first = (focusSearch ? elements.searchInput : elements.closeSidebarBtn)
                    || elements.sidebar.querySelector('button, a[href], input, [tabindex]:not([tabindex="-1"])');
                if (first instanceof HTMLElement) first.focus();
            });
        } else if (!open && wasOpen) {
            const fallback = usesCompactLayout() ? elements.menuToggle : elements.openSidebarBtn;
            const target = sidebarReturnFocus?.isConnected ? sidebarReturnFocus : fallback;
            sidebarReturnFocus = null;
            if (restoreFocus) requestAnimationFrame(() => target?.focus());
        }
    }

    function suppressDialogFocusReturn(dialog) {
        if (dialog && getComputedStyle(dialog).display !== 'none') {
            dialogFocusRestoreSuppressed.add(dialog);
        }
    }

    function topmostOpenDialog() {
        for (let index = openDialogStack.length - 1; index >= 0; index--) {
            const dialog = openDialogStack[index];
            if (dialog.isConnected && getComputedStyle(dialog).display !== 'none') return dialog;
            openDialogStack.splice(index, 1);
        }
        return null;
    }

    function setupDialogAccessibility() {
        const dialogs = [...document.querySelectorAll('[role="dialog"]')];
        const returnFocus = new WeakMap();
        const background = [document.getElementById('main-content')].filter(Boolean);
        const focusableSelector = [
            'a[href]',
            'button:not([disabled])',
            'input:not([disabled]):not([type="hidden"])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(',');

        const isOpen = dialog => getComputedStyle(dialog).display !== 'none';
        const openDialogs = () => dialogs.filter(isOpen);

        function syncDialogs() {
            for (const dialog of dialogs) {
                const open = isOpen(dialog);
                const wasOpen = visibleDialogs.has(dialog);

                if (open && !wasOpen) {
                    visibleDialogs.add(dialog);
                    const previousIndex = openDialogStack.indexOf(dialog);
                    if (previousIndex >= 0) openDialogStack.splice(previousIndex, 1);
                    openDialogStack.push(dialog);
                    const active = document.activeElement;
                    if (active instanceof HTMLElement && !dialog.contains(active)) {
                        const sidebarFallback = usesCompactLayout() ? elements.menuToggle : elements.openSidebarBtn;
                        const target = elements.sidebar.contains(active) && !sidebarIsOpen()
                            ? sidebarFallback
                            : active;
                        if (target) returnFocus.set(dialog, target);
                    }
                    requestAnimationFrame(() => {
                        const initial = dialog.querySelector('[data-dialog-initial-focus]')
                            || dialog.querySelector(focusableSelector)
                            || dialog.querySelector('[tabindex="-1"]');
                        if (initial instanceof HTMLElement) initial.focus();
                    });
                }

                if (!open && wasOpen) {
                    visibleDialogs.delete(dialog);
                    const stackIndex = openDialogStack.indexOf(dialog);
                    if (stackIndex >= 0) openDialogStack.splice(stackIndex, 1);
                    if (dialogFocusRestoreSuppressed.has(dialog)) {
                        dialogFocusRestoreSuppressed.delete(dialog);
                    } else {
                        const previous = returnFocus.get(dialog);
                        if (previous instanceof HTMLElement && previous.isConnected) {
                            requestAnimationFrame(() => previous.focus());
                        }
                    }
                }
            }

            const topDialog = topmostOpenDialog();
            for (const dialog of dialogs) {
                const open = isOpen(dialog);
                const topmost = open && dialog === topDialog;
                dialog.inert = open && !topmost;
                dialog.setAttribute('aria-hidden', String(!topmost));
            }

            const hasOpenDialog = openDialogs().length > 0;
            for (const element of background) element.inert = hasOpenDialog;
            syncSidebarAccessibility(hasOpenDialog);
        }

        const observer = new MutationObserver(syncDialogs);
        for (const dialog of dialogs) observer.observe(dialog, { attributes: true, attributeFilter: ['style', 'class'] });
        syncDialogs();

        document.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const dialog = topmostOpenDialog();
            if (!dialog) return;

            const focusables = [...dialog.querySelectorAll(focusableSelector)]
                .filter(element => element instanceof HTMLElement && element.offsetParent !== null);
            if (focusables.length === 0) {
                event.preventDefault();
                const container = dialog.querySelector('[tabindex="-1"]');
                if (container instanceof HTMLElement) container.focus();
                return;
            }

            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
    }

    function setVideoRoute(videoPath, replace = false) {
        try {
            const url = new URL(location.href);
            url.hash = `video=${encodeURIComponent(videoPath)}`;
            const method = replace ? 'replaceState' : 'pushState';
            if (url.href !== location.href) history[method]({ video: videoPath }, '', url);
        } catch (error) {
            console.warn('Could not update the lesson URL:', error);
        }
    }

    function setHomeRoute(replace = false) {
        try {
            const url = new URL(location.href);
            url.hash = '';
            const method = replace ? 'replaceState' : 'pushState';
            if (url.href !== location.href) history[method]({ view: 'home' }, '', url);
        } catch (error) {
            console.warn('Could not update the library URL:', error);
        }
    }

    function focusHomeHeading() {
        requestAnimationFrame(() => document.getElementById('home-title')?.focus({ preventScroll: true }));
    }

    function scrollMainToTop() {
        elements.mainContent.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
    }

    function showLibraryHome(updateHistory = true) {
        pauseVideoPlayback({ destroyStream: true });
        document.body.dataset.view = 'home';
        elements.videoView.style.display = 'none';
        closeNotesView({ restoreFocus: false });
        elements.homeView.style.display = 'block';
        clearActiveVideoLinks();
        state.currentVideo = null;
        renderHomeTiles(null, []);
        scrollMainToTop();
        if (updateHistory) setHomeRoute();
        focusHomeHeading();
    }

    function restoreRoute() {
        const params = new URLSearchParams(location.hash.replace(/^#/, ''));
        const videoPath = params.get('video');
        if (!videoPath) {
            if (state.currentVideo) showLibraryHome(false);
            return;
        }

        const videoObj = resolveVideoObj(videoPath);
        if (videoObj) {
            if (!state.currentVideo || state.currentVideo.path !== videoPath) loadVideo(videoObj, { updateHistory: false });
        } else {
            showToast('That shared lesson is no longer in this library.', 5000, true);
            setHomeRoute(true);
        }
    }

    // Render Sidebar Navigation
    let navItemId = 0;
    function renderNavigation() {
        navItemId = 0;
        elements.nav.innerHTML = '';
        // Render root level as standard folders instead of unclickable headers
        renderFolderLevel(state.tree, elements.nav, 0);
    }

    function hydrateNavigationTree(container = elements.nav) {
        for (const child of [...container.children]) {
            if (!child.classList.contains('nav-group')) continue;
            const content = [...child.children].find(element => element.classList.contains('nav-content'));
            if (!content) continue;
            content._hydrate?.();
            hydrateNavigationTree(content);
        }
    }

    function revealNavigationPath(folderPath) {
        let container = elements.nav;
        let lastGroup = null;
        for (const folderName of folderPath) {
            const group = [...container.children].find(element =>
                element.classList.contains('nav-group') && element.dataset.folderName === folderName
            );
            if (!group) break;
            const header = [...group.children].find(element => element.classList.contains('nav-header'));
            const content = [...group.children].find(element => element.classList.contains('nav-content'));
            content?._hydrate?.();
            content?.classList.add('open');
            header?.classList.add('active');
            header?.querySelector('.nav-folder-toggle')?.setAttribute('aria-expanded', 'true');
            container = content || container;
            lastGroup = group;
        }
        return lastGroup;
    }

    function clearActiveVideoLinks() {
        document.querySelectorAll('.video-link').forEach(link => {
            link.classList.remove('active');
            link.querySelector('.video-link-main')?.removeAttribute('aria-current');
        });
    }

    function renderFolderLevel(foldersObj, containerElement, depth, currentPath = []) {
        // Sort folders alphabetically (custom order for root)
        const folderNames = sortFolders(Object.keys(foldersObj), depth === 0);
        
        for (const folderName of folderNames) {
            const node = foldersObj[folderName];
            
            if (countVideos(node) === 0) continue; // Skip empty folders entirely
            
            const groupDiv = document.createElement('div');
            groupDiv.className = 'nav-group';
            groupDiv.dataset.folderName = folderName;

            const headerBtn = document.createElement('div');
            headerBtn.className = 'nav-header';
            headerBtn.style.setProperty('--depth', depth); headerBtn.style.paddingLeft = `calc(16px + (var(--depth) * 12px))`;
            
            if (depth === 0) {
                headerBtn.style.fontWeight = 'bold';
                headerBtn.style.color = 'var(--accent)';
            }
            
            const iconSvg = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; min-width: 16px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
            const gridIconSvg = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`;
            
            headerBtn.style.cursor = 'pointer';
            headerBtn.title = "Expand/Collapse Folder";
            headerBtn.innerHTML = `
                <button type="button" class="nav-folder-toggle">
                    ${iconSvg}
                    <span style="word-break: break-word; line-height: 1.3; font-size: 0.95em; padding-right: 8px;">${folderName}</span>
                    <svg class="chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
                </button>
                <button type="button" class="open-tiles-btn" title="Open in tile view" aria-label="Open ${folderName} in tile view">
                    ${gridIconSvg}
                </button>
            `;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'nav-content';
            contentDiv.style.setProperty('--depth', depth);
            contentDiv.id = `nav-content-${++navItemId}`;
            const folderToggle = headerBtn.querySelector('.nav-folder-toggle');
            folderToggle.setAttribute('aria-controls', contentDiv.id);
            folderToggle.setAttribute('aria-expanded', 'false');
            folderToggle.setAttribute('aria-label', `Expand or collapse ${folderName}`);
            
            const fullPath = [...currentPath, folderName];
            
            const hydrateContent = () => {
                if (contentDiv.dataset.rendered === 'true') return;

                // Build only the branch the user opens; the other 795 lessons stay out of the startup DOM.
                if (Object.keys(node.subfolders).length > 0) {
                    renderFolderLevel(node.subfolders, contentDiv, depth + 1, fullPath);
                }

                if (node.videos.length > 0) {
                node.videos.sort(compareVideos);
                node.videos.forEach(video => {
                    const link = document.createElement('div');
                    link.className = `video-link ${state.watched.has(video.path) ? 'watched' : ''}`;
                    link.style.setProperty('--depth', depth); link.style.paddingLeft = `calc(32px + (var(--depth) * 10px))`;

                    const mainButton = document.createElement('button');
                    mainButton.type = 'button';
                    mainButton.className = 'video-link-main';
                    mainButton.setAttribute('aria-label', `Play ${video.title}`);

                    const titleSpan = document.createElement('span');
                    titleSpan.className = 'video-link-title';
                    titleSpan.textContent = video.title;

                    const starBtn = document.createElement('button');
                    starBtn.type = 'button';
                    starBtn.className = 'sidebar-fav-star';
                    starBtn.title = state.favorites.has(video.path) ? 'Unfavorite' : 'Favorite';
                    starBtn.setAttribute('aria-label', starBtn.title + ' ' + video.title);
                    starBtn.setAttribute('aria-pressed', String(state.favorites.has(video.path)));
                    starBtn.innerHTML = state.favorites.has(video.path) ? '&#9733;' : '&#9734;';
                    if (state.favorites.has(video.path)) starBtn.classList.add('active');
                    starBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (state.favorites.has(video.path)) {
                            state.favorites.delete(video.path);
                            starBtn.innerHTML = '&#9734;';
                            starBtn.classList.remove('active');
                            starBtn.title = 'Favorite';
                            starBtn.setAttribute('aria-pressed', 'false');
                        } else {
                            state.favorites.add(video.path);
                            starBtn.innerHTML = '&#9733;';
                            starBtn.classList.add('active');
                            starBtn.title = 'Unfavorite';
                            starBtn.setAttribute('aria-pressed', 'true');
                        }
                        starBtn.setAttribute('aria-label', starBtn.title + ' ' + video.title);
                        safeStore('favoriteVideos', JSON.stringify([...state.favorites]));
                        updateNotesBadge();
                        // Update fav button if this is the current video
                        if (state.currentVideo && state.currentVideo.path === video.path) updateFavBtn();
                    });

                    mainButton.appendChild(titleSpan);
                    link.appendChild(mainButton);
                    link.appendChild(starBtn);
                    link.dataset.path = video.path;
                    if (state.currentVideo?.path === video.path) {
                        link.classList.add('active');
                        mainButton.setAttribute('aria-current', 'page');
                    }
                    mainButton.addEventListener('click', () => loadVideo(video));
                    contentDiv.appendChild(link);
                });
                }

                contentDiv.dataset.rendered = 'true';
            };
            contentDiv._hydrate = hydrateContent;

            // Expand/Collapse entire row
            folderToggle.addEventListener('click', () => {
                const isOpen = contentDiv.classList.contains('open');
                if (!isOpen) {
                    hydrateContent();
                    contentDiv.classList.add('open');
                    headerBtn.classList.add('active');
                    folderToggle.setAttribute('aria-expanded', 'true');
                } else {
                    contentDiv.classList.remove('open');
                    headerBtn.classList.remove('active');
                    folderToggle.setAttribute('aria-expanded', 'false');
                }
            });

            // Separate Click Listener for the dedicated Tile View button
            const tileBtn = headerBtn.querySelector('.open-tiles-btn');
            tileBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Don't toggle the accordion
                
                // Stop video and invalidate any delayed stream callbacks.
                pauseVideoPlayback({ destroyStream: true });
                
                // Switch View
                document.body.dataset.view = 'home';
                elements.videoView.style.display = 'none';
                closeNotesView({ restoreFocus: false });
                elements.homeView.style.display = 'block';
                clearActiveVideoLinks();
                state.currentVideo = null;
                
                // Render Tiles for this specific folder!
                renderHomeTiles(node, fullPath);
                setHomeRoute();
                focusHomeHeading();
                scrollMainToTop();
                
                // Intentionally NOT auto-expanding accordion as per user preference
                
                // On mobile, close sidebar after jumping
                if (usesCompactLayout()) {
                    setSidebarOpen(false, { restoreFocus: false });
                }
            });

            groupDiv.appendChild(headerBtn);
            groupDiv.appendChild(contentDiv);
            containerElement.appendChild(groupDiv);
        }
    }

    // Human-readable time ago
    function timeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + 'm ago';
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ago';
        const days = Math.floor(hours / 24);
        if (days === 1) return 'Yesterday';
        if (days < 7) return days + 'd ago';
        const weeks = Math.floor(days / 7);
        if (weeks < 5) return weeks + 'w ago';
        const months = Math.floor(days / 30);
        return months + 'mo ago';
    }

    // Update notes badge count
    function updateNotesBadge() {
        const allBookmarks = safeLoad('videoBookmarks', {});
        let total = 0;
        for (const arr of Object.values(allBookmarks)) {
            if (Array.isArray(arr)) total += arr.length;
        }

        const lastSeen = parseInt(safeGet('notesBadgeSeen', '0'), 10);
        const unseen = Math.max(0, total - lastSeen);

        const targets = [
            document.getElementById('notes-sidebar-btn'),
            document.getElementById('home-notes-btn'),
            document.getElementById('mobile-notes-btn')
        ];
        for (const btn of targets) {
            if (!btn) continue;
            let badge = btn.querySelector('.notes-badge');
            if (unseen > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'notes-badge';
                    btn.style.position = 'relative';
                    btn.appendChild(badge);
                }
                badge.textContent = unseen > 99 ? '99+' : unseen;
            } else if (badge) {
                badge.remove();
            }
        }
        updateHomeStats();
    }

    function markNotesSeen() {
        const allBookmarks = safeLoad('videoBookmarks', {});
        let total = 0;
        for (const arr of Object.values(allBookmarks)) {
            if (Array.isArray(arr)) total += arr.length;
        }
        safeStore('notesBadgeSeen', total.toString());
        updateNotesBadge();
    }


    // Render Home Tiles as a File Explorer
    function renderHomeTiles(folderNode = null, path = []) {
        updateHomeStats();
        // If null, we are at the root
        if (!folderNode) {
            folderNode = { subfolders: state.tree, videos: [] };
            path = [];
        }

        elements.courseGrid.innerHTML = '';

        // Render Breadcrumbs for Home View
        const homeHeader = document.getElementById('home-breadcrumbs');
        homeHeader.hidden = path.length === 0;
        let breadcrumbHtml = `<a href="#" class="home-crumb" data-level="-1" style="color:var(--accent); text-decoration:none;">Library Home</a>`;
        
        path.forEach((p, idx) => {
            if (idx === path.length - 1) {
                breadcrumbHtml += ` <span style="margin: 0 6px; color: var(--text-muted);">/</span> <span style="color:var(--text-main)">${p}</span>`;
            } else {
                breadcrumbHtml += ` <span style="margin: 0 6px; color: var(--text-muted);">/</span> <a href="#" class="home-crumb" data-level="${idx}" style="color:var(--accent); text-decoration:none;">${p}</a>`;
            }
        });
        homeHeader.innerHTML = breadcrumbHtml;
        
        // Attach crumb events
        homeHeader.querySelectorAll('.home-crumb').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const level = parseInt(e.target.dataset.level);
                if (level === -1) {
                    renderHomeTiles(null, []);
                } else if (level === 0) {
                    // Clicked the root style
                    renderHomeTiles(state.tree[path[0]], [path[0]]);
                } else {
                    // Start at the style
                    let targetNode = state.tree[path[0]];
                    // Traverse down
                    for(let i=1; i<=level; i++) {
                        if(targetNode && targetNode.subfolders[path[i]]) {
                            targetNode = targetNode.subfolders[path[i]];
                        }
                    }
                    renderHomeTiles(targetNode, path.slice(0, level + 1));
                }
                scrollMainToTop();
                focusHomeHeading();
            });
        });

        // ── Salsa Masterclass Course Content ──
        if (typeof salsaCourseData !== 'undefined' && path.length > 0 && path[0] === 'Salsa Masterclass') {
            // Build the folder path key (skip the first "Salsa Masterclass" style prefix, use rest)
            const folderKey = path.slice(1).join('/');

            // Week overview: show week cards with descriptions when viewing the week list
            if (path.length === 2 && salsaCourseData.weeks) {
                const courseHeader = document.createElement('div');
                courseHeader.className = 'course-intro-block';
                courseHeader.innerHTML = `
                    <div class="course-intro-title">${salsaCourseData.title}</div>
                    <div class="course-intro-subtitle">${salsaCourseData.subtitle}</div>
                    <p class="course-intro-text">${salsaCourseData.intro}</p>
                `;
                elements.courseGrid.appendChild(courseHeader);
            }

            // Folder-level description
            if (folderKey && salsaCourseData.folders[folderKey]) {
                const info = salsaCourseData.folders[folderKey];
                let descHtml = `<p class="course-desc-text">${info.description}</p>`;
                if (info.prerequisites) {
                    descHtml += '<div class="course-prereqs">';
                    if (info.prerequisites.on1) {
                        descHtml += '<div class="course-prereq-col"><strong>Prerequisites On1:</strong><ul>' + info.prerequisites.on1.map(p => `<li>${p}</li>`).join('') + '</ul></div>';
                    }
                    if (info.prerequisites.on2) {
                        descHtml += '<div class="course-prereq-col"><strong>Prerequisites On2:</strong><ul>' + info.prerequisites.on2.map(p => `<li>${p}</li>`).join('') + '</ul></div>';
                    }
                    descHtml += '</div>';
                }
                if (info.tips) descHtml += `<p class="course-tips"><strong>Tips:</strong> ${info.tips}</p>`;
                if (info.song) descHtml += `<p class="course-song">&#9835; ${info.song}</p>`;

                const descBlock = document.createElement('div');
                descBlock.className = 'course-desc-block';
                descBlock.innerHTML = descHtml;
                elements.courseGrid.appendChild(descBlock);
            }
        }

        // Helper: create a collapsible section header with arrow toggle
        function createCollapsibleSection(id, icon, label) {
            const collapsed = safeLoad('collapsedSections', {})[id] || false;
            const wrapper = document.createElement('div');
            wrapper.className = 'home-section-wrapper' + (collapsed ? ' collapsed' : '');
            wrapper.dataset.sectionId = id;

            const header = document.createElement('button');
            header.type = 'button';
            header.className = 'favorites-section-header collapsible-header';
            header.setAttribute('aria-expanded', String(!collapsed));
            header.innerHTML = `<span>${icon} ${label}</span><span class="section-toggle-arrow">${collapsed ? '&#9654;' : '&#9660;'}</span>`;
            header.addEventListener('click', () => {
                const isCollapsed = wrapper.classList.toggle('collapsed');
                header.setAttribute('aria-expanded', String(!isCollapsed));
                header.querySelector('.section-toggle-arrow').innerHTML = isCollapsed ? '&#9654;' : '&#9660;';
                const saved = safeLoad('collapsedSections', {});
                saved[id] = isCollapsed;
                safeStore('collapsedSections', JSON.stringify(saved));
            });

            const content = document.createElement('div');
            content.className = 'home-section-content';
            content.id = `home-section-${id}`;
            header.setAttribute('aria-controls', content.id);
            content.style.display = collapsed ? 'none' : 'contents';

            header.addEventListener('click', () => {
                content.style.display = wrapper.classList.contains('collapsed') ? 'none' : 'contents';
            });

            wrapper.appendChild(header);
            return { wrapper, content };
        }

        // Render favorites section at root level (include soft-deleted for undo)
        const allTileFavs = new Set([...state.favorites, ...tilePendingUnfavs]);
        if (path.length === 0 && allTileFavs.size > 0) {
            const { wrapper: favWrapper, content: favContent } = createCollapsibleSection('favorites', '&#9733;', 'Favorites');
            elements.courseGrid.appendChild(favWrapper);

            let favIndex = 0;
            for (const favPath of allTileFavs) {
                const info = videoData[favPath];
                if (!info) continue;
                favIndex++;
                const parts = favPath.split('/');
                const filename = parts.pop();
                const title = titleFromFilename(filename);
                const videoObj = { title, path: favPath, ...info };
                const isRemoved = tilePendingUnfavs.has(favPath);

                const tile = document.createElement('div');
                tile.className = 'course-tile fav-tile' + (isRemoved ? ' tile-unfavorited' : '');
                tile.style.animationDelay = `${Math.min(favIndex, 6) * 0.035}s`;
                tile.style.backgroundColor = 'var(--bg-base)';
                // Determine dance style for color border
                const favTopFolder = favPath.split('/')[0];
                let favStyle = 'Other';
                for (const [s, node] of Object.entries(state.tree)) {
                    if (node.subfolders[favTopFolder]) { favStyle = s; break; }
                }
                tile.style.borderLeft = `3px solid ${styleColors[favStyle] || styleColors['Other']}`;
                tile.innerHTML = `
                    <div class="tile-action-row">
                        <button type="button" class="tile-main-btn" aria-label="Play ${title}" ${isRemoved ? 'disabled' : ''}>
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--accent)" stroke-width="2" fill="${isRemoved ? 'none' : 'var(--accent)'}" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                            <span class="video-tile-title">${title}</span>
                        </button>
                        <button type="button" class="tile-fav-toggle" data-path="${favPath}" title="${isRemoved ? 'Re-favorite' : 'Unfavorite'}">${isRemoved ? 'Re-favorite' : 'Unfavorite'}</button>
                    </div>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: auto; opacity: 0.7;">${parts.join(' / ')}</p>
                `;
                tile.querySelector('.tile-main-btn').addEventListener('click', () => loadVideo(videoObj));
                // Toggle button
                tile.querySelector('.tile-fav-toggle').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (tilePendingUnfavs.has(favPath)) {
                        tilePendingUnfavs.delete(favPath);
                        state.favorites.add(favPath);
                    } else {
                        tilePendingUnfavs.add(favPath);
                        state.favorites.delete(favPath);
                    }
                    safeStore('favoriteVideos', JSON.stringify([...state.favorites]));
                    updateNotesBadge();
                    renderHomeTiles(folderNode, path);
                });
                favContent.appendChild(tile);
            }
            favWrapper.appendChild(favContent);

            const divider = document.createElement('div');
            divider.className = 'favorites-divider';
            elements.courseGrid.appendChild(divider);
        }

        // Continue Watching section at root level
        let tileIndex = 0;
        if (path.length === 0) {
            const positions = safeLoad('videoPositions', {});
            const resumeEntries = Object.entries(positions)
                .filter(([p]) => videoData[p])
                .map(([p, time]) => ({ path: p, time, lastWatched: state.lastWatched[p] || 0 }))
                .sort((a, b) => b.lastWatched - a.lastWatched)
                .slice(0, 8);

            if (resumeEntries.length > 0) {
                const { wrapper: cwWrapper, content: cwContent } = createCollapsibleSection('continue-watching', '&#9654;', 'Continue Watching');
                elements.courseGrid.appendChild(cwWrapper);

                for (const entry of resumeEntries) {
                    const info = videoData[entry.path];
                    const parts = entry.path.split('/');
                    const filename = parts.pop();
            const title = titleFromFilename(filename);
                    const videoObj = { title, path: entry.path, ...info };

                    const tile = document.createElement('div');
                    tile.className = 'course-tile resume-tile';
                    tile.style.animationDelay = `${Math.min(tileIndex, 6) * 0.035}s`;
                    tile.style.backgroundColor = 'var(--bg-base)';

                    const agoText = entry.lastWatched ? timeAgo(entry.lastWatched) : '';

                    tile.innerHTML = `
                        <div style="display: flex; align-items: flex-start; margin-bottom: 2px;">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--accent)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:10px; min-width:20px; margin-top: 2px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <h3 class="video-tile-title" style="margin-bottom: 0; color: var(--text-main); font-weight: normal; line-height: 1.4;">${title}</h3>
                        </div>
                        <p style="font-size: 0.75rem; color: var(--text-muted); margin: 4px 0 0 0;">at ${formatTime(entry.time)}${agoText ? ' · ' + agoText : ''}</p>
                        <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px; opacity: 0.7;">${parts.join(' / ')}</p>
                    `;
                    tile.addEventListener('click', () => loadVideo(videoObj));
                    makeKeyboardAccessible(tile, () => loadVideo(videoObj), `Resume ${title} from ${formatTime(entry.time)}`);
                    cwContent.appendChild(tile);
                    tileIndex++;
                }
                cwWrapper.appendChild(cwContent);

                const divider = document.createElement('div');
                divider.className = 'favorites-divider';
                elements.courseGrid.appendChild(divider);
            }
        }

        // Recent Notes section at root level — grouped by video, showing actual note text
        if (path.length === 0) {
            const allBookmarks = safeLoad('videoBookmarks', {});
            const notedVideos = [];
            for (const [vPath, arr] of Object.entries(allBookmarks)) {
                if (!Array.isArray(arr) || arr.length === 0 || !videoData[vPath]) continue;
                const bks = typeof arr[0] === 'object' ? arr : arr.map(t => ({ t, n: '' }));
                const withNotes = bks.filter(b => b.n);
                if (withNotes.length > 0) {
                    const parts = vPath.split('/');
                    const filename = parts.pop();
            const title = titleFromFilename(filename);
                    notedVideos.push({ path: vPath, title, folder: parts.join(' / '), notes: withNotes });
                }
            }
            if (notedVideos.length > 0) {
                notedVideos.sort((a, b) => b.notes.length - a.notes.length);
                const { wrapper: notesWrapper, content: notesContent } = createCollapsibleSection('recent-notes', '&#128221;', 'Recent Notes');
                elements.courseGrid.appendChild(notesWrapper);

                for (const nv of notedVideos.slice(0, 6)) {
                    const info = videoData[nv.path];
                    const videoObj = { title: nv.title, path: nv.path, ...info };

                    const card = document.createElement('div');
                    card.className = 'course-tile recent-notes-card';
                    card.style.animationDelay = `${Math.min(tileIndex, 6) * 0.035}s`;
                    card.style.backgroundColor = 'var(--bg-base)';

                    // Video title header (clickable → load video)
                    let notesHtml = `<div class="recent-notes-video-title" data-path="${nv.path}" role="button" tabindex="0">${nv.title}</div>`;
                    notesHtml += `<div style="font-size: 0.7rem; color: var(--text-muted); opacity: 0.6; margin-bottom: 8px;">${nv.folder}</div>`;

                    // Individual notes (clickable → seek to timestamp)
                    for (const note of nv.notes) {
                        const escapedNote = (note.n || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        notesHtml += `<div class="recent-note-entry" data-path="${nv.path}" data-time="${note.t}" role="button" tabindex="0">
                            <span style="color: var(--accent); font-size: 0.7rem; flex-shrink: 0;">${formatTime(note.t)}</span>
                            <span style="font-size: 0.8rem; color: var(--text-main);">"${escapedNote}"</span>
                        </div>`;
                    }

                    card.innerHTML = notesHtml;

                    // Click delegation
                    card.addEventListener('click', (e) => {
                        const noteEntry = e.target.closest('.recent-note-entry');
                        if (noteEntry) {
                            const seekTime = parseFloat(noteEntry.dataset.time);
                            loadVideo(videoObj, { seekTime });
                            return;
                        }
                        const titleEl = e.target.closest('.recent-notes-video-title');
                        if (titleEl) {
                            loadVideo(videoObj);
                            return;
                        }
                    });
                    card.addEventListener('keydown', event => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        const target = event.target.closest('.recent-note-entry, .recent-notes-video-title');
                        if (!target || !card.contains(target)) return;
                        event.preventDefault();
                        target.click();
                    });

                    notesContent.appendChild(card);
                    tileIndex++;
                }
                notesWrapper.appendChild(notesContent);

                const divider = document.createElement('div');
                divider.className = 'favorites-divider';
                elements.courseGrid.appendChild(divider);
            }
        }

        // Render folders as tiles
        const subfolders = sortFolders(Object.keys(folderNode.subfolders), path.length === 0);
        for (const fName of subfolders) {
            const node = folderNode.subfolders[fName];
            tileIndex++;
            const numVideos = countVideos(node);
            if (numVideos === 0) continue;

            const tile = document.createElement('div');
            tile.className = 'course-tile folder-tile';
            tile.style.animationDelay = `${Math.min(tileIndex, 6) * 0.035}s`;
            // Style color: at root the folder IS the style, inside a style path[0] is the style
            const tileStyle = path.length === 0 ? fName : path[0];
            const tileColor = styleColors[tileStyle] || styleColors["Other"];
            tile.style.borderLeft = `3px solid ${tileColor}`;
            const watchedCount = countWatchedInFolder(node);
            const pct = numVideos > 0 ? Math.round(watchedCount / numVideos * 100) : 0;
            // Check for Salsa Masterclass week/move descriptions
            let tileSubtitle = '';
            if (typeof salsaCourseData !== 'undefined' && path.length > 0 && path[0] === 'Salsa Masterclass') {
                const weekInfo = salsaCourseData.weeks && salsaCourseData.weeks[fName];
                if (weekInfo) {
                    tileSubtitle = `<p class="tile-course-subtitle">${weekInfo.title}: ${weekInfo.description}</p>`;
                } else {
                    const folderKey = [...path.slice(1), fName].join('/');
                    const folderInfo = salsaCourseData.folders[folderKey];
                    if (folderInfo && folderInfo.description) {
                        const short = folderInfo.description.length > 100 ? folderInfo.description.substring(0, 100) + '...' : folderInfo.description;
                        tileSubtitle = `<p class="tile-course-subtitle">${short}</p>`;
                    }
                }
            }
            tile.innerHTML = `
                <div style="display: flex; align-items: flex-start; margin-bottom: 2px;">
                    <svg viewBox="0 0 24 24" width="28" height="28" stroke="${tileColor}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:12px; min-width:28px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    <h3 style="margin-bottom: 0; color: var(--text-main); word-break: break-word; margin-top: 3px;">${fName}</h3>
                </div>
                ${tileSubtitle}
                <div class="tile-progress-area">
                    <p class="tile-count" style="color: var(--text-muted);">${watchedCount}/${numVideos} watched</p>
                    <div class="tile-progress-track"><div class="tile-progress-fill" style="width: ${pct}%"></div></div>
                </div>
            `;
            tile.addEventListener('click', () => {
                renderHomeTiles(node, [...path, fName]);
                scrollMainToTop();
                focusHomeHeading();
                
                const group = revealNavigationPath([...path, fName]);
                group?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' });
            });
            makeKeyboardAccessible(tile, () => tile.click(), `Open ${fName}, ${numVideos} lessons`);
            elements.courseGrid.appendChild(tile);
        }
        
        // Render videos as tiles (if any in this exact folder)
        if (folderNode.videos) {
            const videos = [...folderNode.videos].sort(compareVideos);
            for (const video of videos) {
                tileIndex++;
                const tile = document.createElement('div');
                tile.className = 'course-tile lesson-tile';
            tile.style.animationDelay = `${Math.min(tileIndex, 6) * 0.035}s`;
                tile.style.backgroundColor = 'var(--bg-base)';
                const vidStyle = path[0] || 'Other';
                const vidColor = styleColors[vidStyle] || styleColors["Other"];
                tile.style.borderLeft = `3px solid ${vidColor}`;
                if(state.watched.has(video.path)) {
                    tile.classList.add('watched-tile');
                }
                const isFav = state.favorites.has(video.path);
                const watchedAt = state.lastWatched[video.path];
                const watchedAgo = watchedAt ? timeAgo(watchedAt) : '';
                tile.innerHTML = `
                    <div class="tile-action-row">
                        <button type="button" class="tile-main-btn" aria-label="Play ${video.title}">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--text-muted)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <span class="video-tile-title">${video.title}</span>
                        </button>
                        <button type="button" class="tile-star-btn${isFav ? ' tile-star-active' : ''}" data-path="${video.path}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${isFav ? 'Remove from favorites' : 'Add to favorites'}: ${video.title}" aria-pressed="${isFav}">
                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="${isFav ? 'currentColor' : 'none'}" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                        </button>
                    </div>
                    ${watchedAgo ? '<p class="tile-watched-ago">' + watchedAgo + '</p>' : ''}
                `;
                tile.querySelector('.tile-main-btn').addEventListener('click', () => loadVideo(video));
                tile.querySelector('.tile-star-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (state.favorites.has(video.path)) {
                        state.favorites.delete(video.path);
                    } else {
                        state.favorites.add(video.path);
                    }
                    safeStore('favoriteVideos', JSON.stringify([...state.favorites]));
                    updateNotesBadge();
                    renderHomeTiles(folderNode, path);
                });
                elements.courseGrid.appendChild(tile);
            }
        }
    }

    const summaryChunkPromises = new Map();

    function getSummaryRegistry() {
        if (!isRecord(globalThis.DanceLibrarySummaries)) globalThis.DanceLibrarySummaries = {};
        return globalThis.DanceLibrarySummaries;
    }

    function ensureSummaryChunk(chunkId) {
        if (!/^[a-z0-9-]+$/.test(chunkId || '')) {
            return Promise.reject(new Error('Invalid summary chunk identifier.'));
        }

        const registry = getSummaryRegistry();
        if (isRecord(registry[chunkId])) return Promise.resolve(registry[chunkId]);
        if (summaryChunkPromises.has(chunkId)) return summaryChunkPromises.get(chunkId);

        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.async = true;
            const chunkUrl = new URL(`summaries/${chunkId}.js`, document.baseURI);
            chunkUrl.searchParams.set('v', String(SUMMARY_ASSET_VERSION));
            script.src = chunkUrl.href;
            script.dataset.summaryChunk = chunkId;
            script.addEventListener('load', () => {
                script.remove();
                const chunk = getSummaryRegistry()[chunkId];
                if (!isRecord(chunk)) {
                    reject(new Error(`Summary chunk ${chunkId} did not register its lessons.`));
                    return;
                }
                resolve(chunk);
            }, { once: true });
            script.addEventListener('error', () => {
                script.remove();
                reject(new Error(`Summary chunk ${chunkId} could not be loaded.`));
            }, { once: true });
            document.head.appendChild(script);
        }).catch(error => {
            summaryChunkPromises.delete(chunkId);
            throw error;
        });

        summaryChunkPromises.set(chunkId, promise);
        return promise;
    }

    async function ensureSummaryForVideo(videoObj) {
        if (typeof videoObj.summary === 'string') return videoObj.summary;
        const catalogInfo = videoData[videoObj.path];
        if (!catalogInfo?.summary_chunk) return '';
        const chunk = await ensureSummaryChunk(catalogInfo.summary_chunk);
        const summary = typeof chunk[videoObj.path] === 'string' ? chunk[videoObj.path] : '';
        videoObj.summary = summary;
        catalogInfo.summary = summary;
        return summary;
    }

    async function ensureAllSummaries() {
        const chunkIds = [...new Set(Object.values(videoData).map(info => info.summary_chunk).filter(Boolean))];
        const chunks = await Promise.all(chunkIds.map(ensureSummaryChunk));
        for (const chunk of chunks) {
            for (const [lessonPath, summary] of Object.entries(chunk)) {
                if (videoData[lessonPath] && typeof summary === 'string') videoData[lessonPath].summary = summary;
            }
        }
    }

    function buildCourseSummaryLead(videoObj) {
        if (typeof salsaCourseData === 'undefined' || !videoObj.path?.startsWith('Salsa Masterclass/')) return '';
        const videoParts = videoObj.path.split('/');
        videoParts.pop();
        const courseInfo = salsaCourseData.folders[videoParts.join('/')];
        if (!courseInfo) return '';

        let html = '<div class="course-video-desc">';
        html += `<p>${escapeHtml(courseInfo.description)}</p>`;
        if (courseInfo.tips) html += `<p class="course-tips"><strong>Tips:</strong> ${escapeHtml(courseInfo.tips)}</p>`;
        if (courseInfo.song) html += `<p class="course-song">&#9835; ${escapeHtml(courseInfo.song)}</p>`;
        if (courseInfo.prerequisites) {
            html += '<div class="course-prereqs">';
            if (courseInfo.prerequisites.on1) {
                html += '<div class="course-prereq-col"><strong>On1:</strong><ul>'
                    + courseInfo.prerequisites.on1.map(item => `<li>${escapeHtml(item)}</li>`).join('') + '</ul></div>';
            }
            if (courseInfo.prerequisites.on2) {
                html += '<div class="course-prereq-col"><strong>On2:</strong><ul>'
                    + courseInfo.prerequisites.on2.map(item => `<li>${escapeHtml(item)}</li>`).join('') + '</ul></div>';
            }
            html += '</div>';
        }
        return `${html}</div>`;
    }

    async function renderVideoSummary(videoObj) {
        const courseLead = buildCourseSummaryLead(videoObj);
        elements.videoSummary.innerHTML = `${courseLead}<div class="summary-loading" role="status"><span class="summary-loading-dot" aria-hidden="true"></span>Loading lesson analysis…</div>`;

        try {
            const summary = await ensureSummaryForVideo(videoObj);
            if (state.currentVideo?.path !== videoObj.path) return;
            const analysis = parseMarkdown(summary);
            elements.videoSummary.innerHTML = courseLead && summary
                ? `${courseLead}<details class="ai-summary-details" open><summary class="ai-summary-toggle">Lesson analysis</summary><div class="ai-summary-content">${analysis}</div></details>`
                : `${courseLead}${analysis}`;
        } catch (error) {
            console.warn('Could not load lesson analysis:', error);
            if (state.currentVideo?.path !== videoObj.path) return;
            elements.videoSummary.innerHTML = `${courseLead}<div class="summary-error" role="alert"><p>The lesson analysis is unavailable right now.</p><button type="button" class="summary-retry-btn">Try again</button></div>`;
            elements.videoSummary.querySelector('.summary-retry-btn')?.addEventListener('click', () => renderVideoSummary(videoObj));
        }
    }

    // Load and Play Video
    function loadVideo(videoObj, options = {}) {
        if (pendingSeekCleanup) {
            pendingSeekCleanup();
            pendingSeekCleanup = null;
            skipNextResume = false;
        }
        tilePendingUnfavs = new Set();
        clearABLoop();
        if (state.currentVideo) saveCurrentPosition();
        state.currentVideo = videoObj;
        const requestedSeek = Number(options.seekTime);
        if (Number.isFinite(requestedSeek) && requestedSeek >= 0) {
            skipNextResume = true;
            preparePendingSeek(videoObj.path, requestedSeek);
        }
        
        // Find playlist siblings for Prev/Next
        const pathParts = videoObj.path.split('/');
        pathParts.pop(); // remove filename
        
        // Determine root style
        let rootStyle = "Other";
        for (const [style, node] of Object.entries(state.tree)) {
            if (node.subfolders[pathParts[0]]) {
                rootStyle = style;
                break;
            }
        }
        
        // Traverse to folder
        let folderNode = state.tree[rootStyle];
        for (const part of pathParts) {
            if (folderNode && folderNode.subfolders[part]) {
                folderNode = folderNode.subfolders[part];
            }
        }
        
        if (folderNode && folderNode.videos) {
            // Ensure sorted
            const sortedVideos = [...folderNode.videos].sort(compareVideos);
            const currentIndex = sortedVideos.findIndex(v => v.path === videoObj.path);
            
            state.playlist = sortedVideos;
            state.playlistIndex = currentIndex;
            
            elements.prevBtn.disabled = currentIndex <= 0;
            elements.nextBtn.disabled = currentIndex === -1 || currentIndex >= sortedVideos.length - 1;
            if (elements.prevOverlayBtn) elements.prevOverlayBtn.disabled = elements.prevBtn.disabled;
            if (elements.nextOverlayBtn) elements.nextOverlayBtn.disabled = elements.nextBtn.disabled;
        } else {
            elements.prevBtn.disabled = true;
            elements.nextBtn.disabled = true;
            if (elements.prevOverlayBtn) elements.prevOverlayBtn.disabled = true;
            if (elements.nextOverlayBtn) elements.nextOverlayBtn.disabled = true;
        }
        elements.homeView.style.display = 'none';
        closeNotesView({ restoreFocus: false });
        document.body.dataset.view = 'video';
        elements.videoView.style.display = 'flex';

        // Update URL/Video Source
        updateVideoSource({ autoplay: true });

        // Update Info
        elements.videoTitle.innerText = videoObj.title;

        renderVideoSummary(videoObj);

        // Update favorite star
        updateFavBtn();

        // Show bookmarks
        elements.bookmarksBar.style.display = 'block';
        renderBookmarks();
        
        // Generate breadcrumbs for video view: Folder1 / Folder2 / filename
        // Create a copy of pathParts because we need the raw path for rendering Home Tiles later
        const fullPathForBreadcrumb = [...pathParts];
        
        // Add root category (Style) to breadcrumb
        for (const [style, node] of Object.entries(state.tree)) {
            if (node.subfolders[fullPathForBreadcrumb[0]]) {
                fullPathForBreadcrumb.unshift(style);
                break;
            }
        }
        
        // Deduplicate consecutive identical segments (e.g. "Salsa Masterclass / Salsa Masterclass")
        let breadcrumbHtml = '';
        let prevPart = '';
        fullPathForBreadcrumb.forEach((part, index) => {
            if (part === prevPart) return; // skip consecutive duplicates
            prevPart = part;
            // Store the path slice up to this point so we can render the exact folder view
            const pathSlice = fullPathForBreadcrumb.slice(1, index + 1);
            if (breadcrumbHtml) breadcrumbHtml += `<span style="margin: 0 6px; color: var(--text-muted);">/</span>`;
            breadcrumbHtml += `<a href="#" class="breadcrumb-link" data-level="${index}" data-path='${JSON.stringify(pathSlice)}' style="color: var(--text-main); text-decoration: none; transition: color 0.2s;">${part}</a>`;
        });
        elements.videoBreadcrumb.innerHTML = breadcrumbHtml;
        
        // Attach listeners to breadcrumb links to go back to Home Tiles View
        document.querySelectorAll('.breadcrumb-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const level = parseInt(e.currentTarget.dataset.level);
                let pathData;
                try { pathData = JSON.parse(e.currentTarget.dataset.path); } catch(err) { return; }
                
                pauseVideoPlayback({ destroyStream: true });
                
                // Switch Views
                document.body.dataset.view = 'home';
                elements.videoView.style.display = 'none';
                closeNotesView({ restoreFocus: false });
                elements.homeView.style.display = 'block';
                
                // Uncheck active states in sidebar
                clearActiveVideoLinks();
                state.currentVideo = null;
                
                // Render the Home Tiles based on the breadcrumb clicked
                const styleName = fullPathForBreadcrumb[0];
                if (level === 0) {
                    // Clicked the root style (e.g. 'Salsa')
                    renderHomeTiles(state.tree[styleName], [styleName]);
                } else {
                    // Traverse down to the specific folder
                    let targetNode = state.tree[styleName]; // Start at style
                    
                    for(const p of pathData) {
                        if(targetNode && targetNode.subfolders[p]) {
                            targetNode = targetNode.subfolders[p];
                        }
                    }
                    
                    // Render that specific folder in the tiles view
                    renderHomeTiles(targetNode, [styleName, ...pathData]);
                }
                focusHomeHeading();
                setHomeRoute();
                
                scrollMainToTop();
            });
            
            link.addEventListener('mouseover', e => e.target.style.color = 'var(--accent)');
            link.addEventListener('mouseout', e => e.target.style.color = 'var(--text-main)');
        });

        // Hydrate only the active lesson's branch before syncing sidebar state.
        // Direct links and home tiles can open a lesson before its lazy nav branch exists.
        revealNavigationPath([rootStyle, ...pathParts]);

        // Highlight Active Link
        clearActiveVideoLinks();
        const activeLink = document.querySelector(`.video-link[data-path="${CSS.escape(videoObj.path)}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
            activeLink.querySelector('.video-link-main')?.setAttribute('aria-current', 'page');
        }

        // Mark as watched
        state.watched.add(videoObj.path);
        safeStore('watchedVideos', JSON.stringify([...state.watched]));
        if (activeLink) activeLink.classList.add('watched');

        // Track last watched timestamp
        state.lastWatched[videoObj.path] = Date.now();
        safeStore('videoLastWatched', JSON.stringify(state.lastWatched));
        updateHomeStats();
        if (options.updateHistory !== false) setVideoRoute(videoObj.path);

        // Scroll to top
        elements.videoView.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });
        requestAnimationFrame(() => elements.videoTitle.focus({ preventScroll: true }));

        // Mobile: close sidebar
        if (usesCompactLayout()) {
            setSidebarOpen(false, { restoreFocus: false });
        }
    }


    // Source sessions keep delayed mobile/HLS callbacks from touching a newer lesson.
    let videoSourceRequest = 0;
    let activeSourceCleanup = null;
    let activeSourcePath = null;
    let playbackIntent = false;
    let expectedResetPauses = 0;
    let playbackErrorNoticeRequest = 0;

    function sourceIsCurrent(requestId, requestedVideo, sessionHls = null) {
        return requestId === videoSourceRequest
            && state.currentVideo?.path === requestedVideo.path
            && (!sessionHls || hls === sessionHls);
    }

    function setPlaybackState(value) {
        elements.playerContainer.dataset.playbackState = value;
    }

    function hideVideoRetry() {
        elements.videoRetryBtn.hidden = true;
        elements.videoRetryBtn.dataset.action = 'retry';
        elements.videoRetryBtn.textContent = 'Retry video';
    }

    function showVideoRetry(message, requestId = videoSourceRequest) {
        if (requestId !== videoSourceRequest || !state.currentVideo) return;
        setPlaybackState('error');
        elements.videoRetryBtn.dataset.action = 'retry';
        elements.videoRetryBtn.textContent = 'Retry video';
        elements.videoRetryBtn.hidden = false;
        if (playbackErrorNoticeRequest !== requestId) {
            playbackErrorNoticeRequest = requestId;
            showToast(message, 6000, true);
        }
    }

    async function attemptVideoPlayback(reason, requestId = videoSourceRequest) {
        if (!playbackIntent || requestId !== videoSourceRequest || !state.currentVideo) return false;
        try {
            await elements.videoPlayer.play();
            return true;
        } catch (error) {
            if (requestId !== videoSourceRequest) return false;
            if (error?.name === 'NotAllowedError') {
                // Mobile browsers may require a direct tap on their native play control.
                console.info(`Playback is waiting for a user gesture (${reason}).`);
                setPlaybackState('ready');
                elements.videoRetryBtn.dataset.action = 'play';
                elements.videoRetryBtn.textContent = 'Play video';
                elements.videoRetryBtn.hidden = false;
                return false;
            }
            if (error?.name === 'AbortError') {
                console.debug(`Playback request was superseded (${reason}).`);
                return false;
            }
            console.warn(`Video playback failed (${reason}):`, error);
            showVideoRetry('The video could not continue. Tap Retry video to reconnect.', requestId);
            return false;
        }
    }

    function requestVideoPlayback(reason) {
        playbackIntent = true;
        return attemptVideoPlayback(reason);
    }

    function releaseActiveSource() {
        if (activeSourceCleanup) {
            activeSourceCleanup();
            activeSourceCleanup = null;
        }
        if (hls) {
            const previousHls = hls;
            hls = null;
            previousHls.destroy();
        }
    }

    async function updateVideoSource(options = {}) {
        if (!state.currentVideo) return;

        const requestedVideo = state.currentVideo;
        const video = elements.videoPlayer;
        const isNewLesson = activeSourcePath !== requestedVideo.path;
        const shouldAutoplay = options.autoplay ?? (isNewLesson || playbackIntent || !video.paused);
        const requestId = ++videoSourceRequest;

        playbackIntent = Boolean(shouldAutoplay);
        activeSourcePath = requestedVideo.path;
        playbackErrorNoticeRequest = 0;
        hideVideoRetry();
        setPlaybackState('loading');

        if (!video.paused) expectedResetPauses += 1;
        releaseActiveSource();
        video.pause();
        video.removeAttribute('src');
        video.load();

        function attachReadyAndErrorHandlers(sourceLabel) {
            const onReady = () => {
                if (sourceIsCurrent(requestId, requestedVideo)) attemptVideoPlayback(`${sourceLabel} ready`, requestId);
            };
            const onError = () => {
                if (!sourceIsCurrent(requestId, requestedVideo)) return;
                console.warn(`${sourceLabel} playback failed:`, video.error);
                showVideoRetry('The video stream stopped. Tap Retry video to reconnect.', requestId);
            };
            const cleanup = () => {
                video.removeEventListener('loadedmetadata', onReady);
                video.removeEventListener('error', onError);
            };
            activeSourceCleanup = cleanup;
            video.addEventListener('loadedmetadata', onReady, { once: true });
            video.addEventListener('error', onError, { once: true });
        }

        function playLocalFile() {
            if (!sourceIsCurrent(requestId, requestedVideo)) return;
            attachReadyAndErrorHandlers('Local video');
            video.src = encodeURI(requestedVideo.path);
        }

        function playNativeHls(streamUrl) {
            if (!sourceIsCurrent(requestId, requestedVideo)) return;
            attachReadyAndErrorHandlers('Native HLS');
            video.src = streamUrl;
        }

        function handleUnavailableStream(message) {
            if (!sourceIsCurrent(requestId, requestedVideo)) return;
            if (canUseLocalMedia) {
                showToast(`${message} Trying the local file.`, 5000, true);
                playLocalFile();
            } else {
                showVideoRetry(`${message} Tap Retry video to reconnect.`, requestId);
            }
        }

        const useCDN = !canUseLocalMedia || state.useBunny;
        if (!useCDN || !requestedVideo.bunny_id || !state.bunnyPullZone) {
            playLocalFile();
            return;
        }

        // Clean pull zone hostname (remove https:// or trailing slashes if user pasted them)
        const host = state.bunnyPullZone.replace('https://', '').replace('http://', '').split('/')[0];
        const streamUrl = `https://${host}/${requestedVideo.bunny_id}/playlist.m3u8`;
        const nativeHlsSupported = Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
        const mediaSourceAvailable = Boolean(globalThis.MediaSource || globalThis.ManagedMediaSource);

        // Native-only Safari/WebViews should not wait on an unnecessary script download.
        if (nativeHlsSupported && !mediaSourceAvailable) {
            playNativeHls(streamUrl);
            return;
        }

        try {
            const HlsRuntime = await ensureHlsRuntime();
            if (!sourceIsCurrent(requestId, requestedVideo)) return;

            // Prefer hls.js where MediaSource is available. Some mobile Chromium builds
            // claim native HLS support but stop shortly after playback begins.
            if (!HlsRuntime.isSupported()) {
                if (nativeHlsSupported) playNativeHls(streamUrl);
                else handleUnavailableStream('Streaming is not supported in this browser.');
                return;
            }

            const sessionHls = new HlsRuntime({
                capLevelToPlayerSize: true,
                startLevel: -1,
                backBufferLength: 60
            });
            let networkRecoveries = 0;
            let mediaRecoveries = 0;
            let recoveryTimer = null;
            let stablePlaybackTimer = null;

            const onStablePlayback = () => {
                if (stablePlaybackTimer) return;
                stablePlaybackTimer = setTimeout(() => {
                    stablePlaybackTimer = null;
                    if (!sourceIsCurrent(requestId, requestedVideo, sessionHls)) return;
                    networkRecoveries = 0;
                    mediaRecoveries = 0;
                }, 30000);
            };

            const cleanupSession = () => {
                if (recoveryTimer) clearTimeout(recoveryTimer);
                if (stablePlaybackTimer) clearTimeout(stablePlaybackTimer);
                recoveryTimer = null;
                stablePlaybackTimer = null;
                video.removeEventListener('playing', onStablePlayback);
            };
            activeSourceCleanup = cleanupSession;
            hls = sessionHls;
            video.addEventListener('playing', onStablePlayback);

            const finishWithStreamError = () => {
                if (!sourceIsCurrent(requestId, requestedVideo, sessionHls)) return;
                cleanupSession();
                if (activeSourceCleanup === cleanupSession) activeSourceCleanup = null;
                hls = null;
                sessionHls.destroy();
                handleUnavailableStream('The lesson stream could not recover.');
            };

            const scheduleRecovery = (label, action, delay) => {
                if (recoveryTimer) return;
                console.warn(`Recovering ${label} playback for ${requestedVideo.path}.`);
                recoveryTimer = setTimeout(() => {
                    recoveryTimer = null;
                    if (!sourceIsCurrent(requestId, requestedVideo, sessionHls)) return;
                    try {
                        action();
                        attemptVideoPlayback(`${label} recovery`, requestId);
                    } catch (error) {
                        console.warn(`${label} recovery failed:`, error);
                        finishWithStreamError();
                    }
                }, delay);
            };

            sessionHls.on(HlsRuntime.Events.MANIFEST_PARSED, () => {
                if (sourceIsCurrent(requestId, requestedVideo, sessionHls)) {
                    attemptVideoPlayback('HLS manifest ready', requestId);
                }
            });
            if (HlsRuntime.Events.FRAG_LOADED) {
                sessionHls.on(HlsRuntime.Events.FRAG_LOADED, () => {
                    if (sourceIsCurrent(requestId, requestedVideo, sessionHls)) onStablePlayback();
                });
            }
            sessionHls.on(HlsRuntime.Events.ERROR, (event, data) => {
                // Never let a delayed callback from lesson A tear down lesson B.
                if (!sourceIsCurrent(requestId, requestedVideo, sessionHls) || !data?.fatal) return;
                clearTimeout(stablePlaybackTimer);
                stablePlaybackTimer = null;
                if (recoveryTimer) return;

                if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR && networkRecoveries < 2) {
                    networkRecoveries += 1;
                    scheduleRecovery('network', () => sessionHls.startLoad(), networkRecoveries * 750);
                    return;
                }
                if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
                    mediaRecoveries += 1;
                    scheduleRecovery('media', () => sessionHls.recoverMediaError(), (mediaRecoveries - 1) * 1000);
                    return;
                }

                console.warn('Unrecoverable HLS playback error:', data.type, data.details);
                finishWithStreamError();
            });

            sessionHls.loadSource(streamUrl);
            sessionHls.attachMedia(video);
        } catch (error) {
            console.warn('Streaming runtime unavailable:', error);
            if (!sourceIsCurrent(requestId, requestedVideo)) return;
            if (nativeHlsSupported) playNativeHls(streamUrl);
            else handleUnavailableStream('Streaming is unavailable.');
        }
    }

    elements.videoPlayer.addEventListener('play', () => {
        playbackIntent = true;
        setPlaybackState('starting');
    });
    elements.videoPlayer.addEventListener('playing', () => {
        playbackIntent = true;
        hideVideoRetry();
        setPlaybackState('playing');
    });
    elements.videoPlayer.addEventListener('waiting', () => setPlaybackState('buffering'));
    elements.videoPlayer.addEventListener('stalled', () => setPlaybackState('buffering'));
    elements.videoPlayer.addEventListener('pause', () => {
        if (expectedResetPauses > 0) {
            expectedResetPauses -= 1;
            return;
        }
        if (!elements.videoPlayer.ended && !elements.videoPlayer.error) playbackIntent = false;
        setPlaybackState(elements.videoPlayer.ended ? 'ended' : 'paused');
    });

    // Resume playback position after source loads
    let skipNextResume = false;
    let pendingSeekCleanup = null;

    function preparePendingSeek(expectedPath, seekTime) {
        if (pendingSeekCleanup) pendingSeekCleanup();
        const video = elements.videoPlayer;
        const cleanup = () => {
            video.removeEventListener('loadedmetadata', onReady);
            video.removeEventListener('error', onError);
            if (pendingSeekCleanup === cleanup) pendingSeekCleanup = null;
        };
        const onReady = () => {
            if (!state.currentVideo || state.currentVideo.path !== expectedPath) {
                cleanup();
                return;
            }
            video.currentTime = playbackCore.clampSeekTime(seekTime, video.duration);
            cleanup();
        };
        const onError = () => {
            skipNextResume = false;
            cleanup();
        };
        video.addEventListener('loadedmetadata', onReady);
        video.addEventListener('error', onError);
        pendingSeekCleanup = cleanup;
    }
    function tryResumePosition() {
        if (skipNextResume) { skipNextResume = false; return; }
        if (!state.currentVideo) return;
        const positions = safeLoad('videoPositions', {});
        const saved = positions[state.currentVideo.path];
        if (saved === undefined || saved === null) return;

        const v = elements.videoPlayer;
        if (!Number.isFinite(Number(v.duration)) || Number(v.duration) <= 0) return;
        const resumeTime = playbackCore.safeResumeTime(saved, v.duration);
        if (resumeTime === null) {
            // Old uploads, imported backups, and near-finished lessons can leave an
            // invalid timestamp that would otherwise seek straight to the end.
            delete positions[state.currentVideo.path];
            safeStore('videoPositions', JSON.stringify(positions));
            return;
        }

        v.currentTime = resumeTime;
        const toast = document.createElement('div');
        toast.className = 'resume-toast';
        toast.setAttribute('role', 'status');
        toast.textContent = 'Resumed from ' + formatTime(resumeTime);
        elements.playerContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 2600);
    }

    // Bind once — fires each time a new source loads metadata
    elements.videoPlayer.addEventListener('loadedmetadata', tryResumePosition);

    function retryCurrentVideoPlayback() {
        if (!state.currentVideo) return;
        const video = elements.videoPlayer;
        const currentTime = Number(video.currentTime);
        const duration = Number(video.duration);
        if (Number.isFinite(currentTime) && currentTime > 0.25
            && Number.isFinite(duration) && currentTime < duration - playbackCore.RESUME_END_GUARD_SECONDS) {
            skipNextResume = true;
            preparePendingSeek(state.currentVideo.path, currentTime);
        }
        updateVideoSource({ autoplay: true });
    }

    function handleVideoAction() {
        if (elements.videoRetryBtn.dataset.action === 'play') {
            requestVideoPlayback('play button');
            return;
        }
        retryCurrentVideoPlayback();
    }

    function saveCurrentPosition() {
        if (!state.currentVideo || !elements.videoPlayer) return;
        const v = elements.videoPlayer;
        const t = Number(v.currentTime || 0);
        const d = Number(v.duration || 0);
        if (!Number.isFinite(t) || t < 1) return;

        if (!Number.isFinite(d) || d === 0 || t < d - 5) {
            const positions = safeLoad('videoPositions', {});
            positions[state.currentVideo.path] = Math.floor(t);
            safeStore('videoPositions', JSON.stringify(positions));
        }

        state.lastWatched[state.currentVideo.path] = Date.now();
        safeStore('videoLastWatched', JSON.stringify(state.lastWatched));
    }

    function pauseVideoPlayback(options = {}) {
        saveCurrentPosition();
        playbackIntent = false;
        expectedResetPauses = 0;
        if (options.destroyStream) {
            videoSourceRequest += 1;
            activeSourcePath = null;
            releaseActiveSource();
            hideVideoRetry();
        }
        if (elements.videoPlayer && !elements.videoPlayer.paused) elements.videoPlayer.pause();
        if (options.destroyStream) {
            elements.videoPlayer.removeAttribute('src');
            elements.videoPlayer.load();
        }
    }

    function clearWatchHistoryData() {
        state.watched.clear();
        state.lastWatched = {};
        safeRemove('watchedVideos');
        safeRemove('videoLastWatched');
        safeRemove('videoPositions');
        renderNavigation();
        if (elements.homeView && elements.homeView.style.display !== 'none') renderHomeTiles(null, []);
    }

    // Clear saved position when video finishes
    elements.videoPlayer.addEventListener('ended', function() {
        playbackIntent = false;
        setPlaybackState('ended');
        if (state.currentVideo) {
            const positions = safeLoad('videoPositions', {});
            delete positions[state.currentVideo.path];
            safeStore('videoPositions', JSON.stringify(positions));
        }
    });

    // Reusable toast notification
    function showToast(msg, duration = 3000, isError = false) {
        const toast = document.createElement('div');
        toast.className = 'resume-toast';
        toast.setAttribute('role', isError ? 'alert' : 'status');
        toast.textContent = msg;
        (elements.playerContainer || document.body).appendChild(toast);
        setTimeout(() => toast.remove(), duration);
    }

    // Video error handler — show message instead of blank black box
    elements.videoPlayer.addEventListener('error', () => {
        const err = elements.videoPlayer.error;
        if (!err) return;
        const msg = err.code === 4 ? 'Video not found — try switching source'
                  : err.code === 3 ? 'Video decode error — try a different browser'
                  : 'Video failed to load';
        showToast(msg, 5000, true);
    });

    // Parse Markdown & Add Clickable Timestamps
    function parseMarkdown(text) {
        if (!text) return '<p class="summary-empty"><em>No analysis is available for this lesson.</em></p>';

        const chapters = [];
        const paragraphs = [];
        const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);

        for (const rawLine of lines) {
            const timestamp = rawLine.match(/\[(\d{1,2}):(\d{2})\]/);
            if (!timestamp) {
                paragraphs.push(rawLine.replace(/^\s*-\s*/, ''));
                continue;
            }

            const minutes = Number(timestamp[1]);
            const seconds = Number(timestamp[2]);
            if (!Number.isFinite(minutes) || seconds > 59) {
                paragraphs.push(rawLine.replace(/^\s*-\s*/, ''));
                continue;
            }

            let remainder = rawLine.slice(timestamp.index + timestamp[0].length)
                .replace(/^\*{0,2}\s*-?\s*/, '')
                .replace(/\*\*/g, '')
                .trim();
            const separator = remainder.indexOf(':');
            const title = (separator >= 0 ? remainder.slice(0, separator) : remainder).trim() || 'Lesson note';
            const description = (separator >= 0 ? remainder.slice(separator + 1) : '').trim();
            chapters.push({
                timeLabel: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
                totalSeconds: (minutes * 60) + seconds,
                title,
                description
            });
        }

        const renderInline = value => escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        let html = '<div class="summary-content">';

        if (paragraphs.length) {
            html += `<div class="summary-intro">${paragraphs.map(line => `<p>${renderInline(line)}</p>`).join('')}</div>`;
        }

        if (chapters.length) {
            const openByDefault = usesCompactLayout() ? '' : ' open';
            html += '<ol class="lesson-chapters">';
            for (const chapter of chapters) {
                html += `<li class="lesson-chapter">
                    <button type="button" class="timestamp-pill" data-time="${chapter.totalSeconds}" aria-label="Jump to ${chapter.timeLabel}">${chapter.timeLabel}</button>
                    <details class="chapter-details"${openByDefault}>
                        <summary><span class="chapter-title">${renderInline(chapter.title)}</span></summary>
                        ${chapter.description ? `<p class="chapter-description">${renderInline(chapter.description)}</p>` : ''}
                    </details>
                </li>`;
            }
            html += '</ol>';
        }

        return `${html}</div>`;
    }

    // Event Listeners
    function setupEventListeners() {
        // Prev/Next Video Navigation
        elements.prevBtn.addEventListener('click', () => {
            if (state.playlist && state.playlistIndex > 0) {
                loadVideo(state.playlist[state.playlistIndex - 1]);
            }
        });
        
        elements.nextBtn.addEventListener('click', () => {
            if (state.playlist && state.playlistIndex < state.playlist.length - 1) {
                loadVideo(state.playlist[state.playlistIndex + 1]);
            }
        });
        if (elements.prevOverlayBtn) {
            elements.prevOverlayBtn.addEventListener('click', () => {
                if (state.playlist && state.playlistIndex > 0) {
                    loadVideo(state.playlist[state.playlistIndex - 1]);
                }
            });
        }
        if (elements.nextOverlayBtn) {
            elements.nextOverlayBtn.addEventListener('click', () => {
                if (state.playlist && state.playlistIndex < state.playlist.length - 1) {
                    loadVideo(state.playlist[state.playlistIndex + 1]);
                }
            });
        }
        // Go Home helper
        function goHome() {
            showLibraryHome(true);
        }

        // Home Breadcrumb
        elements.homeBreadcrumb.addEventListener('click', (e) => {
            e.preventDefault();
            goHome();
        });

        // Sidebar title and mobile header title → go home
        document.querySelectorAll('.sidebar-title').forEach(el => {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                goHome();
                if (usesCompactLayout()) {
                    setSidebarOpen(false, { restoreFocus: false });
                }
            });
            makeKeyboardAccessible(el, () => el.click(), 'Go to library home');
        });

        // Home button in sidebar header
        const homeSidebarBtn = document.getElementById('home-sidebar-btn');
        if (homeSidebarBtn) {
            homeSidebarBtn.addEventListener('click', () => {
                goHome();
                if (usesCompactLayout()) {
                    setSidebarOpen(false, { restoreFocus: false });
                }
            });
        }

        // Timestamp Clicks
        elements.videoSummary.addEventListener('click', (e) => {
            if (e.target.classList.contains('timestamp-pill')) {
                const time = parseFloat(e.target.dataset.time);
                
                // Native HTML5 Video skipping works for both Local & HLS stream!
                elements.videoPlayer.currentTime = time;
                requestVideoPlayback('summary timestamp');
                
                // Scroll up centered towards the video player
                const wrapper = document.getElementById('video-sticky-wrapper');
                if (wrapper) {
                    wrapper.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' });
                }
            }
        });

        
        // Playback-speed menu, including the full keyboard menu pattern.
        const speedDropdown = document.getElementById('speed-dropdown');
        const speedMenuItems = [...elements.speedDropdownBtns];
        const closeSpeedMenu = (returnFocus = false) => {
            speedDropdown.style.display = 'none';
            elements.currentSpeedBtn.setAttribute('aria-expanded', 'false');
            if (returnFocus) elements.currentSpeedBtn.focus();
        };
        const openSpeedMenu = (focusItem = true) => {
            speedDropdown.style.display = 'flex';
            elements.currentSpeedBtn.setAttribute('aria-expanded', 'true');
            if (focusItem) {
                const active = speedMenuItems.find(item => item.getAttribute('aria-checked') === 'true') || speedMenuItems[0];
                requestAnimationFrame(() => active?.focus());
            }
        };
        const focusSpeedItem = (current, direction) => {
            const index = speedMenuItems.indexOf(current);
            const next = (index + direction + speedMenuItems.length) % speedMenuItems.length;
            speedMenuItems[next]?.focus();
        };

        elements.currentSpeedBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            if (elements.currentSpeedBtn.getAttribute('aria-expanded') === 'true') closeSpeedMenu();
            else openSpeedMenu();
        });
        elements.currentSpeedBtn.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                openSpeedMenu();
            } else if (event.key === 'Escape') {
                event.stopPropagation();
                closeSpeedMenu();
            }
        });

        document.addEventListener('click', (event) => {
            if (event.target !== elements.currentSpeedBtn && !speedDropdown.contains(event.target)) closeSpeedMenu();
        });

        speedMenuItems.forEach(btn => {
            btn.addEventListener('click', (event) => {
                setSpeed(parseFloat(event.currentTarget.dataset.speed));
                closeSpeedMenu(true);
            });
            btn.addEventListener('keydown', event => {
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    focusSpeedItem(event.currentTarget, 1);
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    focusSpeedItem(event.currentTarget, -1);
                } else if (event.key === 'Home') {
                    event.preventDefault();
                    speedMenuItems[0]?.focus();
                } else if (event.key === 'End') {
                    event.preventDefault();
                    speedMenuItems[speedMenuItems.length - 1]?.focus();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeSpeedMenu(true);
                } else if (event.key === 'Tab') {
                    closeSpeedMenu();
                }
            });
        });

        // Source Toggle
        elements.sourceToggle.addEventListener('change', (e) => {
            state.useBunny = e.target.checked;
            safeStore('useBunny', state.useBunny);
            updateVideoSource();
        });
        elements.videoRetryBtn.addEventListener('click', handleVideoAction);

        // Search (debounced for 795+ videos)
        let sidebarSearchTimeout;
        elements.searchInput.addEventListener('input', (e) => {
            clearTimeout(sidebarSearchTimeout);
            sidebarSearchTimeout = setTimeout(() => { sidebarSearchFilter(e.target.value); }, 150);
        });
        function sidebarSearchFilter(val) {
            const query = val.trim().toLowerCase();
            if (query) hydrateNavigationTree();
            document.querySelectorAll('.nav-group').forEach(group => {
                let hasVisibleMatch = false;
                
                // Check header
                const headerText = group.querySelector('.nav-header').innerText.toLowerCase();
                
                // Check links
                const links = group.querySelectorAll('.video-link');
                links.forEach(link => {
                    const isMatch = link.innerText.toLowerCase().includes(query);
                    link.hidden = !isMatch;
                    if (isMatch) hasVisibleMatch = true;
                });

                if (headerText.includes(query) || hasVisibleMatch) {
                    group.hidden = false;
                    hasVisibleMatch = true;
                } else {
                    group.hidden = true;
                }
                
                // Auto-open accordion if there is a search match
                const content = group.querySelector('.nav-content');
                const headerBtn = group.querySelector('.nav-header');
                if (query.length > 0 && hasVisibleMatch) {
                    if (content) content.classList.add('open');
                    if (headerBtn) {
                        headerBtn.classList.add('active');
                        headerBtn.querySelector('.nav-folder-toggle')?.setAttribute('aria-expanded', 'true');
                    }
                } else if (query.length === 0) {
                    if (content) content.classList.remove('open');
                    if (headerBtn) {
                        headerBtn.classList.remove('active');
                        headerBtn.querySelector('.nav-folder-toggle')?.setAttribute('aria-expanded', 'false');
                    }
                }
            });
        }

        // Mobile Menu / Desktop Toggle
        const toggleSidebar = () => setSidebarOpen(!sidebarIsOpen());

        if(elements.menuToggle) elements.menuToggle.addEventListener('click', toggleSidebar);
        if(elements.openSidebarBtn) elements.openSidebarBtn.addEventListener('click', toggleSidebar);
        if(elements.closeSidebarBtn) elements.closeSidebarBtn.addEventListener('click', () => setSidebarOpen(false));
        
        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (usesCompactLayout()) {
                if (elements.sidebar.classList.contains('open') && 
                    !elements.sidebar.contains(e.target) && 
                    (elements.menuToggle && !elements.menuToggle.contains(e.target)) &&
                    (elements.openSidebarBtn && !elements.openSidebarBtn.contains(e.target))) {
                    setSidebarOpen(false);
                }
            }
        });

        document.addEventListener('keydown', event => {
            if (event.key !== 'Tab' || !usesCompactLayout() || !sidebarIsOpen() || hasOpenDialog()) return;
            const focusables = [...elements.sidebar.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )].filter(element => element instanceof HTMLElement && element.offsetParent !== null);
            if (!focusables.length) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        const handleLayoutBreakpointChange = () => {
            elements.sidebar.classList.remove('open');
            document.body.classList.remove('sidebar-open');
            document.body.classList.remove('sidebar-closed');
            syncSidebarAccessibility();
        };
        if (typeof compactLayoutQuery.addEventListener === 'function') {
            compactLayoutQuery.addEventListener('change', handleLayoutBreakpointChange);
        } else {
            compactLayoutQuery.addListener(handleLayoutBreakpointChange);
        }

        // Collapse All Folders
        if (elements.collapseAllBtn) {
            elements.collapseAllBtn.addEventListener('click', () => {
                document.querySelectorAll('.nav-content.open').forEach(el => el.classList.remove('open'));
                document.querySelectorAll('.nav-header.active').forEach(el => {
                    el.classList.remove('active');
                    el.querySelector('.nav-folder-toggle')?.setAttribute('aria-expanded', 'false');
                });
            });
        }
        
        // Settings Modal
        function openSettings() {
            pauseVideoPlayback();
            elements.bunnyLibInput.value = state.bunnyPullZone;
            elements.themeSelect.value = state.theme;
            elements.settingsModal.style.display = 'flex';
            updateThemeCounter();
        }
        elements.settingsBtn.addEventListener('click', openSettings);

        elements.closeSettings.addEventListener('click', () => {
            elements.settingsModal.style.display = 'none';
        });

        const closeSettingsX = document.getElementById('close-settings-x');
        if (closeSettingsX) closeSettingsX.addEventListener('click', () => {
            elements.settingsModal.style.display = 'none';
        });

        elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === elements.settingsModal) elements.settingsModal.style.display = 'none';
        });

        elements.saveSettings.addEventListener('click', () => {
            const inputVal = elements.bunnyLibInput.value.trim();
            if (inputVal && !inputVal.includes('.b-cdn.net')) {
                alert("Warning: Bunny Pull Zone usually ends in .b-cdn.net (e.g. vz-123.b-cdn.net)");
            }
            state.bunnyPullZone = inputVal;
            safeStore('bunny_pull_zone', state.bunnyPullZone);
            elements.settingsModal.style.display = 'none';
            
            // If they just added it, turn Bunny on
            if(state.bunnyPullZone) {
                state.useBunny = true;
                elements.sourceToggle.checked = true;
                safeStore('useBunny', true);
                updateVideoSource();
            }
        });

        // Theme switching
        elements.themeSelect.addEventListener('change', (e) => {
            state.theme = e.target.value;
            applyTheme(state.theme);
            onThemeChanged();
        });

        // Theme prev/next navigation
        const themeCounter = document.getElementById('theme-counter');
        function updateThemeCounter() {
            const opts = elements.themeSelect.options;
            const idx = elements.themeSelect.selectedIndex;
            themeCounter.textContent = (idx + 1) + ' / ' + opts.length;
        }

        let themeFavBtn = null; // initialized later
        function onThemeChanged() {
            updateThemeCounter();
            if (themeFavBtn) { updateThemeFavBtn(); renderFavThemes(); }
        }

        function cycleTheme(direction) {
            const opts = elements.themeSelect.options;
            let idx = elements.themeSelect.selectedIndex + direction;
            if (idx < 0) idx = opts.length - 1;
            if (idx >= opts.length) idx = 0;
            elements.themeSelect.selectedIndex = idx;
            state.theme = opts[idx].value;
            applyTheme(state.theme);
            onThemeChanged();
        }

        document.getElementById('theme-prev').addEventListener('click', () => cycleTheme(-1));
        document.getElementById('theme-next').addEventListener('click', () => cycleTheme(1));
        updateThemeCounter();

        // Favorite themes
        const favThemes = new Set(safeLoad('favoriteThemes', []));
        const favThemesRow = document.getElementById('fav-themes-row');
        themeFavBtn = document.getElementById('theme-fav-btn');

        function renderFavThemes() {
            if (favThemes.size === 0) {
                favThemesRow.style.display = 'none';
                return;
            }
            favThemesRow.style.display = 'flex';
            let html = '';
            for (const tv of favThemes) {
                // Find the display name from the select options
                const opt = [...elements.themeSelect.options].find(o => o.value === tv);
                const label = opt ? opt.textContent : tv;
                const isCurrent = state.theme === tv;
                html += `<div class="fav-theme-chip ${isCurrent ? 'current' : ''}" role="group" aria-label="${label} theme">
                    <button type="button" class="fav-theme-apply" data-theme="${tv}" aria-pressed="${isCurrent}">${label}</button>
                    <button type="button" class="fav-theme-remove" data-theme="${tv}" aria-label="Remove ${label} from favorite themes">&times;</button>
                </div>`;
            }
            favThemesRow.innerHTML = html;
        }

        function updateThemeFavBtn() {
            const isFav = favThemes.has(state.theme);
            themeFavBtn.innerHTML = isFav ? '&#9733;' : '&#9734;';
            themeFavBtn.classList.toggle('active', isFav);
            themeFavBtn.title = isFav ? 'Unfavorite this theme' : 'Favorite this theme';
            themeFavBtn.setAttribute('aria-label', themeFavBtn.title);
            themeFavBtn.setAttribute('aria-pressed', String(isFav));
        }

        themeFavBtn.addEventListener('click', () => {
            if (favThemes.has(state.theme)) {
                favThemes.delete(state.theme);
            } else {
                favThemes.add(state.theme);
            }
            safeStore('favoriteThemes', JSON.stringify([...favThemes]));
            updateThemeFavBtn();
            renderFavThemes();
        });

        favThemesRow.addEventListener('click', (e) => {
            // Remove button
            const removeBtn = e.target.closest('.fav-theme-remove');
            if (removeBtn) {
                e.stopPropagation();
                favThemes.delete(removeBtn.dataset.theme);
                safeStore('favoriteThemes', JSON.stringify([...favThemes]));
                updateThemeFavBtn();
                renderFavThemes();
                return;
            }
            // Click chip to apply theme
            const applyButton = e.target.closest('.fav-theme-apply');
            if (applyButton) {
                const tv = applyButton.dataset.theme;
                state.theme = tv;
                applyTheme(tv);
                elements.themeSelect.value = tv;
                updateThemeCounter();
                updateThemeFavBtn();
                renderFavThemes();
            }
        });

        renderFavThemes();
        updateThemeFavBtn();

        // Reset buttons
        function confirmAndReset(msg, action) {
            if (confirm(msg)) { action(); renderHomeTiles(null, []); }
        }

        document.getElementById('reset-watched').addEventListener('click', () => {
            confirmAndReset('Clear all watch history? This cannot be undone.', () => {
                clearWatchHistoryData();
            });
        });

        document.getElementById('reset-bookmarks').addEventListener('click', () => {
            confirmAndReset('Clear all bookmarks and notes for every video?', () => {
                safeRemove('videoBookmarks');
                if (state.currentVideo) renderBookmarks();
                updateNotesBadge();
            });
        });

        document.getElementById('reset-favorites').addEventListener('click', () => {
            confirmAndReset('Clear all favorites?', () => {
                state.favorites.clear();
                safeRemove('favoriteVideos');
                updateNotesBadge();
            });
        });

        document.getElementById('reset-positions').addEventListener('click', () => {
            confirmAndReset('Clear all saved resume positions?', () => {
                safeRemove('videoPositions');
            });
        });

        document.getElementById('reset-all').addEventListener('click', () => {
            confirmAndReset('Reset EVERYTHING? Watch history, bookmarks, notes, favorites, resume positions — all gone. This cannot be undone.', () => {
                state.watched.clear();
                state.favorites.clear();
                safeRemove('watchedVideos');
                safeRemove('videoBookmarks');
                safeRemove('favoriteVideos');
                safeRemove('videoPositions');
                state.lastWatched = {};
                safeRemove('videoLastWatched');
                renderNavigation();
                if (state.currentVideo) renderBookmarks();
                updateNotesBadge();
            });
        });
    }

    function parseCssColor(value) {
        const color = String(value || '').trim();
        const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hex) {
            const normalized = hex[1].length === 3
                ? [...hex[1]].map(character => character + character).join('')
                : hex[1];
            return [0, 2, 4].map(index => parseInt(normalized.slice(index, index + 2), 16));
        }
        const rgb = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
        return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
    }

    function relativeLuminance(rgb) {
        const channels = rgb.map(value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
    }

    function contrastRatio(first, second) {
        if (!first || !second) return 21;
        const a = relativeLuminance(first);
        const b = relativeLuminance(second);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }

    function enforceThemeContrast() {
        const inline = document.body.style;
        for (const property of ['--text-muted', '--pill-text', '--focus-ring']) inline.removeProperty(property);
        const computed = getComputedStyle(document.body);
        const baseValue = computed.getPropertyValue('--bg-base').trim();
        const surfaceValue = computed.getPropertyValue('--bg-surface').trim();
        const mainValue = computed.getPropertyValue('--text-main').trim();
        const mutedValue = computed.getPropertyValue('--text-muted').trim();
        const accentValue = computed.getPropertyValue('--accent').trim();
        const pillValue = computed.getPropertyValue('--pill-text').trim();
        const base = parseCssColor(baseValue);
        const surface = parseCssColor(surfaceValue);
        const main = parseCssColor(mainValue);
        const muted = parseCssColor(mutedValue);
        const accent = parseCssColor(accentValue);
        const pill = parseCssColor(pillValue);
        const readableCandidates = [
            { value: mainValue, rgb: main },
            { value: '#000', rgb: [0, 0, 0] },
            { value: '#fff', rgb: [255, 255, 255] }
        ];
        const readable = readableCandidates.sort((a, b) =>
            Math.min(contrastRatio(b.rgb, base), contrastRatio(b.rgb, surface))
            - Math.min(contrastRatio(a.rgb, base), contrastRatio(a.rgb, surface))
        )[0];

        if (Math.min(contrastRatio(muted, base), contrastRatio(muted, surface)) < 4.5) {
            inline.setProperty('--text-muted', readable.value);
        }

        const focusColor = Math.min(contrastRatio(accent, base), contrastRatio(accent, surface)) >= 3
            ? accentValue
            : readable.value;
        inline.setProperty('--focus-ring', focusColor);

        if (contrastRatio(accent, pill) < 4.5) {
            const black = [0, 0, 0];
            const white = [255, 255, 255];
            inline.setProperty('--pill-text', contrastRatio(accent, white) >= contrastRatio(accent, black) ? '#fff' : '#000');
        }
    }

    function applyTheme(themeName) {
        document.documentElement.setAttribute('data-theme', themeName);
        document.body.setAttribute('data-theme', themeName);
        enforceThemeContrast();
        safeStore('theme', themeName);
        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.content = getComputedStyle(document.body).getPropertyValue('--bg-base').trim() || '#e8ecf0';
    }

    // ── Export / Import ───────────────────────────────────
    function downloadFile(filename, content, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.hidden = true;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const exportModal = document.getElementById('export-modal');
    const importFileInput = document.getElementById('import-file-input');

    // Open export modal — context-aware
    let exportContext = 'library'; // 'library' or 'video'
    const scopeToggleWrap = document.getElementById('exp-scope-toggle-wrap');
    const exportScopeLabel = document.getElementById('export-scope-label');
    const exportModalTitle = document.getElementById('export-modal-title');

    document.querySelectorAll('.open-export-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            pauseVideoPlayback();
            const onVideo = state.currentVideo && elements.videoView.style.display !== 'none';
            exportContext = onVideo ? 'video' : 'library';

            if (exportContext === 'video') {
                exportModalTitle.textContent = 'Export — ' + state.currentVideo.title;
                exportScopeLabel.textContent = 'Exporting for this video:';
                document.getElementById('exp-bookmarks-label').textContent = 'This video\'s bookmarks & notes';
                document.getElementById('exp-summaries-label').textContent = 'This video\'s summary';
                document.getElementById('exp-summaries').checked = true;
                document.getElementById('exp-favorites').checked = false;
                document.getElementById('exp-watch-history').checked = false;
                document.getElementById('exp-entire-library').checked = false;
                scopeToggleWrap.style.display = 'flex';
            } else {
                exportModalTitle.textContent = 'Export / Import';
                exportScopeLabel.textContent = 'Exporting entire library:';
                document.getElementById('exp-bookmarks-label').textContent = 'All bookmarks & notes';
                document.getElementById('exp-summaries-label').textContent = 'All video summaries';
                document.getElementById('exp-summaries').checked = false;
                document.getElementById('exp-favorites').checked = true;
                document.getElementById('exp-watch-history').checked = false;
                document.getElementById('exp-entire-library').checked = false;
                scopeToggleWrap.style.display = 'none';
            }
            document.getElementById('exp-bookmarks').checked = true;
            exportModal.style.display = 'flex';
        });
    });

    document.getElementById('close-export-modal').addEventListener('click', () => {
        exportModal.style.display = 'none';
    });
    exportModal.addEventListener('click', (e) => {
        if (e.target === exportModal) exportModal.style.display = 'none';
    });

    // Export logic
    document.getElementById('do-export').addEventListener('click', async (event) => {
        const includeBookmarks = document.getElementById('exp-bookmarks').checked;
        const includeFavorites = document.getElementById('exp-favorites').checked;
        const includeSummaries = document.getElementById('exp-summaries').checked;
        const includeWatchHistory = document.getElementById('exp-watch-history').checked;
        const expandToLibrary = document.getElementById('exp-entire-library').checked;
        const currentVideoOnly = exportContext === 'video' && !expandToLibrary;
        const format = document.querySelector('input[name="export-format"]:checked').value;

        if (includeSummaries) {
            const exportButton = event.currentTarget;
            const originalLabel = exportButton.textContent;
            exportButton.disabled = true;
            exportButton.setAttribute('aria-busy', 'true');
            exportButton.textContent = currentVideoOnly ? 'Loading analysis…' : 'Loading all analyses…';
            try {
                if (currentVideoOnly && state.currentVideo) await ensureSummaryForVideo(state.currentVideo);
                else await ensureAllSummaries();
            } catch (error) {
                console.warn('Could not prepare summaries for export:', error);
                showToast('Summaries could not be loaded. Check your connection and try again.', 6000, true);
                return;
            } finally {
                exportButton.disabled = false;
                exportButton.removeAttribute('aria-busy');
                exportButton.textContent = originalLabel;
            }
        }

        const date = new Date().toISOString().slice(0, 10);

        if (format === 'json') {
            // JSON backup
            const data = { exportedAt: new Date().toISOString() };

            if (includeBookmarks) {
                const allBk = safeLoad('videoBookmarks', {});
                if (currentVideoOnly && state.currentVideo) {
                    const path = state.currentVideo.path;
                    data.videoBookmarks = allBk[path] ? { [path]: allBk[path] } : {};
                } else {
                    data.videoBookmarks = allBk;
                }
            }
            if (includeFavorites) {
                data.favoriteVideos = safeLoad('favoriteVideos', []);
            }
            if (includeWatchHistory) {
                data.watchedVideos = safeLoad('watchedVideos', []);
                data.videoPositions = safeLoad('videoPositions', {});
                data.videoLastWatched = safeLoad('videoLastWatched', {});
            }
            if (includeSummaries) {
                if (currentVideoOnly && state.currentVideo) {
                    const info = videoData[state.currentVideo.path];
                    data.summaries = info ? { [state.currentVideo.path]: info.summary || '' } : {};
                } else {
                    const summaries = {};
                    for (const [path, info] of Object.entries(videoData)) {
                        if (info.summary) summaries[path] = info.summary;
                    }
                    data.summaries = summaries;
                }
            }
            data.theme = safeGet('theme', 'arctic');

            downloadFile(`dance-library-${date}.json`, JSON.stringify(data, null, 2), 'application/json');
        } else {
            // Markdown
            let md = '# Dance Library Notes\n\n';
            md += `_Exported ${new Date().toLocaleDateString()}_\n\n`;

            // Determine which video paths to include
            let videoPaths = null; // null = all
            if (currentVideoOnly && state.currentVideo) {
                videoPaths = [state.currentVideo.path];
            }

            // Favorites
            if (includeFavorites) {
                const favorites = safeLoad('favoriteVideos', []);
                const filtered = videoPaths ? favorites.filter(f => videoPaths.includes(f)) : favorites;
                if (filtered.length > 0) {
                    md += '## Favorites\n\n';
                    for (const fav of filtered) {
                        const parts = fav.split('/');
                        const filename = parts.pop();
            const title = titleFromFilename(filename);
                        md += `- **${title}** — _${parts.join(' / ')}_\n`;
                    }
                    md += '\n';
                }
            }

            // Bookmarks & Notes
            if (includeBookmarks) {
                const allBookmarks = safeLoad('videoBookmarks', {});
                const paths = (videoPaths || Object.keys(allBookmarks)).filter(p => {
                    const arr = allBookmarks[p];
                    return Array.isArray(arr) && arr.length > 0;
                });

                if (paths.length > 0) {
                    md += '## Bookmarks & Notes\n\n';
                    for (const videoPath of paths) {
                        let bookmarks = allBookmarks[videoPath];
                        if (!bookmarks) continue;
                        if (bookmarks.length > 0 && typeof bookmarks[0] === 'number') {
                            bookmarks = bookmarks.map(t => ({ t, n: '' }));
                        }
                        bookmarks.sort((a, b) => a.t - b.t);

                        const parts = videoPath.split('/');
                        const filename = parts.pop();
            const title = titleFromFilename(filename);

                        md += `### ${title}\n`;
                        md += `_${parts.join(' / ')}_\n\n`;

                        for (const bk of bookmarks) {
                            const time = formatTime(bk.t);
                            if (bk.n) {
                                md += `- **[${time}]** ${bk.n}\n`;
                            } else {
                                md += `- [${time}]\n`;
                            }
                        }
                        md += '\n';
                    }
                }
            }

            // Summaries
            if (includeSummaries) {
                const pathsToExport = videoPaths || Object.keys(videoData);
                const withSummaries = pathsToExport.filter(p => videoData[p] && videoData[p].summary);

                if (withSummaries.length > 0) {
                    md += '## Video Summaries\n\n';
                    for (const videoPath of withSummaries) {
                        const parts = videoPath.split('/');
                        const filename = parts.pop();
            const title = titleFromFilename(filename);

                        md += `### ${title}\n`;
                        md += `_${parts.join(' / ')}_\n\n`;
                        md += videoData[videoPath].summary + '\n\n';
                    }
                }
            }

            // Watch history
            if (includeWatchHistory) {
                const watched = safeLoad('watchedVideos', []);
                const filtered = videoPaths ? watched.filter(w => videoPaths.includes(w)) : watched;
                if (filtered.length > 0) {
                    md += '## Watch History\n\n';
                    for (const w of filtered) {
                        const parts = w.split('/');
                        const title = titleFromFilename(parts.pop());
                        const ago = state.lastWatched[w] ? ' — ' + timeAgo(state.lastWatched[w]) : '';
                        md += `- ${title}${ago}\n`;
                    }
                    md += '\n';
                }
            }

            const suffix = currentVideoOnly && state.currentVideo
                ? state.currentVideo.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30)
                : 'all';
            downloadFile(`dance-notes-${suffix}-${date}.md`, md, 'text/markdown');
        }

        exportModal.style.display = 'none';
    });

    // Import
    document.getElementById('do-import').addEventListener('click', () => {
        importFileInput.click();
    });

    function validateBackupData(data) {
        if (!isRecord(data)) throw new TypeError('Backup root must be an object.');
        const recognized = ['watchedVideos', 'videoBookmarks', 'favoriteVideos', 'videoPositions', 'videoLastWatched'];
        if (!recognized.some(key => data[key] !== undefined)) {
            throw new TypeError('No recognizable Dance Library data was found.');
        }

        for (const key of recognized) {
            if (data[key] === undefined) continue;
            const validator = storageValidators[key];
            if (validator && !validator(data[key])) throw new TypeError(`Invalid ${key} data.`);
        }
        if (data.theme !== undefined && typeof data.theme !== 'string') throw new TypeError('Invalid theme value.');
        return data;
    }

    importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
            alert('This backup is too large to import safely.');
            importFileInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = validateBackupData(JSON.parse(evt.target.result));

                if (!confirm('Import this backup? This will MERGE with your existing data (not replace it). Continue?')) return;

                if (Array.isArray(data.watchedVideos)) {
                    const existing = new Set(safeLoad('watchedVideos', []));
                    data.watchedVideos.forEach(v => existing.add(v));
                    safeStore('watchedVideos', JSON.stringify([...existing]));
                    existing.forEach(v => state.watched.add(v));
                }

                if (data.videoBookmarks && typeof data.videoBookmarks === 'object') {
                    const existing = safeLoad('videoBookmarks', {});
                    for (const [path, bks] of Object.entries(data.videoBookmarks)) {
                        if (!existing[path]) {
                            existing[path] = bks;
                        } else {
                            const existingTimes = new Set(existing[path].map(b => typeof b === 'object' ? b.t : b));
                            for (const bk of bks) {
                                const t = typeof bk === 'object' ? bk.t : bk;
                                if (!existingTimes.has(t)) existing[path].push(bk);
                            }
                        }
                    }
                    safeStore('videoBookmarks', JSON.stringify(existing));
                }

                if (Array.isArray(data.favoriteVideos)) {
                    const existing = new Set(safeLoad('favoriteVideos', []));
                    data.favoriteVideos.forEach(v => existing.add(v));
                    safeStore('favoriteVideos', JSON.stringify([...existing]));
                    existing.forEach(v => state.favorites.add(v));
                }

                if (data.videoPositions && typeof data.videoPositions === 'object') {
                    const existing = safeLoad('videoPositions', {});
                    for (const [path, pos] of Object.entries(data.videoPositions)) {
                        if (!existing[path] || pos > existing[path]) existing[path] = pos;
                    }
                    safeStore('videoPositions', JSON.stringify(existing));
                }

                if (data.videoLastWatched && typeof data.videoLastWatched === 'object') {
                    for (const [path, ts] of Object.entries(data.videoLastWatched)) {
                        if (!state.lastWatched[path] || ts > state.lastWatched[path]) state.lastWatched[path] = ts;
                    }
                    safeStore('videoLastWatched', JSON.stringify(state.lastWatched));
                }

                if (typeof data.theme === 'string' && [...elements.themeSelect.options].some(option => option.value === data.theme)) {
                    state.theme = data.theme;
                    elements.themeSelect.value = data.theme;
                    safeStore('theme', data.theme);
                    applyTheme(data.theme);
                }

                renderNavigation();
                renderHomeTiles(null, []);
                if (state.currentVideo) renderBookmarks();
                updateNotesBadge();
                exportModal.style.display = 'none';
                alert('Import complete! Your data has been merged.');
            } catch (err) {
                alert('Error reading file: ' + err.message);
            }
        };
        reader.onerror = () => { alert('Could not read file. Please try again.'); };
        reader.readAsText(file);
        importFileInput.value = '';
    });

    // ── A-B Loop ──────────────────────────────────────────
    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return m + ':' + String(s).padStart(2, '0');
    }

    function clearABLoop() {
        state.loopA = null;
        state.loopB = null;
        const btn = elements.abLoopBtn;
        btn.textContent = 'A–B';
        btn.className = 'overlay-btn';
        btn.title = 'A-B Loop: set start [ set end ] clear Esc';
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', 'Set A-B loop start');
    }

    function setLoopA() {
        const video = elements.videoPlayer;
        if (isNaN(video.duration)) return;
        state.loopA = video.currentTime;
        state.loopB = null;
        elements.abLoopBtn.textContent = 'A ' + formatTime(video.currentTime);
        elements.abLoopBtn.className = 'overlay-btn loop-a-set';
        elements.abLoopBtn.title = 'A-B Loop: Click to set end point (B)';
        elements.abLoopBtn.setAttribute('aria-pressed', 'false');
        elements.abLoopBtn.setAttribute('aria-label', 'Set A-B loop end');
    }

    function setLoopB() {
        const video = elements.videoPlayer;
        if (isNaN(video.duration) || state.loopA === null) return;
        let a = state.loopA;
        let b = video.currentTime;
        if (b < a) { const tmp = a; a = b; b = tmp; }
        if (b - a < 0.5) { b = a + 0.5; }
        state.loopA = a;
        state.loopB = b;
        elements.abLoopBtn.textContent = formatTime(a) + ' \u2192 ' + formatTime(b);
        elements.abLoopBtn.className = 'overlay-btn loop-active';
        elements.abLoopBtn.title = 'A-B Loop active. Click to clear.';
        elements.abLoopBtn.setAttribute('aria-pressed', 'true');
        elements.abLoopBtn.setAttribute('aria-label', 'Clear active A-B loop');
        video.currentTime = a;
        requestVideoPlayback('A-B loop');
    }

    function handleABLoopClick() {
        if (state.loopA === null) {
            setLoopA();
        } else if (state.loopB === null) {
            setLoopB();
        } else {
            clearABLoop();
        }
    }

    // Single timeupdate handler — bound once, never stacked
    let lastSaveTime = 0;
    elements.videoPlayer.addEventListener('timeupdate', function() {
        // A-B Loop
        if (state.loopA !== null && state.loopB !== null) {
            if (this.currentTime >= state.loopB) {
                this.currentTime = state.loopA;
            }
        }
        // Resume: save position every 3 seconds
        const now = Date.now();
        if (state.currentVideo && now - lastSaveTime > 3000) {
            lastSaveTime = now;
            const t = this.currentTime;
            const d = this.duration;
            if (!isNaN(d) && t > 5 && t < d - 5) {
                const positions = safeLoad('videoPositions', {});
                positions[state.currentVideo.path] = Math.floor(t);
                safeStore('videoPositions', JSON.stringify(positions));
            }
        }
    });

    elements.abLoopBtn.addEventListener('click', handleABLoopClick);

    // ── Speed Persistence ────────────────────────────────
    elements.videoPlayer.addEventListener('playing', function() {
        if (state.playbackSpeed !== 1.0 && this.playbackRate !== state.playbackSpeed) {
            this.playbackRate = state.playbackSpeed;
        }
    });

    // ── Mirror Mode ──────────────────────────────────────
    elements.mirrorBtn.addEventListener('click', () => {
        state.mirrored = !state.mirrored;
        elements.videoPlayer.classList.toggle('mirrored', state.mirrored);
        elements.mirrorBtn.classList.toggle('mirror-active', state.mirrored);
        elements.mirrorBtn.setAttribute('aria-pressed', String(state.mirrored));
        elements.mirrorBtn.setAttribute('aria-label', state.mirrored ? 'Turn off mirrored video' : 'Mirror video');
    });

    // ── Skip Controls ────────────────────────────────────
    elements.skipBackBtn.addEventListener('click', () => {
        const v = elements.videoPlayer;
        if (!isNaN(v.duration)) v.currentTime = Math.max(0, v.currentTime - 5);
    });

    elements.skipFwdBtn.addEventListener('click', () => {
        const v = elements.videoPlayer;
        if (!isNaN(v.duration)) v.currentTime = Math.min(v.duration, v.currentTime + 5);
    });

    // ── Bookmarks (with optional notes) ────────────────
    // Data format: [{t: seconds, n: "note text"}, ...]
    // Migrates from old format [seconds, ...] on first read

    const bookmarkEditRow = document.getElementById('bookmark-edit-row');
    const bookmarkEditInput = document.getElementById('bookmark-edit-input');
    const bookmarkEditLabel = document.getElementById('bookmark-edit-label');
    let editingBookmarkIdx = null;

    function getBookmarks(videoPath) {
        const all = safeLoad('videoBookmarks', {});
        let arr = all[videoPath] || [];
        // Migrate old format: [number, ...] → [{t, n}, ...]
        if (arr.length > 0 && typeof arr[0] === 'number') {
            arr = arr.map(t => ({ t: t, n: '' }));
            all[videoPath] = arr;
            safeStore('videoBookmarks', JSON.stringify(all));
        }
        return arr.sort((a, b) => a.t - b.t);
    }

    function saveBookmarksToStorage(videoPath, bookmarks) {
        const all = safeLoad('videoBookmarks', {});
        if (bookmarks.length === 0) {
            delete all[videoPath];
        } else {
            all[videoPath] = bookmarks;
        }
        safeStore('videoBookmarks', JSON.stringify(all));
    }

    function renderBookmarks() {
        if (!state.currentVideo) return;
        const bookmarks = getBookmarks(state.currentVideo.path);
        elements.bookmarksList.innerHTML = '';
        closeBookmarkEdit();

        if (bookmarks.length === 0) {
            elements.bookmarksList.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);opacity:0.6;">No bookmarks yet</span>';
            return;
        }

        bookmarks.forEach((bk, idx) => {
            const pill = document.createElement('span');
            pill.className = 'bookmark-pill';
            pill.setAttribute('role', 'group');
            pill.dataset.time = bk.t;
            pill.dataset.index = idx;
            const noteText = bk.n ? ` <span class="bookmark-note-text">\u2014 ${bk.n.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>` : '';
            pill.innerHTML = `<button type="button" class="bookmark-open" aria-label="Play from ${formatTime(bk.t)}"><span class="bookmark-time-text">${formatTime(bk.t)}</span>${noteText}</button><button type="button" class="bookmark-edit-icon" data-idx="${idx}" aria-label="Edit bookmark note">&#9998;</button><button type="button" class="bookmark-delete" data-idx="${idx}" aria-label="Delete bookmark">&times;</button>`;
            elements.bookmarksList.appendChild(pill);
        });
        updateNotesBadge();
    }

    function openBookmarkEdit(idx) {
        const bookmarks = getBookmarks(state.currentVideo.path);
        if (idx < 0 || idx >= bookmarks.length) return;
        editingBookmarkIdx = idx;
        const bk = bookmarks[idx];
        bookmarkEditLabel.textContent = formatTime(bk.t);
        bookmarkEditInput.value = bk.n || '';
        bookmarkEditInput.placeholder = 'Note for ' + formatTime(bk.t) + ' (optional, Enter to save)';
        bookmarkEditRow.style.display = 'flex';
        bookmarkEditInput.focus();
    }

    function closeBookmarkEdit() {
        bookmarkEditRow.style.display = 'none';
        editingBookmarkIdx = null;
        bookmarkEditInput.value = '';
    }

    function saveBookmarkNote() {
        if (editingBookmarkIdx === null || !state.currentVideo) return;
        const bookmarks = getBookmarks(state.currentVideo.path);
        if (editingBookmarkIdx >= bookmarks.length) return;
        bookmarks[editingBookmarkIdx].n = bookmarkEditInput.value.trim();
        if (bookmarkEditInput.value.trim()) bookmarks[editingBookmarkIdx].ts = Date.now();
        saveBookmarksToStorage(state.currentVideo.path, bookmarks);
        renderBookmarks();
    }

    bookmarkEditInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveBookmarkNote();
        } else if (e.key === 'Escape') {
            closeBookmarkEdit();
        }
    });

    bookmarkEditInput.addEventListener('blur', () => {
        // Save on blur if there's text, otherwise just close
        if (bookmarkEditInput.value.trim()) {
            saveBookmarkNote();
        } else {
            closeBookmarkEdit();
        }
    });

    elements.addBookmarkBtn.addEventListener('click', () => {
        const v = elements.videoPlayer;
        if (!state.currentVideo || isNaN(v.duration)) return;
        const time = Math.round(v.currentTime * 10) / 10;
        const bookmarks = getBookmarks(state.currentVideo.path);
        // Don't add duplicates (within 1s)
        if (bookmarks.some(bk => Math.abs(bk.t - time) < 1)) return;
        bookmarks.push({ t: time, n: '', ts: Date.now() });
        saveBookmarksToStorage(state.currentVideo.path, bookmarks);
        renderBookmarks();
        // Auto-open edit for the newly added bookmark
        const sorted = getBookmarks(state.currentVideo.path);
        const newIdx = sorted.findIndex(bk => Math.abs(bk.t - time) < 1);
        if (newIdx !== -1) openBookmarkEdit(newIdx);
    });

    elements.bookmarksList.addEventListener('click', (e) => {
        // Edit icon clicked
        const editIcon = e.target.closest('.bookmark-edit-icon');
        if (editIcon) {
            e.stopPropagation();
            openBookmarkEdit(parseInt(editIcon.dataset.idx));
            return;
        }
        // Delete button clicked
        const deleteBtn = e.target.closest('.bookmark-delete');
        if (deleteBtn) {
            e.stopPropagation();
            const idx = parseInt(deleteBtn.dataset.idx);
            const bookmarks = getBookmarks(state.currentVideo.path);
            bookmarks.splice(idx, 1);
            saveBookmarksToStorage(state.currentVideo.path, bookmarks);
            renderBookmarks();
            return;
        }
        // Pill clicked — seek to time
        const openButton = e.target.closest('.bookmark-open');
        const pill = openButton && openButton.closest('.bookmark-pill');
        if (pill) {
            const time = parseFloat(pill.dataset.time);
            elements.videoPlayer.currentTime = time;
            requestVideoPlayback('bookmark');
        }
    });

    // ── Speed Presets (Learn / Practice / Full) ─────────
    function setSpeed(speed) {
        state.playbackSpeed = speed;
        elements.videoPlayer.playbackRate = speed;
        // Update the overlay dropdown to match
        elements.currentSpeedBtn.innerText = speed.toFixed(2).replace(/\.00$/, '.0') + 'x';
        elements.currentSpeedBtn.setAttribute('aria-label', `Playback speed, ${elements.currentSpeedBtn.innerText}`);
        elements.speedDropdownBtns.forEach(b => {
            const active = parseFloat(b.dataset.speed) === speed;
            b.classList.toggle('active', active);
            b.setAttribute('aria-checked', String(active));
        });
        // Update preset buttons
        elements.speedPresetBtns.forEach(b => {
            const active = parseFloat(b.dataset.speed) === speed;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', String(active));
        });
    }

    elements.speedPresetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            setSpeed(parseFloat(btn.dataset.speed));
        });
    });

    // ── Favorites ────────────────────────────────────────
    function updateFavBtn() {
        if (!state.currentVideo) return;
        const isFav = state.favorites.has(state.currentVideo.path);
        elements.favIcon.setAttribute('fill', isFav ? 'currentColor' : 'none');
        elements.favBtn.classList.toggle('fav-active', isFav);
        elements.favBtn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
        elements.favBtn.setAttribute('aria-pressed', String(isFav));
        elements.favBtn.setAttribute('aria-label', elements.favBtn.title);
    }

    elements.favBtn.addEventListener('click', () => {
        if (!state.currentVideo) return;
        const path = state.currentVideo.path;
        if (state.favorites.has(path)) {
            state.favorites.delete(path);
        } else {
            state.favorites.add(path);
        }
        safeStore('favoriteVideos', JSON.stringify([...state.favorites]));
        updateFavBtn();
        updateNotesBadge();
        updateHomeStats();
    });

    // ── Notes & Favorites View ─────────────────────────
    const notesView = document.getElementById('notes-view');
    const notesContent = document.getElementById('notes-content');
    const notesSubtitle = document.getElementById('notes-subtitle');

    function showNotesView() {
        pauseVideoPlayback();
        pendingUnfavorites = new Set();
        notesView.style.display = 'flex';
        renderNotesView();
        markNotesSeen();
    }

    function closeNotesView(options = {}) {
        if (options.restoreFocus === false) suppressDialogFocusReturn(notesView);
        notesView.style.display = 'none';
    }

    function resolveVideoObj(videoPath) {
        const info = videoData[videoPath];
        if (!info) return null;
        const parts = videoPath.split('/');
        const filename = parts.pop();
            const title = titleFromFilename(filename);
        return { title, path: videoPath, folderPath: parts.join(' / '), ...info };
    }

    // Track unfavorited items during this notes view session (soft delete)
    let pendingUnfavorites = new Set();
    let notesFilterMode = 'all'; // 'all' or 'notes-only'

    function renderNotesView() {
        notesContent.innerHTML = '';
        const allBookmarks = safeLoad('videoBookmarks', {});

        // Count totals for subtitle
        let totalNotes = 0;
        let totalBookmarks = 0;
        for (const arr of Object.values(allBookmarks)) {
            if (!Array.isArray(arr) || arr.length === 0) continue;
            totalBookmarks += arr.length;
            if (typeof arr[0] === 'object') {
                totalNotes += arr.filter(b => b.n).length;
            }
        }
        const subtitleParts = [];
        if (totalNotes > 0) subtitleParts.push(totalNotes + ' note' + (totalNotes !== 1 ? 's' : ''));
        if (totalBookmarks > 0) subtitleParts.push(totalBookmarks + ' bookmark' + (totalBookmarks !== 1 ? 's' : ''));
        notesSubtitle.textContent = subtitleParts.length > 0 ? subtitleParts.join(' \u00B7 ') : '';

        // Search query from notes search bar
        const sq = notesSearchQuery;

        // ── Bookmarks & Notes Section ──
        const bookmarkPaths = Object.keys(allBookmarks).filter(p => {
            const arr = allBookmarks[p];
            if (!Array.isArray(arr) || arr.length === 0) return false;
            if (!sq) return true;
            // Match against video title, path, or note text
            const searchStr = p.toLowerCase();
            if (searchStr.includes(sq)) return true;
            return arr.some(bk => typeof bk === 'object' && bk.n && bk.n.toLowerCase().includes(sq));
        });

        // Sort by most bookmarks first
        bookmarkPaths.sort((a, b) => {
            return allBookmarks[b].length - allBookmarks[a].length;
        });

        if (bookmarkPaths.length > 0) {
            const section = document.createElement('div');
            section.className = 'notes-section';

            // Header with filter toggle
            const headerHtml = `<div class="notes-section-title" style="justify-content: space-between;">
                <span>&#9998; Bookmarks &amp; Notes</span>
                <div class="notes-filter-toggle">
                    <button type="button" class="notes-filter-btn ${notesFilterMode === 'all' ? 'active' : ''}" data-filter="all" aria-pressed="${notesFilterMode === 'all'}">All</button>
                    <button type="button" class="notes-filter-btn ${notesFilterMode === 'notes-only' ? 'active' : ''}" data-filter="notes-only" aria-pressed="${notesFilterMode === 'notes-only'}">With notes</button>
                </div>
            </div>`;
            section.innerHTML = headerHtml;

            let hasVisibleItems = false;

            for (const videoPath of bookmarkPaths) {
                let bookmarks = allBookmarks[videoPath];
                if (!Array.isArray(bookmarks) || bookmarks.length === 0) continue;
                if (typeof bookmarks[0] === 'number') {
                    bookmarks = bookmarks.map(t => ({ t, n: '' }));
                }
                bookmarks.sort((a, b) => a.t - b.t);

                // Apply filter
                const filtered = notesFilterMode === 'notes-only' ? bookmarks.filter(bk => bk.n) : bookmarks;
                if (filtered.length === 0) continue;

                hasVisibleItems = true;
                const videoObj = resolveVideoObj(videoPath);
                if (!videoObj) continue;

                const group = document.createElement('div');
                group.className = 'notes-video-group';

                let itemsHtml = '';
                filtered.forEach((bk) => {
                    // Find the real index in the full (unfiltered) sorted array
                    const realIdx = bookmarks.findIndex(b => b.t === bk.t && b.n === bk.n);
                    const escapedNote = (bk.n || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    const hasNote = !!bk.n;
                    const noteAgo = bk.ts ? `<span class="notes-bookmark-ago">${timeAgo(bk.ts)}</span>` : '';
                    const noteHtml = hasNote
                        ? `<span class="notes-bookmark-note">${escapedNote}</span>${noteAgo}`
                        : '<span class="notes-bookmark-notext">No note</span>';
                    itemsHtml += `<div class="notes-bookmark-item ${hasNote ? 'has-note' : ''}" data-path="${videoPath}" data-time="${bk.t}" data-bk-idx="${realIdx}" role="group">
                        <div class="notes-bookmark-open" role="button" tabindex="0" data-path="${videoPath}" data-time="${bk.t}">
                            <span class="notes-bookmark-time">${formatTime(bk.t)}</span>
                            <span class="notes-bookmark-text-wrap">${noteHtml}</span>
                        </div>
                        <span class="notes-item-actions">
                            <button type="button" class="notes-item-copy" data-path="${videoPath}" data-time="${bk.t}" data-note="${escapedNote}" aria-label="Copy note">&#128203;</button>
                            <button type="button" class="notes-item-edit" data-path="${videoPath}" data-bk-idx="${realIdx}" data-note="${escapedNote}" aria-label="Edit note">&#9998;</button>
                            <button type="button" class="notes-item-delete" data-path="${videoPath}" data-bk-idx="${realIdx}" aria-label="Delete bookmark">&times;</button>
                        </span>
                    </div>`;
                });

                group.innerHTML = `
                    <div class="notes-video-header">
                        <div>
                            <button type="button" class="notes-video-title" data-path="${videoPath}">${videoObj.title}</button>
                            <div class="notes-video-path">${videoObj.folderPath}</div>
                        </div>
                    </div>
                    ${itemsHtml}
                `;
                section.appendChild(group);
            }

            if (!hasVisibleItems && notesFilterMode === 'notes-only') {
                section.innerHTML += '<div class="notes-empty">No bookmarks with notes yet. Add notes to your bookmarks from the video page.</div>';
            }

            notesContent.appendChild(section);
        }

        // Favorites are now in their own separate modal

        // ── Empty State ──
        if (bookmarkPaths.length === 0) {
            notesContent.innerHTML = '<div class="notes-empty">No bookmarks or notes yet. Watch a video and use the bookmark button to start.</div>';
        }
        updateNotesBadge();
    }

    function handleNotesClick(e) {
        // Filter toggle buttons
        const filterBtn = e.target.closest('.notes-filter-btn');
        if (filterBtn) {
            e.stopPropagation();
            notesFilterMode = filterBtn.dataset.filter;
            renderNotesView();
            return;
        }

        // Copy icon → copy note to clipboard
        const copyIcon = e.target.closest('.notes-item-copy');
        if (copyIcon) {
            e.stopPropagation();
            const videoPath = copyIcon.dataset.path;
            const time = formatTime(parseFloat(copyIcon.dataset.time));
            const note = copyIcon.dataset.note || '';
            const videoObj = resolveVideoObj(videoPath);
            const videoTitle = videoObj ? videoObj.title : '';
            const folder = videoObj ? videoObj.folderPath : '';
            const text = note
                ? `${time} — "${note}" — ${videoTitle} (${folder})`
                : `${time} — ${videoTitle} (${folder})`;
            copyText(text).then(copied => {
                if (!copied) {
                    showToast('Copy is unavailable in this browser.', 4000, true);
                    return;
                }
                copyIcon.textContent = '✓';
                setTimeout(() => { copyIcon.textContent = '📋'; }, 1500);
            });
            return;
        }

        // Edit icon → inline edit
        const editIcon = e.target.closest('.notes-item-edit');
        if (editIcon) {
            e.stopPropagation();
            const item = editIcon.closest('.notes-bookmark-item');
            const textWrap = item.querySelector('.notes-bookmark-text-wrap');
            const openTarget = item.querySelector('.notes-bookmark-open');
            openTarget.removeAttribute('role');
            openTarget.removeAttribute('tabindex');
            const currentNote = editIcon.dataset.note || '';
            const videoPath = editIcon.dataset.path;
            const bkIdx = parseInt(editIcon.dataset.bkIdx);

            // Replace text with a labelled input without interpolating note text into HTML.
            textWrap.innerHTML = '';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'notes-inline-edit';
            input.value = currentNote;
            input.placeholder = 'Add a note...';
            input.maxLength = 120;
            const videoObj = resolveVideoObj(videoPath);
            const context = videoObj ? ` for ${videoObj.title}` : '';
            input.setAttribute('aria-label', `Edit note at ${formatTime(parseFloat(item.dataset.time))}${context}`);
            textWrap.appendChild(input);
            input.focus();
            input.selectionStart = input.value.length;

            let saved = false;
            const saveEdit = () => {
                if (saved) return;
                saved = true;
                const newNote = input.value.trim();
                const allBk = safeLoad('videoBookmarks', {});
                let arr = allBk[videoPath] || [];
                if (arr.length > 0 && typeof arr[0] === 'number') {
                    arr = arr.map(t => ({ t, n: '' }));
                }
                arr.sort((a, b) => a.t - b.t);
                if (bkIdx < arr.length) {
                    arr[bkIdx].n = newNote;
                    if (newNote) arr[bkIdx].ts = Date.now();
                    allBk[videoPath] = arr;
                    safeStore('videoBookmarks', JSON.stringify(allBk));
                }
                renderNotesView();
                if (elements.homeView.style.display !== 'none') renderHomeTiles(null, []);
            };

            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); saveEdit(); }
                else if (ev.key === 'Escape') { renderNotesView(); }
            });
            input.addEventListener('blur', saveEdit);
            return;
        }

        // Delete icon → remove bookmark
        const deleteIcon = e.target.closest('.notes-item-delete');
        if (deleteIcon) {
            e.stopPropagation();
            const videoPath = deleteIcon.dataset.path;
            const bkIdx = parseInt(deleteIcon.dataset.bkIdx);
            const allBk = safeLoad('videoBookmarks', {});
            let arr = allBk[videoPath] || [];
            if (arr.length > 0 && typeof arr[0] === 'number') {
                arr = arr.map(t => ({ t, n: '' }));
            }
            arr.sort((a, b) => a.t - b.t);
            arr.splice(bkIdx, 1);
            if (arr.length === 0) {
                delete allBk[videoPath];
            } else {
                allBk[videoPath] = arr;
            }
            safeStore('videoBookmarks', JSON.stringify(allBk));
            renderNotesView();
            updateNotesBadge();
            if (elements.homeView.style.display !== 'none') renderHomeTiles(null, []);
            return;
        }

        // Bookmark item → load video + seek
        const openButton = e.target.closest('.notes-bookmark-open');
        const bookmarkItem = openButton && openButton.closest('.notes-bookmark-item');
        if (bookmarkItem) {
            const videoObj = resolveVideoObj(bookmarkItem.dataset.path);
            if (videoObj) {
                const seekTime = parseFloat(bookmarkItem.dataset.time);
                closeNotesView({ restoreFocus: false });
                loadVideo(videoObj, { seekTime });
            }
            return;
        }

        // Video title → load video
        const videoTitle = e.target.closest('.notes-video-title');
        if (videoTitle) {
            const videoObj = resolveVideoObj(videoTitle.dataset.path);
            if (videoObj) {
                closeNotesView({ restoreFocus: false });
                loadVideo(videoObj);
            }
            return;
        }

    }

    // Notes view click delegation — bound once
    notesContent.addEventListener('click', handleNotesClick);
    notesContent.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = event.target.closest('.notes-bookmark-open');
        if (!target || event.target !== target) return;
        event.preventDefault();
        target.click();
    });

    // Notes button in sidebar
    document.getElementById('notes-sidebar-btn').addEventListener('click', () => {
        showNotesView();
        if (usesCompactLayout()) {
            setSidebarOpen(false, { restoreFocus: false });
        }
    });

    // ── Theater Mode ─────────────────────────────────────
    const theaterBtn = document.getElementById('theater-btn');
    let theaterMode = false;

    function toggleTheater() {
        theaterMode = !theaterMode;
        document.body.classList.toggle('theater-mode', theaterMode);
        theaterBtn.classList.toggle('theater-active', theaterMode);
        theaterBtn.setAttribute('aria-pressed', String(theaterMode));
        theaterBtn.setAttribute('aria-label', theaterMode ? 'Exit theater mode' : 'Enter theater mode');
    }

    theaterBtn.addEventListener('click', toggleTheater);

    // ── Spotlight Search ─────────────────────────────────
    const spotlightOverlay = document.getElementById('spotlight-overlay');
    const spotlightInput = document.getElementById('spotlight-input');
    const spotlightResults = document.getElementById('spotlight-results');
    let spotlightActive = -1;

    function openSpotlight() {
        pauseVideoPlayback();
        spotlightOverlay.style.display = 'flex';
        spotlightInput.value = '';
        spotlightResults.innerHTML = '';
        spotlightActive = -1;
        spotlightInput.setAttribute('aria-expanded', 'true');
        spotlightInput.removeAttribute('aria-activedescendant');
        setTimeout(() => spotlightInput.focus(), 50);
    }

    function closeSpotlight(options = {}) {
        if (options.restoreFocus === false) suppressDialogFocusReturn(spotlightOverlay);
        spotlightOverlay.style.display = 'none';
        spotlightInput.value = '';
        spotlightResults.innerHTML = '';
        spotlightInput.setAttribute('aria-expanded', 'false');
        spotlightInput.removeAttribute('aria-activedescendant');
        spotlightInput.blur();
    }

    function renderSpotlightResults(query) {
        spotlightResults.innerHTML = '';
        spotlightActive = -1;
        spotlightInput.removeAttribute('aria-activedescendant');
        if (!query.trim()) return;

        const q = query.toLowerCase();
        const matches = [];

        for (const [path, info] of Object.entries(videoData)) {
            const parts = path.split('/');
            const filename = parts[parts.length - 1];
            const title = titleFromFilename(filename);
            const searchStr = (title + ' ' + parts.slice(0, -1).join(' ')).toLowerCase();

            if (searchStr.includes(q)) {
                const normalizedTitle = title.toLowerCase();
                const score = normalizedTitle.startsWith(q) ? 0 : normalizedTitle.includes(q) ? 1 : 2;
                matches.push({ title, path, folderPath: parts.slice(0, -1).join(' / '), info, score });
            }
        }

        if (matches.length === 0) {
            spotlightResults.innerHTML = '<div class="spotlight-empty">No videos found</div>';
            return;
        }

        matches.sort((a, b) => a.score - b.score || compareNatural(a.title, b.title));
        matches.slice(0, 20).forEach((m, i) => {
            const result = document.createElement('button');
            result.type = 'button';
            result.id = `spotlight-result-${i}`;
            result.setAttribute('role', 'option');
            result.setAttribute('aria-selected', String(i === 0));
            result.className = 'spotlight-result' + (i === 0 ? ' active' : '');
            result.innerHTML = `<span class="spotlight-result-title">${m.title}</span><span class="spotlight-result-path">${m.folderPath}</span>`;
            result.addEventListener('click', () => {
                const videoObj = { title: m.title, path: m.path, ...m.info };
                closeSpotlight({ restoreFocus: false });
                loadVideo(videoObj);
            });
            spotlightResults.appendChild(result);
        });
        spotlightActive = 0;
        spotlightInput.setAttribute('aria-activedescendant', 'spotlight-result-0');
    }

    let spotlightTimeout;
    spotlightInput.addEventListener('input', () => {
        clearTimeout(spotlightTimeout);
        spotlightTimeout = setTimeout(() => renderSpotlightResults(spotlightInput.value), 100);
    });

    spotlightInput.addEventListener('keydown', (e) => {
        const items = spotlightResults.querySelectorAll('.spotlight-result');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length === 0) return;
            spotlightActive = Math.min(spotlightActive + 1, items.length - 1);
            items.forEach((el, i) => {
                const active = i === spotlightActive;
                el.classList.toggle('active', active);
                el.setAttribute('aria-selected', String(active));
            });
            spotlightInput.setAttribute('aria-activedescendant', items[spotlightActive].id);
            items[spotlightActive].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length === 0) return;
            spotlightActive = Math.max(spotlightActive - 1, 0);
            items.forEach((el, i) => {
                const active = i === spotlightActive;
                el.classList.toggle('active', active);
                el.setAttribute('aria-selected', String(active));
            });
            spotlightInput.setAttribute('aria-activedescendant', items[spotlightActive].id);
            items[spotlightActive].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (spotlightActive >= 0 && items[spotlightActive]) {
                items[spotlightActive].click();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeSpotlight();
        }
    });

    spotlightOverlay.addEventListener('click', (e) => {
        if (e.target === spotlightOverlay) closeSpotlight();
    });
    document.getElementById('close-spotlight')?.addEventListener('click', () => closeSpotlight());
    const homeSearchBtn = document.getElementById('home-search-btn');
    if (homeSearchBtn) homeSearchBtn.addEventListener('click', openSpotlight);
    document.getElementById('mobile-search-btn')?.addEventListener('click', openSpotlight);

    // ── Shortcuts Overlay ────────────────────────────────
    const shortcutsOverlay = document.getElementById('shortcuts-overlay');

    function toggleShortcuts() {
        const opening = shortcutsOverlay.style.display === 'none';
        if (opening) pauseVideoPlayback();
        shortcutsOverlay.style.display = opening ? 'flex' : 'none';
    }

    document.getElementById('close-shortcuts').addEventListener('click', () => {
        shortcutsOverlay.style.display = 'none';
    });

    shortcutsOverlay.addEventListener('click', (e) => {
        if (e.target === shortcutsOverlay) shortcutsOverlay.style.display = 'none';
    });

    // ── Help Guide Modal ─────────────────────────────────
    const helpModal = document.getElementById('help-modal');

    const openHelpModal = () => {
        pauseVideoPlayback();
        helpModal.style.display = 'flex';
        if (usesCompactLayout()) {
            setSidebarOpen(false, { restoreFocus: false });
        }
    };
    document.getElementById('help-btn').addEventListener('click', openHelpModal);
    const homeHelpBtn = document.getElementById('home-help-btn');
    if (homeHelpBtn) homeHelpBtn.addEventListener('click', openHelpModal);
    const homeNotesBtn = document.getElementById('home-notes-btn');
    if (homeNotesBtn) homeNotesBtn.addEventListener('click', () => showNotesView());
    const homeSettingsBtn = document.getElementById('home-settings-btn');
    if (homeSettingsBtn) homeSettingsBtn.addEventListener('click', () => {
        pauseVideoPlayback();
        elements.bunnyLibInput.value = state.bunnyPullZone;
        elements.themeSelect.value = state.theme;
        elements.settingsModal.style.display = 'flex';
        const tc = document.getElementById('theme-counter');
        if (tc) tc.textContent = (elements.themeSelect.selectedIndex + 1) + ' / ' + elements.themeSelect.options.length;
    });

    // Mobile header buttons
    const mobileNotesBtn = document.getElementById('mobile-notes-btn');
    if (mobileNotesBtn) mobileNotesBtn.addEventListener('click', () => showNotesView());
    const mobileHelpBtn = document.getElementById('mobile-help-btn');
    if (mobileHelpBtn) mobileHelpBtn.addEventListener('click', openHelpModal);
    const mobileSettingsBtn = document.getElementById('mobile-settings-btn');
    if (mobileSettingsBtn) mobileSettingsBtn.addEventListener('click', () => {
        pauseVideoPlayback();
        elements.bunnyLibInput.value = state.bunnyPullZone;
        elements.themeSelect.value = state.theme;
        elements.settingsModal.style.display = 'flex';
        const tc = document.getElementById('theme-counter');
        if (tc) tc.textContent = (elements.themeSelect.selectedIndex + 1) + ' / ' + elements.themeSelect.options.length;
    });

    document.getElementById('close-help').addEventListener('click', () => {
        helpModal.style.display = 'none';
    });

    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) helpModal.style.display = 'none';
    });

    // ── Watch History Modal ─────────────────────────────
    const historyModal = document.getElementById('history-modal');
    const historyContent = document.getElementById('history-content');

    let historySearchQuery = '';

    function renderHistoryList() {
        const sq = historySearchQuery;
        const entries = [...state.watched]
            .filter(p => videoData[p])
            .map(p => ({ path: p, lastWatched: state.lastWatched[p] || 0 }))
            .sort((a, b) => b.lastWatched - a.lastWatched);

        const filtered = sq ? entries.filter(e => e.path.toLowerCase().includes(sq)) : entries;

        if (filtered.length === 0) {
            historyContent.innerHTML = sq
                ? '<p style="color: var(--text-muted); text-align: center; padding: 40px 0;">No matching videos.</p>'
                : '<p style="color: var(--text-muted); text-align: center; padding: 40px 0;">No videos watched yet.</p>';
            return;
        }

        const positions = safeLoad('videoPositions', {});
        let html = '';
        for (const entry of filtered) {
            const info = videoData[entry.path];
            if (!info) continue;
            const parts = entry.path.split('/');
            const filename = parts.pop();
            const title = titleFromFilename(filename);
            const folder = parts.join(' / ');
            const ago = entry.lastWatched ? timeAgo(entry.lastWatched) : '';
            const resumeTime = positions[entry.path];
            const resumeStr = resumeTime ? formatTime(resumeTime) : '';

            html += `<div class="history-item" data-path="${entry.path}" role="button" tabindex="0" style="cursor: pointer;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                    <div style="min-width: 0; flex: 1;">
                        <div style="font-weight: 500; color: var(--text-main); margin-bottom: 2px; word-break: break-word;">${title}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); opacity: 0.7;">${folder}</div>
                    </div>
                    <div style="text-align: right; flex-shrink: 0;">
                        ${ago ? `<div style="font-size: 0.75rem; color: var(--text-muted);">${ago}</div>` : ''}
                        ${resumeStr ? `<div style="font-size: 0.7rem; color: var(--accent); margin-top: 2px;">at ${resumeStr}</div>` : ''}
                    </div>
                </div>
            </div>`;
        }
        historyContent.innerHTML = html;
    }

    // Click to load video (delegated, bound once)
    historyContent.addEventListener('click', (e) => {
        const item = e.target.closest('.history-item');
        if (!item) return;
        const path = item.dataset.path;
        const info = videoData[path];
        if (!info) return;
        const parts = path.split('/');
        const filename = parts.pop();
            const title = titleFromFilename(filename);
        const videoObj = { title, path, ...info };
        closeHistoryModal({ restoreFocus: false });
        loadVideo(videoObj);
    });
    historyContent.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const item = event.target.closest('.history-item');
        if (!item || event.target !== item) return;
        event.preventDefault();
        item.click();
    });

    // Search input
    const historySearchInput = document.getElementById('history-search-input');
    historySearchInput.addEventListener('input', () => {
        historySearchQuery = historySearchInput.value.trim().toLowerCase();
        renderHistoryList();
    });

    function showHistoryModal() {
        pauseVideoPlayback();
        historySearchQuery = '';
        historySearchInput.value = '';
        renderHistoryList();
        historyModal.style.display = 'flex';
    }

    function closeHistoryModal(options = {}) {
        if (options.restoreFocus === false) suppressDialogFocusReturn(historyModal);
        historyModal.style.display = 'none';
    }

    document.getElementById('close-history-modal').addEventListener('click', closeHistoryModal);
    document.getElementById('clear-history-modal').addEventListener('click', () => {
        if (!confirm('Clear watch history and resume positions? This cannot be undone.')) return;
        clearWatchHistoryData();
        historySearchQuery = '';
        historySearchInput.value = '';
        renderHistoryList();
    });
    historyModal.addEventListener('click', (e) => {
        if (e.target === historyModal) closeHistoryModal();
    });

    // Sidebar + mobile + home header history buttons
    const historySidebarBtn = document.getElementById('history-sidebar-btn');
    if (historySidebarBtn) historySidebarBtn.addEventListener('click', showHistoryModal);
    const mobileHistoryBtn = document.getElementById('mobile-history-btn');
    if (mobileHistoryBtn) mobileHistoryBtn.addEventListener('click', showHistoryModal);
    const homeHistoryBtn = document.getElementById('home-history-btn');
    if (homeHistoryBtn) homeHistoryBtn.addEventListener('click', showHistoryModal);

    // ── Favorites Modal ─────────────────────────────
    const favoritesModal = document.getElementById('favorites-modal');
    const favoritesContent = document.getElementById('favorites-content');
    let favSearchQuery = '';
    let favPendingUnfavs = new Set();

    function renderFavoritesList() {
        const sq = favSearchQuery;
        const allFavPaths = new Set([...state.favorites, ...favPendingUnfavs]);

        if (allFavPaths.size === 0) {
            favoritesContent.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px 0;">No favorites yet. Star a video to add it here.</p>';
            return;
        }

        let html = '';
        let matchCount = 0;
        for (const favPath of allFavPaths) {
            const videoObj = resolveVideoObj(favPath);
            if (!videoObj) continue;
            if (sq && !favPath.toLowerCase().includes(sq) && !videoObj.title.toLowerCase().includes(sq)) continue;
            matchCount++;

            const isUnfavorited = favPendingUnfavs.has(favPath);
            html += `<div class="notes-fav-item ${isUnfavorited ? 'notes-fav-removed' : ''}" data-path="${favPath}" role="group" aria-label="${videoObj.title}">
                <button type="button" class="notes-fav-open" data-path="${favPath}" ${isUnfavorited ? 'disabled' : ''}>
                    <span class="notes-fav-star">${isUnfavorited ? '&#9734;' : '&#9733;'}</span>
                    <span style="flex:1;min-width:0;">
                        <span class="notes-fav-title">${videoObj.title}</span>
                        <span class="notes-fav-path">${videoObj.folderPath}</span>
                    </span>
                </button>
                <button type="button" class="notes-fav-toggle" data-path="${favPath}" title="${isUnfavorited ? 'Re-favorite' : 'Remove from favorites'}">
                    ${isUnfavorited ? 'Re-favorite' : 'Unfavorite'}
                </button>
            </div>`;
        }

        if (matchCount === 0) {
            favoritesContent.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px 0;">No matching favorites.</p>';
        } else {
            favoritesContent.innerHTML = html;
        }
    }

    // Click handler (delegated)
    favoritesContent.addEventListener('click', (e) => {
        // Toggle unfavorite/re-favorite
        const toggle = e.target.closest('.notes-fav-toggle');
        if (toggle) {
            e.stopPropagation();
            const path = toggle.dataset.path;
            if (favPendingUnfavs.has(path)) {
                favPendingUnfavs.delete(path);
                state.favorites.add(path);
            } else {
                favPendingUnfavs.add(path);
                state.favorites.delete(path);
            }
            safeStore('favoriteVideos', JSON.stringify([...state.favorites]));
            updateNotesBadge();
            if (state.currentVideo && state.currentVideo.path === path) updateFavBtn();
            renderFavoritesList();
            return;
        }
        // Click item to load video
        const openButton = e.target.closest('.notes-fav-open');
        const item = openButton && openButton.closest('.notes-fav-item');
        if (item && !item.classList.contains('notes-fav-removed')) {
            const videoObj = resolveVideoObj(item.dataset.path);
            if (videoObj) {
                closeFavoritesModal({ restoreFocus: false });
                loadVideo(videoObj);
            }
        }
    });
    favoritesContent.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const item = event.target.closest('.notes-fav-item');
        if (!item || event.target !== item) return;
        event.preventDefault();
        item.click();
    });

    const favSearchInput = document.getElementById('favorites-search-input');
    favSearchInput.addEventListener('input', () => {
        favSearchQuery = favSearchInput.value.trim().toLowerCase();
        renderFavoritesList();
    });

    function showFavoritesModal() {
        pauseVideoPlayback();
        favSearchQuery = '';
        favSearchInput.value = '';
        favPendingUnfavs = new Set();
        renderFavoritesList();
        favoritesModal.style.display = 'flex';
    }

    function closeFavoritesModal(options = {}) {
        if (options.restoreFocus === false) suppressDialogFocusReturn(favoritesModal);
        favoritesModal.style.display = 'none';
    }

    document.getElementById('close-favorites-modal').addEventListener('click', closeFavoritesModal);
    favoritesModal.addEventListener('click', (e) => {
        if (e.target === favoritesModal) closeFavoritesModal();
    });

    // Wire up all favorites buttons
    const favsSidebarBtn = document.getElementById('favs-sidebar-btn');
    if (favsSidebarBtn) favsSidebarBtn.addEventListener('click', showFavoritesModal);
    const mobileFavsBtn = document.getElementById('mobile-favs-btn');
    if (mobileFavsBtn) mobileFavsBtn.addEventListener('click', showFavoritesModal);
    const homeFavsBtn = document.getElementById('home-favs-btn');
    if (homeFavsBtn) homeFavsBtn.addEventListener('click', showFavoritesModal);

    // ── Web Share (mobile native share sheet) ──────────
    const shareBtn = document.getElementById('share-btn');
    if (navigator.share) {
        shareBtn.hidden = false;
        shareBtn.addEventListener('click', () => {
            if (!state.currentVideo) return;
            const title = state.currentVideo.title;
            const text = `Check out "${title}" on Dance Masterclass Library`;
            const url = window.location.href;
            navigator.share({ title, text, url }).catch(() => {});
        });
    }

    // ── Email & Print in Export ──────────────────────
    const doEmailBtn = document.getElementById('do-email');
    if (doEmailBtn) {
        doEmailBtn.addEventListener('click', () => {
            // Generate markdown content same as export
            const expBtn = document.getElementById('do-export');
            // Temporarily switch to markdown, build content, open mailto
            const format = document.querySelector('input[name="export-format"]:checked');
            const origVal = format ? format.value : 'markdown';
            // Force markdown for email
            const mdRadio = document.querySelector('input[name="export-format"][value="markdown"]');
            if (mdRadio) mdRadio.checked = true;
            // Trigger export logic to get content, but intercept
            const subject = encodeURIComponent('My Dance Notes');
            // Build simple email body from bookmarks
            const allBk = safeLoad('videoBookmarks', {});
            let body = 'My Dance Practice Notes\n\n';
            for (const [path, arr] of Object.entries(allBk)) {
                if (!Array.isArray(arr) || arr.length === 0) continue;
                const bks = typeof arr[0] === 'object' ? arr : arr.map(t => ({ t, n: '' }));
                const withNotes = bks.filter(b => b.n);
                if (withNotes.length === 0) continue;
                const parts = path.split('/');
                const filename = parts.pop();
            const title = titleFromFilename(filename);
                body += title + ' (' + parts.join(' / ') + ')\n';
                for (const bk of withNotes) {
                    body += '  ' + formatTime(bk.t) + ' — ' + bk.n + '\n';
                }
                body += '\n';
            }
            window.location.href = 'mailto:?subject=' + subject + '&body=' + encodeURIComponent(body);
            if (format) format.checked = true; // restore
        });
    }

    const doPrintBtn = document.getElementById('do-print');
    if (doPrintBtn) {
        doPrintBtn.addEventListener('click', () => {
            const allBk = safeLoad('videoBookmarks', {});
            let html = '<html><head><title>Dance Practice Notes</title><style>body{font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px;}h1{font-size:1.5rem;}h2{font-size:1.1rem;margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:4px;}p{margin:4px 0;font-size:0.9rem;}.time{color:#c0392b;font-weight:600;}.note{color:#333;}</style></head><body>';
            html += '<h1>Dance Practice Notes</h1>';
            for (const [path, arr] of Object.entries(allBk)) {
                if (!Array.isArray(arr) || arr.length === 0) continue;
                const bks = typeof arr[0] === 'object' ? arr : arr.map(t => ({ t, n: '' }));
                const parts = path.split('/');
                const filename = parts.pop();
                const title = titleFromFilename(filename);
                html += '<h2>' + escapeHtml(title) + ' <small style="color:#999;">' + escapeHtml(parts.join(' / ')) + '</small></h2>';
                for (const bk of bks) {
                    const noteText = bk.n ? ' — ' + bk.n : '';
                    html += '<p><span class="time">' + formatTime(bk.t) + '</span><span class="note">' + escapeHtml(noteText) + '</span></p>';
                }
            }
            html += '</body></html>';
            const win = window.open('', '_blank');
            if (!win) {
                showToast('Allow pop-ups to print your dance notes.', 5000, true);
                return;
            }
            win.document.write(html);
            win.document.close();
            win.print();
        });
    }


    // ── Notes Modal Close ─────────────────────────────
    document.getElementById('close-notes-modal').addEventListener('click', closeNotesView);
    notesView.addEventListener('click', (e) => {
        if (e.target === notesView) closeNotesView();
    });

    // ── Notes Manager Search ─────────────────────────────
    const notesSearchInput = document.getElementById('notes-search-input');

    notesSearchInput.addEventListener('input', () => {
        notesSearchQuery = notesSearchInput.value.trim().toLowerCase();
        renderNotesView();
    });

    // ── Keyboard Shortcuts ───────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const activeDialog = topmostOpenDialog();
            if (activeDialog) {
                e.preventDefault();
                switch (activeDialog.id) {
                    case 'spotlight-overlay': closeSpotlight(); break;
                    case 'notes-view': closeNotesView(); break;
                    case 'history-modal': closeHistoryModal(); break;
                    case 'favorites-modal': closeFavoritesModal(); break;
                    case 'export-modal': exportModal.style.display = 'none'; break;
                    case 'shortcuts-overlay': shortcutsOverlay.style.display = 'none'; break;
                    case 'help-modal': helpModal.style.display = 'none'; break;
                    case 'settings-modal': elements.settingsModal.style.display = 'none'; break;
                    default: activeDialog.style.display = 'none';
                }
                return;
            }
            if (usesCompactLayout() && sidebarIsOpen()) { setSidebarOpen(false); return; }
            if (theaterMode) { toggleTheater(); return; }
            if (state.loopA !== null || state.loopB !== null) clearABLoop();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (spotlightOverlay.style.display !== 'none') { closeSpotlight(); } else { openSpotlight(); }
            return;
        }

        // Preserve native keyboard behavior for controls, links, and editable content.
        const interactive = e.target.closest('input, select, textarea, button, a, [role="button"], [contenteditable="true"]');
        if (interactive) return;

        // Global shortcuts
        if (e.key === '?') {
            e.preventDefault();
            toggleShortcuts();
            return;
        }

        // Only handle video shortcuts when video view is visible
        const videoVisible = elements.videoView.style.display !== 'none';
        const v = elements.videoPlayer;

        switch (e.key) {
            case ' ':
                if (!videoVisible || isNaN(v.duration)) return;
                e.preventDefault();
                if (v.paused) requestVideoPlayback('keyboard shortcut');
                else v.pause();
                break;
            case 'ArrowLeft':
                if (!videoVisible || isNaN(v.duration)) return;
                e.preventDefault();
                v.currentTime = Math.max(0, v.currentTime - 5);
                break;
            case 'ArrowRight':
                if (!videoVisible || isNaN(v.duration)) return;
                e.preventDefault();
                v.currentTime = Math.min(v.duration, v.currentTime + 5);
                break;
            case '[':
                if (!videoVisible || isNaN(v.duration)) return;
                if (state.loopA === null) {
                    setLoopA();
                } else if (state.loopB !== null) {
                    clearABLoop();
                    setLoopA();
                }
                break;
            case ']':
                if (!videoVisible || isNaN(v.duration)) return;
                if (state.loopA !== null && state.loopB === null) {
                    setLoopB();
                }
                break;
            case 'm':
            case 'M':
                if (!videoVisible) return;
                elements.mirrorBtn.click();
                break;
            case 't':
            case 'T':
                if (!videoVisible) return;
                toggleTheater();
                break;
            case 'b':
            case 'B':
                if (!videoVisible || isNaN(v.duration)) return;
                elements.addBookmarkBtn.click();
                break;
        }
    });

    // Start only after every module-level binding and event handler is initialized.
    try {
        init();
    } catch (error) {
        showFatalError('A startup error interrupted the library. Reload to try again.');
        console.error(error);
    }
});

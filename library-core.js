/* Pure catalog and hash-route helpers. No DOM, storage, or network access.
 * Browser: DanceLibraryCatalog.createCatalog(data, taxonomy), DanceLibraryRoutes.
 * Node: require('./library-core.js') exposes the same two APIs.
 *
 * Catalog entries retain source metadata and exact legacy path identity.
 * folderPath is the original folder string; folderSegments excludes category.
 * categories contains populated names in taxonomy order, then unknown names.
 * folder([]) returns root; other folder paths begin with the category.
 * Each folder has {name, path, category, subfolders, videos, all, count}.
 * subfolders is a null-prototype name-to-node object; videos are direct children.
 * search favorites accepts a Set or array of exact lesson paths. An empty set
 * matches nothing; omit favorites to search all lessons. Results are new arrays.
 * Entries/nodes are detached from source objects but deliberately remain usable
 * by existing renderers that attach loaded analysis or sort their child arrays.
 *
 * Route format returns a complete hash, or '' for home/invalid input.
 * parse returns {view:'home', invalid:true} for malformed/ambiguous routes.
 * Canonical hashes: #video=...&t=12.5, #folder=[encoded JSON array],
 * #view=notes, #view=queue. Existing #video=... hashes remain valid.
 */
(function (root) {
    'use strict';

    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const normalize = value => String(value ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en');
    const compareText = (first, second) => collator.compare(first, second)
        || (first < second ? -1 : first > second ? 1 : 0);
    const compareEntries = (first, second) => collator.compare(first.title, second.title)
        || compareText(first.path, second.path);
    const validText = value => typeof value === 'string' && value.trim().length > 0
        && !/[\u0000-\u001f\u007f]/.test(value);
    const validFolderPath = value => Array.isArray(value) && value.length > 0
        && value.every(validText);

    function createCatalog(videoData, taxonomy = {}) {
        if (!isRecord(videoData)) throw new TypeError('The catalog must be a record of lesson paths.');
        if (!isRecord(taxonomy)) throw new TypeError('The taxonomy must be an object.');
        const categoryOrder = Array.isArray(taxonomy.categoryOrder)
            ? [...new Set(taxonomy.categoryOrder.filter(validText))] : [];
        const courseCategories = isRecord(taxonomy.courseCategoryByFolder)
            ? taxonomy.courseCategoryByFolder : Object.create(null);
        const courseDisplayNames = isRecord(taxonomy.courseDisplayNameByFolder)
            ? taxonomy.courseDisplayNameByFolder : Object.create(null);
        const entriesByPath = new Map();
        const searchText = new Map();
        const makeFolder = (name, path, category) => ({
            name, path: [...path], category,
            subfolders: Object.create(null), videos: [], all: [], count: 0
        });
        const tree = makeFolder('', [], null);

        for (const [path, info] of Object.entries(videoData)) {
            if (!validText(path) || !isRecord(info)) {
                throw new TypeError('Each catalog lesson needs a nonempty path and metadata object.');
            }
            const parts = path.split('/');
            const filename = parts.pop();
            if (!validText(filename) || parts.some(segment => !validText(segment))) {
                throw new TypeError(`Invalid catalog path: ${path}`);
            }
            const mappedCategory = hasOwn(courseCategories, parts[0]) ? courseCategories[parts[0]] : null;
            const category = validText(mappedCategory) ? mappedCategory : 'Other';
            const title = typeof info.title === 'string' && info.title.trim()
                ? info.title.trim() : filename.replace(/\.(mp4|mov|m4v)$/i, '');
            const entry = {
                ...info, path, title, category,
                folderPath: parts.join('/'), folderSegments: [...parts]
            };
            entriesByPath.set(path, entry);
            const alias = hasOwn(courseDisplayNames, parts[0]) && validText(courseDisplayNames[parts[0]])
                ? courseDisplayNames[parts[0]] : '';
            searchText.set(path, normalize(`${title} ${path} ${category} ${alias}`));

            let node = tree;
            node.all.push(entry);
            for (const segment of [category, ...parts]) {
                if (!hasOwn(node.subfolders, segment)) {
                    node.subfolders[segment] = makeFolder(segment, [...node.path, segment], category);
                }
                node = node.subfolders[segment];
                node.all.push(entry);
            }
            node.videos.push(entry);
        }

        const presentCategories = Object.keys(tree.subfolders);
        const categories = [
            ...categoryOrder.filter(category => presentCategories.includes(category)),
            ...presentCategories.filter(category => !categoryOrder.includes(category)).sort(compareText)
        ];
        const sortFolder = node => {
            const names = node === tree ? categories : Object.keys(node.subfolders).sort(compareText);
            const ordered = Object.create(null);
            for (const name of names) {
                ordered[name] = node.subfolders[name];
                sortFolder(ordered[name]);
            }
            node.subfolders = ordered;
            node.videos.sort(compareEntries);
            node.all.sort(compareEntries);
            node.count = node.all.length;
        };
        sortFolder(tree);
        const all = [...tree.all];

        function search(query = '', options = {}) {
            if (!isRecord(options)) throw new TypeError('Search options must be an object.');
            const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
            const category = options.category === undefined || options.category === null || options.category === ''
                ? null : normalize(options.category);
            let favorites = null;
            if (options.favorites !== undefined && options.favorites !== null) {
                if (!Array.isArray(options.favorites)
                    && Object.prototype.toString.call(options.favorites) !== '[object Set]') {
                    throw new TypeError('Favorites must be a Set or array of lesson paths.');
                }
                favorites = new Set(options.favorites);
            }
            let limit = Infinity;
            if (options.limit !== undefined) {
                if (typeof options.limit !== 'number' || !Number.isSafeInteger(options.limit) || options.limit < 0) {
                    throw new TypeError('The result limit must be a nonnegative safe integer.');
                }
                limit = options.limit;
            }
            if (limit === 0) return [];
            const matches = [];
            for (const entry of all) {
                if (category !== null && normalize(entry.category) !== category) continue;
                if (favorites !== null && !favorites.has(entry.path)) continue;
                if (!tokens.every(token => searchText.get(entry.path).includes(token))) continue;
                matches.push(entry);
                if (matches.length >= limit) break;
            }
            return matches;
        }

        function folder(pathArray) {
            if (!Array.isArray(pathArray) || pathArray.some(segment => !validText(segment))) return null;
            let node = tree;
            for (const segment of pathArray) {
                if (!hasOwn(node.subfolders, segment)) return null;
                node = node.subfolders[segment];
            }
            return node;
        }

        return Object.freeze({
            search, folder,
            find: path => entriesByPath.get(path) || null,
            categories, all
        });
    }

    const invalidRoute = () => ({ view: 'home', invalid: true });
    const validTime = value => typeof value === 'number' && Number.isFinite(value)
        && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
    const decimalTime = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

    function parse(hash) {
        if (typeof hash !== 'string') return invalidRoute();
        const raw = hash.startsWith('#') ? hash.slice(1) : hash;
        if (!raw || raw === 'home') return { view: 'home' };
        if (raw === 'notes' || raw === 'queue') return { view: raw };
        try {
            // URLSearchParams alone repairs invalid escapes and UTF-8 silently.
            // Validate first, but decode each actual parameter only once below.
            decodeURIComponent(raw.replace(/\+/g, ' '));
            const params = new URLSearchParams(raw);
            const keys = [...params.keys()];
            if (keys.length !== new Set(keys).size) return invalidRoute();
            if (keys.some(key => !['view', 'video', 'folder', 't'].includes(key))) return invalidRoute();
            const selectors = ['view', 'video', 'folder'].filter(key => params.has(key));
            if (selectors.length !== 1) return invalidRoute();

            if (params.has('video')) {
                const path = params.get('video');
                if (!validText(path)) return invalidRoute();
                const route = { view: 'video', path };
                if (params.has('t')) {
                    const time = params.get('t');
                    if (!decimalTime.test(time) || !validTime(Number(time))) return invalidRoute();
                    route.time = Number(time);
                }
                return route;
            }
            if (params.has('t')) return invalidRoute();
            if (params.has('folder')) {
                const path = JSON.parse(params.get('folder'));
                return validFolderPath(path) ? { view: 'folder', path } : invalidRoute();
            }
            const view = params.get('view');
            return ['home', 'notes', 'queue'].includes(view) ? { view } : invalidRoute();
        } catch (_) {
            return invalidRoute();
        }
    }

    function format(route) {
        if (!isRecord(route) || route.invalid) return '';
        try {
            if (route.view === 'home') return '';
            if (route.view === 'notes' || route.view === 'queue') return `#view=${route.view}`;
            if (route.view === 'folder') {
                return validFolderPath(route.path) ? `#folder=${encodeURIComponent(JSON.stringify(route.path))}` : '';
            }
            if (route.view === 'video' && validText(route.path)) {
                if (route.time !== undefined && !validTime(route.time)) return '';
                return `#video=${encodeURIComponent(route.path)}`
                    + (route.time !== undefined ? `&t=${route.time}` : '');
            }
        } catch (_) {
            // encodeURIComponent rejects lone surrogate strings.
        }
        return '';
    }

    const DanceLibraryCatalog = Object.freeze({ createCatalog });
    const DanceLibraryRoutes = Object.freeze({ parse, format });
    root.DanceLibraryCatalog = DanceLibraryCatalog;
    root.DanceLibraryRoutes = DanceLibraryRoutes;
    if (typeof module === 'object' && module.exports) {
        module.exports = { DanceLibraryCatalog, DanceLibraryRoutes };
    }
})(globalThis);

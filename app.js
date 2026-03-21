document.addEventListener('DOMContentLoaded', () => {
    // Check if videoData exists from data.js
    if (typeof videoData === 'undefined') {
        alert("Error: data.js not found or corrupted. Please run generate_data_js.py");
        return;
    }

    const checkIsMobile = () => window.innerWidth <= 768 || /Mobi|Android/i.test(navigator.userAgent);
    const isHosted = location.hostname.includes('github.io') || location.protocol === 'https:';

    // Safe JSON parse from localStorage (never crashes on corrupt data)
    function safeLoad(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
        catch(e) { console.warn('Corrupt localStorage key:', key, e); localStorage.removeItem(key); return fallback; }
    }

    // State
    const state = {
        tree: {},
        currentVideo: null,
        watched: new Set(safeLoad('watchedVideos', [])),
        useBunny: isHosted || checkIsMobile() ? true : (localStorage.getItem('useBunny') === 'true'),
        theme: localStorage.getItem('theme') || 'solarized-light',
        bunnyPullZone: localStorage.getItem('bunny_pull_zone') || (typeof BUNNY_PULL_ZONE !== 'undefined' ? BUNNY_PULL_ZONE : ''),
        loopA: null,
        loopB: null,
        playbackSpeed: 1.0,
        mirrored: false,
        favorites: new Set(safeLoad('favoriteVideos', [])),
        lastWatched: safeLoad('videoLastWatched', {})
    };

    // Elements
    const elements = {
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
        
        videoTitle: document.getElementById('video-title'),
        videoSummary: document.getElementById('video-summary'),
        speedDropdownBtns: document.querySelectorAll('#speed-dropdown div'),
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

    // Soft-delete tracking for tile unfavorites (cleared on navigation)
    let tilePendingUnfavs = new Set();
    // Notes manager search state (used in renderNotesView)
    let notesSearchQuery = '';

    // Initialize
    init();

    function init() {
        parseDataToTree();
        applyTheme(state.theme);
        renderNavigation();
        renderHomeTiles(); // start at root
        setupEventListeners();
        
        // Init UI state
        elements.sourceToggle.checked = isHosted || checkIsMobile() ? true : state.useBunny;
        elements.themeSelect.value = state.theme;
        updateNotesBadge();
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
            
            const title = filename.replace(/\.(mp4|mov)$/i, "");
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
            return a.localeCompare(b);
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

    // Render Sidebar Navigation
    function renderNavigation() {
        elements.nav.innerHTML = '';
        // Render root level as standard folders instead of unclickable headers
        renderFolderLevel(state.tree, elements.nav, 0);
    }

    function renderFolderLevel(foldersObj, containerElement, depth, currentPath = []) {
        // Sort folders alphabetically (custom order for root)
        const folderNames = sortFolders(Object.keys(foldersObj), depth === 0);
        
        for (const folderName of folderNames) {
            const node = foldersObj[folderName];
            
            if (countVideos(node) === 0) continue; // Skip empty folders entirely
            
            const groupDiv = document.createElement('div');
            groupDiv.className = 'nav-group';

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
                <div style="display:flex; align-items:center; flex-grow:1;">
                    ${iconSvg}
                    <span style="word-break: break-word; line-height: 1.3; font-size: 0.95em; padding-right: 8px;">${folderName}</span>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                    <div class="open-tiles-btn" style="padding: 4px; display:flex; align-items:center; border-radius: 4px; transition: background-color 0.2s;" title="Open in Tile View">
                        ${gridIconSvg}
                    </div>
                    <div style="padding: 4px; display:flex; align-items:center;">
                        <svg class="chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 18l6-6-6-6"/></svg>
                    </div>
                </div>
            `;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'nav-content';
            contentDiv.style.setProperty('--depth', depth);
            
            const fullPath = [...currentPath, folderName];
            
            // Render subfolders recursively
            if (Object.keys(node.subfolders).length > 0) {
                renderFolderLevel(node.subfolders, contentDiv, depth + 1, fullPath);
            }

            // Render videos in this folder
            if (node.videos.length > 0) {
                node.videos.sort((a, b) => a.title.localeCompare(b.title));
                node.videos.forEach(video => {
                    const link = document.createElement('a');
                    link.className = `video-link ${state.watched.has(video.path) ? 'watched' : ''}`;
                    link.style.setProperty('--depth', depth); link.style.paddingLeft = `calc(40px + (var(--depth) * 12px))`;
                    link.innerText = video.title;
                    link.dataset.path = video.path;
                    link.addEventListener('click', () => loadVideo(video));
                    contentDiv.appendChild(link);
                });
            }

            // Expand/Collapse entire row
            headerBtn.addEventListener('click', (e) => {
                const isOpen = contentDiv.classList.contains('open');
                if (!isOpen) {
                    contentDiv.classList.add('open');
                    headerBtn.classList.add('active');
                } else {
                    contentDiv.classList.remove('open');
                    headerBtn.classList.remove('active');
                }
            });

            // Separate Click Listener for the dedicated Tile View button
            const tileBtn = headerBtn.querySelector('.open-tiles-btn');
            tileBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Don't toggle the accordion
                
                // Stop video if playing
                if (elements.videoPlayer && !elements.videoPlayer.paused) elements.videoPlayer.pause();
                if (typeof hls !== 'undefined' && hls) {
                    hls.destroy();
                    hls = null;
                }
                
                // Switch View
                elements.videoView.style.display = 'none';
                document.getElementById('notes-view').style.display = 'none';
                elements.homeView.style.display = 'block';
                document.querySelectorAll('.video-link').forEach(l => l.classList.remove('active'));
                state.currentVideo = null;
                
                // Render Tiles for this specific folder!
                renderHomeTiles(node, fullPath);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                
                // Intentionally NOT auto-expanding accordion as per user preference
                
                // On mobile, close sidebar after jumping
                if (window.innerWidth <= 768) {
                    elements.sidebar.classList.remove('open');
                    document.body.classList.remove('sidebar-open');
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
        const btn = document.getElementById('notes-sidebar-btn');
        let badge = btn.querySelector('.notes-badge');
        const allBookmarks = safeLoad('videoBookmarks', {});
        let total = 0;
        for (const arr of Object.values(allBookmarks)) {
            if (Array.isArray(arr)) total += arr.length;
        }
        total += state.favorites.size;
        if (total > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'notes-badge';
                btn.style.position = 'relative';
                btn.appendChild(badge);
            }
            badge.textContent = total > 99 ? '99+' : total;
        } else if (badge) {
            badge.remove();
        }
    }


    // Render Home Tiles as a File Explorer
    function renderHomeTiles(folderNode = null, path = []) {
        // If null, we are at the root
        if (!folderNode) {
            folderNode = { subfolders: state.tree, videos: [] };
            path = [];
        }

        elements.courseGrid.innerHTML = '';

        // Render Breadcrumbs for Home View
        const homeHeader = document.querySelector('.home-title');
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

        // Render favorites section at root level (include soft-deleted for undo)
        const allTileFavs = new Set([...state.favorites, ...tilePendingUnfavs]);
        if (path.length === 0 && allTileFavs.size > 0) {
            const favHeader = document.createElement('div');
            favHeader.className = 'favorites-section-header';
            favHeader.innerHTML = '<span class="fav-section-star">&#9733;</span> Favorites';
            elements.courseGrid.appendChild(favHeader);

            let favIndex = 0;
            for (const favPath of allTileFavs) {
                const info = videoData[favPath];
                if (!info) continue;
                favIndex++;
                const parts = favPath.split('/');
                const filename = parts.pop();
                const title = filename.replace(/\.(mp4|mov)$/i, "");
                const videoObj = { title, path: favPath, ...info };
                const isRemoved = tilePendingUnfavs.has(favPath);

                const tile = document.createElement('div');
                tile.className = 'course-tile fav-tile' + (isRemoved ? ' tile-unfavorited' : '');
                tile.style.animationDelay = `${favIndex * 0.04}s`;
                tile.style.backgroundColor = 'var(--bg-base)';
                // Determine dance style for color border
                const favTopFolder = favPath.split('/')[0];
                let favStyle = 'Other';
                for (const [s, node] of Object.entries(state.tree)) {
                    if (node.subfolders[favTopFolder]) { favStyle = s; break; }
                }
                tile.style.borderLeft = `3px solid ${styleColors[favStyle] || styleColors['Other']}`;
                tile.innerHTML = `
                    <div style="display: flex; align-items: flex-start; margin-bottom: 2px;">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--accent)" stroke-width="2" fill="${isRemoved ? 'none' : 'var(--accent)'}" stroke-linecap="round" stroke-linejoin="round" style="margin-right:10px; min-width:20px; margin-top: 2px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        <h3 class="video-tile-title" style="margin-bottom: 0; color: var(--text-main); font-weight: normal; line-height: 1.4;">${title}</h3>
                        <button class="tile-fav-toggle" data-path="${favPath}" title="${isRemoved ? 'Re-favorite' : 'Unfavorite'}">${isRemoved ? 'Re-favorite' : 'Unfavorite'}</button>
                    </div>
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: auto; opacity: 0.7;">${parts.join(' / ')}</p>
                `;
                // Click tile body → load video (but not if clicking the toggle button)
                tile.addEventListener('click', (e) => {
                    if (e.target.closest('.tile-fav-toggle')) return;
                    if (isRemoved) return;
                    loadVideo(videoObj);
                });
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
                    localStorage.setItem('favoriteVideos', JSON.stringify([...state.favorites]));
                    updateNotesBadge();
                    renderHomeTiles(folderNode, path);
                });
                elements.courseGrid.appendChild(tile);
            }

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
                const cwHeader = document.createElement('div');
                cwHeader.className = 'favorites-section-header';
                cwHeader.innerHTML = '&#9654; Continue Watching';
                elements.courseGrid.appendChild(cwHeader);

                for (const entry of resumeEntries) {
                    const info = videoData[entry.path];
                    const parts = entry.path.split('/');
                    const filename = parts.pop();
                    const title = filename.replace(/\.(mp4|mov)$/i, '');
                    const videoObj = { title, path: entry.path, ...info };

                    const tile = document.createElement('div');
                    tile.className = 'course-tile resume-tile';
                    tile.style.animationDelay = `${tileIndex * 0.04}s`;
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
                    elements.courseGrid.appendChild(tile);
                    tileIndex++;
                }

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
            tile.className = 'course-tile';
            tile.style.animationDelay = `${tileIndex * 0.04}s`;
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
                
                // Keep sidebar in sync - open the accordion for this folder
                const headers = Array.from(document.querySelectorAll('.nav-header span'));
                const targetHeader = headers.find(span => span.innerText === fName);
                if (targetHeader) {
                    const btn = targetHeader.closest('.nav-header');
                    if (!btn.classList.contains('active')) btn.click();
                    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
            elements.courseGrid.appendChild(tile);
        }
        
        // Render videos as tiles (if any in this exact folder)
        if (folderNode.videos) {
            const videos = [...folderNode.videos].sort((a,b) => a.title.localeCompare(b.title));
            for (const video of videos) {
                tileIndex++;
                const tile = document.createElement('div');
                tile.className = 'course-tile';
            tile.style.animationDelay = `${tileIndex * 0.04}s`;
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
                    <div style="display: flex; align-items: flex-start; margin-bottom: 2px;">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--text-muted)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:10px; min-width:20px; margin-top: 2px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        <h3 class="video-tile-title" style="margin-bottom: 0; color: var(--text-main); font-weight: normal; line-height: 1.4;">${video.title}</h3>
                        <button class="tile-star-btn${isFav ? ' tile-star-active' : ''}" data-path="${video.path}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">
                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="${isFav ? 'currentColor' : 'none'}" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                        </button>
                    </div>
                    ${watchedAgo ? '<p class="tile-watched-ago">' + watchedAgo + '</p>' : ''}
                `;
                tile.addEventListener('click', (e) => {
                    if (e.target.closest('.tile-star-btn')) return;
                    loadVideo(video);
                });
                tile.querySelector('.tile-star-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (state.favorites.has(video.path)) {
                        state.favorites.delete(video.path);
                    } else {
                        state.favorites.add(video.path);
                    }
                    localStorage.setItem('favoriteVideos', JSON.stringify([...state.favorites]));
                    updateNotesBadge();
                    renderHomeTiles(folderNode, path);
                });
                elements.courseGrid.appendChild(tile);
            }
        }
    }

    // Load and Play Video
    function loadVideo(videoObj) {
        tilePendingUnfavs = new Set();
        clearABLoop();
        state.currentVideo = videoObj;
        
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
            const sortedVideos = [...folderNode.videos].sort((a,b) => a.title.localeCompare(b.title));
            const currentIndex = sortedVideos.findIndex(v => v.path === videoObj.path);
            
            state.playlist = sortedVideos;
            state.playlistIndex = currentIndex;
            
            elements.prevBtn.disabled = currentIndex <= 0;
            elements.nextBtn.disabled = currentIndex === -1 || currentIndex >= sortedVideos.length - 1;
        } else {
            elements.prevBtn.disabled = true;
            elements.nextBtn.disabled = true;
        }
        elements.homeView.style.display = 'none';
        document.getElementById('notes-view').style.display = 'none';
        elements.videoView.style.display = 'flex';

        // Update URL/Video Source
        updateVideoSource();

        // Update Info
        elements.videoTitle.innerText = videoObj.title;

        // Build summary with course description for Salsa Masterclass videos
        let summaryHtml = '';
        if (typeof salsaCourseData !== 'undefined' && videoObj.path && videoObj.path.startsWith('Salsa Masterclass/')) {
            const videoParts = videoObj.path.split('/');
            videoParts.pop(); // remove filename
            const folderKey = videoParts.join('/');
            const courseInfo = salsaCourseData.folders[folderKey];
            if (courseInfo) {
                summaryHtml += '<div class="course-video-desc">';
                summaryHtml += `<p>${courseInfo.description}</p>`;
                if (courseInfo.tips) summaryHtml += `<p class="course-tips"><strong>Tips:</strong> ${courseInfo.tips}</p>`;
                if (courseInfo.song) summaryHtml += `<p class="course-song">&#9835; ${courseInfo.song}</p>`;
                if (courseInfo.prerequisites) {
                    summaryHtml += '<div class="course-prereqs">';
                    if (courseInfo.prerequisites.on1) summaryHtml += '<div class="course-prereq-col"><strong>On1:</strong><ul>' + courseInfo.prerequisites.on1.map(p => `<li>${p}</li>`).join('') + '</ul></div>';
                    if (courseInfo.prerequisites.on2) summaryHtml += '<div class="course-prereq-col"><strong>On2:</strong><ul>' + courseInfo.prerequisites.on2.map(p => `<li>${p}</li>`).join('') + '</ul></div>';
                    summaryHtml += '</div>';
                }
                summaryHtml += '</div>';
            }
        }
        // AI summary (collapsible if course description exists)
        const aiContent = parseMarkdown(videoObj.summary);
        if (summaryHtml && videoObj.summary) {
            summaryHtml += '<details class="ai-summary-details"><summary class="ai-summary-toggle">AI Analysis</summary><div class="ai-summary-content">' + aiContent + '</div></details>';
        } else {
            summaryHtml += aiContent;
        }
        elements.videoSummary.innerHTML = summaryHtml;

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
                
                // Stop the video
                if (elements.videoPlayer && !elements.videoPlayer.paused) elements.videoPlayer.pause();
                if (hls) {
                    hls.destroy();
                    hls = null;
                }
                
                // Switch Views
                elements.videoView.style.display = 'none';
                document.getElementById('notes-view').style.display = 'none';
                elements.homeView.style.display = 'block';
                
                // Uncheck active states in sidebar
                document.querySelectorAll('.video-link').forEach(l => l.classList.remove('active'));
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
                
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
            
            link.addEventListener('mouseover', e => e.target.style.color = 'var(--accent)');
            link.addEventListener('mouseout', e => e.target.style.color = 'var(--text-main)');
        });

        // Highlight Active Link
        document.querySelectorAll('.video-link').forEach(l => l.classList.remove('active'));
        const activeLink = document.querySelector(`.video-link[data-path="${CSS.escape(videoObj.path)}"]`);
        if (activeLink) activeLink.classList.add('active');

        // Mark as watched
        state.watched.add(videoObj.path);
        localStorage.setItem('watchedVideos', JSON.stringify([...state.watched]));
        if (activeLink) activeLink.classList.add('watched');

        // Track last watched timestamp
        state.lastWatched[videoObj.path] = Date.now();
        localStorage.setItem('videoLastWatched', JSON.stringify(state.lastWatched));

        // Scroll to top
        elements.videoView.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Mobile: close sidebar
        if (window.innerWidth <= 768) {
            elements.sidebar.classList.remove('open');
            document.body.classList.remove('sidebar-open');
        }
    }


    // Switch between Local and Bunny
    function updateVideoSource() {
        if (!state.currentVideo) return;
        
        const video = elements.videoPlayer;
        
        // Clean up previous HLS instance if it exists
        if (hls) {
            hls.destroy();
            hls = null;
        }
        
        const useCDN = state.useBunny || checkIsMobile();
        if (useCDN && state.currentVideo.bunny_id && state.bunnyPullZone) {
            // Clean pull zone hostname (remove https:// or trailing slashes if user pasted them)
            let host = state.bunnyPullZone.replace('https://', '').replace('http://', '').split('/')[0];
            const streamUrl = `https://${host}/${state.currentVideo.bunny_id}/playlist.m3u8`;
            
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                hls = new Hls();
                hls.loadSource(streamUrl);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, function() {
                    video.play().catch(e => console.log("Autoplay prevented:", e));
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                // Native Safari support
                video.src = streamUrl;
                video.addEventListener('loadedmetadata', function() {
                    video.play().catch(e => console.log("Autoplay prevented:", e));
                }, { once: true });
            }
        } else {
            // Local File Playback
            video.src = encodeURI(state.currentVideo.path);
            video.play().catch(e => console.log("Autoplay prevented:", e));
        }
    }

    // Resume playback position after source loads
    let skipNextResume = false;
    function tryResumePosition() {
        if (skipNextResume) { skipNextResume = false; return; }
        if (!state.currentVideo) return;
        const positions = safeLoad('videoPositions', {});
        const saved = positions[state.currentVideo.path];
        if (saved && saved > 5) {
            const v = elements.videoPlayer;
            v.currentTime = saved;
            // Show toast
            const toast = document.createElement('div');
            toast.className = 'resume-toast';
            toast.textContent = 'Resumed from ' + formatTime(saved);
            elements.playerContainer.appendChild(toast);
            setTimeout(() => toast.remove(), 2600);
        }
    }

    // Bind once — fires each time a new source loads metadata
    elements.videoPlayer.addEventListener('loadedmetadata', tryResumePosition);

    // Clear saved position when video finishes
    elements.videoPlayer.addEventListener('ended', function() {
        if (state.currentVideo) {
            const positions = safeLoad('videoPositions', {});
            delete positions[state.currentVideo.path];
            localStorage.setItem('videoPositions', JSON.stringify(positions));
        }
    });

    // Parse Markdown & Add Clickable Timestamps
    function parseMarkdown(text) {
        if (!text) return "<em>No summary available for this lesson.</em>";
        
        let html = text
            // Bold
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Timestamps: [MM:SS]
            .replace(/\[(\d{2}:\d{2})\]/g, (match, timeStr) => {
                const parts = timeStr.split(':');
                const totalSeconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                return `<span class="timestamp-pill" data-time="${totalSeconds}">${match}</span>`;
            });

        // Split by dashes for bullet points
        const lines = html.split('\n').filter(l => l.trim().length > 0);
        let listHtml = '<ul>';
        lines.forEach(line => {
            if (line.trim().startsWith('- ')) {
                listHtml += `<li>${line.replace(/^- /, '')}</li>`;
            } else {
                listHtml += `<p>${line}</p>`;
            }
        });
        listHtml += '</ul>';

        return listHtml;
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
        // Go Home helper
        function goHome() {
            elements.videoView.style.display = 'none';
            document.getElementById('notes-view').style.display = 'none';
            elements.homeView.style.display = 'block';
            if (elements.videoPlayer && !elements.videoPlayer.paused) elements.videoPlayer.pause();
            if (hls) {
                hls.destroy();
                hls = null;
            }
            document.querySelectorAll('.video-link').forEach(l => l.classList.remove('active'));
            state.currentVideo = null;
            renderHomeTiles(null, []);
            window.scrollTo({ top: 0, behavior: 'smooth' });
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
                if (window.innerWidth <= 768) {
                    elements.sidebar.classList.remove('open');
                    document.body.classList.remove('sidebar-open');
                }
            });
        });

        // Home button in sidebar header
        const homeSidebarBtn = document.getElementById('home-sidebar-btn');
        if (homeSidebarBtn) {
            homeSidebarBtn.addEventListener('click', () => {
                goHome();
                if (window.innerWidth <= 768) {
                    elements.sidebar.classList.remove('open');
                    document.body.classList.remove('sidebar-open');
                }
            });
        }

        // Timestamp Clicks
        elements.videoSummary.addEventListener('click', (e) => {
            if (e.target.classList.contains('timestamp-pill')) {
                const time = parseFloat(e.target.dataset.time);
                
                // Native HTML5 Video skipping works for both Local & HLS stream!
                elements.videoPlayer.currentTime = time;
                elements.videoPlayer.play();
                
                // Scroll up centered towards the video player
                const wrapper = document.getElementById('video-sticky-wrapper');
                if (wrapper) {
                    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });

        
        // Mobile-friendly dropdown toggle
        elements.currentSpeedBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('speed-dropdown');
            const isVisible = dropdown.style.display === 'flex';
            dropdown.style.display = isVisible ? 'none' : 'flex';
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('speed-dropdown');
            if (dropdown && e.target !== elements.currentSpeedBtn && !dropdown.contains(e.target)) {
                dropdown.style.display = '';
            }
        });
        
        // In-Player Speed Overlay Controls
        elements.speedDropdownBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const speed = parseFloat(e.target.dataset.speed);
                setSpeed(speed);
                document.getElementById('speed-dropdown').style.display = 'none';
            });
        });

        // Source Toggle
        elements.sourceToggle.addEventListener('change', (e) => {
            state.useBunny = e.target.checked;
            localStorage.setItem('useBunny', state.useBunny);
            updateVideoSource();
        });

        // Search
        elements.searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            document.querySelectorAll('.nav-group').forEach(group => {
                let hasVisibleMatch = false;
                
                // Check header
                const headerText = group.querySelector('.nav-header').innerText.toLowerCase();
                
                // Check links
                const links = group.querySelectorAll('.video-link');
                links.forEach(link => {
                    const isMatch = link.innerText.toLowerCase().includes(query);
                    link.style.display = isMatch ? 'block' : 'none';
                    if (isMatch) hasVisibleMatch = true;
                });

                if (headerText.includes(query) || hasVisibleMatch) {
                    group.style.display = 'block';
                    hasVisibleMatch = true;
                } else {
                    group.style.display = 'none';
                }
                
                // Auto-open accordion if there is a search match
                const content = group.querySelector('.nav-content');
                const headerBtn = group.querySelector('.nav-header');
                if (query.length > 0 && hasVisibleMatch) {
                    if (content) content.classList.add('open');
                    if (headerBtn) headerBtn.classList.add('active');
                } else if (query.length === 0) {
                    if (content) content.classList.remove('open');
                    if (headerBtn) headerBtn.classList.remove('active');
                }
            });
        });

        // Mobile Menu / Desktop Toggle
        const toggleSidebar = () => {
            if (window.innerWidth <= 768) {
                elements.sidebar.classList.toggle('open');
                document.body.classList.toggle('sidebar-open', elements.sidebar.classList.contains('open'));
            } else {
                document.body.classList.toggle('sidebar-closed');
            }
        };

        if(elements.menuToggle) elements.menuToggle.addEventListener('click', toggleSidebar);
        if(elements.openSidebarBtn) elements.openSidebarBtn.addEventListener('click', toggleSidebar);
        if(elements.closeSidebarBtn) elements.closeSidebarBtn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                elements.sidebar.classList.remove('open');
                document.body.classList.remove('sidebar-open');
            } else {
                document.body.classList.add('sidebar-closed');
            }
        });
        
        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                if (elements.sidebar.classList.contains('open') && 
                    !elements.sidebar.contains(e.target) && 
                    (elements.menuToggle && !elements.menuToggle.contains(e.target)) &&
                    (elements.openSidebarBtn && !elements.openSidebarBtn.contains(e.target))) {
                    elements.sidebar.classList.remove('open');
                    document.body.classList.remove('sidebar-open');
                }
            }
        });

        // Collapse All Folders
        if (elements.collapseAllBtn) {
            elements.collapseAllBtn.addEventListener('click', () => {
                document.querySelectorAll('.nav-content.open').forEach(el => el.classList.remove('open'));
                document.querySelectorAll('.nav-header.active').forEach(el => el.classList.remove('active'));
            });
        }
        
        // Settings Modal
        elements.settingsBtn.addEventListener('click', () => {
            elements.bunnyLibInput.value = state.bunnyPullZone;
            elements.settingsModal.style.display = 'flex';
        });

        elements.closeSettings.addEventListener('click', () => {
            elements.settingsModal.style.display = 'none';
        });

        elements.saveSettings.addEventListener('click', () => {
            const inputVal = elements.bunnyLibInput.value.trim();
            if (inputVal && !inputVal.includes('.b-cdn.net')) {
                alert("Warning: Bunny Pull Zone usually ends in .b-cdn.net (e.g. vz-123.b-cdn.net)");
            }
            state.bunnyPullZone = inputVal;
            localStorage.setItem('bunny_pull_zone', state.bunnyPullZone);
            elements.settingsModal.style.display = 'none';
            
            // If they just added it, turn Bunny on
            if(state.bunnyPullZone) {
                state.useBunny = true;
                elements.sourceToggle.checked = true;
                localStorage.setItem('useBunny', true);
                updateVideoSource();
            }
        });

        // Theme switching
        elements.themeSelect.addEventListener('change', (e) => {
            state.theme = e.target.value;
            applyTheme(state.theme);
            updateThemeCounter();
        });

        // Theme prev/next navigation
        const themeCounter = document.getElementById('theme-counter');
        function updateThemeCounter() {
            const opts = elements.themeSelect.options;
            const idx = elements.themeSelect.selectedIndex;
            themeCounter.textContent = (idx + 1) + ' / ' + opts.length;
        }

        function cycleTheme(direction) {
            const opts = elements.themeSelect.options;
            let idx = elements.themeSelect.selectedIndex + direction;
            if (idx < 0) idx = opts.length - 1;
            if (idx >= opts.length) idx = 0;
            elements.themeSelect.selectedIndex = idx;
            state.theme = opts[idx].value;
            applyTheme(state.theme);
            updateThemeCounter();
        }

        document.getElementById('theme-prev').addEventListener('click', () => cycleTheme(-1));
        document.getElementById('theme-next').addEventListener('click', () => cycleTheme(1));
        updateThemeCounter();

        // Reset buttons
        function confirmAndReset(msg, action) {
            if (confirm(msg)) { action(); renderHomeTiles(null, []); }
        }

        document.getElementById('reset-watched').addEventListener('click', () => {
            confirmAndReset('Clear all watch history? This cannot be undone.', () => {
                state.watched.clear();
                state.lastWatched = {};
                localStorage.removeItem('watchedVideos');
                localStorage.removeItem('videoLastWatched');
                renderNavigation();
            });
        });

        document.getElementById('reset-bookmarks').addEventListener('click', () => {
            confirmAndReset('Clear all bookmarks and notes for every video?', () => {
                localStorage.removeItem('videoBookmarks');
                if (state.currentVideo) renderBookmarks();
                updateNotesBadge();
            });
        });

        document.getElementById('reset-favorites').addEventListener('click', () => {
            confirmAndReset('Clear all favorites?', () => {
                state.favorites.clear();
                localStorage.removeItem('favoriteVideos');
                updateNotesBadge();
            });
        });

        document.getElementById('reset-positions').addEventListener('click', () => {
            confirmAndReset('Clear all saved resume positions?', () => {
                localStorage.removeItem('videoPositions');
            });
        });

        document.getElementById('reset-all').addEventListener('click', () => {
            confirmAndReset('Reset EVERYTHING? Watch history, bookmarks, notes, favorites, resume positions — all gone. This cannot be undone.', () => {
                state.watched.clear();
                state.favorites.clear();
                localStorage.removeItem('watchedVideos');
                localStorage.removeItem('videoBookmarks');
                localStorage.removeItem('favoriteVideos');
                localStorage.removeItem('videoPositions');
                state.lastWatched = {};
                localStorage.removeItem('videoLastWatched');
                renderNavigation();
                if (state.currentVideo) renderBookmarks();
                updateNotesBadge();
            });
        });
    }

    function applyTheme(themeName) {
        document.documentElement.setAttribute('data-theme', themeName);
        document.body.setAttribute('data-theme', themeName);
        localStorage.setItem('theme', themeName);
    }

    // ── Export / Import ───────────────────────────────────
    function downloadFile(filename, content, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
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
    document.getElementById('do-export').addEventListener('click', () => {
        const includeBookmarks = document.getElementById('exp-bookmarks').checked;
        const includeFavorites = document.getElementById('exp-favorites').checked;
        const includeSummaries = document.getElementById('exp-summaries').checked;
        const includeWatchHistory = document.getElementById('exp-watch-history').checked;
        const expandToLibrary = document.getElementById('exp-entire-library').checked;
        const currentVideoOnly = exportContext === 'video' && !expandToLibrary;
        const format = document.querySelector('input[name="export-format"]:checked').value;

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
            data.theme = localStorage.getItem('theme') || 'solarized-light';

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
                        const title = filename.replace(/\.(mp4|mov)$/i, '');
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
                        const title = filename.replace(/\.(mp4|mov)$/i, '');

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
                        const title = filename.replace(/\.(mp4|mov)$/i, '');

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
                        const title = parts.pop().replace(/\.(mp4|mov)$/i, '');
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

    importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = JSON.parse(evt.target.result);

                if (!data.watchedVideos && !data.videoBookmarks && !data.favoriteVideos) {
                    alert('Invalid backup file — no recognizable data found.');
                    return;
                }

                if (!confirm('Import this backup? This will MERGE with your existing data (not replace it). Continue?')) return;

                if (Array.isArray(data.watchedVideos)) {
                    const existing = new Set(safeLoad('watchedVideos', []));
                    data.watchedVideos.forEach(v => existing.add(v));
                    localStorage.setItem('watchedVideos', JSON.stringify([...existing]));
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
                    localStorage.setItem('videoBookmarks', JSON.stringify(existing));
                }

                if (Array.isArray(data.favoriteVideos)) {
                    const existing = new Set(safeLoad('favoriteVideos', []));
                    data.favoriteVideos.forEach(v => existing.add(v));
                    localStorage.setItem('favoriteVideos', JSON.stringify([...existing]));
                    existing.forEach(v => state.favorites.add(v));
                }

                if (data.videoPositions && typeof data.videoPositions === 'object') {
                    const existing = safeLoad('videoPositions', {});
                    for (const [path, pos] of Object.entries(data.videoPositions)) {
                        if (!existing[path] || pos > existing[path]) existing[path] = pos;
                    }
                    localStorage.setItem('videoPositions', JSON.stringify(existing));
                }

                if (data.videoLastWatched && typeof data.videoLastWatched === 'object') {
                    for (const [path, ts] of Object.entries(data.videoLastWatched)) {
                        if (!state.lastWatched[path] || ts > state.lastWatched[path]) state.lastWatched[path] = ts;
                    }
                    localStorage.setItem('videoLastWatched', JSON.stringify(state.lastWatched));
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
        btn.textContent = 'A';
        btn.className = 'overlay-btn';
        btn.title = 'A-B Loop: set start [ set end ] clear Esc';
    }

    function setLoopA() {
        const video = elements.videoPlayer;
        if (isNaN(video.duration)) return;
        state.loopA = video.currentTime;
        state.loopB = null;
        elements.abLoopBtn.textContent = 'A ' + formatTime(video.currentTime);
        elements.abLoopBtn.className = 'overlay-btn loop-a-set';
        elements.abLoopBtn.title = 'A-B Loop: Click to set end point (B)';
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
        video.currentTime = a;
        video.play().catch(() => {});
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
                localStorage.setItem('videoPositions', JSON.stringify(positions));
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
            localStorage.setItem('videoBookmarks', JSON.stringify(all));
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
        localStorage.setItem('videoBookmarks', JSON.stringify(all));
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
            pill.dataset.time = bk.t;
            pill.dataset.index = idx;
            const noteText = bk.n ? ` <span class="bookmark-note-text">\u2014 ${bk.n.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>` : '';
            pill.innerHTML = `<span class="bookmark-time-text">${formatTime(bk.t)}</span>${noteText}<span class="bookmark-edit-icon" data-idx="${idx}" title="Edit note">&#9998;</span><span class="bookmark-delete" data-idx="${idx}">&times;</span>`;
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
        bookmarks.push({ t: time, n: '' });
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
        const pill = e.target.closest('.bookmark-pill');
        if (pill) {
            const time = parseFloat(pill.dataset.time);
            elements.videoPlayer.currentTime = time;
            elements.videoPlayer.play().catch(() => {});
        }
    });

    // ── Speed Presets (Learn / Practice / Full) ─────────
    function setSpeed(speed) {
        state.playbackSpeed = speed;
        elements.videoPlayer.playbackRate = speed;
        // Update the overlay dropdown to match
        elements.currentSpeedBtn.innerText = speed.toFixed(2).replace(/\.00$/, '.0') + 'x';
        elements.speedDropdownBtns.forEach(b => {
            b.classList.toggle('active', parseFloat(b.dataset.speed) === speed);
        });
        // Update preset buttons
        elements.speedPresetBtns.forEach(b => {
            b.classList.toggle('active', parseFloat(b.dataset.speed) === speed);
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
    }

    elements.favBtn.addEventListener('click', () => {
        if (!state.currentVideo) return;
        const path = state.currentVideo.path;
        if (state.favorites.has(path)) {
            state.favorites.delete(path);
        } else {
            state.favorites.add(path);
        }
        localStorage.setItem('favoriteVideos', JSON.stringify([...state.favorites]));
        updateFavBtn();
        updateNotesBadge();
    });

    // ── Notes & Favorites View ─────────────────────────
    const notesView = document.getElementById('notes-view');
    const notesContent = document.getElementById('notes-content');
    const notesSubtitle = document.getElementById('notes-subtitle');

    function showNotesView() {
        // Stop video if playing
        if (elements.videoPlayer && !elements.videoPlayer.paused) elements.videoPlayer.pause();

        // Reset soft-delete state for fresh session
        pendingUnfavorites = new Set();

        elements.homeView.style.display = 'none';
        elements.videoView.style.display = 'none';
        notesView.style.display = 'block';
        renderNotesView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function resolveVideoObj(videoPath) {
        const info = videoData[videoPath];
        if (!info) return null;
        const parts = videoPath.split('/');
        const filename = parts.pop();
        const title = filename.replace(/\.(mp4|mov)$/i, '');
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
        const favCount = state.favorites.size;
        const subtitleParts = [];
        if (totalNotes > 0) subtitleParts.push(totalNotes + ' note' + (totalNotes !== 1 ? 's' : ''));
        if (totalBookmarks > 0) subtitleParts.push(totalBookmarks + ' bookmark' + (totalBookmarks !== 1 ? 's' : ''));
        if (favCount > 0) subtitleParts.push(favCount + ' favorite' + (favCount !== 1 ? 's' : ''));
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
                    <button class="notes-filter-btn ${notesFilterMode === 'all' ? 'active' : ''}" data-filter="all">All</button>
                    <button class="notes-filter-btn ${notesFilterMode === 'notes-only' ? 'active' : ''}" data-filter="notes-only">With notes</button>
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
                    const noteHtml = hasNote
                        ? `<span class="notes-bookmark-note">${escapedNote}</span>`
                        : '<span class="notes-bookmark-notext">No note</span>';
                    itemsHtml += `<div class="notes-bookmark-item ${hasNote ? 'has-note' : ''}" data-path="${videoPath}" data-time="${bk.t}" data-bk-idx="${realIdx}">
                        <span class="notes-bookmark-time">${formatTime(bk.t)}</span>
                        <span class="notes-bookmark-text-wrap">${noteHtml}</span>
                        <span class="notes-item-actions">
                            <span class="notes-item-edit" data-path="${videoPath}" data-bk-idx="${realIdx}" data-note="${escapedNote}" title="Edit note">&#9998;</span>
                            <span class="notes-item-delete" data-path="${videoPath}" data-bk-idx="${realIdx}" title="Delete bookmark">&times;</span>
                        </span>
                    </div>`;
                });

                group.innerHTML = `
                    <div class="notes-video-header">
                        <div>
                            <div class="notes-video-title" data-path="${videoPath}">${videoObj.title}</div>
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

        // ── Favorites Section ──
        // Show current favorites + pending unfavorites (soft-deleted, shown muted)
        const allFavPaths = new Set([...state.favorites, ...pendingUnfavorites]);
        if (allFavPaths.size > 0) {
            const section = document.createElement('div');
            section.className = 'notes-section';
            section.innerHTML = '<div class="notes-section-title">&#9733; Favorites</div>';

            for (const favPath of allFavPaths) {
                const videoObj = resolveVideoObj(favPath);
                if (!videoObj) continue;
                // Filter by search query — match path OR title
                if (sq && !favPath.toLowerCase().includes(sq) && !videoObj.title.toLowerCase().includes(sq)) continue;

                const isUnfavorited = pendingUnfavorites.has(favPath);
                const item = document.createElement('div');
                item.className = 'notes-fav-item' + (isUnfavorited ? ' notes-fav-removed' : '');
                item.dataset.path = favPath;
                item.innerHTML = `
                    <span class="notes-fav-star">${isUnfavorited ? '&#9734;' : '&#9733;'}</span>
                    <div style="flex:1;min-width:0;">
                        <div class="notes-fav-title">${videoObj.title}</div>
                        <div class="notes-fav-path">${videoObj.folderPath}</div>
                    </div>
                    <button class="notes-fav-toggle" data-path="${favPath}" title="${isUnfavorited ? 'Re-favorite' : 'Remove from favorites'}">
                        ${isUnfavorited ? 'Re-favorite' : 'Unfavorite'}
                    </button>
                `;
                section.appendChild(item);
            }

            notesContent.appendChild(section);
        }

        // ── Empty State ──
        if (bookmarkPaths.length === 0 && allFavPaths.size === 0) {
            notesContent.innerHTML = '<div class="notes-empty">No bookmarks, notes, or favorites yet. Start watching videos and use the bookmark and star buttons to build your collection.</div>';
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

        // Edit icon → inline edit
        const editIcon = e.target.closest('.notes-item-edit');
        if (editIcon) {
            e.stopPropagation();
            const item = editIcon.closest('.notes-bookmark-item');
            const textWrap = item.querySelector('.notes-bookmark-text-wrap');
            const currentNote = editIcon.dataset.note || '';
            const videoPath = editIcon.dataset.path;
            const bkIdx = parseInt(editIcon.dataset.bkIdx);

            // Replace text with input
            textWrap.innerHTML = `<input type="text" class="notes-inline-edit" value="${currentNote.replace(/"/g, '&quot;')}" placeholder="Add a note..." maxlength="120">`;
            const input = textWrap.querySelector('.notes-inline-edit');
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
                    allBk[videoPath] = arr;
                    localStorage.setItem('videoBookmarks', JSON.stringify(allBk));
                }
                renderNotesView();
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
            localStorage.setItem('videoBookmarks', JSON.stringify(allBk));
            renderNotesView();
            return;
        }

        // Bookmark item → load video + seek
        const bookmarkItem = e.target.closest('.notes-bookmark-item');
        if (bookmarkItem) {
            const videoObj = resolveVideoObj(bookmarkItem.dataset.path);
            if (videoObj) {
                const seekTime = parseFloat(bookmarkItem.dataset.time);
                notesView.style.display = 'none';
                skipNextResume = true;
                loadVideo(videoObj);
                const onReady = () => {
                    elements.videoPlayer.currentTime = seekTime;
                    elements.videoPlayer.removeEventListener('loadedmetadata', onReady);
                };
                elements.videoPlayer.addEventListener('loadedmetadata', onReady);
            }
            return;
        }

        // Video title → load video
        const videoTitle = e.target.closest('.notes-video-title');
        if (videoTitle) {
            const videoObj = resolveVideoObj(videoTitle.dataset.path);
            if (videoObj) {
                notesView.style.display = 'none';
                loadVideo(videoObj);
            }
            return;
        }

        // Favorite toggle button
        const favToggle = e.target.closest('.notes-fav-toggle');
        if (favToggle) {
            e.stopPropagation();
            const path = favToggle.dataset.path;
            if (pendingUnfavorites.has(path)) {
                // Re-favorite
                pendingUnfavorites.delete(path);
                state.favorites.add(path);
            } else {
                // Soft unfavorite
                pendingUnfavorites.add(path);
                state.favorites.delete(path);
            }
            localStorage.setItem('favoriteVideos', JSON.stringify([...state.favorites]));
            renderNotesView();
            return;
        }

        // Favorite item → load video (only if not unfavorited)
        const favItem = e.target.closest('.notes-fav-item');
        if (favItem) {
            if (favItem.classList.contains('notes-fav-removed')) return;
            const videoObj = resolveVideoObj(favItem.dataset.path);
            if (videoObj) {
                notesView.style.display = 'none';
                loadVideo(videoObj);
            }
            return;
        }
    }

    // Notes view click delegation — bound once
    notesContent.addEventListener('click', handleNotesClick);

    // Notes button in sidebar
    document.getElementById('notes-sidebar-btn').addEventListener('click', () => {
        showNotesView();
        if (window.innerWidth <= 768) {
            elements.sidebar.classList.remove('open');
            document.body.classList.remove('sidebar-open');
        }
    });

    // ── Theater Mode ─────────────────────────────────────
    const theaterBtn = document.getElementById('theater-btn');
    let theaterMode = false;

    function toggleTheater() {
        theaterMode = !theaterMode;
        document.body.classList.toggle('theater-mode', theaterMode);
        theaterBtn.classList.toggle('theater-active', theaterMode);
    }

    theaterBtn.addEventListener('click', toggleTheater);

    // ── Spotlight Search ─────────────────────────────────
    const spotlightOverlay = document.getElementById('spotlight-overlay');
    const spotlightInput = document.getElementById('spotlight-input');
    const spotlightResults = document.getElementById('spotlight-results');
    let spotlightActive = -1;

    function openSpotlight() {
        spotlightOverlay.style.display = 'flex';
        spotlightInput.value = '';
        spotlightResults.innerHTML = '';
        spotlightActive = -1;
        setTimeout(() => spotlightInput.focus(), 50);
    }

    function closeSpotlight() {
        spotlightOverlay.style.display = 'none';
        spotlightInput.value = '';
        spotlightResults.innerHTML = '';
    }

    function renderSpotlightResults(query) {
        spotlightResults.innerHTML = '';
        spotlightActive = -1;
        if (!query.trim()) return;

        const q = query.toLowerCase();
        const matches = [];

        for (const [path, info] of Object.entries(videoData)) {
            const parts = path.split('/');
            const filename = parts[parts.length - 1];
            const title = filename.replace(/\.(mp4|mov)$/i, '');
            const searchStr = (title + ' ' + parts.slice(0, -1).join(' ')).toLowerCase();

            if (searchStr.includes(q)) {
                matches.push({ title, path, folderPath: parts.slice(0, -1).join(' / '), info });
            }
            if (matches.length >= 12) break;
        }

        if (matches.length === 0) {
            spotlightResults.innerHTML = '<div class="spotlight-empty">No videos found</div>';
            return;
        }

        matches.forEach((m, i) => {
            const div = document.createElement('div');
            div.className = 'spotlight-result' + (i === 0 ? ' active' : '');
            div.innerHTML = `<span class="spotlight-result-title">${m.title}</span><span class="spotlight-result-path">${m.folderPath}</span>`;
            div.addEventListener('click', () => {
                const videoObj = { title: m.title, path: m.path, ...m.info };
                closeSpotlight();
                loadVideo(videoObj);
            });
            spotlightResults.appendChild(div);
        });
        spotlightActive = 0;
    }

    spotlightInput.addEventListener('input', () => {
        renderSpotlightResults(spotlightInput.value);
    });

    spotlightInput.addEventListener('keydown', (e) => {
        const items = spotlightResults.querySelectorAll('.spotlight-result');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length === 0) return;
            spotlightActive = Math.min(spotlightActive + 1, items.length - 1);
            items.forEach((el, i) => el.classList.toggle('active', i === spotlightActive));
            items[spotlightActive].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length === 0) return;
            spotlightActive = Math.max(spotlightActive - 1, 0);
            items.forEach((el, i) => el.classList.toggle('active', i === spotlightActive));
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

    // ── Shortcuts Overlay ────────────────────────────────
    const shortcutsOverlay = document.getElementById('shortcuts-overlay');

    function toggleShortcuts() {
        shortcutsOverlay.style.display = shortcutsOverlay.style.display === 'none' ? 'flex' : 'none';
    }

    document.getElementById('close-shortcuts').addEventListener('click', () => {
        shortcutsOverlay.style.display = 'none';
    });

    shortcutsOverlay.addEventListener('click', (e) => {
        if (e.target === shortcutsOverlay) shortcutsOverlay.style.display = 'none';
    });

    // ── Help Guide Modal ─────────────────────────────────
    const helpModal = document.getElementById('help-modal');

    document.getElementById('help-btn').addEventListener('click', () => {
        helpModal.style.display = 'flex';
        if (window.innerWidth <= 768) {
            elements.sidebar.classList.remove('open');
            document.body.classList.remove('sidebar-open');
        }
    });

    document.getElementById('close-help').addEventListener('click', () => {
        helpModal.style.display = 'none';
    });

    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) helpModal.style.display = 'none';
    });

    // ── Notes Manager Search ─────────────────────────────
    const notesSearchInput = document.getElementById('notes-search-input');

    notesSearchInput.addEventListener('input', () => {
        notesSearchQuery = notesSearchInput.value.trim().toLowerCase();
        renderNotesView();
    });

    // ── Keyboard Shortcuts ───────────────────────────────
    document.addEventListener('keydown', (e) => {
        // Skip if user is typing in an input/select/textarea
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

        // Global shortcuts
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            if (spotlightOverlay.style.display !== 'none') { closeSpotlight(); } else { openSpotlight(); }
            return;
        }

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
                v.paused ? v.play().catch(() => {}) : v.pause();
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
            case 'Escape':
                // Close overlays first (priority order)
                if (spotlightOverlay.style.display !== 'none') {
                    closeSpotlight();
                    return;
                }
                if (exportModal.style.display !== 'none') {
                    exportModal.style.display = 'none';
                    return;
                }
                if (shortcutsOverlay.style.display !== 'none') {
                    shortcutsOverlay.style.display = 'none';
                    return;
                }
                if (helpModal.style.display !== 'none') {
                    helpModal.style.display = 'none';
                    return;
                }
                if (elements.settingsModal.style.display === 'flex') {
                    elements.settingsModal.style.display = 'none';
                    return;
                }
                if (theaterMode) {
                    toggleTheater();
                    return;
                }
                if (state.loopA !== null || state.loopB !== null) {
                    clearABLoop();
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
});

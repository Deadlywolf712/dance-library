/* Course discovery shares the catalog and route controller; it owns no saved data. */
(function (root) {
    'use strict';

    const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en');
    const textElement = (tag, className, text) => {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        return element;
    };

    root.DanceCourseBrowser = {
        init({ catalog, present, sortFolders, currentPath, onOpen, onNavigate, suppressFocusReturn }) {
            const modal = document.getElementById('course-browser-modal');
            const search = document.getElementById('course-browser-search');
            const style = document.getElementById('course-browser-style');
            const results = document.getElementById('course-browser-results');
            const count = document.getElementById('course-browser-count');
            const clear = document.getElementById('course-browser-clear');
            const courses = catalog.categories.flatMap(category => {
                style.append(new Option(category, category));
                const folder = catalog.folder([category]);
                return sortFolders(Object.keys(folder.subfolders), false).map(name => {
                    const node = folder.subfolders[name];
                    const display = present(name, category);
                    return { category, path: node.path, count: node.count, ...display,
                        searchText: normalize(`${category} ${name} ${display.displayName} ${display.title} ${display.teacher} ${display.level}`) };
                });
            });

            function close({ navigate = false } = {}) {
                if (navigate) suppressFocusReturn(modal);
                modal.style.display = 'none';
            }

            function render() {
                const tokens = normalize(search.value).trim().split(/\s+/).filter(Boolean);
                const matches = courses.filter(course => (!style.value || course.category === style.value)
                    && tokens.every(token => course.searchText.includes(token)));
                const activePath = currentPath();
                clear.hidden = search.value.length === 0;
                count.textContent = `${matches.length} ${matches.length === 1 ? 'course' : 'courses'}`;
                const fragment = document.createDocumentFragment();
                for (const category of catalog.categories) {
                    const group = matches.filter(course => course.category === category);
                    if (!group.length) continue;
                    const section = document.createElement('section');
                    section.className = 'course-browser-group';
                    const heading = textElement('h3', 'course-browser-group-title', category);
                    section.append(heading);
                    for (const course of group) {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.className = 'course-browser-row';
                        button.dataset.path = JSON.stringify(course.path);
                        const active = activePath?.[0] === course.path[0] && activePath?.[1] === course.path[1];
                        const copy = textElement('span', 'course-browser-copy', '');
                        const title = textElement('span', 'course-browser-title', course.title);
                        copy.append(title);
                        if (course.teacher) copy.append(textElement('span', 'course-browser-teacher', course.teacher));
                        if (active) {
                            button.setAttribute('aria-current', 'true');
                            copy.append(textElement('span', 'course-browser-current', 'Current course'));
                        }
                        const meta = textElement('span', 'course-browser-meta', '');
                        if (course.level) meta.append(textElement('span', 'course-level', course.level));
                        meta.append(textElement('span', 'course-browser-lessons', `${course.count} ${course.count === 1 ? 'lesson' : 'lessons'}`));
                        const arrow = textElement('span', 'course-browser-arrow', '→');
                        arrow.setAttribute('aria-hidden', 'true');
                        button.append(copy, meta, arrow);
                        button.addEventListener('click', () => {
                            close({ navigate: true });
                            onNavigate([...course.path]);
                        });
                        section.append(button);
                    }
                    fragment.append(section);
                }
                if (!matches.length) {
                    const empty = textElement('div', 'course-browser-empty', '');
                    empty.append(textElement('p', 'course-browser-empty-title', 'No matching courses'));
                    empty.append(textElement('p', '', 'Try a teacher, course title, or another style.'));
                    fragment.append(empty);
                }
                results.replaceChildren(fragment);
                results.scrollTop = 0;
            }

            function open() {
                onOpen();
                search.value = '';
                style.value = '';
                render();
                modal.style.display = 'flex';
                requestAnimationFrame(() => {
                    const current = results.querySelector('[aria-current="true"]');
                    if (!current) return;
                    const row = current.getBoundingClientRect();
                    const viewport = results.getBoundingClientRect();
                    if (row.top < viewport.top || row.bottom > viewport.bottom) {
                        results.scrollTop += row.top - viewport.top - 8;
                    }
                });
            }

            document.getElementById('browse-courses-btn').addEventListener('click', open);
            document.getElementById('close-course-browser-btn').addEventListener('click', () => close());
            modal.addEventListener('click', event => { if (event.target === modal) close(); });
            search.addEventListener('input', render);
            style.addEventListener('change', render);
            clear.addEventListener('click', () => { search.value = ''; render(); search.focus(); });
            return { close };
        }
    };
})(globalThis);

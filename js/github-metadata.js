/* Optional public GitHub activity. No tokens, no private repository requests. */
(function () {
    'use strict';
    const owner = 'DoctorStrangeSH';
    const projects = [
        { repo: 'Skyward-Tales', selector: '.feature-game', detail: 'skyward-tales' },
        { repo: 'WorkPilot', selector: '.feature-automation', detail: 'workpilot' },
        { repo: 'GhostSignal', selector: '.feature-detective', detail: 'ghost-signal' },
        { repo: 'Last-Ritual', selector: '.feature-ritual', detail: 'last-ritual' },
        { repo: 'dm-workspace', selector: '.web-project-dm' },
        { repo: 'aethel-vtt', selector: '.web-project-aethel' }
    ];
    const cacheKey = 'devspace_public_github_v1';
    const ttl = 30 * 60 * 1000;
    const fmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
    let activity = {};

    function cacheRead() {
        try {
            const raw = JSON.parse(sessionStorage.getItem(cacheKey) || '{}');
            if (raw.expires > Date.now() && raw.data && typeof raw.data === 'object') return raw.data;
        } catch (_) { /* Storage may be blocked. */ }
        return null;
    }

    function cacheWrite(data) {
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ expires: Date.now() + ttl, data })); }
        catch (_) { /* The site works without sessionStorage. */ }
    }

    async function fetchPublic(repo) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        try {
            const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal
            });
            if (!response.ok) return null;
            const value = await response.json();
            // Never show private repository metadata, even if API permissions change.
            if (value.private !== false || value.full_name !== `${owner}/${repo}`) return null;
            const updated = Date.parse(value.pushed_at || '');
            if (!Number.isFinite(updated)) return null;
            return { stars: Math.max(0, Number(value.stargazers_count) || 0), pushed: updated };
        } catch (_) { return null; }
        finally { clearTimeout(timer); }
    }

    function label(data) {
        return `★ ${data.stars.toLocaleString('ru-RU')} · Код обновлялся ${fmt.format(new Date(data.pushed))}`;
    }

    function paintCards() {
        projects.forEach(project => {
            const card = document.querySelector(project.selector);
            if (!card) return;
            let el = card.querySelector('.github-live-meta');
            if (!el) {
                el = document.createElement('span');
                el.className = 'github-live-meta';
                el.setAttribute('aria-live', 'polite');
                card.append(el);
            }
            if (activity[project.repo]) {
                el.textContent = label(activity[project.repo]);
                el.hidden = false;
            } else {
                el.hidden = true;
            }
        });
    }

    function paintDetail() {
        const match = /^#project\/([a-z-]+)$/.exec(window.location.hash);
        const project = projects.find(item => item.detail === (match && match[1]));
        const panel = document.getElementById('showcaseContent');
        if (!panel || !project) return;
        const aside = panel.querySelector('.showcase-aside');
        if (!aside) return;
        let el = aside.querySelector('.github-detail-meta');
        if (!el) { el = document.createElement('p'); el.className = 'github-detail-meta'; aside.append(el); }
        if (activity[project.repo]) {
            el.textContent = label(activity[project.repo]);
            el.hidden = false;
        } else { el.hidden = true; }
    }

    async function init() {
        const stored = cacheRead();
        if (stored) activity = stored;
        paintCards(); paintDetail();
        if (stored) return;
        const responses = await Promise.all(projects.map(async project => [project.repo, await fetchPublic(project.repo)]));
        activity = Object.fromEntries(responses.filter(([, data]) => data));
        cacheWrite(activity);
        paintCards(); paintDetail();
    }

    window.addEventListener('hashchange', () => setTimeout(paintDetail, 0));
    // Re-render a detail when its route changes while the showcase remains open.
    const details = document.getElementById('showcaseContent');
    if (details) new MutationObserver(() => {
        if (!details.querySelector('.github-detail-meta')) paintDetail();
    }).observe(details, { childList: true, subtree: false });
    init();
})();

/* ============================================
   GITHUB SERVICE
   ============================================ */

var GitHubService = {
    _username: 'DoctorStrangeSH',

    init: function() {
        // Remove the legacy plaintext PAT. Public repository import uses no credentials.
        try { localStorage.removeItem('github_token'); } catch (_) {}
        console.log('GitHubService: public repositories only; no token stored');
    },

    getRepos: function() {
        if (!this._username) return Promise.resolve([]);

        var url = 'https://api.github.com/users/' + this._username + '/repos?sort=updated&per_page=30';

        return fetch(url)
            .then(function(res) {
                if (!res.ok) throw new Error('GitHub API error: ' + res.status);
                return res.json();
            })
            .then(function(repos) {
                if (!Array.isArray(repos)) return [];
                return repos.map(function(repo) {
                    return {
                        id: 'gh-' + repo.id,
                        name: repo.name,
                        description: repo.description || '',
                        url: repo.html_url,
                        stars: repo.stargazers_count,
                        forks: repo.forks_count,
                        language: repo.language,
                        updatedAt: repo.updated_at,
                        topics: repo.topics || [],
                        isGitHub: true
                    };
                });
            })
            .catch(function(err) {
                console.error('GitHubService:', err);
                return [];
            });
    },

    importAsProject: function(repoData) {
        return {
            name: repoData.name,
            description: repoData.description || '',
            status: 'development',
            github: repoData.url,
            demo: '',
            techStack: repoData.language ? [repoData.language] : [],
            tags: repoData.topics || [],
            progress: 0,
            checklist: [],
            updates: [],
            notes: [],
            screenshots: [],
            milestones: [],
            completedMilestones: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'github'
        };
    }
};

window.GitHubService = GitHubService;

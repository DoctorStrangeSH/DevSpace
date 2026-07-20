/* ============================================
   GITHUB SERVICE
   ============================================ */

var GitHubService = {
    _token: null,
    _username: 'DoctorStrangeSH',

    init: function() {
        this._token = localStorage.getItem('github_token');
        console.log('GitHubService: username =', this._username);
    },

    setToken: function(token) {
        this._token = token;
        localStorage.setItem('github_token', token);
    },

    isConnected: function() {
        return !!this._token;
    },

    getRepos: function() {
        if (!this._username) return Promise.resolve([]);
        
        var url = 'https://api.github.com/users/' + this._username + '/repos?sort=updated&per_page=30';
        var headers = {};
        if (this._token) {
            headers['Authorization'] = 'token ' + this._token;
        }
        
        return fetch(url, { headers: headers })
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
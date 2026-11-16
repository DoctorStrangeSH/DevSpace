/* ============================================
   FIREBASE SERVICE
   ============================================ */

var FIREBASE_ENABLED = true;

var FIREBASE_CONFIG = {
    apiKey: "AIzaSyCOKMOJvrtRLNiAUQX4JJ062zRSy1zZ14U",
    authDomain: "devspace-aa564.firebaseapp.com",
    projectId: "devspace-aa564",
    storageBucket: "devspace-aa564.firebasestorage.app",
    messagingSenderId: "229133858436",
    appId: "1:229133858436:web:9cf2ffc80ac3f68a9434d1"
};

var CURRENT_USER_ID = 'owner';

var FirebaseService = {
    _db: null,
    _initialized: false,
    _userId: CURRENT_USER_ID,
    // Anonymous static pages must never be able to mutate shared data.
    // A real server-verified owner session is required before enabling writes.
    _writesEnabled: false,

    COLLECTIONS: {
        PROJECTS: 'projects',
        SETTINGS: 'settings'
    },

    init: function() {
        if (!FIREBASE_ENABLED) {
            console.log('Firebase: отключен');
            return Promise.resolve();
        }

        if (this._initialized) return Promise.resolve();

        if (typeof firebase === 'undefined') {
            console.warn('Firebase: SDK не загружен');
            return Promise.resolve();
        }

        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }

            this._db = firebase.firestore();
            this._initialized = true;
            console.log('Firebase: инициализирован');
            return Promise.resolve();
        } catch (error) {
            console.error('Firebase: ошибка -', error.message);
            return Promise.resolve();
        }
    },

    getProjects: function() {
        if (!this._db) return Promise.resolve(null);
        
        return this._db
            .collection(this.COLLECTIONS.PROJECTS)
            .where('userId', '==', this._userId)
            .get()
            .then(function(snapshot) {
                var projects = [];
                snapshot.forEach(function(doc) {
                    var data = doc.data();
                    data.id = doc.id;
                    projects.push(data);
                });
                projects.sort(function(a, b) {
                    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
                });
                return projects;
            })
            .catch(function(error) {
                console.error('Firebase getProjects:', error);
                return null;
            });
    },

    // Read-only private preview; never merges into local state. The Firebase
    // authenticated session, not a user-provided UID, determines the path.
    getPrivateProjectPreview: function() {
        if (!this._db || typeof firebase === 'undefined' || !firebase.auth ||
            !firebase.auth().currentUser || !firebase.auth().currentUser.uid) {
            return Promise.resolve(null);
        }
        var uid = firebase.auth().currentUser.uid;
        var self = this;
        return this._db.collection('users').doc(uid).collection('projects')
            .limit(100).get().then(function(snapshot) {
                // Discard results if the identity changed during the request.
                if (!firebase.auth().currentUser || firebase.auth().currentUser.uid !== uid) return null;
                var result = [];
                snapshot.forEach(function(doc) {
                    var project = self._decodePrivateProjectDocument(doc.data(), doc.id);
                    if (project) result.push(project);
                });
                return result;
            }).catch(function(error) {
                console.warn('Private project preview unavailable:', error);
                return null;
            });
    },

    // Validate untrusted JSON before showing it in a read-only preview.
    // No preview result is ever merged into the local project store.
    _decodePrivateProjectDocument: function(data, documentId) {
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
            typeof documentId !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(documentId) ||
            data.id !== documentId || data.schemaVersion !== 1 ||
            typeof data.payload !== 'string' || data.payload.length < 2 || data.payload.length > 200000 ||
            Object.keys(data).some(function(key) {
                return ['id', 'schemaVersion', 'payload', 'updatedAt'].indexOf(key) === -1;
            })) return null;
        try {
            var project = JSON.parse(data.payload);
            if (!project || typeof project !== 'object' || Array.isArray(project) ||
                project.id !== documentId || Object.keys(project).some(function(key) {
                    return key === '__proto__' || key === 'constructor' || key === 'prototype';
                })) return null;
            return project;
        } catch (error) {
            return null;
        }
    },

    // Builds data matching the prototype Firestore rules; does NOT write it.
    // A future explicit upload must attach firebase.firestore.FieldValue.serverTimestamp().
    _preparePrivateProjectEnvelope: function(project) {
        if (!project || typeof project !== 'object' || Array.isArray(project) ||
            typeof project.id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(project.id)) return null;
        try {
            var payload = JSON.stringify(project);
            if (!payload || payload.length < 2 || payload.length > 200000 ||
                !this._decodePrivateProjectDocument({
                    id: project.id, schemaVersion: 1, payload: payload
                }, project.id)) return null;
            return { id: project.id, schemaVersion: 1, payload: payload };
        } catch (error) {
            return null;
        }
    },

    deleteProject: function(projectId) {
        if (!this._writesEnabled) return Promise.resolve(false);
        if (!this._db) return Promise.resolve(false);
        
        return this._db
            .collection(this.COLLECTIONS.PROJECTS)
            .doc(projectId)
            .delete()
            .then(function() {
                console.log('Firebase: проект удален');
                return true;
            })
            .catch(function(error) {
                console.error('Firebase deleteProject:', error);
                return false;
            });
    },

    saveAllProjects: function(projects) {
        if (!this._writesEnabled) return Promise.resolve(false);
        if (!this._db) return Promise.resolve();
        
        if (!projects || !projects.length) {
            return this.clearAllProjects();
        }
        
        var self = this;
        var batch = this._db.batch();
        
        projects.forEach(function(project) {
            var ref = self._db.collection(self.COLLECTIONS.PROJECTS).doc(project.id);
            var docData = {};
            Object.keys(project).forEach(function(key) {
                docData[key] = project[key];
            });
            docData.userId = self._userId;
            docData.syncedAt = new Date().toISOString();
            batch.set(ref, docData, { merge: true });
        });
        
        return batch.commit()
            .then(function() {
                console.log('Firebase: сохранено', projects.length, 'проектов');
            })
            .catch(function(error) {
                console.error('Firebase saveAllProjects:', error);
            });
    },

    getSettings: function() {
        if (!this._db) return Promise.resolve(null);
        
        return this._db
            .collection(this.COLLECTIONS.SETTINGS)
            .doc(this._userId)
            .get()
            .then(function(doc) {
                return doc.exists ? doc.data() : null;
            })
            .catch(function() { return null; });
    },

    saveSettings: function(settings) {
        if (!this._writesEnabled) return Promise.resolve(false);
        if (!this._db) return Promise.resolve();
        
        return this._db
            .collection(this.COLLECTIONS.SETTINGS)
            .doc(this._userId)
            .set(settings, { merge: true })
            .catch(function(error) {
                console.error('Firebase saveSettings:', error);
            });
    },

    clearAllProjects: function() {
        if (!this._writesEnabled) return Promise.resolve(false);
        if (!this._db) return Promise.resolve();
        
        var self = this;
        
        return this._db
            .collection(this.COLLECTIONS.PROJECTS)
            .where('userId', '==', this._userId)
            .get()
            .then(function(snapshot) {
                if (snapshot.empty) return;
                
                var batch = self._db.batch();
                snapshot.forEach(function(doc) {
                    batch.delete(doc.ref);
                });
                
                return batch.commit();
            })
            .catch(function(error) {
                console.error('Firebase clearAllProjects:', error);
            });
    },

    clearAllData: function() {
        if (!this._writesEnabled) return Promise.resolve(false);
        if (!this._db) return Promise.resolve();
        
        var self = this;
        
        return this._db
            .collection(this.COLLECTIONS.PROJECTS)
            .where('userId', '==', this._userId)
            .get()
            .then(function(snapshot) {
                var batch = self._db.batch();
                
                snapshot.forEach(function(doc) {
                    batch.delete(doc.ref);
                });
                
                var settingsRef = self._db.collection(self.COLLECTIONS.SETTINGS).doc(self._userId);
                batch.delete(settingsRef);
                
                return batch.commit();
            })
            .catch(function(error) {
                console.error('Firebase clearAllData:', error);
            });
    }
};

window.FirebaseService = FirebaseService;

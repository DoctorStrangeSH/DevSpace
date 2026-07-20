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

    deleteProject: function(projectId) {
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
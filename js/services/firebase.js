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
    // Owner confirmed publishing create-only Firestore rules on 2026-11-17.
    // This gate is used ONLY by an explicit, single-project upload.
    // Automatic sync, updates and deletions remain disabled.
    _privateProjectCreatesEnabled: true,
    _lastPrivatePreviewError: null,
    _lastPrivateCreateError: null,

    _describePrivateCreateError: function(code) {
        switch (code) {
            case 'permission-denied': return 'Firebase отклонил запись. Проверь, что опубликованы именно правила создания проектов для владельца.';
            case 'unauthenticated': return 'Сессия Google изменилась. Войди снова и запусти проверку.';
            case 'already-exists': return 'Проект с таким ID уже есть в облаке. Он не перезаписан.';
            case 'invalid-project': return 'Проект не соответствует требованиям безопасности или превышает допустимый размер.';
            case 'unavailable': return 'Нет связи с Firestore. Проверь интернет и затем повтори проверку.';
            case 'deadline-exceeded': return 'Истекло время ожидания Firebase. Проверь облако, прежде чем повторять загрузку.';
            case 'verification-failed': return 'Не удалось подтвердить сохранение. Сначала обнови список облачных проектов.';
            default: return 'Не удалось подтвердить создание. Запусти проверку облака перед повтором.';
        }
    },

    _describePrivatePreviewError: function(code) {
        switch (code) {
            case 'permission-denied': return 'Доступ запрещён правилами Firestore. Проверь разрешения для своего UID.';
            case 'unauthenticated': return 'Сессия Google истекла. Выйди и войди снова.';
            case 'unavailable': return 'Firestore временно недоступен. Проверь интернет и повтори попытку.';
            case 'deadline-exceeded': return 'Firestore не ответил вовремя. Повтори попытку.';
            case 'invalid-document': return 'В облаке есть повреждённый или неподдерживаемый проект. Перенос остановлен.';
            case 'too-many-projects': return 'В облаке 100 или больше проектов. Требуется постраничная проверка.';
            default: return 'Не удалось прочитать приватные проекты. Повтори попытку позже.';
        }
    },

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
        this._lastPrivatePreviewError = null;
        if (!this._db || typeof firebase === 'undefined' || !firebase.auth ||
            !firebase.auth().currentUser || !firebase.auth().currentUser.uid) {
            this._lastPrivatePreviewError = 'unauthenticated';
            return Promise.resolve(null);
        }
        var uid = firebase.auth().currentUser.uid;
        var self = this;
        return this._db.collection('users').doc(uid).collection('projects')
            .limit(100).get().then(function(snapshot) {
                // Discard results if the identity changed during the request.
                if (!firebase.auth().currentUser || firebase.auth().currentUser.uid !== uid) return null;
                var result = [];
                var invalid = false;
                snapshot.forEach(function(doc) {
                    var project = self._decodePrivateProjectDocument(doc.data(), doc.id);
                    if (project) result.push(project);
                    else invalid = true;
                });
                // A partial or malformed inventory must never produce a migration plan.
                if (invalid) {
                    self._lastPrivatePreviewError = 'invalid-document';
                    return null;
                }
                if (result.length >= 100) {
                    self._lastPrivatePreviewError = 'too-many-projects';
                    return null;
                }
                return result;
            }).catch(function(error) {
                if (!firebase.auth().currentUser || firebase.auth().currentUser.uid !== uid) return null;
                var allowed = ['permission-denied', 'unauthenticated', 'unavailable', 'deadline-exceeded'];
                var code = error && error.code;
                self._lastPrivatePreviewError = allowed.indexOf(code) !== -1 ? code : 'unknown';
                console.warn('Private project preview unavailable:', self._lastPrivatePreviewError);
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
                project.id !== documentId || !this._isSafePrivateProjectTree(project)) return null;
            return project;
        } catch (error) {
            return null;
        }
    },

    // Prevent dangerous keys at ANY depth, and limit nesting/node count before
    // a future cloud download can be merged into local application state.
    _isSafePrivateProjectTree: function(root) {
        var stack = [{ value: root, depth: 0 }];
        var nodes = 0;
        while (stack.length) {
            var current = stack.pop();
            if (++nodes > 10000 || current.depth > 40) return false;
            var value = current.value;
            if (!value || typeof value !== 'object') continue;
            var keys = Object.keys(value);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false;
                stack.push({ value: value[key], depth: current.depth + 1 });
            }
        }
        return true;
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

    // Create ONE private project only if absent. A Firestore transaction makes
    // the absence check atomic with creation, even across several devices.
    // This is intentionally unreachable in production while the gate is false.
    createPrivateProjectIfAbsent: function(project, expectedUid) {
        this._lastPrivateCreateError = null;
        if (!this._privateProjectCreatesEnabled || !this._db ||
            typeof firebase === 'undefined' || !firebase.auth ||
            !firebase.firestore || !firebase.firestore.FieldValue ||
            !firebase.firestore.FieldValue.serverTimestamp) {
            this._lastPrivateCreateError = 'unavailable';
            return Promise.resolve(false);
        }
        var envelope = this._preparePrivateProjectEnvelope(project);
        if (!envelope || typeof expectedUid !== 'string' || !expectedUid ||
            !firebase.auth().currentUser || firebase.auth().currentUser.uid !== expectedUid) {
            this._lastPrivateCreateError = envelope ? 'unauthenticated' : 'invalid-project';
            return Promise.resolve(false);
        }
        var self = this;
        var reference = this._db.collection('users').doc(expectedUid)
            .collection('projects').doc(envelope.id);
        return this._db.runTransaction(function(transaction) {
            return transaction.get(reference).then(function(snapshot) {
                // Never replace an existing project, even when contents match.
                if (snapshot.exists) {
                    self._lastPrivateCreateError = 'already-exists';
                    return false;
                }
                if (!firebase.auth().currentUser ||
                    firebase.auth().currentUser.uid !== expectedUid ||
                    !self._privateProjectCreatesEnabled) {
                    self._lastPrivateCreateError = 'unauthenticated';
                    return false;
                }
                transaction.set(reference, {
                    id: envelope.id,
                    schemaVersion: envelope.schemaVersion,
                    payload: envelope.payload,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                return true;
            });
        }).then(function(created) {
            if (!created) return false;
            if (!firebase.auth().currentUser ||
                firebase.auth().currentUser.uid !== expectedUid) {
                self._lastPrivateCreateError = 'unauthenticated';
                return false;
            }
            return reference.get().then(function(saved) {
                if (!firebase.auth().currentUser || firebase.auth().currentUser.uid !== expectedUid ||
                    !saved.exists) {
                    self._lastPrivateCreateError = 'verification-failed';
                    return false;
                }
                var data = saved.data();
                var verified = !!(data && data.payload === envelope.payload &&
                    self._decodePrivateProjectDocument(data, envelope.id));
                if (!verified) self._lastPrivateCreateError = 'verification-failed';
                return verified;
            });
        }).catch(function(error) {
            var allowed = ['permission-denied', 'unauthenticated', 'unavailable', 'deadline-exceeded', 'already-exists'];
            self._lastPrivateCreateError = allowed.indexOf(error && error.code) !== -1 ? error.code : 'unknown';
            return false;
        });
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

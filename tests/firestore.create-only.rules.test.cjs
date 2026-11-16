const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, serverTimestamp } = require('firebase/firestore');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.create-only.rules'), 'utf8');
const envPromise = initializeTestEnvironment({
  projectId: 'demo-devspace-rules',
  firestore: { rules }
});

test('create-only prototype isolates users and never changes existing data', async () => {
  const env = await envPromise;
  try {
    const owner = env.authenticatedContext('user-A').firestore();
    const stranger = env.authenticatedContext('user-B').firestore();
    const guest = env.unauthenticatedContext().firestore();
    const item = 'users/user-A/projects/sample';
    const ref = doc(owner, item);
    const valid = { id: 'sample', schemaVersion: 1, payload: '{"id":"sample"}', updatedAt: serverTimestamp() };

    await assertFails(setDoc(doc(stranger, item), valid));
    await assertFails(setDoc(doc(guest, item), valid));
    await assertFails(getDoc(doc(stranger, item)));
    await assertFails(getDocs(collection(stranger, 'users/user-A/projects')));
    await assertFails(getDoc(doc(guest, item)));
    await assertSucceeds(setDoc(ref, valid));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(getDocs(collection(owner, 'users/user-A/projects')));
    await assertFails(setDoc(ref, valid));
    await assertFails(updateDoc(ref, { payload: '{"id":"sample","modified":true}' }));
    await assertFails(deleteDoc(ref));
    await assertFails(setDoc(doc(owner, 'projects/legacy'), valid));
    await assertFails(getDoc(doc(owner, 'users/user-A/healthHistory/today')));
    await assertFails(setDoc(doc(owner, 'users/user-A/settings/main'), valid));
  } finally {
    await env.clearFirestore();
  }
});

test('create-only prototype rejects malformed fields and cross-account paths', async () => {
  const env = await envPromise;
  try {
    const owner = env.authenticatedContext('user-A').firestore();
    const item = doc(owner, 'users/user-A/projects/sample');
    const valid = { id: 'sample', schemaVersion: 1, payload: '{"id":"sample"}', updatedAt: serverTimestamp() };
    for (const bad of [
      { ...valid, id: 'other' },
      { ...valid, schemaVersion: 2 },
      { ...valid, payload: 42 },
      { ...valid, payload: '' },
      { ...valid, payload: 'x'.repeat(200001) },
      { ...valid, updatedAt: new Date('2020-01-01') },
      { ...valid, privileged: true },
      { ...valid, uid: 'user-B' },
      { ...valid, role: 'admin' },
      { id: 'sample', payload: valid.payload, updatedAt: serverTimestamp() }
    ]) await assertFails(setDoc(item, bad));
    await assertFails(setDoc(doc(owner, 'users/user-B/projects/sample'), valid));
  } finally {
    await env.clearFirestore();
  }
});

test.after(async () => { const env = await envPromise; await env.cleanup(); });

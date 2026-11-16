const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, serverTimestamp } = require('firebase/firestore');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const envPromise = initializeTestEnvironment({
  projectId: 'demo-devspace-rules',
  firestore: { rules }
});

test('private Firestore rules enforce UID isolation and block legacy collections', async () => {
  const env = await envPromise;
  try {
    const anonymous = env.unauthenticatedContext().firestore();
    const owner = env.authenticatedContext('user-A').firestore();
    const stranger = env.authenticatedContext('user-B').firestore();
    const privateProject = 'users/user-A/projects/example';
    const legacyProject = 'projects/example';

    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, privateProject), { name: 'Private project' });
      await setDoc(doc(db, legacyProject), { name: 'Legacy project' });
    });

    await assertSucceeds(getDoc(doc(owner, privateProject)));
    await assertFails(getDoc(doc(stranger, privateProject)));
    await assertFails(getDoc(doc(anonymous, privateProject)));
    await assertFails(setDoc(doc(owner, privateProject), { name: 'Tampered' }));
    await assertFails(deleteDoc(doc(owner, privateProject)));
    await assertFails(getDoc(doc(owner, legacyProject)));
    await assertFails(getDoc(doc(anonymous, legacyProject)));
    await assertFails(setDoc(doc(stranger, legacyProject), { name: 'Attack' }));
  } finally {
    await env.clearFirestore();
  }
});

test('project writes remain disabled even for valid owner envelopes', async () => {
  const env = await envPromise;
  try {
    const owner = env.authenticatedContext('user-A').firestore();
    const stranger = env.authenticatedContext('user-B').firestore();
    const item = 'users/user-A/projects/new-project';
    const valid = { id: 'new-project', schemaVersion: 1, payload: '{"name":"Example"}', updatedAt: serverTimestamp() };
    await assertFails(setDoc(doc(stranger, item), valid));
    await assertFails(setDoc(doc(owner, item), { ...valid, id: 'other-project' }));
    await assertFails(setDoc(doc(owner, item), { ...valid, role: 'admin' }));
    await assertFails(setDoc(doc(owner, item), { ...valid, payload: 'x'.repeat(200001) }));
    await assertFails(setDoc(doc(owner, item), valid));
    await assertFails(setDoc(doc(owner, item), { ...valid, schemaVersion: 2 }));
    await assertFails(setDoc(doc(owner, item), { ...valid, payload: 123 }));
    await assertFails(setDoc(doc(owner, item), { ...valid, payload: '{"name":"Updated"}' }));
    await assertFails(deleteDoc(doc(owner, item)));
  } finally {
    await env.clearFirestore();
  }
});

test('health history remains fully closed during read-only migration preview stage', async () => {
  const env = await envPromise;
  try {
    const owner = env.authenticatedContext('user-A').firestore();
    const stranger = env.authenticatedContext('user-B').firestore();
    const record = 'users/user-A/healthHistory/2026-11-15';
    await assertFails(setDoc(doc(stranger, record), { date: '2026-11-15', scores: {}, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(owner, record), { date: '2026-11-14', scores: {}, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(owner, record), { date: '2026-11-15', scores: {}, extra: true, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(owner, record), { date: '2026-11-15', scores: { a: 80 }, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(owner, record), { date: '2026-11-15', scores: {}, extra: true, updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(stranger, record)));
    await assertFails(getDoc(doc(owner, record)));
  } finally {
    await env.clearFirestore();
  }
});

test.after(async () => {
  const env = await envPromise;
  await env.cleanup();
});

import { getFirestore as _get, initializeFirestore as _init, connectFirestoreEmulator } from 'firebase/firestore';
export * from 'firebase/firestore';
const seen = new WeakSet();
const wire = (d) => { if (!seen.has(d)) { seen.add(d); try { connectFirestoreEmulator(d, '127.0.0.1', 8080); } catch (e) {} } return d; };
export function getFirestore(...a) { return wire(_get(...a)); }
export function initializeFirestore(...a) { return wire(_init(...a)); }
export function enableIndexedDbPersistence() { return Promise.resolve(); }

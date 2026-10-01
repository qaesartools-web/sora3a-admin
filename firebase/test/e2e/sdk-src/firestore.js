import { getFirestore as _get, connectFirestoreEmulator } from 'firebase/firestore';
export * from 'firebase/firestore';
const seen = new WeakSet();
export function getFirestore(...a){ const d=_get(...a); if(!seen.has(d)){ seen.add(d); try{ connectFirestoreEmulator(d,'127.0.0.1',8080); }catch(e){} } return d; }
export function enableIndexedDbPersistence(){ return Promise.resolve(); }

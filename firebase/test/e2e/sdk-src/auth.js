import { initializeAuth as _init, getAuth as _get, connectAuthEmulator } from 'firebase/auth';
export * from 'firebase/auth';
const seen = new WeakSet();
function hook(a){ if(!seen.has(a)){ seen.add(a); try{ connectAuthEmulator(a,'http://127.0.0.1:9099',{disableWarnings:true}); }catch(e){} } return a; }
export function initializeAuth(app, deps){ return hook(_init(app, deps)); }
export function getAuth(app){ return hook(_get(app)); }

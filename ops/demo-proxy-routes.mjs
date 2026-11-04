/** Shared exact demo allowlist. Run-status recovery adds one UUID-shaped GET route only. */
const exact=new Set(['/api/demo/login','/api/demo/health','/api/demo/reset']);
const status=/^\/api\/demo\/reset\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const demoProxyAllowed=path=>exact.has(path)||status.test(path);
export const resetStatusMethodAllowed=(path,method)=>!status.test(path)||method==='GET';

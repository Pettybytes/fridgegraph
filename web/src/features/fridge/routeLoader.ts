// Module-only prefetch: imports definitions, never calls an adapter or fetches
// family records. The mounted route still reads through the CURRENT context.
let pending:ReturnType<typeof load>|undefined
const load=()=>import('./ConnectedFridge').then(module=>({default:module.ConnectedFridge}))
export function loadFridgeRoute(){return pending??=load().catch(error=>{pending=undefined;throw error})}
export function prefetchFridgeRoute(){void loadFridgeRoute().catch(()=>{/* Navigation retains its normal retry/error behavior. */})}

// Re-export of the one Tauri bridge (web/src/app/bridge.js) so panel and avatar share it.
export { invoke, listen, emit, isTauri } from '../../../web/src/app/bridge.js';

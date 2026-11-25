// Default app config: the single source for pages and (via set_hotkeys) for Rust.
// Hotkey accelerators use the Tauri global-shortcut format ("Ctrl+Alt+F", "F13", "Shift+Numpad1").
export const ACTIONS = [
  { id: 'play:flush', name: 'Descarga (vomitar água)' },
  { id: 'play:paper', name: 'Papel higiênico' },
  { id: 'play:jump', name: 'Pulo' },
  { id: 'play:backflip', name: 'Mortal' },
  { id: 'play:no', name: 'Não (balança a cabeça)' },
  { id: 'play:gargle', name: 'Gargarejo' },
  { id: 'play:blink', name: 'Piscar' },
  { id: 'toggle:clickthrough', name: 'Liga/desliga clicar através' },
  { id: 'toggle:follow', name: 'Liga/desliga seguir o mouse' },
  { id: 'toggle:mic', name: 'Liga/desliga microfone' },
  { id: 'open:control', name: 'Abrir painel' },
  { id: 'sala:editar', name: 'Abrir/fechar editor da Sala 3D' },
];

export const DEFAULT_CONFIG = {
  migr044: true, migr045: true,   // configs novas já nascem no formato atual (ver config.rs::migrate)
  version: 1,
  character: 'privada',   // 'privada' (toilet) | 'chratos' (human avatar)
  activeOutfit: 'base',
  outfits: {},
  activeScene: 0,
  // Default = the character lives in its own normal window (taskbar/alt-tab, OBS "Captura de janela").
  // The desktop overlay is optional (mode 'overlay').
  scenes: [
    { name: 'Janela (OBS chroma)', mode: 'window', outfit: null, x: 0.5, y: 0.86, scale: 1.25, background: 'color', bgColor: '#00ff00', follow: true, mic: true, clickThrough: 'off', alwaysOnTop: false },
    { name: 'Janela transparente', mode: 'window', outfit: null, x: 0.5, y: 0.86, scale: 1.25, background: 'transparent', bgColor: '#00ff00', follow: true, mic: true, clickThrough: 'off', alwaysOnTop: false },
    { name: 'Sala 3D (cenário completo)', mode: 'window', outfit: null, x: 0.5, y: 0.86, scale: 1.25, background: 'sala', bgColor: '#000000', winSize: '1920x1080', follow: true, mic: true, clickThrough: 'off', alwaysOnTop: false },
    { name: 'Ilha tropical 3D', mode: 'window', outfit: null, x: 0.5, y: 0.86, scale: 1.25, background: 'ilha', bgColor: '#000000', winSize: '1920x1080', follow: true, mic: true, clickThrough: 'off', alwaysOnTop: false },
    { name: 'Gameplay (vaso no canto)', mode: 'window', outfit: null, x: 0.91, y: 0.975, scale: 1.05, background: 'transparent', bgColor: '#00ff00', winSize: '1920x1080', follow: true, mic: true, clickThrough: 'off', alwaysOnTop: false, transicao: 'descarga' },
    { name: 'Desktop (overlay, opcional)', mode: 'overlay', outfit: null, x: 0.84, y: 0.8, scale: 1.0, background: 'transparent', bgColor: '#00ff00', follow: true, mic: true, clickThrough: 'on', alwaysOnTop: true },
  ],
  hotkeys: {
    'Ctrl+Alt+F': { action: 'play', arg: 'flush' },
    'Ctrl+Alt+P': { action: 'play', arg: 'paper' },
    'Ctrl+Alt+J': { action: 'play', arg: 'jump' },
    'Ctrl+Alt+K': { action: 'play', arg: 'backflip' },
    'Ctrl+Alt+N': { action: 'play', arg: 'no' },
    'Ctrl+Alt+G': { action: 'play', arg: 'gargle' },
    'Ctrl+Alt+T': { action: 'toggle', arg: 'clickthrough' },
    'Ctrl+Alt+M': { action: 'toggle', arg: 'mic' },
    'Ctrl+Alt+O': { action: 'open', arg: 'control' },
    'Ctrl+Alt+1': { action: 'scene', arg: '0' },
    'Ctrl+Alt+2': { action: 'scene', arg: '1' },
    'Ctrl+Alt+3': { action: 'scene', arg: '2' },
    'Ctrl+Alt+4': { action: 'scene', arg: '3' },
    'Ctrl+Alt+5': { action: 'scene', arg: '4' },
    'Ctrl+Alt+6': { action: 'scene', arg: '5' },
    'Ctrl+Shift+1': { action: 'outfit', arg: 'base' },
    'Ctrl+Shift+2': { action: 'outfit', arg: 'soviet' },
    'Ctrl+Shift+3': { action: 'outfit', arg: 'golden' },
  },
  audio: { enabled: true, device: null, gateDb: -50, rangeDb: 28, hold: 0.14, gainDb: 0, autoLevel: true },
  render: { fps: 60, pixelRatio: 1.5, ao: false },
  // look: how far he turns toward the mouse (whole virtual desktop, all monitors)
  look: { range: 1.0, reachPx: 1400, maxYawDeg: 80, maxPitchDeg: 35 },
  settings: { openPanelOnStart: true },
};

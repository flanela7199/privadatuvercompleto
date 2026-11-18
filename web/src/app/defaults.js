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
  { id: 'reset:position', name: 'Voltar para a posição da cena' },
  { id: 'open:control', name: 'Abrir painel' },
];

export const DEFAULT_CONFIG = {
  version: 1,
  activeOutfit: 'base',
  outfits: {},
  activeScene: 0,
  scenes: [
    { name: 'Desktop (canto)', mode: 'overlay', outfit: null, x: 0.84, y: 0.8, scale: 1.0, background: 'transparent', bgColor: '#00ff00', follow: true, mic: true, clickThrough: 'auto' },
    { name: 'Centro grande', mode: 'overlay', outfit: null, x: 0.5, y: 0.75, scale: 1.8, background: 'transparent', bgColor: '#00ff00', follow: true, mic: true, clickThrough: 'auto' },
    { name: 'OBS (chroma verde)', mode: 'window', outfit: null, x: 0.5, y: 0.82, scale: 1.3, background: 'color', bgColor: '#00ff00', follow: true, mic: true, clickThrough: 'off' },
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
    'Ctrl+Alt+R': { action: 'reset', arg: 'position' },
    'Ctrl+Alt+O': { action: 'open', arg: 'control' },
    'Ctrl+Alt+1': { action: 'scene', arg: '0' },
    'Ctrl+Alt+2': { action: 'scene', arg: '1' },
    'Ctrl+Alt+3': { action: 'scene', arg: '2' },
    'Ctrl+Shift+1': { action: 'outfit', arg: 'base' },
    'Ctrl+Shift+2': { action: 'outfit', arg: 'soviet' },
    'Ctrl+Shift+3': { action: 'outfit', arg: 'golden' },
  },
  audio: { enabled: true, device: null, gateDb: -50, rangeDb: 28, hold: 0.14 },
  render: { fps: 60, pixelRatio: 1.5, ao: false },
};

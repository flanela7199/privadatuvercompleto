import React from 'react';
import { emit, listen } from '../lib/bridge';
import { useStore } from '../state/config';

/**
 * Mirror of the character window — the panel never renders the character itself.
 * The avatar window streams small frames (`preview-frame` {data, w, h, seq}) while we ask for them:
 *   preview-want {on:true, fps:8, width:320}  every 2 s while this tab is visible + focused (heartbeat)
 *   preview-want {on:false}                   on blur / hidden / tab switch / unmount
 *   preview-snap                              once after every config/outfit change (fresh frame even at 0 fps)
 */
export function Preview({ active }: { active: boolean }) {
  const { s } = useStore();
  const [src, setSrc] = React.useState<string | null>(null);
  const lastSeq = React.useRef(-1);

  React.useEffect(() => listen('preview-frame', (f: any) => {
    if (!f?.data) return;
    if (typeof f.seq === 'number') { if (f.seq <= lastSeq.current && lastSeq.current - f.seq < 1000) return; lastSeq.current = f.seq; }
    setSrc(f.data);
  }), []);

  // heartbeat while visible + focused + on this tab
  React.useEffect(() => {
    let on = false;
    const want = () => document.visibilityState === 'visible' && document.hasFocus() && active;
    const tick = () => {
      const w = want();
      if (w) emit('preview-want', { on: true, fps: 8, width: 320 });
      else if (on) emit('preview-want', { on: false });
      on = w;
    };
    tick();
    const iv = setInterval(tick, 2000);
    const onChange = () => tick();
    addEventListener('focus', onChange);
    addEventListener('blur', onChange);
    document.addEventListener('visibilitychange', onChange);
    return () => {
      clearInterval(iv);
      removeEventListener('focus', onChange);
      removeEventListener('blur', onChange);
      document.removeEventListener('visibilitychange', onChange);
      emit('preview-want', { on: false });
    };
  }, [active]);

  // fresh frame after every change (the avatar applies the new state first)
  React.useEffect(() => {
    const t = setTimeout(() => emit('preview-snap', {}), 150);
    return () => clearTimeout(t);
  }, [s.cfg, s.work]);

  return (
    <div id="preview" className={src ? '' : 'skel'}>
      {src && <img src={src} alt="Privada Tuber" draggable={false} />}
      <div className="hint">{src ? 'espelho da janela do personagem' : 'esperando a janela do personagem…'}</div>
    </div>
  );
}

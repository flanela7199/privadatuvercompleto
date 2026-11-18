import React from 'react';
import { accessoryThumb, presetThumb, customThumb, onThumbsChanged } from '../lib/thumbs';

export const CATEGORY_ICON: Record<string, string> = {
  Chapéus: '🎩', Olhos: '🕶️', Rosto: '👄', Bigodes: '🥸', Corpo: '👔', Objetos: '🧸', Outros: '📦',
};

/**
 * Thumbnail image:
 *   acc="id"              accessory (static web/thumbs image, else rendered once + cached)
 *   preset="id"           built-in preset/theme (static image only)
 *   preset="id" custom    user outfit (frame captured from the character window)
 * Requested when the element is on screen; skeleton while loading; fallback icon (with the
 * reason in the tooltip) when there is no image.
 */
export function Thumb({ acc, preset, custom, theme, className = 'img', icon = '📦', onClick, title }: {
  acc?: string; preset?: string; custom?: boolean; theme?: any; className?: string; icon?: string; onClick?: () => void; title?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [gen, setGen] = React.useState(0);
  React.useEffect(() => onThumbsChanged(() => setGen((g) => g + 1)), []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const onScreen = () => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > -150 && r.top < innerHeight + 150 && r.right > 0 && r.left < innerWidth;
    };
    let io: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setVisible(true); }, { rootMargin: '150px' });
      io.observe(el);
    }
    const iv = setInterval(() => { if (onScreen()) setVisible(true); }, 700);
    if (onScreen()) setVisible(true);
    return () => { io?.disconnect(); clearInterval(iv); };
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    let live = true;
    const p = acc ? accessoryThumb(acc, theme) : preset ? (custom ? customThumb(preset) : presetThumb(preset)) : Promise.resolve(null);
    p.then((u) => {
      if (!live) return;
      setUrl(u);
      setErr(u ? null : custom ? 'Sem miniatura ainda (salve o visual com a janela do personagem aberta)'
        : preset ? 'Miniatura estática não encontrada (rode o gerador: npm run thumbs)' : 'Não consegui gerar a miniatura (veja o console)');
    }).catch((e) => { console.error('[thumb]', acc || preset, e); if (live) { setUrl(null); setErr(String(e?.message || e)); } });
    return () => { live = false; };
  }, [acc, preset, custom, visible, gen]);

  const loading = !url && !err;
  return (
    <div ref={ref} className={`thumb ${className} ${loading ? 'skel' : ''}`} title={err ? `${title ? title + ' — ' : ''}${err}` : title} onClick={onClick}
      style={url ? { backgroundImage: `url("${url}")` } : undefined}>
      {err && <span className="thumb-icon">{icon}</span>}
    </div>
  );
}

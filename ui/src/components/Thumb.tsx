import React from 'react';
import { accessoryThumb, outfitThumb, outfitThumbKey, onThumbsChanged } from '../lib/thumbs';

export const CATEGORY_ICON: Record<string, string> = {
  Chapéus: '🎩', Olhos: '🕶️', Rosto: '👄', Bigodes: '🥸', Corpo: '👔', Objetos: '🧸', Outros: '📦',
};

/**
 * Thumbnail image:
 *   acc="id"                       accessory (app cache -> static seed -> rendered once + cached)
 *   preset="id" outfit={resolved}  any outfit (app cache by outfitThumbKey(resolved) -> static seed)
 * Requested when the element is on screen; skeleton while loading; fallback icon (with the
 * reason in the tooltip) when there is no image.
 */
export function Thumb({ acc, preset, outfit, custom, theme, className = 'img', icon = '📦', onClick, title }: {
  acc?: string; preset?: string; outfit?: any; custom?: boolean; theme?: any; className?: string; icon?: string; onClick?: () => void; title?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [gen, setGen] = React.useState(0);
  React.useEffect(() => onThumbsChanged(() => setGen((g) => g + 1)), []);
  const outKey = outfit ? outfitThumbKey(outfit) : '';

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
    const p = acc ? accessoryThumb(acc, theme) : preset && outfit ? outfitThumb(preset, outfit) : Promise.resolve(null);
    p.then((u) => {
      if (!live) return;
      setUrl(u);
      setErr(u ? null : preset ? (custom ? 'Miniatura ainda não gerada (abra a janela do personagem; ela gera ao carregar)' : 'Miniatura ainda não gerada (a janela do personagem gera ao carregar)')
        : 'Não consegui gerar a miniatura (veja o console)');
    }).catch((e) => { console.error('[thumb]', acc || preset, e); if (live) { setUrl(null); setErr(String(e?.message || e)); } });
    return () => { live = false; };
  }, [acc, preset, outKey, visible, gen]);

  const loading = !url && !err;
  return (
    <div ref={ref} className={`thumb ${className} ${loading ? 'skel' : ''}`} title={err ? `${title ? title + ' — ' : ''}${err}` : title} onClick={onClick}
      style={url ? { backgroundImage: `url("${url}")` } : undefined}>
      {err && <span className="thumb-icon">{icon}</span>}
    </div>
  );
}

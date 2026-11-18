import React from 'react';
import { accessoryThumb, outfitThumb } from '../lib/thumbs';

export const CATEGORY_ICON: Record<string, string> = {
  Chapéus: '🎩', Olhos: '🕶️', Rosto: '👄', Bigodes: '🥸', Corpo: '👔', Objetos: '🧸', Outros: '📦',
};

/**
 * Lazy thumbnail (accessory alone or whole outfit). Requested only when the element is on screen
 * (IntersectionObserver, plus a periodic visibility check in case the observer never fires inside
 * a scroll container / hidden tab). Skeleton while waiting; a fallback icon if generation fails.
 * Every card, preset and equipped-list mini icon shares the same cached image.
 */
export function Thumb({ acc, outfit, theme, className = 'img', icon = '📦', onClick, title }: {
  acc?: string; outfit?: any; theme?: any; className?: string; icon?: string; onClick?: () => void; title?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const key = acc ?? (outfit ? JSON.stringify({ m: outfit.materials, s: outfit.slots }) : '');

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
    setUrl(null); setFailed(false);
    const p = acc ? accessoryThumb(acc, theme) : outfit ? outfitThumb(outfit) : Promise.resolve(null);
    p.then((u) => { if (live) (u ? setUrl(u) : setFailed(true)); })
      .catch((e) => { console.error('[thumb]', acc || 'outfit', e); if (live) setFailed(true); });
    return () => { live = false; };
  }, [key, visible]);

  return (
    <div ref={ref} className={`thumb ${className} ${url || failed ? '' : 'skel'}`} title={title} onClick={onClick}
      style={url ? { backgroundImage: `url("${url}")` } : undefined}>
      {failed && <span className="thumb-icon">{icon}</span>}
    </div>
  );
}

import React from 'react';
import { accessoryThumb, outfitThumb } from '../lib/thumbs';

/**
 * Lazy thumbnail (accessory alone or whole outfit). Only requested when the card scrolls
 * into view (IntersectionObserver); shows a shimmering skeleton until the image is ready.
 * Images are generated one at a time in idle time and cached in localStorage.
 */
export function Thumb({ acc, outfit, theme, className = 'img', onClick, title }: {
  acc?: string; outfit?: any; theme?: any; className?: string; onClick?: () => void; title?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const key = acc ?? (outfit ? JSON.stringify({ m: outfit.materials, s: outfit.slots }) : '');

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    let live = true;
    setUrl(null); setFailed(false);
    const p = acc ? accessoryThumb(acc, theme) : outfit ? outfitThumb(outfit) : Promise.resolve(null);
    p.then((u) => { if (live) (u ? setUrl(u) : setFailed(true)); });
    return () => { live = false; };
  }, [key, visible]);

  return (
    <div ref={ref} className={`${className} ${url || failed ? '' : 'skel'}`} title={title} onClick={onClick}
      style={url ? { backgroundImage: `url(${url})` } : undefined}>
      {failed && '📦'}
    </div>
  );
}

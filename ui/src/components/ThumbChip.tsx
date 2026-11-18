import React from 'react';
import { prerender } from '../lib/thumbs';

/** "miniaturas 12/70" chip in the header while the background pre-render runs. */
export function ThumbChip() {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => { prerender.subs.add(force); return () => { prerender.subs.delete(force); }; }, []);
  if (!prerender.running || !prerender.total) return null;
  const pct = Math.round((prerender.done / prerender.total) * 100);
  return (
    <div className="chip" title="Gerando as miniaturas em segundo plano (só na primeira vez)">
      <span className="chip-bar" style={{ width: `${pct}%` }} />
      <span className="chip-txt">miniaturas {prerender.done}/{prerender.total}</span>
    </div>
  );
}

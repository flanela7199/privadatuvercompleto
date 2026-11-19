import React from 'react';

export type EyeStyle = 'classico' | 'googly' | 'desenho' | 'serio' | 'sticker';

/** tiny SVG previews of each eye style (pair of eyes) */
function Icon({ style }: { style: EyeStyle }) {
  const eye = (cx: number) => {
    switch (style) {
      case 'classico': // flat white disc, bold black ring, big pupil looking slightly up
        return (<g key={cx}><circle cx={cx} cy="12" r="7.5" fill="#fff" stroke="#111" strokeWidth="1.8" /><circle cx={cx + 1} cy="10.5" r="3.4" fill="#111" /></g>);
      case 'googly': // clear dome with highlight, loose pupil sagging down
        return (<g key={cx}><circle cx={cx} cy="12" r="7.5" fill="#fff" stroke="#555" strokeWidth="1" /><circle cx={cx} cy="15" r="3.3" fill="#111" /><ellipse cx={cx - 2.6} cy="8.6" rx="2" ry="1.2" fill="#fff" stroke="#bbb" strokeWidth=".5" opacity=".9" /></g>);
      case 'desenho': // cartoon: tall oval, thin line, pupil with shine
        return (<g key={cx}><ellipse cx={cx} cy="12" rx="6" ry="8" fill="#fff" stroke="#111" strokeWidth="1.2" /><ellipse cx={cx + .5} cy="13" rx="2.6" ry="3.4" fill="#111" /><circle cx={cx + 1.4} cy="11.6" r=".9" fill="#fff" /></g>);
      case 'sticker': // flat printed sticker: thin ring, white border, flat pupil
        return (<g key={cx}><circle cx={cx} cy="12" r="8.2" fill="#f4f4f4" /><circle cx={cx} cy="12" r="6.6" fill="#fff" stroke="#222" strokeWidth=".9" /><circle cx={cx} cy="12" r="2.9" fill="#222" /></g>);
      case 'serio': // half-lidded, small pupil
        return (<g key={cx}><circle cx={cx} cy="12" r="7" fill="#fff" stroke="#111" strokeWidth="1.6" /><circle cx={cx} cy="13" r="2.4" fill="#111" /><path d={`M${cx - 7.6} 10.5 Q${cx} 5.2 ${cx + 7.6} 10.5 L${cx + 7.6} 4 L${cx - 7.6} 4 Z`} fill="#3a3d48" /><path d={`M${cx - 7} 10.6 L${cx + 7} 9.6`} stroke="#111" strokeWidth="1.6" /></g>);
    }
  };
  return <svg viewBox="0 0 40 24" width="40" height="24" aria-hidden="true">{eye(11)}{eye(29)}</svg>;
}

const OPTIONS: [EyeStyle, string][] = [
  ['classico', 'Clássico (como a imagem)'], ['googly', 'Googly'], ['desenho', 'Desenho'], ['serio', 'Sério'], ['sticker', 'Adesivo'],
];

/** 4-option eye style picker with preview icons */
export function EyeStylePicker({ value, onChange }: { value: string; onChange: (v: EyeStyle) => void }) {
  return (
    <div className="eye-picker" role="radiogroup">
      {OPTIONS.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'sel' : ''} title={label} onClick={() => onChange(v)}>
          <Icon style={v} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

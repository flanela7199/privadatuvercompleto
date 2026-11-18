import React from 'react';
import type { Opt } from '../lib/catalog';

type Props = { value: string | number | null | undefined; options: Opt[]; onChange: (v: string) => void; disabled?: boolean; tip?: string; style?: React.CSSProperties; className?: string };

export function Select({ value, options, onChange, disabled, tip, style, className = '' }: Props) {
  const has = options.some(([v]) => String(v) === String(value ?? ''));
  return (
    <select className={`input ${className}`} value={String(value ?? '')} disabled={disabled} title={tip} style={style} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      {!has && value != null && <option value={String(value)}>{String(value)}</option>}
    </select>
  );
}

export function TextField({ value, onChange, placeholder, type = 'text' }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return <input type={type} className="input" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

import React from 'react';
import type { Opt } from '../lib/catalog';

/** Segmented control: a row of mutually exclusive options. */
export function Segmented({ value, options, onChange, tip }: { value: string; options: Opt[]; onChange: (v: string) => void; tip?: string }) {
  return (
    <div className="seg" role="radiogroup" title={tip}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={String(v) === value} className={String(v) === value ? 'sel' : ''} onClick={() => onChange(String(v))}>{l}</button>
      ))}
    </div>
  );
}

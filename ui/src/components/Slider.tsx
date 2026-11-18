import React from 'react';

export const FMT = {
  n2: (v: number) => v.toFixed(2),
  int: (v: number) => String(Math.round(v)),
  db: (v: number) => `${v} dB`,
  s: (v: number) => `${v.toFixed(2)} s`,
  x: (v: number) => `${v.toFixed(2)}×`,
  pct: (v: number) => `${Math.round(v * 100)}%`,
  px: (v: number) => `${Math.round(v)} px`,
  deg: (v: number) => `${Math.round(v)}°`,
};
type Props = { value: number; min: number; max: number; step?: number; fmt?: keyof typeof FMT; onChange: (v: number) => void; disabled?: boolean };

/** Range slider with a right-aligned value label. */
export function Slider({ value, min, max, step = 0.01, fmt = 'n2', onChange, disabled }: Props) {
  const v = Number(value ?? 0);
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={v} disabled={disabled} onChange={(e) => onChange(+e.target.value)} />
      <output>{FMT[fmt](v)}</output>
    </div>
  );
}

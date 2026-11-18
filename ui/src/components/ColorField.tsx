import React from 'react';
import { toHex } from '../lib/catalog';

/** Color input that previews while dragging but only commits on change. */
export function ColorField({ value, onChange, disabled, tip, fallback = '#ffffff' }: { value?: string; onChange: (v: string) => void; disabled?: boolean; tip?: string; fallback?: string }) {
  const [v, setV] = React.useState(toHex(value, fallback));
  React.useEffect(() => setV(toHex(value, fallback)), [value, fallback]);
  return (
    <input
      type="color" className="color" value={v} disabled={disabled} title={tip}
      onInput={(e) => setV((e.target as HTMLInputElement).value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

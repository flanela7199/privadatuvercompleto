import React from 'react';

export function Toggle({ checked, onChange, tip, disabled }: { checked: boolean; onChange: (v: boolean) => void; tip?: string; disabled?: boolean }) {
  return (
    <label className="switch" title={tip}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

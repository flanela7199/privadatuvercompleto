import React from 'react';

export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (id: string) => void }) {
  return (
    <nav className="tabs">
      {tabs.map(([id, label]) => <button key={id} className={id === value ? 'sel' : ''} onClick={() => onChange(id)}>{label}</button>)}
    </nav>
  );
}

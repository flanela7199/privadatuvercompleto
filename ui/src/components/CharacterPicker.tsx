import React from 'react';
import { useStore } from '../state/config';
import { CHARACTERS } from '../lib/catalog';

/** Header selector: which character the avatar window shows (config.character). */
export function CharacterPicker() {
  const { s, setCharacter } = useStore();
  const cur = s.cfg.character || 'privada';
  return (
    <div className="char-picker" role="radiogroup" aria-label="Personagem">
      {CHARACTERS.map(([id, icon, name]) => (
        <button key={id} type="button" role="radio" aria-checked={cur === id} className={cur === id ? 'sel' : ''}
          title={`Usar ${name}`} onClick={() => cur !== id && setCharacter(id)}>
          <span className="ic">{icon}</span><span>{name}</span>
        </button>
      ))}
    </div>
  );
}

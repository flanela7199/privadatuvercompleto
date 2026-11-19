import React from 'react';
import { useStore } from '../state/config';
import { ANIMS, CHRATOS_ANIMS } from '../lib/catalog';
import { Section } from '../components/Section';
import { Button } from '../components/Button';

const QUICK: [string, string][] = [
  ['toggle:clickthrough', '🖱 Clicar através'], ['toggle:follow', '👀 Seguir mouse'],
  ['toggle:mic', '🎤 Microfone'],
];

export function Animacoes() {
  const { s, runAction } = useStore();
  const chratos = s.cfg.character === 'chratos';
  const list = chratos ? CHRATOS_ANIMS : ANIMS;
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <Section title={chratos ? 'Animações do Chratos' : 'Animações'} desc="Toca na hora (também dá pra usar atalhos).">
        <div className="anim-grid">{list.map(([id, n]) => <Button key={id} size="big" onClick={() => runAction(`play:${id}`)}>{n}</Button>)}</div>
      </Section>
      <Section title="Controles rápidos">
        <div className="anim-grid">{QUICK.map(([v, n]) => <Button key={v} size="big" onClick={() => runAction(v)}>{n}</Button>)}</div>
      </Section>
    </div>
  );
}

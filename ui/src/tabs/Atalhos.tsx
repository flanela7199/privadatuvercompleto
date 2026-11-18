import React from 'react';
import { useStore, allOutfits } from '../state/config';
import { ACTIONS, DEFAULT_CONFIG } from '../lib/legacy';
import { VISEMES, accelFromEvent, clone, type Opt } from '../lib/catalog';
import { Section, Field } from '../components/Section';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { Toggle } from '../components/Toggle';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';

type Row = { accel: string; value: string; enabled: boolean };
const toRows = (hk: any): Row[] => Object.entries(hk || {}).map(([accel, b]: any) => ({ accel, value: `${b.action}:${b.arg ?? ''}`, enabled: b.enabled !== false }));
function toCfg(rows: Row[]) {
  const out: any = {};
  for (const r of rows) {
    if (!r.accel || out[r.accel]) continue; // repeated accelerator: first wins (shown in red)
    const i = r.value.indexOf(':');
    out[r.accel] = { action: r.value.slice(0, i), arg: r.value.slice(i + 1), ...(r.enabled ? {} : { enabled: false }) };
  }
  return out;
}

export function Atalhos() {
  const { s, update, applyHotkeys, runAction } = useStore();
  const toast = useToast();
  const [rows, setRows] = React.useState<Row[]>(() => toRows(s.cfg.hotkeys));
  const [rec, setRec] = React.useState(-1);
  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;
  const failed = new Set(s.hkFailed);

  const commit = React.useCallback(async (next: Row[], master = s.cfg.hotkeysEnabled) => {
    setRows(next);
    const hotkeys = toCfg(next);
    update((d) => { d.cfg.hotkeys = hotkeys; d.cfg.hotkeysEnabled = master; });
    const f = await applyHotkeys({ ...s.cfg, hotkeys, hotkeysEnabled: master });
    if (f.length) toast(<>Não consegui registrar: <b>{f.join(', ')}</b> (outro programa usa?)</>, 'warn', 4500);
  }, [s.cfg, update, applyHotkeys]);

  // key recorder
  React.useEffect(() => {
    if (rec < 0) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      const cur = rowsRef.current;
      if (e.code === 'Escape') { setRows(cur[rec]?.accel ? cur : cur.filter((_, j) => j !== rec)); setRec(-1); return; }
      const a = accelFromEvent(e);
      if (!a) return;
      let next = cur.map((r) => ({ ...r }));
      const other = next.findIndex((r, j) => j !== rec && r.accel === a);
      if (other >= 0 && !confirm(`${a} já está em uso. Trocar para esta ação?`)) { setRec(-1); return; }
      let idx = rec;
      if (other >= 0) { next.splice(other, 1); if (other < idx) idx--; }
      next[idx].accel = a;
      setRec(-1);
      commit(next);
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [rec, commit]);

  const opts: Opt[] = [
    ...ACTIONS.map((a: any) => [a.id, a.name] as Opt),
    ...allOutfits(s).map(([id, n]) => [`outfit:${id}`, `Visual: ${n}`] as Opt),
    ...s.cfg.scenes.map((sc: any, i: number) => [`scene:${i}`, `Cena ${i + 1}: ${sc.name}`] as Opt),
    ...VISEMES.map((v) => [`viseme:${v}`, `Boca: ${v}`] as Opt),
  ];
  const counts: Record<string, number> = {};
  for (const r of rows) if (r.accel) counts[r.accel] = (counts[r.accel] || 0) + 1;
  const nOn = rows.filter((r) => r.enabled && r.accel).length;
  const master = s.cfg.hotkeysEnabled;

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <Section title="Atalhos globais" desc="Funcionam mesmo com o jogo ou o OBS em foco. Clique no atalho e aperte as teclas (Esc cancela)."
        right={<div className="btns">
          <Button kind="primary" onClick={() => { const next = [...rows, { accel: '', value: 'play:flush', enabled: true }]; setRows(next); setRec(next.length - 1); }}>＋ Adicionar atalho</Button>
          <Button onClick={() => { if (confirm('Voltar todos os atalhos para o padrão?')) { commit(toRows(clone(DEFAULT_CONFIG.hotkeys))); toast('Atalhos restaurados'); } }}>Restaurar padrão</Button>
        </div>}>
        <div style={{ marginBottom: 16 }}>
          <Field label="Atalhos globais ligados">
            <Toggle checked={master} onChange={(v) => commit(rows, v)} />
            <span className="mut">{master ? `${nOn} ativos` : 'todos desligados (a lista fica salva)'}</span>
          </Field>
        </div>
        {rows.length ? (
          <table className="hk">
            <thead><tr><th>Ligado</th><th>Atalho</th><th>Ação</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const cls = [rec === i && 'rec', counts[r.accel] > 1 && 'dup', failed.has(r.accel) && 'failed'].filter(Boolean).join(' ');
                const tip = counts[r.accel] > 1 ? 'Atalho repetido!' : failed.has(r.accel) ? 'Falhou ao registrar' : 'Clique e aperte as teclas';
                return (
                  <tr key={i} className={r.enabled ? '' : 'off'}>
                    <td style={{ width: 56 }}><Toggle checked={r.enabled} tip={r.enabled ? 'Desligar este atalho' : 'Ligar este atalho'} onChange={(v) => commit(rows.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} /></td>
                    <td style={{ width: 190 }}><span className={`keycap ${cls}`} title={tip} onClick={() => setRec(i)}>{rec === i ? 'aperte as teclas…' : r.accel || '(clique para gravar)'}</span></td>
                    <td><Select value={r.value} options={opts} onChange={(v) => commit(rows.map((x, j) => (j === i ? { ...x, value: v } : x)))} /></td>
                    <td style={{ width: 120, textAlign: 'right' }}>
                      <Button size="sm" tip="Testar agora" onClick={() => runAction(r.value)}>▶</Button>{' '}
                      <Button kind="danger" size="sm" tip="Apagar atalho" onClick={() => commit(rows.filter((_, j) => j !== i))}>✕</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <EmptyState icon="⌨">Nenhum atalho. Clique em Adicionar atalho.</EmptyState>}
      </Section>
    </div>
  );
}

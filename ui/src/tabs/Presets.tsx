import React from 'react';
import { useStore, resolveOutfit, outfitName, newId, rawOutfit } from '../state/config';
import { mergeTheme } from '../lib/legacy';
import { clone, download, pickFile } from '../lib/catalog';
import { clearThumbs, captureOutfitThumb, requestOutfitThumbs } from '../lib/thumbs';
import { Section } from '../components/Section';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Thumb } from '../components/Thumb';
import { useToast } from '../components/Toast';

export function Presets() {
  const { s, update, applyOutfit } = useStore();
  const toast = useToast();
  const [gen, setGen] = React.useState(0); // bump to re-render thumbnails after "Miniaturas"
  const mine = Object.entries(s.cfg.outfits || {}) as [string, any][];
  const built = [...Object.entries(s.themes), ...Object.entries(s.presets)] as [string, any][];

  const card = (id: string, t: any, isMine: boolean) => {
    const active = s.cfg.activeOutfit === id;
    return (
      <div key={`${id}.${gen}`} className={`preset ${active ? 'active' : ''}`}>
        <Thumb preset={id} outfit={resolveOutfit(s, id)} custom={isMine} icon="🚽" title="Clique para usar" onClick={() => applyOutfit(id)} />
        <div className="nm">{t.name || id}</div>
        <div className="tag">{isMine ? 'meu preset' : s.themes[id] ? 'tema' : 'preset pronto'}{active ? ' · em uso' : ''}</div>
        <div className="btns">
          <Button kind="primary" size="sm" disabled={active} onClick={() => applyOutfit(id)}>{active ? 'Em uso' : 'Usar'}</Button>
          {isMine ? (
            <>
              <Button size="sm" onClick={() => { const n = prompt('Novo nome do preset:', t.name || ''); if (n) update((d) => { d.cfg.outfits[id].name = n; if (d.cfg.activeOutfit === id) d.work.name = n; }); }}>Renomear</Button>
              <Button kind="danger" size="sm" onClick={() => {
                if (!confirm(`Apagar "${t.name}"?`)) return;
                update((d) => { delete d.cfg.outfits[id]; if (d.cfg.activeOutfit === id) { d.cfg.activeOutfit = 'base'; d.work = resolveOutfit(d, 'base'); } });
                toast('Preset apagado');
              }}>Apagar</Button>
            </>
          ) : (
            <Button size="sm" tip="Cria uma cópia editável em Meus presets" onClick={() => {
              update((d) => { const nid = newId(); d.cfg.outfits[nid] = { ...resolveOutfit(d, id), id: nid, name: `${outfitName(d, id)} (cópia)` }; delete d.cfg.outfits[nid].extends; });
              toast('Copiado para Meus presets');
            }}>Copiar</Button>
          )}
        </div>
      </div>
    );
  };

  const saveCurrent = () => {
    const n = prompt('Nome do preset:', s.cfg.outfits[s.cfg.activeOutfit] ? s.work.name : 'Meu visual');
    if (!n) return;
    const nid = newId();
    update((d) => { d.cfg.outfits[nid] = { ...clone(d.work), id: nid, name: n }; delete d.cfg.outfits[nid].extends; d.cfg.activeOutfit = nid; d.work = d.cfg.outfits[nid]; });
    toast(<>Preset <b>{n}</b> salvo</>);
    // immediate image = mirror of the character window (it wears it); proper render requested too
    const resolved = { ...clone(s.work), id: nid, name: n };
    setTimeout(() => { captureOutfitThumb(resolved); requestOutfitThumbs([resolved]); }, 400);
  };
  const importJson = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const t = JSON.parse(await f.text());
      if (!t.slots && !t.materials) throw new Error('Esse arquivo não é um visual (faltam slots/materials).');
      update((d) => {
        const nid = newId();
        const base = t.extends && rawOutfit(d, t.extends) ? resolveOutfit(d, t.extends) : d.themes.base;
        d.cfg.outfits[nid] = { ...mergeTheme(base, t), id: nid, name: t.name || f.name.replace(/\.json$/i, '') };
        delete d.cfg.outfits[nid].extends;
        d.cfg.activeOutfit = nid; d.work = clone(d.cfg.outfits[nid]);
        const resolved = clone(d.cfg.outfits[nid]);
        setTimeout(() => { captureOutfitThumb(resolved); requestOutfitThumbs([resolved]); }, 400);
      });
      toast('Visual importado');
    } catch (err: any) { toast(err.message, 'err'); }
  };

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <Section title="Meus presets" desc="Visuais que você montou. Monte na aba Visual e salve aqui."
        right={<div className="btns">
          <Button kind="primary" onClick={saveCurrent}>💾 Salvar visual atual</Button>
          <Button tip="Salva o visual atual em .json" onClick={() => download(`${(s.work.name || 'visual').replace(/\W+/g, '_')}.json`, s.work)}>⬇ Exportar</Button>
          <Button tip="Carrega um visual .json" onClick={importJson}>📂 Importar</Button>
        </div>}>
        {mine.length ? <div className="preset-grid">{mine.map(([id, t]) => card(id, t, true))}</div> : <EmptyState icon="⭐">Nenhum preset ainda.</EmptyState>}
      </Section>
      <Section title="Presets prontos" desc={`${built.length} visuais prontos para usar ou copiar.`}
        right={<Button tip="Recarrega as miniaturas" onClick={() => { clearThumbs(); setGen((g) => g + 1); toast('Miniaturas recarregadas'); }}>↻ Miniaturas</Button>}>
        <div className="preset-grid">{built.map(([id, t]) => card(id, t, false))}</div>
      </Section>
    </div>
  );
}

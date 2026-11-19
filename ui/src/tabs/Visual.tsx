import React from 'react';
import { useStore } from '../state/config';
import { listAccessories, MUSTACHE_IDS } from '../lib/legacy';
import { CATS, MAT_KEYS, SOCKETS, SOCKET_OPTS, BODY_DEFAULTS, accInfo, clone, readAsDataURL } from '../lib/catalog';
import { Preview } from '../components/Preview';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { Slider } from '../components/Slider';
import { ColorField } from '../components/ColorField';
import { Field, Fields } from '../components/Section';
import { EmptyState } from '../components/EmptyState';
import { Thumb, CATEGORY_ICON } from '../components/Thumb';
import { Segmented } from '../components/Segmented';
import { useToast } from '../components/Toast';

type Sel = { slot: string; index: number } | null;

export function Visual({ active }: { active: boolean }) {
  const { s, update } = useStore();
  const toast = useToast();
  const [cat, setCat] = React.useState('Todos');
  const [q, setQ] = React.useState('');
  const [sock, setSock] = React.useState('');
  const [sel, setSel] = React.useState<Sel>(null);
  const work = s.work;
  const base = s.themes.base;

  const worn = React.useMemo(() => {
    const set = new Set<string>();
    for (const l of Object.values(work.slots || {}) as any[]) for (const e of l) set.add(e.id);
    return set;
  }, [work]);
  const ids = React.useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (listAccessories() as string[]).filter((id) => id !== 'glb').filter((id) => {
      const i = accInfo(id);
      return (cat === 'Todos' || i.category === cat) && (!qq || i.name.toLowerCase().includes(qq) || id.includes(qq));
    }).sort((a, b) => accInfo(a).name.localeCompare(accInfo(b).name, 'pt'));
  }, [cat, q]);
  const entries = React.useMemo(() => {
    const out: { slot: string; index: number; e: any }[] = [];
    for (const [slot, l] of Object.entries(work.slots || {}) as any) l.forEach((e: any, index: number) => out.push({ slot, index, e }));
    return out;
  }, [work]);
  const selEntry = sel && work.slots[sel.slot]?.[sel.index];

  const equip = (id: string) => {
    const slot = sock || accInfo(id).socket || 'head_top';
    let index = 0;
    update((d) => {
      // one mustache at a time: replacing feels better than stacking (face or upper lip)
      if ((MUSTACHE_IDS as string[]).includes(id)) for (const k of ['lip_upper', 'face']) if (d.work.slots[k]) d.work.slots[k] = d.work.slots[k].filter((e: any) => !(MUSTACHE_IDS as string[]).includes(e.id));
      (d.work.slots[slot] ||= []).push({ id, params: {} });
      index = d.work.slots[slot].length - 1;
    }, { fork: true });
    setSel({ slot, index });
    toast(<>Vestiu <b>{accInfo(id).name}</b></>);
  };
  const edit = (fn: (slots: any) => void) => update((d) => fn(d.work.slots), { fork: true });
  const setTransform = (k: string, v: number) => update((d) => {
    const e = d.work.slots[sel!.slot][sel!.index];
    const t = (e.transform ||= {});
    t.position ||= [0, 0, 0]; t.rotation ||= [0, 0, 0];
    if (k[0] === 'p') t.position['xyz'.indexOf(k[1])] = v;
    else if (k[0] === 'r') t.rotation['xyz'.indexOf(k[1])] = v;
    else t.scale = v;
  }, { fork: true });

  const importGlb = async (f: File | undefined) => {
    if (!f) return;
    const src = await readAsDataURL(f);
    const slot = sock || 'head_top';
    let index = 0;
    update((d) => { (d.work.slots[slot] ||= []).push({ id: 'glb', params: { src, name: f.name.replace(/\.(glb|gltf)$/i, ''), fit: 0.35 } }); index = d.work.slots[slot].length - 1; }, { fork: true });
    setSel({ slot, index });
    toast(<>Modelo <b>{f.name}</b> adicionado</>);
  };

  const body = { tank: { ...BODY_DEFAULTS.tank, ...(work.body?.tank || {}) }, eyes: { ...BODY_DEFAULTS.eyes, ...(work.body?.eyes || {}) }, neck: { ...BODY_DEFAULTS.neck, ...(work.body?.neck || {}) }, roll: { ...BODY_DEFAULTS.roll, ...(work.body?.roll || {}) } };
  const setBody = (part: 'tank' | 'eyes' | 'neck' | 'roll', k: string, v: number | string) => update((d) => {
    d.work.body ||= {};
    d.work.body[part] = { ...BODY_DEFAULTS[part], ...(d.work.body[part] || {}), [k]: v };
  }, { fork: true });
  const T = selEntry?.transform || {};
  const pos = T.position || [0, 0, 0], rot = T.rotation || [0, 0, 0];

  return (
    <>
      <div>
        <Preview active={active} />
        <Card>
          <h3 style={{ marginTop: 0 }}>Cores do corpo</h3>
          <div className="mats">
            {MAT_KEYS.map(([k, n]) => (
              <label key={k}>{n}<ColorField value={work.materials?.[k]?.color} onChange={(v) => update((d) => { d.work.materials[k] = { ...(d.work.materials[k] || d.work.materials.porcelain), color: v }; }, { fork: true })} /></label>
            ))}
          </div>
        </Card>
        <Card className="compact">
          <div className="sec-h row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }} className="grow">Corpo</h3>
            <Button size="sm" tip="Volta às proporções originais" disabled={!work.body} onClick={() => update((d) => { delete d.work.body; }, { fork: true })}>Restaurar proporções</Button>
          </div>
          <Fields>
            <Field label="Cabeça largura" tip="Largura do tanque"><Slider value={body.tank.w} min={0.6} max={1.6} step={0.01} fmt="x" onChange={(v) => setBody('tank', 'w', v)} /></Field>
            <Field label="Cabeça altura" tip="Altura do tanque"><Slider value={body.tank.h} min={0.6} max={1.6} step={0.01} fmt="x" onChange={(v) => setBody('tank', 'h', v)} /></Field>
            <Field label="Cabeça profund." tip="Profundidade do tanque"><Slider value={body.tank.d} min={0.6} max={1.6} step={0.01} fmt="x" onChange={(v) => setBody('tank', 'd', v)} /></Field>
            <Field label="Arredondado" tip="Raio das quinas do tanque (metros)"><Slider value={body.tank.round} min={0.02} max={0.16} step={0.005} fmt="m3" onChange={(v) => setBody('tank', 'round', v)} /></Field>
            <Field label="Estufado" tip="Quanto as faces do tanque incham para fora (metros)"><Slider value={body.tank.bulge} min={0} max={0.06} step={0.001} fmt="m3" onChange={(v) => setBody('tank', 'bulge', v)} /></Field>
            <Field label="Afunilado embaixo" tip="Largura da base do tanque em relação ao topo (1 = reto)"><Slider value={body.tank.taper} min={0.7} max={1.15} step={0.01} fmt="x" onChange={(v) => setBody('tank', 'taper', v)} /></Field>
            <Field label="Tampa arredondada" tip="Raio das bordas da tampa do tanque (metros)"><Slider value={body.tank.lidRound} min={0.01} max={0.05} step={0.001} fmt="m3" onChange={(v) => setBody('tank', 'lidRound', v)} /></Field>
            <Field label="Pescoço (cano)" tip="Comprimento do cano: sobe/desce a cabeça"><Slider value={body.neck.length} min={0.6} max={1.6} step={0.01} fmt="x" onChange={(v) => setBody('neck', 'length', v)} /></Field>
            <Field label="Olhos tamanho"><Slider value={body.eyes.size} min={0.5} max={1.8} step={0.01} fmt="x" onChange={(v) => setBody('eyes', 'size', v)} /></Field>
            <Field label="Olhos distância" tip="Separação entre os olhos"><Slider value={body.eyes.spacing} min={0.6} max={1.6} step={0.01} fmt="x" onChange={(v) => setBody('eyes', 'spacing', v)} /></Field>
            <Field label="Olhos altura" tip="Sobe/desce os olhos (metros)"><Slider value={body.eyes.y} min={-0.12} max={0.12} step={0.005} onChange={(v) => setBody('eyes', 'y', v)} /></Field>
            <Field label="Rolo de papel" tip="Onde fica o suporte do papel higiênico">
              <Segmented value={body.roll.mount} options={[['side', 'Do lado (padrão)'], ['front', 'Na frente']]} onChange={(v) => setBody('roll', 'mount', v)} />
            </Field>
          </Fields>
        </Card>
        <Card>
          <h3 style={{ marginTop: 0 }}>Modelo próprio (.glb)</h3>
          <p className="mut" style={{ marginBottom: 8 }}>Qualquer modelo 3D vira acessório no lugar escolhido acima da grade.</p>
          <input type="file" className="file" accept=".glb,.gltf" onChange={(e) => { importGlb(e.target.files?.[0]); e.target.value = ''; }} />
        </Card>
      </div>

      <div>
        <div className="chips">{CATS.map((c) => <button key={c} className={c === cat ? 'sel' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>
        <div className="bar">
          <input type="search" className="input" placeholder="Buscar acessório…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={sock} options={[['', 'Lugar padrão'], ...SOCKET_OPTS]} onChange={setSock} tip="Onde colocar o próximo acessório" style={{ flex: 'none', width: 190 }} />
        </div>
        {ids.length ? (
          <div className="grid">
            {ids.map((id) => (
              <div key={id} className={`acc-card ${worn.has(id) ? 'worn' : ''}`} title={`${accInfo(id).name} · ${SOCKETS[accInfo(id).socket] || accInfo(id).socket}`} onClick={() => equip(id)}>
                {worn.has(id) && <div className="badge">✔</div>}
                <Thumb acc={id} theme={base} icon={CATEGORY_ICON[accInfo(id).category] || '📦'} />
                <div className="nm">{accInfo(id).name}</div>
              </div>
            ))}
          </div>
        ) : <EmptyState icon="🔍">Nenhum acessório com esse nome.</EmptyState>}
      </div>

      <div>
        <Card>
          <div className="sec-h row" style={{ marginBottom: 8 }}>
            <h2>Equipados</h2><span className="mut">{entries.length || ''}</span><div className="grow" />
            {entries.length > 0 && <Button kind="danger" size="sm" tip="Remove todos os acessórios" onClick={() => { if (confirm('Tirar todos os acessórios?')) { edit((sl) => { for (const k of Object.keys(sl)) delete sl[k]; }); setSel(null); } }}>Tirar tudo</Button>}
          </div>
          {entries.length ? (
            <div className="worn-list">
              {entries.map(({ slot, index, e }) => (
                <div key={`${slot}.${index}`} className={`row ${sel && sel.slot === slot && sel.index === index ? 'sel' : ''}`}
                  onClick={(ev) => { if (!(ev.target as HTMLElement).closest('select,button')) setSel({ slot, index }); }}>
                  {e.id === 'glb' ? <span className="ph">📦</span> : <Thumb acc={e.id} theme={base} className="ph" icon={CATEGORY_ICON[accInfo(e.id).category] || '📦'} />}
                  <span className="nm" title={e.id}>{e.hidden ? '🚫 ' : ''}{e.params?.name || accInfo(e.id).name}</span>
                  <Select value={slot} options={SOCKET_OPTS} tip="Mudar de lugar" onChange={(to) => {
                    let ni = 0;
                    edit((sl) => { const [m] = sl[slot].splice(index, 1); m.transform = {}; (sl[to] ||= []).push(m); ni = sl[to].length - 1; });
                    setSel({ slot: to, index: ni });
                  }} />
                  <Button kind="ghost" size="sm" tip={e.hidden ? 'Mostrar' : 'Esconder'} onClick={() => edit((sl) => { sl[slot][index].hidden = !sl[slot][index].hidden; })}>👁</Button>
                  <Button kind="ghost" size="sm" tip="Duplicar" onClick={() => edit((sl) => { sl[slot].push(clone(sl[slot][index])); })}>⧉</Button>
                  <Button kind="ghost" size="sm" className="danger" tip="Remover" onClick={() => { edit((sl) => { sl[slot].splice(index, 1); }); setSel(null); }}>✕</Button>
                </div>
              ))}
            </div>
          ) : <EmptyState icon="👔">Nada equipado.<br />Clique num card para vestir.</EmptyState>}
        </Card>

        <Card className="adj">
          {selEntry ? (
            <>
              <h2 style={{ marginBottom: 12 }}>Ajustar: {selEntry.params?.name || accInfo(selEntry.id).name}</h2>
              <Fields>
                {(['x', 'y', 'z'] as const).map((a, i) => <Field key={`p${a}`} label={`Pos ${a.toUpperCase()}`}><Slider value={pos[i]} min={-0.6} max={0.6} step={0.005} onChange={(v) => setTransform(`p${a}`, v)} /></Field>)}
                {(['x', 'y', 'z'] as const).map((a, i) => <Field key={`r${a}`} label={`Girar ${a.toUpperCase()}`}><Slider value={rot[i]} min={-3.14} max={3.14} step={0.01} onChange={(v) => setTransform(`r${a}`, v)} /></Field>)}
                <Field label="Escala"><Slider value={typeof T.scale === 'number' ? T.scale : 1} min={0.1} max={3} step={0.01} fmt="x" onChange={(v) => setTransform('s', v)} /></Field>
                <Field label="Cor">
                  <ColorField value={selEntry.params?.color} fallback="#888888" onChange={(v) => edit((sl) => { (sl[sel!.slot][sel!.index].params ||= {}).color = v; })} />
                  <Button size="sm" tip="Volta a cor do acessório" onClick={() => edit((sl) => { delete sl[sel!.slot][sel!.index].params?.color; })}>original</Button>
                </Field>
              </Fields>
              <div className="btns" style={{ marginTop: 12 }}><Button size="sm" onClick={() => edit((sl) => { sl[sel!.slot][sel!.index].transform = {}; })}>Zerar posição</Button></div>
            </>
          ) : (
            <><h2 style={{ marginBottom: 8 }}>Ajustar</h2><EmptyState icon="🎯">Selecione um acessório equipado para mover, girar, escalar e mudar a cor.</EmptyState></>
          )}
        </Card>
      </div>
    </>
  );
}

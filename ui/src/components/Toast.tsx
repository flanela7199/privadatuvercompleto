import React from 'react';

type Kind = 'ok' | 'err' | 'warn';
type T = { id: number; msg: React.ReactNode; kind: Kind };
const Ctx = React.createContext<(msg: React.ReactNode, kind?: Kind, ms?: number) => void>(() => {});
export const useToast = () => React.useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = React.useState<T[]>([]);
  const push = React.useCallback((msg: React.ReactNode, kind: Kind = 'ok', ms = 2600) => {
    const id = Math.random();
    setList((l) => [...l.slice(-4), { id, msg, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), ms);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div id="toasts">{list.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </Ctx.Provider>
  );
}

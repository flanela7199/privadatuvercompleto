import React from 'react';
import { Tooltip } from './Tooltip';

/** Card with a title, an optional description and optional right-side actions. */
export function Section({ title, desc, right, children }: { title: React.ReactNode; desc?: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="sec">
      <div className={`sec-h ${right ? 'row' : ''}`}>
        <div className="grow"><h2>{title}</h2>{desc && <p>{desc}</p>}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

export const Fields = ({ children }: { children: React.ReactNode }) => <div className="fields">{children}</div>;

/** Label (+ optional "?" tooltip) in a fixed column, control on the right. */
export function Field({ label, tip, children }: { label: React.ReactNode; tip?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}{tip && <Tooltip text={tip} />}</label>
      <div className="ctl">{children}</div>
    </div>
  );
}

export const Note = ({ kind = '', children }: { kind?: '' | 'warn'; children: React.ReactNode }) => <div className={`note ${kind}`}>{children}</div>;

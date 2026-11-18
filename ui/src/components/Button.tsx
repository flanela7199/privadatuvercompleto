import React from 'react';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'big';
  tip?: string;
};
/** Button: primary (main action), secondary (default), danger (destructive), ghost (icon-ish). */
export function Button({ kind = 'secondary', size = 'md', tip, className = '', ...rest }: Props) {
  const cls = ['btn', kind !== 'secondary' && kind, size !== 'md' && size, className].filter(Boolean).join(' ');
  return <button type="button" className={cls} title={tip} {...rest} />;
}

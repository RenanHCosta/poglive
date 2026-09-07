import type { ReactNode } from 'react';

interface Props {
  tone: 'neutral' | 'success' | 'warning';
  children: ReactNode;
}
export function StatusBadge({ tone, children }: Props) {
  return (
    <span className={`status-badge ${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

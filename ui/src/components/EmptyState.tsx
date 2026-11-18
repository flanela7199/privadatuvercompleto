import React from 'react';

export const EmptyState = ({ icon, children }: { icon: string; children: React.ReactNode }) => (
  <div className="empty"><div>{icon}</div><p>{children}</p></div>
);

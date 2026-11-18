import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { StoreProvider } from './state/config';
import { ToastProvider } from './components/Toast';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <StoreProvider>
      <App />
    </StoreProvider>
  </ToastProvider>,
);

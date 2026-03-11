import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PeriodProvider } from './context/PeriodContext';
import App from './App';
import './theme/tokens.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PeriodProvider>
          <App />
        </PeriodProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

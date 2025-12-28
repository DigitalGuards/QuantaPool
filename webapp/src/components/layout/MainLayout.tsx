import { Outlet } from 'react-router';
import { Header } from './Header';
import { DevToolsPanel } from '../debug/DevToolsPanel';

export function MainLayout() {
  return (
    <div className="min-h-screen bg-qrl-bg flex flex-col relative">
      {/* Circuit pattern decoration */}
      <div className="circuit-decoration" />

      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 relative z-10">
        <Outlet />
      </main>
      <footer className="border-t border-qrl-border py-4 text-center text-qrl-muted text-sm relative z-10">
        <div className="flex items-center justify-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-qrl-cyan animate-pulse"></span>
          <span>QuantaPool Testing App</span>
          <span className="text-qrl-border">|</span>
          <span>Zond Testnet (Chain ID: 32382)</span>
        </div>
      </footer>
      <DevToolsPanel />
    </div>
  );
}

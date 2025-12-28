import { Outlet } from 'react-router';
import { Header } from './Header';
import { DevToolsPanel } from '../debug/DevToolsPanel';

export function MainLayout() {
  return (
    <div className="min-h-screen bg-qrl-darker flex flex-col">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-gray-800 py-4 text-center text-gray-500 text-sm">
        QuantaPool Testing App | Zond Testnet (Chain ID: 32382)
      </footer>
      <DevToolsPanel />
    </div>
  );
}

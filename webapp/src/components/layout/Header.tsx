import { Link, useLocation } from 'react-router';
import { ConnectWallet } from '../wallet/ConnectWallet';

const navLinks = [
  { path: '/', label: 'Dashboard', icon: '◉' },
  { path: '/stake', label: 'Stake', icon: '⬡' },
  { path: '/queue', label: 'Queue', icon: '☰' },
  { path: '/stats', label: 'Stats', icon: '◫' },
];

export function Header() {
  const location = useLocation();

  return (
    <header className="bg-qrl-dark/80 backdrop-blur-sm border-b border-qrl-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 no-underline">
            <div className="w-10 h-10 bg-qrl-orange rounded-xl flex items-center justify-center font-bold text-white text-lg shadow-lg shadow-qrl-orange/20">
              Q
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold text-white">QuantaPool</span>
              <span className="text-xs text-qrl-orange font-medium -mt-0.5">TESTNET</span>
            </div>
          </Link>

          {/* Navigation - Desktop */}
          <nav className="hidden md:flex items-center gap-1 bg-qrl-darker/50 rounded-xl p-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 no-underline ${
                  location.pathname === link.path
                    ? 'bg-qrl-orange text-white'
                    : 'text-qrl-muted hover:text-white hover:bg-qrl-border'
                }`}
              >
                <span className="text-base">{link.icon}</span>
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Wallet */}
          <ConnectWallet />
        </div>

        {/* Mobile Nav */}
        <nav className="md:hidden flex items-center gap-2 mt-3 overflow-x-auto pb-1">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all no-underline ${
                location.pathname === link.path
                  ? 'bg-qrl-orange text-white'
                  : 'text-qrl-muted bg-qrl-darker/50'
              }`}
            >
              <span>{link.icon}</span>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

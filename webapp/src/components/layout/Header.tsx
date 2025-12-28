import { Link, useLocation } from 'react-router';
import { ConnectWallet } from '../wallet/ConnectWallet';

const navLinks = [
  { path: '/', label: 'Dashboard' },
  { path: '/stake', label: 'Stake' },
  { path: '/queue', label: 'Queue' },
  { path: '/stats', label: 'Stats' },
];

export function Header() {
  const location = useLocation();

  return (
    <header className="bg-qrl-dark border-b border-gray-700">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-qrl-primary rounded-lg flex items-center justify-center font-bold text-white">
              Q
            </div>
            <span className="text-xl font-bold text-white">QuantaPool</span>
            <span className="text-xs bg-yellow-600 text-white px-2 py-0.5 rounded">
              TESTNET
            </span>
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`text-sm font-medium transition-colors ${
                  location.pathname === link.path
                    ? 'text-qrl-primary'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Wallet */}
          <ConnectWallet />
        </div>

        {/* Mobile Nav */}
        <nav className="md:hidden flex items-center gap-4 mt-4 overflow-x-auto">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`text-sm font-medium whitespace-nowrap ${
                location.pathname === link.path
                  ? 'text-qrl-primary'
                  : 'text-gray-400'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

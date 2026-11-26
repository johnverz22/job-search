import { Search } from 'lucide-react';
import { NavLink, Outlet, ScrollRestoration } from 'react-router-dom';

const link = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium lg:min-h-9 ${isActive ? 'bg-accent-soft text-text' : 'text-muted hover:text-text'}`;

export function Layout() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg">Skip to content</a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8">
          <NavLink to="/" className="flex min-h-11 items-center gap-2 text-base font-bold lg:min-h-9">
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg"><Search size={16} aria-hidden="true" /></span>
            Job search
          </NavLink>
          <nav aria-label="Main" className="flex items-center gap-1">
            <NavLink to="/" end className={link}>Jobs</NavLink>
            <NavLink to="/status" className={link}>Status</NavLink>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-screen-xl px-4 py-4 outline-none sm:px-6 sm:py-6 lg:px-8">
        <Outlet />
      </main>
      <ScrollRestoration />
    </>
  );
}

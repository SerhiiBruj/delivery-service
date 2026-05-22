import React from 'react';
import { useAuth } from '../context/AuthContext';

export default function Layout({ children }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-900">
      <header className="bg-slate-900 text-white p-4 shadow-md flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <span className="text-xl font-black tracking-wider text-emerald-400">HYPER_FEED MVP</span>
          <span className="bg-slate-700 px-2.5 py-1 rounded text-xs font-mono text-emerald-300">SECURE_AUTH_ACTIVE</span>
        </div>
        
        {user && (
          <div className="flex items-center space-x-4">
            <div className="text-right hidden sm:block">
              <div className="text-xs text-slate-400 font-bold uppercase">Роль системи</div>
              <div className="text-sm font-black text-emerald-400 font-mono">{user.role}</div>
            </div>
            <button
              onClick={logout}
              className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg text-xs font-bold tracking-wide uppercase transition-all shadow"
            >
              Вийти з акаунту
            </button>
          </div>
        )}
      </header>

      <main className="p-6 max-w-7xl mx-auto w-full flex-grow">
        {children}
      </main>
    </div>
  );
}
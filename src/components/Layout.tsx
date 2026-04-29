import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col pb-24 md:pb-0 font-sans relative isolate overflow-x-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <img
          src="/mini-milagros-watermark.webp"
          alt=""
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 w-[min(92vw,620px)] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.18] md:w-[720px]"
        />
      </div>
      
      <header className="pt-10 px-6 pb-5 text-center relative z-10 max-w-[500px] mx-auto w-full">
        <div className="font-serif italic text-[28px] text-primary mb-1">
          MiniMilagros
        </div>
        <div className="text-[11px] uppercase tracking-[2px] text-primary-dim font-bold">
          Estudio de Estética
        </div>
        
        <Link to="/admin" className="absolute top-5 right-6 text-[11px] text-on-surface-variant no-underline border border-outline-variant px-2 py-1 rounded select-none hover:bg-surface-container-highest transition-colors">
          Admin
        </Link>
      </header>

      <main className="relative z-10 flex-grow max-w-[500px] mx-auto w-full px-6 pt-2 pb-24">
        {children}
      </main>

      {/* Bottom Navbar for Mobile */}
      <nav className="md:hidden bg-background/95 backdrop-blur-md fixed bottom-0 w-full z-50 shadow-[0_-4px_12px_rgba(139,79,79,0.05)] border-t border-outline-variant">
        <div className="flex justify-around items-center px-4 pb-6 pt-4">
           <Link to="/" className="flex flex-col items-center justify-center text-on-surface-variant p-2 hover:text-primary transition-colors">
              <span className="material-symbols-outlined mb-1 text-[22px]">home</span>
              <span className="text-[10px] uppercase font-medium">Inicio</span>
           </Link>
           <a href="#servicios" className="flex flex-col items-center justify-center text-on-surface-variant p-2 hover:text-primary transition-colors">
              <span className="material-symbols-outlined mb-1 text-[22px]">spa</span>
              <span className="text-[10px] uppercase font-medium">Servicios</span>
           </a>
           <Link to="/admin" className="flex flex-col items-center justify-center text-on-surface-variant p-2 hover:text-primary transition-colors">
              <span className="material-symbols-outlined mb-1 text-[22px]">settings</span>
              <span className="text-[10px] uppercase font-medium">Admin</span>
           </Link>
        </div>
      </nav>
    </div>
  );
}

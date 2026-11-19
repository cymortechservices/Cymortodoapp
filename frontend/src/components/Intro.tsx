import { useEffect, useState } from 'react';

const KEY = 'cymor.intro.v1';
export const introSeen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

/** Cinematic first-run intro (~4.2s). Skippable, shown once per device, skipped for reduced-motion users. */
export default function Intro({ onDone }: { onDone: () => void }) {
  const [out, setOut] = useState(false);
  const finish = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } setOut(true); setTimeout(onDone, 500); };
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    const t = setTimeout(finish, 4200);
    const k = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'Enter') && finish();
    addEventListener('keydown', k);
    return () => { clearTimeout(t); removeEventListener('keydown', k); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const letters = 'CYMOR'.split('');
  return (
    <div role="dialog" aria-label="Welcome" onClick={finish} className={`fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-[#07080f] transition-opacity duration-500 ${out ? 'opacity-0' : 'opacity-100'}`}>
      <style>{`
        @keyframes draw { from { stroke-dashoffset: 800 } to { stroke-dashoffset: 0 } }
        @keyframes spinSlow { to { transform: rotate(360deg) } }
        @keyframes letter { from { opacity:0; transform: translateY(40px) scale(.9); filter: blur(10px) } to { opacity:1; transform:none; filter:none } }
        @keyframes fadeUp { from { opacity:0; transform: translateY(14px) } to { opacity:1; transform:none } }
        @keyframes hand { from { transform: rotate(0) } to { transform: rotate(720deg) } }
        @keyframes glow { 0%,100% { opacity:.35 } 50% { opacity:.8 } }
        @keyframes stars { from { transform: translateY(0) } to { transform: translateY(-120px) } }
      `}</style>
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(600px 400px at 50% 45%, rgba(124,92,255,.35), transparent 70%)', animation: 'glow 3s ease-in-out infinite' }} />
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(1px 1px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 60%, #9bf, transparent), radial-gradient(1.5px 1.5px at 40% 80%, #fff, transparent), radial-gradient(1px 1px at 85% 20%, #c9f, transparent)', backgroundSize: '240px 240px', animation: 'stars 12s linear infinite' }} />
      <svg width="220" height="220" viewBox="0 0 220 220" className="relative" aria-hidden>
        <defs><linearGradient id="ig" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7c5cff" /><stop offset="1" stopColor="#22d3ee" /></linearGradient></defs>
        <circle cx="110" cy="110" r="96" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="2" />
        <circle cx="110" cy="110" r="96" fill="none" stroke="url(#ig)" strokeWidth="5" strokeLinecap="round" strokeDasharray="800" style={{ animation: 'draw 2.2s cubic-bezier(.6,.05,.2,1) .2s both', transformOrigin: 'center', transform: 'rotate(-90deg)' }} />
        <g style={{ transformOrigin: '110px 110px', animation: 'spinSlow 14s linear infinite' }}>
          {Array.from({ length: 12 }).map((_, i) => <line key={i} x1="110" y1="22" x2="110" y2={i % 3 === 0 ? 34 : 28} stroke="rgba(255,255,255,.35)" strokeWidth="2" transform={`rotate(${i * 30} 110 110)`} />)}
        </g>
        <line x1="110" y1="110" x2="110" y2="50" stroke="#eef" strokeWidth="4" strokeLinecap="round" style={{ transformOrigin: '110px 110px', animation: 'hand 3.6s cubic-bezier(.5,0,.2,1) .2s both' }} />
        <line x1="110" y1="110" x2="110" y2="76" stroke="url(#ig)" strokeWidth="6" strokeLinecap="round" style={{ transformOrigin: '110px 110px', animation: 'hand 4.2s cubic-bezier(.5,0,.2,1) .2s both reverse' }} />
        <circle cx="110" cy="110" r="6" fill="#fff" />
      </svg>
      <h1 className="relative mt-6 flex gap-1 font-display text-5xl font-bold tracking-[0.18em] text-white sm:text-6xl" aria-label="CYMOR TO-DO">
        {letters.map((l, i) => <span key={i} style={{ animation: `letter .8s cubic-bezier(.2,.7,.2,1) ${1.1 + i * 0.09}s both` }}>{l}</span>)}
        <span className="ml-3 bg-gradient-to-r from-[#7c5cff] to-[#22d3ee] bg-clip-text text-transparent" style={{ animation: 'letter .8s ease 1.7s both' }}>TO-DO</span>
      </h1>
      <p className="relative mt-4 text-sm tracking-[0.3em] text-white/70" style={{ animation: 'fadeUp .9s ease 2.4s both' }}>OWN YOUR TIME. MASTER YOUR DAY.</p>
      <p className="absolute bottom-8 text-xs text-white/40" style={{ animation: 'fadeUp .6s ease 1.5s both' }}>Tap to skip</p>
    </div>
  );
}

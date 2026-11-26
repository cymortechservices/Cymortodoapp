import { useEffect, useRef, useState } from 'react';

/** The intro plays on EVERY launch. (Kept for the Settings 'replay' button.) */
export const introSeen = () => { try { return localStorage.getItem('cymor.nointro') === '1'; } catch { return false; } }; // 'cymor.nointro' exists only for automated tests
export const resetIntro = () => undefined;

/** Gold dust drifting upward behind the emblem. Pure canvas, DPR-aware, stops on unmount. */
function GoldDust() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    let w = 0, h = 0, raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => { w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    const N = w < 600 ? 55 : 90;
    const ps = Array.from({ length: N }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.6 + 0.4, v: Math.random() * 0.35 + 0.08, a: Math.random() * 0.6 + 0.2, t: Math.random() * 6.28 }));
    const tick = () => {
      g.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.y -= p.v; p.t += 0.015; p.x += Math.sin(p.t) * 0.25;
        if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
        const tw = 0.55 + 0.45 * Math.sin(p.t * 2.2);
        g.beginPath(); g.fillStyle = `rgba(245,215,110,${p.a * tw})`; g.shadowColor = 'rgba(212,175,55,.9)'; g.shadowBlur = 8; g.arc(p.x, p.y, p.r, 0, 6.28); g.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    addEventListener('resize', size);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', size); };
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}

/** Cinematic first-run intro (~5.4s). Tap / Esc / Enter skips. Shown on every launch (tap to skip); skipped for reduced motion. */
export default function Intro({ onDone }: { onDone: () => void }) {
  const [out, setOut] = useState(false);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    setOut(true);
    setTimeout(onDone, 650);
  };
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    const t = setTimeout(finish, 4800);
    const k = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'Enter') && finish();
    addEventListener('keydown', k);
    return () => { clearTimeout(t); removeEventListener('keydown', k); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const word = 'CYMOR'.split('');
  const ticks = Array.from({ length: 60 });
  return (
    <div role="dialog" aria-label="Welcome to CYMOR TO-DO" onClick={finish}
      className={`fixed inset-0 z-[100] flex cursor-pointer select-none flex-col items-center justify-center overflow-hidden transition-all duration-700 ${out ? 'scale-105 opacity-0' : 'opacity-100'}`}
      style={{ background: 'radial-gradient(120% 80% at 50% 38%, #1d170a 0%, #0c0a06 55%, #060504 100%)', height: '100dvh' }}>
      <style>{`
        @keyframes ringDraw { from { stroke-dashoffset: 1000 } to { stroke-dashoffset: 0 } }
        @keyframes tickIn { from { opacity: 0; transform: scaleY(.2) } to { opacity: 1; transform: none } }
        @keyframes sweep { from { transform: rotate(0deg) } to { transform: rotate(1080deg) } }
        @keyframes sweepMin { from { transform: rotate(-90deg) } to { transform: rotate(270deg) } }
        @keyframes emblemIn { from { opacity: 0; transform: scale(.82) } to { opacity: 1; transform: none } }
        @keyframes halo { 0%,100% { opacity: .35; transform: scale(1) } 50% { opacity: .75; transform: scale(1.08) } }
        @keyframes letterIn { from { opacity: 0; transform: translateY(26px) scale(.94); filter: blur(12px) } to { opacity: 1; transform: none; filter: blur(0) } }
        @keyframes ruleIn { from { transform: scaleX(0); opacity: 0 } to { transform: scaleX(1); opacity: 1 } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
        @keyframes glint { from { background-position: 220% 0 } to { background-position: -120% 0 } }
        @keyframes breathe { 0%,100% { opacity: .35 } 50% { opacity: .8 } }
      `}</style>
      <GoldDust />
      <div className="pointer-events-none absolute left-1/2 top-[38%] h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(212,175,55,.34), rgba(212,175,55,0))', animation: 'halo 4s ease-in-out infinite' }} />

      <svg viewBox="0 0 260 260" className="relative w-[min(66vw,300px)]" style={{ animation: 'emblemIn 1.1s cubic-bezier(.2,.7,.2,1) both' }} aria-hidden>
        <defs>
          <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F5D76E" /><stop offset=".5" stopColor="#D4AF37" /><stop offset="1" stopColor="#B8860B" /></linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="2.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <circle cx="130" cy="130" r="118" fill="none" stroke="rgba(245,215,110,.14)" strokeWidth="1" />
        <circle cx="130" cy="130" r="108" fill="none" stroke="url(#gold)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="1000" filter="url(#glow)"
          style={{ transformOrigin: '130px 130px', transform: 'rotate(-90deg)', animation: 'ringDraw 2.6s cubic-bezier(.6,.05,.2,1) .25s both' }} />
        {ticks.map((_, i) => {
          const major = i % 5 === 0;
          return <line key={i} x1="130" y1={major ? 28 : 31} x2="130" y2="38" stroke={major ? '#F5D76E' : 'rgba(245,215,110,.45)'} strokeWidth={major ? 2.4 : 1} strokeLinecap="round"
            transform={`rotate(${i * 6} 130 130)`} style={{ transformOrigin: '130px 130px', animation: `tickIn .35s ease ${0.9 + i * 0.022}s both` }} />;
        })}
        <circle cx="130" cy="130" r="86" fill="none" stroke="rgba(245,215,110,.12)" strokeWidth="1" strokeDasharray="2 6" />
        <g style={{ transformOrigin: '130px 130px', animation: 'sweepMin 3.4s cubic-bezier(.45,0,.2,1) .5s both' }}>
          <line x1="130" y1="130" x2="130" y2="52" stroke="#F5EFE0" strokeWidth="3.2" strokeLinecap="round" filter="url(#glow)" />
        </g>
        <g style={{ transformOrigin: '130px 130px', animation: 'sweep 4s cubic-bezier(.45,0,.2,1) .5s both' }}>
          <line x1="130" y1="130" x2="130" y2="80" stroke="url(#gold)" strokeWidth="5.5" strokeLinecap="round" filter="url(#glow)" />
        </g>
        <circle cx="130" cy="130" r="7" fill="url(#gold)" />
        <circle cx="130" cy="130" r="2.6" fill="#0c0a06" />
      </svg>

      <h1 className="relative mt-9 flex font-display text-[clamp(2.6rem,13vw,4.6rem)] font-bold leading-none" aria-label="CYMOR TO-DO" style={{ letterSpacing: '0.2em', marginRight: '-0.2em' }}>
        {word.map((l, i) => (
          <span key={i} className="inline-block"
            style={{ backgroundImage: 'linear-gradient(100deg,#B8860B 0%,#F5D76E 30%,#fff3c4 50%,#F5D76E 70%,#B8860B 100%)', backgroundSize: '220% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
              animation: `letterIn .95s cubic-bezier(.2,.7,.2,1) ${1.7 + i * 0.12}s both, glint 2.4s ease-in-out ${3.1 + i * 0.05}s both` }}>{l}</span>
        ))}
      </h1>
      <div className="relative mt-4 h-px w-40 origin-center" style={{ background: 'linear-gradient(90deg, transparent, #D4AF37, transparent)', animation: 'ruleIn 1s ease 2.6s both' }} />
      <p className="relative mt-4 text-[15px] font-semibold tracking-[0.55em] text-[#F5D76E]" style={{ marginRight: '-0.55em', animation: 'fadeUp .9s ease 2.8s both' }}>TO-DO</p>
      <p className="relative mt-7 px-8 text-center font-display text-lg italic text-[#e9dfc2]" style={{ animation: 'fadeUp 1s ease 3.4s both' }}>Own your time. Master your day.</p>
      <p className="absolute bottom-[max(2.2rem,env(safe-area-inset-bottom))] text-xs uppercase tracking-[0.3em] text-[#a69d88]" style={{ animation: 'fadeUp .8s ease 2s both, breathe 2.4s ease-in-out 3s infinite' }}>Tap to begin</p>
    </div>
  );
}

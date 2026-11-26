/** Notification sounds generated with WebAudio (no audio files). Only play while the app is open. */
let ctx: AudioContext | null = null;
const SEQ: Record<string, [number, number][]> = {
  chime: [[880, 0.12], [1320, 0.2]],
  pulse: [[660, 0.1], [660, 0.1], [990, 0.2]],
  soft: [[523, 0.25]],
  alert: [[990, 0.12], [740, 0.12], [990, 0.12], [740, 0.2]],
};
export const SOUNDS = Object.keys(SEQ);
export function playSound(name = 'chime', enabled = true) {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    let t = ctx.currentTime;
    for (const [f, d] of SEQ[name] ?? SEQ.chime!) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d + 0.02);
      t += d + 0.03;
    }
  } catch { /* autoplay blocked or unsupported */ }
}

/** Loud repeating alarm for the in-app "activity is starting" screen. Call stopAlarm() to silence it. */
let alarmTimer: ReturnType<typeof setInterval> | undefined;
export function startAlarm() {
  stopAlarm();
  const beep = () => {
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') void ctx.resume();
      let t = ctx.currentTime;
      for (let k = 0; k < 3; k++) for (const f of [1568, 2093]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.18);
        t += 0.23;
      }
    } catch { /* autoplay blocked */ }
    try { navigator.vibrate?.([300, 150, 300, 150, 600]); } catch { /* unsupported */ }
  };
  beep();
  alarmTimer = setInterval(beep, 2400);
}
export function stopAlarm() { if (alarmTimer) clearInterval(alarmTimer); alarmTimer = undefined; try { navigator.vibrate?.(0); } catch { /* unsupported */ } }

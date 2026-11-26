import type { NotifyCfg } from './auth';

/** Activity templates saved on this phone (localStorage). */
export interface Template { id: string; name: string; title: string; category: string; color: string; location: string; start: string; end: string; notify?: NotifyCfg }
const KEY = 'cymor.templates';
export const loadTemplates = (): Template[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const save = (t: Template[]) => { try { localStorage.setItem(KEY, JSON.stringify(t.slice(0, 24))); } catch { /* storage unavailable */ } };
export function addTemplate(t: Omit<Template, 'id' | 'name'> & { name?: string }): Template[] {
  const all = loadTemplates().filter((x) => x.title.toLowerCase() !== t.title.toLowerCase());
  const next = [{ ...t, id: Math.random().toString(36).slice(2, 9), name: t.name ?? t.title }, ...all]; save(next); return next;
}
export function removeTemplate(id: string): Template[] { const next = loadTemplates().filter((x) => x.id !== id); save(next); return next; }

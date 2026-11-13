import Dexie, { type EntityTable } from 'dexie';

export interface Note {
  id: string;
  /** caminho no vault, ex.: "Projetos/Quartzo.md" */
  path: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  /** exclusão lógica para propagar pelo sync */
  deleted: 0 | 1;
  /** 0 = alteração local ainda não enviada */
  synced: 0 | 1;
  /** updatedAt da última versão conhecida do servidor (detecção de conflito) */
  remoteUpdatedAt: number;
  pinned?: 0 | 1;
}

export interface Meta {
  key: string;
  value: unknown;
}

/**
 * Um banco por "espaço": 'local' (modo offline) ou o uid do usuário logado.
 * Assim trocar de conta nunca mistura notas.
 */
export class QuartzoDB extends Dexie {
  notes!: EntityTable<Note, 'id'>;
  meta!: EntityTable<Meta, 'key'>;
  constructor(space: string) {
    super(`quartzo-${space}`);
    this.version(1).stores({
      notes: 'id, path, updatedAt, deleted, synced',
      meta: 'key',
    });
  }
}

let current: QuartzoDB | null = null;

export function openSpace(space: string): QuartzoDB {
  if (current && current.name === `quartzo-${space}`) return current;
  current?.close();
  current = new QuartzoDB(space);
  return current;
}

export function getDB(): QuartzoDB {
  if (!current) throw new Error('Banco não inicializado');
  return current;
}

export const newId = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '');

export function deviceId(): string {
  try {
    let id = localStorage.getItem('quartzo.device');
    if (!id) {
      id = newId().slice(0, 12);
      localStorage.setItem('quartzo.device', id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

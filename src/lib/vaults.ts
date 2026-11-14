import { getDB, newId, type Note } from './db';

/**
 * Cofres (vaults): conjuntos independentes de notas dentro da mesma conta —
 * como as pastas-vault do Obsidian. Cada nota guarda o id do cofre; links,
 * grafo, busca e tags enxergam só o cofre aberto. A lista de cofres fica no
 * documento raiz do Firestore (manage/modulo/quartzo/{uid}) e sincroniza.
 */
export interface Vault {
  id: string;
  name: string;
  createdAt: number;
}

export const MAIN_VAULT = 'main';
export const DEFAULT_VAULTS: Vault[] = [{ id: MAIN_VAULT, name: 'Principal', createdAt: 0 }];

export const vaultOf = (n: Pick<Note, 'vault'>) => n.vault || MAIN_VAULT;

let current = MAIN_VAULT;
export const getVault = () => current;
export const setCurrentVault = (id: string) => { current = id || MAIN_VAULT; };

type VaultsMeta = { list: Vault[]; updatedAt: number };

export function normalizeVaults(list: unknown): Vault[] {
  const arr = Array.isArray(list) ? list : [];
  const out: Vault[] = arr
    .filter((v): v is Vault => !!v && typeof (v as Vault).id === 'string' && typeof (v as Vault).name === 'string')
    .map((v) => ({ id: v.id, name: v.name.slice(0, 80), createdAt: Number(v.createdAt) || 0 }));
  if (!out.some((v) => v.id === MAIN_VAULT)) out.unshift(DEFAULT_VAULTS[0]);
  return out;
}

export async function readVaults(): Promise<VaultsMeta> {
  const m = (await getDB().meta.get('vaults'))?.value as VaultsMeta | undefined;
  return { list: normalizeVaults(m?.list), updatedAt: m?.updatedAt ?? 0 };
}

type Pusher = (meta: VaultsMeta) => void;
let pusher: Pusher | null = null;
/** O motor de sync registra aqui como enviar a lista de cofres. */
export const onVaultsChanged = (fn: Pusher | null) => { pusher = fn; };

export async function writeVaults(list: Vault[], updatedAt = Date.now(), fromRemote = false) {
  const meta = { list: normalizeVaults(list), updatedAt };
  await getDB().meta.put({ key: 'vaults', value: meta });
  if (!fromRemote) pusher?.(meta);
}

export async function createVault(name: string): Promise<Vault> {
  const { list } = await readVaults();
  const v: Vault = { id: newId().slice(0, 12), name: name.trim() || 'Novo cofre', createdAt: Date.now() };
  await writeVaults([...list, v]);
  return v;
}

export async function renameVault(id: string, name: string) {
  const { list } = await readVaults();
  await writeVaults(list.map((v) => (v.id === id ? { ...v, name: name.trim() || v.name } : v)));
}

/** Remove o cofre da lista e manda as notas dele para a lixeira (recuperáveis). */
export async function deleteVault(id: string) {
  if (id === MAIN_VAULT) return;
  const db = getDB();
  const now = Date.now();
  await db.notes.filter((n) => vaultOf(n) === id && !n.deleted).modify({ deleted: 1, updatedAt: now, synced: 0 });
  const { list } = await readVaults();
  await writeVaults(list.filter((v) => v.id !== id));
}

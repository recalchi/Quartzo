import { getDB, newId, type Note } from './db';
import { getVault, MAIN_VAULT, vaultOf } from './vaults';

export const titleOf = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');
export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
/** Chave de comparação de títulos: ignora maiúsculas, espaços nas pontas, .md e forma Unicode (acentos NFC/NFD). */
export const normalizeKey = (s: string) => s.normalize('NFC').trim().replace(/\.md$/i, '').replace(/\s+/g, ' ').toLowerCase();

export function sanitizePath(path: string): string {
  let p = path
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim())
    .filter(Boolean)
    .join('/');
  if (!p) p = 'Sem título';
  if (!/\.md$/i.test(p)) p += '.md';
  return p;
}

/** Garante caminho único adicionando " 1", " 2"... */
export async function uniquePath(path: string, ignoreId?: string, vault = getVault()): Promise<string> {
  const db = getDB();
  const base = sanitizePath(path).replace(/\.md$/i, '');
  let candidate = `${base}.md`;
  let i = 1;
  for (;;) {
    const hit = await db.notes.where('path').equals(candidate).filter((n) => !n.deleted && n.id !== ignoreId && vaultOf(n) === vault).first();
    if (!hit) return candidate;
    candidate = `${base} ${i++}.md`;
  }
}

export async function createNote(path: string, content = '', vault = getVault()): Promise<Note> {
  const now = Date.now();
  const note: Note = {
    id: newId(),
    path: await uniquePath(path, undefined, vault),
    content,
    createdAt: now,
    updatedAt: now,
    deleted: 0,
    synced: 0,
    remoteUpdatedAt: 0,
    ...(vault !== MAIN_VAULT ? { vault } : {}),
  };
  await getDB().notes.add(note);
  return note;
}

export async function updateNote(id: string, patch: Partial<Pick<Note, 'content' | 'path' | 'pinned' | 'vault'>>) {
  const db = getDB();
  const cur = await db.notes.get(id);
  const vault = patch.vault ?? (cur ? vaultOf(cur) : getVault());
  if (patch.path || patch.vault) patch.path = await uniquePath(patch.path ?? cur?.path ?? 'Sem título', id, vault);
  // cofre principal = campo ausente (Dexie remove a chave quando o valor é undefined)
  if (patch.vault === MAIN_VAULT) patch.vault = undefined;
  await db.notes.update(id, { ...patch, updatedAt: Date.now(), synced: 0 });
}

export async function renameNote(note: Note, newPath: string) {
  const oldTitle = titleOf(note.path);
  await updateNote(note.id, { path: newPath });
  const fresh = await getDB().notes.get(note.id);
  const newTitle = fresh ? titleOf(fresh.path) : titleOf(newPath);
  if (oldTitle === newTitle) return;
  // Atualiza [[links]] que apontavam para o título antigo
  const re = new RegExp(`\\[\\[${escapeRe(oldTitle)}(\\|[^\\]]*)?\\]\\]`, 'gi');
  const v = vaultOf(note);
  const all = await getDB().notes.filter((n) => !n.deleted && vaultOf(n) === v && re.test(n.content)).toArray();
  for (const n of all) {
    re.lastIndex = 0;
    await updateNote(n.id, { content: n.content.replace(re, (_m, alias) => `[[${newTitle}${alias ?? ''}]]`) });
  }
}

export async function deleteNote(id: string) {
  await getDB().notes.update(id, { deleted: 1, updatedAt: Date.now(), synced: 0 });
}

/** Restaura da lixeira; se o cofre original não existe mais, vai para o cofre aberto. */
export async function restoreNote(id: string, intoVault?: string) {
  const db = getDB();
  const n = await db.notes.get(id);
  if (!n) return;
  const vault = intoVault ?? vaultOf(n);
  const path = await uniquePath(n.path, id, vault);
  await db.notes.update(id, { deleted: 0, path, vault: vault === MAIN_VAULT ? undefined : vault, updatedAt: Date.now(), synced: 0 });
}

/** Renomeia/move uma pasta inteira (todas as notas abaixo dela). */
export async function renameFolder(from: string, to: string) {
  const db = getDB();
  const v = getVault();
  const target = sanitizePath(to).replace(/\.md$/i, '');
  const list = await db.notes.filter((n) => !n.deleted && vaultOf(n) === v && (n.path.startsWith(`${from}/`))).toArray();
  for (const n of list) await updateNote(n.id, { path: `${target}/${n.path.slice(from.length + 1)}` });
  return list.length;
}

/** Manda para a lixeira todas as notas de uma pasta. */
export async function deleteFolder(folder: string) {
  const db = getDB();
  const v = getVault();
  const now = Date.now();
  return db.notes.filter((n) => !n.deleted && vaultOf(n) === v && n.path.startsWith(`${folder}/`)).modify({ deleted: 1, updatedAt: now, synced: 0 });
}

export async function duplicateNote(n: Note) {
  return createNote(n.path.replace(/\.md$/i, ' (cópia).md'), n.content, vaultOf(n));
}

export function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function todayPath(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `Diário/${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.md`;
}

export async function openOrCreateDaily(): Promise<Note> {
  const path = todayPath();
  const existing = await getDB().notes.where('path').equals(path).filter((n) => !n.deleted && vaultOf(n) === getVault()).first();
  if (existing) return existing;
  const d = new Date();
  const header = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  return createNote(path, `# ${header}\n\n## Tarefas\n- [ ] \n\n## Notas\n`);
}

export const WELCOME = `# Bem-vindo ao Quartzo 💎

O Quartzo é o seu segundo cérebro: notas em **Markdown**, conectadas por links e
sincronizadas entre desktop, web e celular com a sua conta do **Recalchi Manage**.

## Comece por aqui
- Crie uma nota com **Ctrl/⌘ + N**
- Abra qualquer nota rapidamente com **Ctrl/⌘ + P**
- Ligue ideias escrevendo \`[[Nome da nota]]\` — por exemplo [[Atalhos]]
- Use #tags para agrupar assuntos
- Abra a **nota do dia** pelo ícone de calendário
- Veja as conexões no **grafo** 🕸️

## Tarefas
- [x] Instalar o Quartzo
- [ ] Importar meu vault antigo (menu ⋯ → Importar pasta)
- [ ] Entrar com a conta do Recalchi Manage para sincronizar

> Dica: tudo funciona offline. Quando a internet voltar, o Quartzo sincroniza sozinho.
`;

export const SHORTCUTS = `# Atalhos

| Ação | Atalho |
| --- | --- |
| Nova nota | Ctrl/⌘ + N |
| Abrir nota (busca rápida) | Ctrl/⌘ + P |
| Alternar edição/visualização | Ctrl/⌘ + E |
| Buscar no texto | Ctrl/⌘ + F |
| Nota do dia | Ctrl/⌘ + D |
| Grafo | Ctrl/⌘ + G |

Voltar para [[Bem-vindo ao Quartzo]] · #ajuda
`;

const seeding = new Map<string, Promise<void>>();

/** Cria as notas iniciais uma única vez por banco (seguro contra chamadas concorrentes). */
export function seedIfEmpty(): Promise<void> {
  const name = getDB().name;
  if (!seeding.has(name)) seeding.set(name, doSeed());
  return seeding.get(name)!;
}

async function doSeed() {
  const db = getDB();
  const seeded = await db.meta.get('seeded');
  if (seeded) return;
  const count = await db.notes.count();
  if (count === 0) {
    await createNote('Bem-vindo ao Quartzo.md', WELCOME);
    await createNote('Atalhos.md', SHORTCUTS);
  }
  await db.meta.put({ key: 'seeded', value: true });
}

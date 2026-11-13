import { getDB, newId, type Note } from './db';

export const titleOf = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');
export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const normalizeKey = (s: string) => s.trim().toLowerCase();

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
export async function uniquePath(path: string, ignoreId?: string): Promise<string> {
  const db = getDB();
  const base = sanitizePath(path).replace(/\.md$/i, '');
  let candidate = `${base}.md`;
  let i = 1;
  for (;;) {
    const hit = await db.notes.where('path').equals(candidate).filter((n) => !n.deleted && n.id !== ignoreId).first();
    if (!hit) return candidate;
    candidate = `${base} ${i++}.md`;
  }
}

export async function createNote(path: string, content = ''): Promise<Note> {
  const now = Date.now();
  const note: Note = {
    id: newId(),
    path: await uniquePath(path),
    content,
    createdAt: now,
    updatedAt: now,
    deleted: 0,
    synced: 0,
    remoteUpdatedAt: 0,
  };
  await getDB().notes.add(note);
  return note;
}

export async function updateNote(id: string, patch: Partial<Pick<Note, 'content' | 'path' | 'pinned'>>) {
  const db = getDB();
  if (patch.path) patch.path = await uniquePath(patch.path, id);
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
  const all = await getDB().notes.filter((n) => !n.deleted && re.test(n.content)).toArray();
  for (const n of all) {
    re.lastIndex = 0;
    await updateNote(n.id, { content: n.content.replace(re, (_m, alias) => `[[${newTitle}${alias ?? ''}]]`) });
  }
}

export async function deleteNote(id: string) {
  await getDB().notes.update(id, { deleted: 1, updatedAt: Date.now(), synced: 0 });
}

export async function restoreNote(id: string) {
  await getDB().notes.update(id, { deleted: 0, updatedAt: Date.now(), synced: 0 });
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
  const existing = await getDB().notes.where('path').equals(path).filter((n) => !n.deleted).first();
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

export async function seedIfEmpty() {
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

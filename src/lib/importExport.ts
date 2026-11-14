import JSZip from 'jszip';
import { getDB } from './db';
import { createNote, sanitizePath } from './notes';
import { getVault, vaultOf } from './vaults';

/**
 * Importa arquivos .md de uma pasta (ex.: um vault antigo do Obsidian).
 * Ignora pastas ocultas como .obsidian, .trash e .git.
 */
/** Nome da pasta escolhida no seletor (usado para nomear um cofre importado). */
export function rootFolderName(files: FileList | File[]): string {
  const f = Array.from(files)[0] as (File & { webkitRelativePath?: string }) | undefined;
  return f?.webkitRelativePath?.split('/')[0] || 'Cofre importado';
}

export async function importFiles(files: FileList | File[], vault = getVault()): Promise<number> {
  let count = 0;
  for (const f of Array.from(files)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (!/\.(md|markdown|txt)$/i.test(rel)) continue;
    const parts = rel.replace(/\\/g, '/').split('/');
    if (parts.some((p) => p.startsWith('.'))) continue;
    // remove a pasta raiz escolhida pelo usuário
    const path = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
    const content = await f.text();
    await createNote(sanitizePath(path.replace(/\.(markdown|txt)$/i, '.md')), content, vault);
    count++;
  }
  return count;
}

/** Exporta o vault inteiro como .zip com a estrutura de pastas. */
export async function exportZip(): Promise<Blob> {
  const zip = new JSZip();
  const v = getVault();
  const notes = await getDB().notes.filter((n) => !n.deleted && vaultOf(n) === v).toArray();
  for (const n of notes) zip.file(n.path, n.content);
  return zip.generateAsync({ type: 'blob' });
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

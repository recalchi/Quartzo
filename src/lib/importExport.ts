import JSZip from 'jszip';
import { getDB } from './db';
import { createNote, sanitizePath } from './notes';

/**
 * Importa arquivos .md de uma pasta (ex.: um vault antigo do Obsidian).
 * Ignora pastas ocultas como .obsidian, .trash e .git.
 */
export async function importFiles(files: FileList | File[]): Promise<number> {
  let count = 0;
  for (const f of Array.from(files)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (!/\.(md|markdown|txt)$/i.test(rel)) continue;
    const parts = rel.replace(/\\/g, '/').split('/');
    if (parts.some((p) => p.startsWith('.'))) continue;
    // remove a pasta raiz escolhida pelo usuário
    const path = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
    const content = await f.text();
    await createNote(sanitizePath(path.replace(/\.(markdown|txt)$/i, '.md')), content);
    count++;
  }
  return count;
}

/** Exporta o vault inteiro como .zip com a estrutura de pastas. */
export async function exportZip(): Promise<Blob> {
  const zip = new JSZip();
  const notes = await getDB().notes.filter((n) => !n.deleted).toArray();
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

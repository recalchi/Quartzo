/**
 * Importa um PDF em notas: cada título (linha em negrito) vira uma nota.
 * Tudo acontece no próprio aparelho — o arquivo não é enviado a nenhum servidor.
 */
export interface PdfLine {
  text: string;
  bold: boolean;
  /** sugestão inicial de "começa uma nota nova aqui" */
  title: boolean;
}

export async function readPdfLines(file: File): Promise<PdfLine[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: PdfLine[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      await page.getOperatorList(); // carrega as fontes (para saber o que é negrito)
      const content = await page.getTextContent();
      const fontIsBold = new Map<string, boolean>();
      const isBold = (fontName: string) => {
        if (!fontIsBold.has(fontName)) {
          let name = '';
          try { name = (page.commonObjs.get(fontName) as { name?: string } | undefined)?.name ?? ''; } catch { /* fonte não carregada */ }
          fontIsBold.set(fontName, /bold|black|heavy|semibold/i.test(name));
        }
        return fontIsBold.get(fontName)!;
      };
      // agrupa os pedaços de texto em linhas pela posição vertical
      const rows: { y: number; parts: { x: number; str: string; bold: boolean }[] }[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const [, , , , x, y] = it.transform as number[];
        let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
        if (!row) { row = { y, parts: [] }; rows.push(row); }
        row.parts.push({ x, str: it.str, bold: isBold(it.fontName) });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.parts.sort((a, b) => a.x - b.x);
        const text = r.parts.map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const boldChars = r.parts.filter((x) => x.bold).reduce((n, x) => n + x.str.length, 0);
        const total = r.parts.reduce((n, x) => n + x.str.length, 0);
        const bold = boldChars / Math.max(1, total) > 0.6;
        out.push({ text, bold, title: bold && looksLikeTitle(text) });
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

/** Título: curto, sem cara de e-mail/URL e sem muitos números. */
function looksLikeTitle(t: string) {
  const s = t.replace(/[:：]\s*$/, '');
  return s.length <= 40 && !/@|https?:\/\/|www\./i.test(s) && (s.match(/\d/g)?.length ?? 0) < 6;
}

export interface PdfNote { title: string; content: string }

/** Monta as notas a partir das linhas marcadas como título. */
export function buildNotes(lines: PdfLine[], fallbackTitle: string): PdfNote[] {
  const notes: PdfNote[] = [];
  let cur: { title: string; body: string[] } | null = null;
  const flush = () => { if (cur) notes.push({ title: cur.title, content: `# ${cur.title}\n\n${cur.body.join('\n')}\n`.replace(/\n{3,}/g, '\n\n') }); };
  for (const l of lines) {
    if (l.title) {
      flush();
      cur = { title: cleanTitle(l.text), body: [] };
    } else {
      if (!cur) cur = { title: fallbackTitle, body: [] };
      // linha que estava em negrito no meio do texto continua destacada
      cur.body.push(l.bold ? `**${l.text}**` : l.text);
    }
  }
  flush();
  return notes.filter((n) => n.title);
}

const cleanTitle = (t: string) => t.replace(/[:：]\s*$/, '').replace(/[\\/<>:"|?*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sem título';

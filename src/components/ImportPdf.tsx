import { useEffect, useMemo, useState } from 'react';
import { buildNotes, readPdfLines, type PdfLine } from '../lib/pdfImport';
import { createNote } from '../lib/notes';
import { createVault, setVaultLock, type Vault } from '../lib/vaults';

interface Props {
  file: File;
  current: Vault;
  onClose: () => void;
  /** importou: abre o cofre de destino */
  onDone: (vaultId: string, count: number) => void;
}

const niceName = (f: File) => {
  const base = f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || 'Importado';
  return base.charAt(0).toUpperCase() + base.slice(1);
};

/** Prévia da importação: o usuário escolhe quais linhas começam uma nota nova. */
export function ImportPdf({ file, current, onClose, onDone }: Props) {
  const [lines, setLines] = useState<PdfLine[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState<'new' | 'here'>('new');
  const [name, setName] = useState(() => niceName(file));
  const [protect, setProtect] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    readPdfLines(file).then(setLines).catch((e) => setErr(`Não foi possível ler o PDF: ${(e as Error).message}`));
  }, [file]);

  const notes = useMemo(() => (lines ? buildNotes(lines, name || 'Início') : []), [lines, name]);

  const toggle = (i: number) => setLines((ls) => ls && ls.map((l, j) => (j === i ? { ...l, title: !l.title } : l)));

  const run = async () => {
    if (!lines) return;
    setBusy(true);
    try {
      let vaultId = current.id;
      if (target === 'new') {
        const v = await createVault(name.trim() || niceName(file));
        vaultId = v.id;
        if (protect) await setVaultLock(v.id, true);
      }
      for (const n of notes) await createNote(n.title, n.content, vaultId);
      onDone(vaultId, notes.length);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="import-box" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <b>Importar PDF</b>
          <small className="muted">{file.name} · lido só neste aparelho</small>
        </header>

        {!lines && !err && <div className="handoff-wait"><span className="spinner" /> Lendo o PDF…</div>}
        {err && <div className="login-msg error">{err}</div>}

        {lines && (
          <>
            <div className="import-opts">
              <label><input type="radio" checked={target === 'new'} onChange={() => setTarget('new')} /> Novo cofre</label>
              {target === 'new' && <input className="gs-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cofre" />}
              <label><input type="radio" checked={target === 'here'} onChange={() => setTarget('here')} /> No cofre aberto ({current.name})</label>
              {target === 'new' && (
                <label title="Pede digital/PIN do aparelho para abrir"><input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} /> Proteger com PIN/biometria</label>
              )}
            </div>
            <p className="muted small">
              Marque as linhas que <b>começam uma nota nova</b> (títulos em negrito já vêm marcados). Serão criadas <b>{notes.length}</b> notas.
            </p>
            <div className="import-lines">
              {lines.map((l, i) => (
                <label key={i} className={`import-line${l.title ? ' title' : ''}`}>
                  <input type="checkbox" checked={l.title} onChange={() => toggle(i)} />
                  <span className={l.bold ? 'b' : ''}>{l.text}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <footer className="row-btns">
          <button className="btn small ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button className="btn small primary" disabled={!lines || busy || !notes.length} onClick={() => void run()}>
            {busy ? 'Importando…' : `Importar ${notes.length} notas`}
          </button>
        </footer>
      </div>
    </div>
  );
}

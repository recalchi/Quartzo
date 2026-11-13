import { ACCENTS, setSettings, useSettings } from '../lib/settings';
import type { SyncState } from '../lib/sync';
import { MANAGE_URL } from '../lib/firebase';

interface Props {
  account: string;
  sync: SyncState;
  noteCount: number;
  onImport: () => void;
  onExport: () => void;
  onLogout: () => void;
}

export function SettingsView({ account, sync, noteCount, onImport, onExport, onLogout }: Props) {
  const s = useSettings();
  return (
    <div className="settings">
      <h2>Configurações</h2>

      <section>
        <h3>Aparência</h3>
        <div className="set-row">
          <div>
            <b>Tema</b>
            <p>O padrão é escuro neutro.</p>
          </div>
          <div className="seg">
            {(['dark', 'light', 'system'] as const).map((t) => (
              <button key={t} className={s.theme === t ? 'on' : ''} onClick={() => setSettings({ theme: t })}>
                {t === 'dark' ? 'Escuro' : t === 'light' ? 'Claro' : 'Sistema'}
              </button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <div>
            <b>Cor de destaque</b>
            <p>Links, seleção e a nota aberta no grafo.</p>
          </div>
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button key={a.value} title={a.name} className={`swatch${s.accent === a.value ? ' on' : ''}`} style={{ background: a.value }} onClick={() => setSettings({ accent: a.value })} />
            ))}
            <label className="swatch custom" title="Cor personalizada">
              <input type="color" value={s.accent} onChange={(e) => setSettings({ accent: e.target.value })} />
            </label>
          </div>
        </div>
        <div className="set-row">
          <div>
            <b>Tamanho do texto</b>
            <p>{s.editorSize}px no editor e na leitura.</p>
          </div>
          <input type="range" min={13} max={22} value={s.editorSize} onChange={(e) => setSettings({ editorSize: Number(e.target.value) })} />
        </div>
      </section>

      <section>
        <h3>Conta e sincronização</h3>
        <div className="set-row">
          <div>
            <b>{account}</b>
            <p>
              {sync === 'local'
                ? 'Notas guardadas só neste dispositivo.'
                : 'Conta do Recalchi Manage — notas sincronizadas entre web, desktop e celular.'}
            </p>
          </div>
          <button className="btn small" onClick={onLogout}>Sair</button>
        </div>
        {MANAGE_URL && (
          <div className="set-row">
            <div>
              <b>Recalchi Manage</b>
              <p>Gerencie o Quartzo e baixe os aplicativos na plataforma.</p>
            </div>
            <button className="btn small" onClick={() => window.open(`${MANAGE_URL.replace(/\/$/, '')}/quartzo/painel`, '_blank', 'noopener')}>Abrir painel</button>
          </div>
        )}
      </section>

      <section>
        <h3>Dados</h3>
        <div className="set-row">
          <div>
            <b>{noteCount} notas</b>
            <p>Importe uma pasta de .md (inclusive um vault do Obsidian) ou exporte tudo em .zip.</p>
          </div>
          <div className="row-btns">
            <button className="btn small" onClick={onImport}>Importar pasta</button>
            <button className="btn small" onClick={onExport}>Exportar .zip</button>
          </div>
        </div>
      </section>

      <p className="muted small">Quartzo {__APP_VERSION__} · projeto independente de Renan Recalchi</p>
    </div>
  );
}

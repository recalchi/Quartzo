import { ACCENTS, setSettings, useSettings } from '../lib/settings';
import type { SyncState } from '../lib/sync';
import { MANAGE_URL } from '../lib/firebase';
import { MAIN_VAULT, type Vault } from '../lib/vaults';

interface Props {
  account: string;
  sync: SyncState;
  noteCount: number;
  onImport: () => void;
  onExport: () => void;
  onLogout: () => void;
  vaults: Vault[];
  current: string;
  counts: Map<string, number>;
  onSwitchVault: (id: string) => void;
  onNewVault: () => void;
  onImportVault: () => void;
  onRenameVault: (v: Vault) => void;
  onDeleteVault: (v: Vault) => void;
}

export function SettingsView({ account, sync, noteCount, onImport, onExport, onLogout, vaults, current, counts, onSwitchVault, onNewVault, onImportVault, onRenameVault, onDeleteVault }: Props) {
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
        <h3>Cofres</h3>
        <p className="muted small">Cada cofre é um conjunto separado de notas (como um vault do Obsidian): links, grafo, tags e busca
          enxergam só o cofre aberto. Todos sincronizam com a sua conta.</p>
        {vaults.map((v) => (
          <div key={v.id} className={`set-row vault-row${v.id === current ? ' on' : ''}`}>
            <div>
              <b>🗄 {v.name}{v.id === current && <small className="badge">aberto</small>}</b>
              <p>{counts.get(v.id) ?? 0} notas{v.id === MAIN_VAULT ? ' · cofre principal' : ''}</p>
            </div>
            <div className="row-btns">
              {v.id !== current && <button className="btn small" onClick={() => onSwitchVault(v.id)}>Abrir</button>}
              <button className="btn small ghost" onClick={() => onRenameVault(v)}>Renomear</button>
              {v.id !== MAIN_VAULT && <button className="btn small ghost danger" onClick={() => onDeleteVault(v)}>Excluir</button>}
            </div>
          </div>
        ))}
        <div className="row-btns" style={{ marginTop: 10 }}>
          <button className="btn small primary" onClick={onNewVault}>＋ Novo cofre</button>
          <button className="btn small" onClick={onImportVault}>📂 Abrir pasta como cofre (vault do Obsidian)</button>
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
            <p>No cofre aberto: importe uma pasta de .md ou exporte o cofre em .zip.</p>
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

import { useEffect, useRef, useState } from 'react';
import { Logo } from './Logo';
import { askText } from './Overlays';
import type { Vault } from '../lib/vaults';
import { setVaultLock } from '../lib/vaults';
import {
  checkPin, deviceAuth, hasPin, lockErrorMessage, lockMethod, markUnlocked, methodLabel, setPin, type LockMethod,
} from '../lib/vaultLock';

const PIN_RE = /^\d{4,8}$/;

/** Cria o PIN do Quartzo (pede duas vezes). */
async function createPin(space: string): Promise<boolean> {
  const a = await askText('Crie um PIN para os cofres protegidos', '', { secret: true, ok: 'Continuar', hint: '4 a 8 números. Fica guardado só neste aparelho.' });
  if (!a) return false;
  if (!PIN_RE.test(a)) { alert('O PIN precisa ter de 4 a 8 números.'); return false; }
  const b = await askText('Repita o PIN', '', { secret: true, ok: 'Salvar PIN' });
  if (b !== a) { if (b !== null) alert('Os PINs não conferem.'); return false; }
  await setPin(space, a);
  return true;
}

/** Autentica o dono do aparelho para mexer num cofre protegido. */
export async function authenticate(space: string, label: string, reason: string): Promise<boolean> {
  const m = await lockMethod();
  if (m !== 'pin') {
    await deviceAuth(space, reason, label);
    return true;
  }
  if (!hasPin(space)) return createPin(space);
  const pin = await askText(reason, '', { secret: true, ok: 'Confirmar' });
  if (!pin) return false;
  if (!(await checkPin(space, pin))) { alert('PIN incorreto.'); return false; }
  return true;
}

/** Liga o bloqueio de um cofre (confirma no aparelho antes). */
export async function enableLock(space: string, label: string, v: Vault) {
  try {
    if (!(await authenticate(space, label, `Proteger o cofre “${v.name}”`))) return;
    await setVaultLock(v.id, true);
    markUnlocked(v.id); // quem acabou de proteger continua com ele aberto
  } catch (e) {
    alert(lockErrorMessage(e));
  }
}

/** Desliga o bloqueio (exige autenticação). */
export async function disableLock(space: string, label: string, v: Vault) {
  try {
    if (!(await authenticate(space, label, `Remover a proteção do cofre “${v.name}”`))) return;
    await setVaultLock(v.id, false);
  } catch (e) {
    alert(lockErrorMessage(e));
  }
}

interface Props {
  space: string;
  label: string;
  vault: Vault;
  vaults: Vault[];
  onSwitch: (id: string) => void;
}

/** Tela exibida no lugar das notas enquanto um cofre protegido está trancado. */
export function LockScreen({ space, label, vault, vaults, onSwitch }: Props) {
  const [method, setMethod] = useState<LockMethod | null>(null);
  const [pin, setPinValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fails = useRef(0);
  const [cooldown, setCooldown] = useState(0);
  const tried = useRef(false);

  useEffect(() => { void lockMethod().then(setMethod); }, []);

  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const unlockDevice = async () => {
    setBusy(true);
    setErr(null);
    try {
      await deviceAuth(space, `Abrir o cofre “${vault.name}”`, label);
      markUnlocked(vault.id);
    } catch (e) {
      setErr(lockErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // no celular, a biometria/PIN do sistema já aparece sozinha
  useEffect(() => {
    if (method === 'native' && !tried.current) { tried.current = true; void unlockDevice(); }
  }, [method]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldown) return;
    setBusy(true);
    setErr(null);
    if (!hasPin(space)) {
      // aparelho sem PIN do Quartzo ainda: cria agora
      if (await createPin(space)) markUnlocked(vault.id);
      setBusy(false);
      return;
    }
    const ok = await checkPin(space, pin);
    setBusy(false);
    if (ok) { fails.current = 0; markUnlocked(vault.id); return; }
    fails.current++;
    setPinValue('');
    if (fails.current >= 5) { fails.current = 0; setCooldown(30); setErr('Muitas tentativas. Aguarde 30 segundos.'); }
    else setErr('PIN incorreto.');
  };

  const others = vaults.filter((v) => v.id !== vault.id);

  return (
    <div className="login lock-screen">
      <div className="login-card">
        <div className="login-brand">
          <Logo size={52} />
          <h1>🔒 {vault.name}</h1>
          <p>Este cofre está protegido{method ? ` com ${methodLabel[method]}` : ''}.</p>
        </div>

        {method && method !== 'pin' && (
          <button className="btn primary" disabled={busy} onClick={() => void unlockDevice()}>
            {busy ? 'Aguardando o aparelho…' : method === 'native' ? 'Desbloquear com digital ou PIN do celular' : 'Desbloquear com o bloqueio do aparelho'}
          </button>
        )}

        {method === 'pin' && (
          <form className="login-email" onSubmit={submitPin}>
            {hasPin(space) ? (
              <input className="pin-input" type="password" inputMode="numeric" autoComplete="off" autoFocus placeholder="PIN do Quartzo"
                value={pin} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 8))} disabled={!!cooldown} />
            ) : (
              <p className="gate-text">Este aparelho ainda não tem um PIN do Quartzo. Crie um para abrir os cofres protegidos aqui.</p>
            )}
            <button className="btn primary" disabled={busy || !!cooldown || (hasPin(space) && pin.length < 4)}>
              {cooldown ? `Aguarde ${cooldown}s` : hasPin(space) ? 'Desbloquear' : 'Criar PIN e desbloquear'}
            </button>
          </form>
        )}

        {err && <div className="login-msg error">{err}</div>}

        {others.length > 0 && (
          <>
            <div className="login-sep"><span>ou abrir outro cofre</span></div>
            <div className="lock-vaults">
              {others.map((v) => (
                <button key={v.id} className="chip" onClick={() => onSwitch(v.id)}>{v.lock ? '🔒 ' : '🗄 '}{v.name}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { Logo } from './Logo';
import { authErrorMessage, isUnknownAccount, type AuthApi, type Gate } from '../hooks/useAuth';
import { clearHandoffParams, getLastAccount, handoffCode, sendHandoff } from '../lib/googleAuth';

type Msg = { kind: 'error' | 'ok'; text: string } | null;

export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function Avatar({ email, photo }: { email: string; photo?: string | null }) {
  return photo
    ? <img className="acc-avatar" src={photo} alt="" referrerPolicy="no-referrer" />
    : <span className="acc-avatar letter">{email[0]?.toUpperCase()}</span>;
}

export function Login({ api, handoffFor }: { api: AuthApi; handoffFor?: string | null }) {
  const last = getLastAccount();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [suggestGoogle, setSuggestGoogle] = useState<string | null>(null);

  async function google(hint?: string, choose = false) {
    setBusy('google');
    setMsg(null);
    try {
      await api.google(hint, choose);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'cancelled') setMsg({ kind: 'error', text: authErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy('email');
    setMsg(null);
    setSuggestGoogle(null);
    try {
      await api.login(email, password);
    } catch (err) {
      setMsg({ kind: 'error', text: authErrorMessage(err) });
      // conta inexistente → sugere criar com Google já com o e-mail digitado
      if (isUnknownAccount(err)) setSuggestGoogle(email.trim());
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!email) return setMsg({ kind: 'error', text: 'Digite seu e-mail para receber o link.' });
    try {
      await api.resetPassword(email);
      setMsg({ kind: 'ok', text: 'Enviamos um link de redefinição para o seu e-mail.' });
    } catch (err) {
      setMsg({ kind: 'error', text: authErrorMessage(err) });
    }
  }

  // apps: aguardando o login no navegador
  if (api.handoff) {
    return (
      <div className="login">
        <div className="login-card">
          <div className="login-brand">
            <Logo size={56} />
            <h1>Conclua no navegador</h1>
            <p>Abrimos o navegador para você entrar com Google. Depois, volte para cá — o Quartzo entra sozinho.</p>
          </div>
          <div className="handoff-code" title="Confira se é o mesmo código mostrado no navegador">{api.handoff.code}</div>
          <p className="login-foot">Confira se este código aparece no navegador antes de confirmar.</p>
          <div className="handoff-wait"><span className="spinner" /> Aguardando a confirmação…</div>
          <button type="button" className="btn ghost" onClick={api.handoff.reopen}>Abrir o navegador de novo</button>
          <button type="button" className="btn link" onClick={api.cancelHandoff}>Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <Logo size={64} />
          <h1>Quartzo</h1>
          <p>{handoffFor ? 'Entre para conectar o Quartzo do seu aparelho.' : 'Suas notas conectadas, em qualquer lugar.'}</p>
        </div>

        {api.firebaseConfigured ? (
          <>
            {last && (
              <button type="button" className="acc-btn" disabled={!!busy} onClick={() => void google(last.email)}>
                <Avatar email={last.email} photo={last.photo} />
                <span className="acc-text">
                  <b>Continuar como {last.name?.split(' ')[0] || last.email.split('@')[0]}</b>
                  <small>{last.email}</small>
                </span>
                <GoogleIcon />
              </button>
            )}
            <button type="button" className="btn google" disabled={!!busy} onClick={() => void google(undefined, !!last)}>
              <GoogleIcon /> {busy === 'google' ? 'Abrindo o Google…' : last ? 'Usar outra conta Google' : 'Entrar ou criar conta com Google'}
            </button>
            <p className="login-foot">Novo por aqui? A conta é criada com o seu Google — sem senha para lembrar.</p>

            {msg && !showEmail && <div className={`login-msg ${msg.kind}`}>{msg.text}</div>}

            {!showEmail ? (
              <button type="button" className="btn link" onClick={() => { setShowEmail(true); setMsg(null); }}>
                Entrar com e-mail e senha (contas antigas do Manage)
              </button>
            ) : (
              <form className="login-email" onSubmit={submit}>
                <div className="login-sep"><span>e-mail e senha</span></div>
                <label>
                  E-mail do Recalchi Manage
                  <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label>
                  Senha
                  <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </label>
                {msg && <div className={`login-msg ${msg.kind}`}>{msg.text}</div>}
                {suggestGoogle !== null && (
                  <div className="login-suggest">
                    <b>Ainda não tem conta?</b>
                    <span>Crie agora com o Google{suggestGoogle ? <> usando <i>{suggestGoogle}</i></> : ''} e continue de onde parou.</span>
                    <button type="button" className="btn google" onClick={() => void google(suggestGoogle || undefined, true)}>
                      <GoogleIcon /> Criar conta com Google e continuar
                    </button>
                  </div>
                )}
                <button className="btn primary" disabled={!!busy}>{busy === 'email' ? 'Entrando…' : 'Entrar e sincronizar'}</button>
                <button type="button" className="btn link" onClick={reset}>Esqueci minha senha</button>
              </form>
            )}
          </>
        ) : (
          <div className="login-msg error">
            Este build não tem a configuração do Firebase (.env). Você pode usar o Quartzo offline.
          </div>
        )}

        {!handoffFor && (
          <>
            <div className="login-sep"><span>ou</span></div>
            <button type="button" className="btn ghost" onClick={api.useLocal}>Usar só neste dispositivo (offline)</button>
          </>
        )}
        <p className="login-foot">Mesma conta do Recalchi Manage · dados protegidos por usuário</p>
      </div>
    </div>
  );
}

/** Conta nova ou e-mail diferente do habitual: confirma antes de abrir as notas. */
export function AccountGate({ api, gate }: { api: AuthApi; gate: Gate }) {
  const [busy, setBusy] = useState(false);
  const u = gate.user;
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <Logo size={56} />
          <h1>{gate.kind === 'new' ? 'Criar sua conta?' : 'Conta diferente'}</h1>
        </div>
        <div className="acc-btn static">
          <Avatar email={u.email ?? '?'} photo={u.photoURL} />
          <span className="acc-text"><b>{u.displayName || u.email}</b><small>{u.email}</small></span>
        </div>
        {gate.kind === 'new' ? (
          <p className="gate-text">
            Esta conta Google ainda <b>não tem cadastro</b> no Recalchi Manage / Quartzo.
            {gate.previous && <> Neste aparelho você costuma usar <b>{gate.previous}</b>.</>}
            {' '}Quer criar a conta agora e continuar? Seus cofres começam vazios e sincronizam em todos os aparelhos.
          </p>
        ) : (
          <p className="gate-text">
            Você entrou como <b>{u.email}</b>, mas neste aparelho costuma usar <b>{gate.previous}</b>.
            As notas de cada conta são separadas.
          </p>
        )}
        <button className="btn primary" disabled={busy} onClick={() => void run(api.confirmGate)}>
          {gate.kind === 'new' ? 'Criar conta e continuar' : `Continuar como ${u.email}`}
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => void run(api.rejectGate)}>
          {gate.kind === 'new' ? 'Usar outra conta' : `Voltar e usar ${gate.previous}`}
        </button>
      </div>
    </div>
  );
}

/** Navegador aberto pelo app: confirma a conexão do aparelho à conta. */
export function HandoffConfirm({ user, challenge, onDone, onLogout }: { user: User; challenge: string; onDone: () => void; onLogout: () => void }) {
  const [state, setState] = useState<'ask' | 'sending' | 'done'>('ask');
  const [err, setErr] = useState<string | null>(null);
  const code = handoffCode(challenge);

  const confirm = async () => {
    setState('sending');
    setErr(null);
    try {
      await sendHandoff(user, challenge);
      setState('done');
    } catch (e) {
      setErr((e as Error).message);
      setState('ask');
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <Logo size={56} />
          <h1>{state === 'done' ? 'Pronto!' : 'Conectar aparelho'}</h1>
        </div>
        {state === 'done' ? (
          <>
            <p className="gate-text">O Quartzo do seu computador/celular já está entrando como <b>{user.email}</b>. Pode voltar para o app.</p>
            <button className="btn ghost" onClick={() => { clearHandoffParams(); onDone(); }}>Continuar aqui no navegador</button>
          </>
        ) : (
          <>
            <div className="handoff-code">{code}</div>
            <p className="gate-text">
              O app do Quartzo pediu para entrar na conta abaixo. Confirme <b>só se foi você</b> que acabou de tocar em
              “Entrar com Google” no app e se o código acima é o mesmo mostrado lá.
            </p>
            <div className="acc-btn static">
              <Avatar email={user.email ?? '?'} photo={user.photoURL} />
              <span className="acc-text"><b>{user.displayName || user.email}</b><small>{user.email}</small></span>
            </div>
            {err && <div className="login-msg error">{err}</div>}
            <button className="btn primary" disabled={state === 'sending'} onClick={() => void confirm()}>
              {state === 'sending' ? 'Conectando…' : 'Confirmar e conectar o app'}
            </button>
            <button className="btn ghost" onClick={onLogout}>Usar outra conta</button>
            <button className="btn link" onClick={() => { clearHandoffParams(); onDone(); }}>Não fui eu — cancelar</button>
          </>
        )}
      </div>
    </div>
  );
}

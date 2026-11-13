import { useState } from 'react';
import { Logo } from './Logo';
import { authErrorMessage, type useAuth } from '../hooks/useAuth';

type AuthApi = ReturnType<typeof useAuth>;

export function Login({ api }: { api: AuthApi }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.login(email, password);
    } catch (err) {
      setMsg({ kind: 'error', text: authErrorMessage(err) });
    } finally {
      setBusy(false);
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

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <Logo size={64} />
          <h1>Quartzo</h1>
          <p>Suas notas conectadas, em qualquer lugar.</p>
        </div>

        {api.firebaseConfigured ? (
          <>
            <label>
              E-mail do Recalchi Manage
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Senha
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {msg && <div className={`login-msg ${msg.kind}`}>{msg.text}</div>}
            <button className="btn primary" disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar e sincronizar'}
            </button>
            <button type="button" className="btn link" onClick={reset}>
              Esqueci minha senha
            </button>
          </>
        ) : (
          <div className="login-msg error">
            Este build não tem a configuração do Firebase (.env). Você pode usar o Quartzo offline.
          </div>
        )}

        <div className="login-sep"><span>ou</span></div>
        <button type="button" className="btn ghost" onClick={api.useLocal}>
          Usar só neste dispositivo (offline)
        </button>
        <p className="login-foot">Mesma conta do Recalchi Manage · dados protegidos por usuário</p>
      </form>
    </div>
  );
}

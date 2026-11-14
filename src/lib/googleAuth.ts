import {
  GoogleAuthProvider, getAdditionalUserInfo, signInWithCredential, signInWithPopup, signInWithRedirect,
  type User, type UserCredential,
} from 'firebase/auth';
import { auth, MANAGE_URL } from './firebase';

/** Desktop (Electron) e Android (Capacitor) não aceitam o popup do Google: usam o login pelo navegador. */
export function isNativeApp(): boolean {
  if (location.protocol === 'quartzo:') return true;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

// ------------------------------------------------------------ última conta usada neste aparelho
export interface LastAccount { email: string; name?: string | null; photo?: string | null }
const LAST_KEY = 'quartzo.lastAccount';
export function getLastAccount(): LastAccount | null {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; }
}
export function rememberAccount(u: Pick<User, 'email' | 'displayName' | 'photoURL'>) {
  if (!u.email) return;
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ email: u.email, name: u.displayName, photo: u.photoURL })); } catch { /* ignore */ }
}
export function forgetAccount() { try { localStorage.removeItem(LAST_KEY); } catch { /* ignore */ } }

// ------------------------------------------------------------ web: popup do Google
function provider(hint?: string, chooseAccount = false) {
  const p = new GoogleAuthProvider();
  p.addScope('email');
  p.addScope('profile');
  const params: Record<string, string> = {};
  if (hint) params.login_hint = hint;
  if (chooseAccount || !hint) params.prompt = 'select_account';
  p.setCustomParameters(params);
  return p;
}

export const REDIRECT_FLAG = 'quartzo.googleRedirect';

/** Credencial do Google do último login neste navegador (usada para conectar um app). */
let lastGoogle: { idToken: string; email: string | null; at: number } | null = null;
export function keepGoogleCredential(cred: UserCredential) {
  const idToken = GoogleAuthProvider.credentialFromResult(cred)?.idToken;
  if (idToken) lastGoogle = { idToken, email: cred.user.email, at: Date.now() };
}

export async function googlePopup(hint?: string, chooseAccount = false): Promise<{ cred: UserCredential; isNew: boolean } | null> {
  if (!auth) throw new Error('Firebase não configurado neste build.');
  try {
    const cred = await signInWithPopup(auth, provider(hint, chooseAccount));
    keepGoogleCredential(cred);
    return { cred, isNew: !!getAdditionalUserInfo(cred)?.isNewUser };
  } catch (e) {
    const code = (e as { code?: string }).code;
    // navegador bloqueou o popup (comum no celular): volta por redirecionamento
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      sessionStorage.setItem(REDIRECT_FLAG, '1');
      await signInWithRedirect(auth, provider(hint, chooseAccount));
      return null;
    }
    throw e;
  }
}

// ------------------------------------------------------------ apps: login pelo navegador (handoff + PKCE)
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Código curto exibido no app e no navegador para o usuário conferir que é o mesmo pedido. */
export const handoffCode = (challenge: string) => challenge.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase().replace(/(.{4})/, '$1-');

export interface Handoff {
  code: string;
  url: string;
  /** reabre o navegador */
  reopen: () => void;
  /** espera o login no navegador e entra no app; devolve o e-mail da conta */
  wait: (signal: AbortSignal) => Promise<string | null>;
}

export async function startHandoff(hint?: string): Promise<Handoff> {
  if (!auth) throw new Error('Firebase não configurado neste build.');
  if (!MANAGE_URL) throw new Error('Endereço do Recalchi Manage não configurado neste build.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const base = MANAGE_URL.replace(/\/$/, '');
  const url = `${base}/quartzo/app/?handoff=${challenge}${hint ? `&hint=${encodeURIComponent(hint)}` : ''}`;
  const reopen = () => { window.open(url, '_blank', 'noopener'); };
  reopen();

  const wait = async (signal: AbortSignal) => {
    const deadline = Date.now() + 3 * 60_000 + 15_000;
    while (!signal.aborted && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      if (signal.aborted) break;
      try {
        const res = await fetch(`${base}/api/quartzo/auth/claim`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verifier }), signal,
        });
        if (res.status === 200) {
          const data = await res.json() as { credential: string; email: string | null };
          // a credencial do Google funciona no Electron e no WebView (sem popup)
          await signInWithCredential(auth!, GoogleAuthProvider.credential(data.credential));
          return data.email;
        }
      } catch (e) {
        if (signal.aborted) break;
        if ((e as { code?: string }).code?.startsWith('auth/')) throw e;
        // sem internet por um instante: tenta de novo
      }
    }
    if (signal.aborted) throw Object.assign(new Error('cancelado'), { code: 'cancelled' });
    throw Object.assign(new Error('O tempo para concluir o login no navegador acabou. Tente de novo.'), { code: 'timeout' });
  };

  return { code: handoffCode(challenge), url, reopen, wait };
}

/**
 * Navegador: entrega ao app que pediu a credencial do Google (depois da confirmação do usuário).
 * Se o login no navegador não foi agora com Google, pede o Google de novo (popup) para obtê-la.
 */
export async function sendHandoff(user: User, challenge: string): Promise<void> {
  const fresh = lastGoogle && Date.now() - lastGoogle.at < 30 * 60_000
    && (!user.email || lastGoogle.email?.toLowerCase() === user.email.toLowerCase());
  let idToken = fresh ? lastGoogle!.idToken : null;
  if (!idToken) {
    if (!auth) throw new Error('Firebase não configurado.');
    const cred = await signInWithPopup(auth, provider(user.email ?? undefined));
    if (user.email && cred.user.email?.toLowerCase() !== user.email.toLowerCase()) {
      throw new Error(`Você escolheu ${cred.user.email} no Google. Confirme com ${user.email} ou use “Usar outra conta”.`);
    }
    keepGoogleCredential(cred);
    idToken = lastGoogle?.idToken ?? null;
    if (!idToken) throw new Error('O Google não devolveu a credencial. Tente de novo.');
  }
  const res = await fetch('/api/quartzo/auth/handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge, credential: idToken }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { erro?: string };
    throw Object.assign(new Error(data.erro || 'Não foi possível conectar o aparelho.'), { status: res.status });
  }
}

export function readHandoffParams(): { challenge: string; hint: string | null } | null {
  const p = new URLSearchParams(location.search);
  const c = p.get('handoff');
  return c && /^[A-Za-z0-9_-]{43}$/.test(c) ? { challenge: c, hint: p.get('hint') } : null;
}

export function clearHandoffParams() {
  const u = new URL(location.href);
  u.searchParams.delete('handoff');
  u.searchParams.delete('hint');
  history.replaceState(null, '', u.pathname + u.search + u.hash);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAdditionalUserInfo,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, firebaseConfigured, vaultPath } from '../lib/firebase';
import {
  REDIRECT_FLAG, getLastAccount, googlePopup, isNativeApp, rememberAccount, startHandoff, type Handoff,
} from '../lib/googleAuth';

/**
 * "gate": a conta entrou, mas antes de abrir as notas o usuário confirma —
 *  - new:      conta Google sem cadastro → "Criar conta e continuar?"
 *  - mismatch: e-mail diferente do que costuma usar neste aparelho → "Continuar como X?"
 */
export type Gate = { kind: 'new' | 'mismatch'; user: User; previous?: string | null };

export type Session =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'local' }
  | { kind: 'gate'; gate: Gate }
  | { kind: 'user'; user: User };

const LOCAL_KEY = 'quartzo.localMode';

/** Grava o cadastro do usuário no documento raiz do Quartzo (lido pelo painel do Manage). */
async function registerProfile(u: User, provider: string) {
  if (!db) return;
  const [a, b, c, d] = vaultPath(u.uid);
  await setDoc(doc(db, a, b, c, d), {
    app: 'quartzo',
    email: u.email ?? null,
    displayName: u.displayName ?? null,
    photoURL: u.photoURL ?? null,
    provider,
    createdAt: serverTimestamp(),
  }, { merge: true });
}

export function useAuth() {
  const [session, setSession] = useState<Session>({ kind: 'loading' });
  /** enquanto o login Google decide o "gate", o listener não abre o app */
  const holding = useRef(false);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const abort = useRef<AbortController | null>(null);

  const release = useCallback((u: User) => {
    holding.current = false;
    rememberAccount(u);
    setSession({ kind: 'user', user: u });
  }, []);

  /** decide se a conta recém-autenticada precisa de confirmação */
  const decide = useCallback((u: User, isNew: boolean) => {
    const prev = getLastAccount()?.email ?? null;
    if (isNew) { holding.current = true; setSession({ kind: 'gate', gate: { kind: 'new', user: u, previous: prev } }); return; }
    if (prev && u.email && prev.toLowerCase() !== u.email.toLowerCase()) {
      holding.current = true;
      setSession({ kind: 'gate', gate: { kind: 'mismatch', user: u, previous: prev } });
      return;
    }
    release(u);
  }, [release]);

  useEffect(() => {
    if (!auth) {
      setSession(safeGet(LOCAL_KEY) === '1' ? { kind: 'local' } : { kind: 'signed-out' });
      return;
    }
    // volta de um login por redirecionamento (popup bloqueado)
    if (sessionStorage.getItem(REDIRECT_FLAG)) {
      holding.current = true;
      sessionStorage.removeItem(REDIRECT_FLAG);
      getRedirectResult(auth).then((cred) => {
        if (cred) decide(cred.user, !!getAdditionalUserInfo(cred)?.isNewUser);
        else holding.current = false;
      }).catch(() => { holding.current = false; });
    }
    return onAuthStateChanged(auth, (u) => {
      if (holding.current) return;
      if (u) { rememberAccount(u); setSession({ kind: 'user', user: u }); }
      else setSession(safeGet(LOCAL_KEY) === '1' ? { kind: 'local' } : { kind: 'signed-out' });
    });
  }, [decide]);

  return {
    session,
    firebaseConfigured,
    native: isNativeApp(),
    /** pedido de login aberto no navegador (apps) */
    handoff,

    /** Entrar (ou criar conta) com Google. */
    async google(hint?: string, chooseAccount = false) {
      if (!auth) throw new Error('Firebase não configurado neste build.');
      safeSet(LOCAL_KEY, '0');
      if (isNativeApp()) {
        abort.current?.abort();
        const ctrl = new AbortController();
        abort.current = ctrl;
        const h = await startHandoff(hint);
        setHandoff(h);
        holding.current = true;
        try {
          await h.wait(ctrl.signal);
          // a confirmação de conta nova já aconteceu no navegador; aqui só confere o e-mail
          decide(auth.currentUser!, false);
        } catch (e) {
          holding.current = false;
          throw e;
        } finally {
          setHandoff(null);
        }
        return;
      }
      holding.current = true;
      try {
        const r = await googlePopup(hint, chooseAccount);
        if (!r) return; // seguiu por redirecionamento
        decide(r.cred.user, r.isNew);
      } catch (e) {
        holding.current = false;
        throw e;
      }
    },
    cancelHandoff() {
      abort.current?.abort();
      setHandoff(null);
    },

    /** Confirmações do "gate" */
    async confirmGate() {
      if (session.kind !== 'gate') return;
      const { user, kind } = session.gate;
      if (kind === 'new') await registerProfile(user, 'google').catch(() => void 0);
      release(user);
    },
    /** "Usar outra conta": desfaz o cadastro recém-criado (se for novo) e volta ao login */
    async rejectGate() {
      if (session.kind !== 'gate') return;
      const { user, kind } = session.gate;
      if (kind === 'new') await user.delete().catch(() => void 0);
      if (auth?.currentUser) await signOut(auth);
      holding.current = false;
      setSession({ kind: 'signed-out' });
    },

    async login(email: string, password: string) {
      if (!auth) throw new Error('Firebase não configurado neste build.');
      safeSet(LOCAL_KEY, '0');
      await signInWithEmailAndPassword(auth, email.trim(), password);
    },
    async resetPassword(email: string) {
      if (!auth) throw new Error('Firebase não configurado neste build.');
      await sendPasswordResetEmail(auth, email.trim());
    },
    useLocal() {
      safeSet(LOCAL_KEY, '1');
      setSession({ kind: 'local' });
    },
    async logout() {
      safeSet(LOCAL_KEY, '0');
      if (auth?.currentUser) await signOut(auth);
      setSession({ kind: 'signed-out' });
    },
  };
}

export type AuthApi = ReturnType<typeof useAuth>;

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

/** Erros que indicam "essa conta não existe" → sugerir criar com Google. */
export const isUnknownAccount = (e: unknown) =>
  ['auth/user-not-found', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes((e as { code?: string })?.code ?? '');

export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'E-mail ou senha incorretos — ou esta conta ainda não existe.',
    'auth/invalid-login-credentials': 'E-mail ou senha incorretos — ou esta conta ainda não existe.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'Não encontramos uma conta com esse e-mail.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
    'auth/network-request-failed': 'Sem conexão com a internet.',
    'auth/user-disabled': 'Esta conta está desativada.',
    'auth/popup-closed-by-user': 'Login cancelado.',
    'auth/cancelled-popup-request': 'Login cancelado.',
    'auth/unauthorized-domain': 'Este endereço ainda não está autorizado para login com Google no Firebase.',
    'auth/operation-not-allowed': 'O login com Google não está habilitado no Firebase.',
    'auth/account-exists-with-different-credential': 'Já existe uma conta com esse e-mail usando outro método de login.',
    timeout: 'O tempo para concluir o login no navegador acabou. Tente de novo.',
    cancelled: 'Login cancelado.',
  };
  return map[code] ?? (e as Error)?.message ?? 'Erro inesperado.';
}

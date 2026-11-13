import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, firebaseConfigured } from '../lib/firebase';

export type Session =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'local' }
  | { kind: 'user'; user: User };

const LOCAL_KEY = 'quartzo.localMode';

export function useAuth() {
  const [session, setSession] = useState<Session>({ kind: 'loading' });

  useEffect(() => {
    const local = safeGet(LOCAL_KEY) === '1';
    if (!auth) {
      setSession(local ? { kind: 'local' } : { kind: 'signed-out' });
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      if (u) setSession({ kind: 'user', user: u });
      else setSession(safeGet(LOCAL_KEY) === '1' ? { kind: 'local' } : { kind: 'signed-out' });
    });
  }, []);

  return {
    session,
    firebaseConfigured,
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

export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'Usuário não encontrado no Recalchi Manage.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
    'auth/network-request-failed': 'Sem conexão com a internet.',
    'auth/user-disabled': 'Esta conta está desativada.',
  };
  return map[code] ?? (e as Error)?.message ?? 'Erro inesperado.';
}

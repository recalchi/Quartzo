import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const env = import.meta.env;
const SAME_ORIGIN_AUTH = ['recalchimanage.com', 'www.recalchimanage.com'];

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  // No recalchimanage.com o login do Google passa pelo próprio domínio (o Manage
  // encaminha /__/auth/* ao Firebase); sem isso, navegadores de celular perdem o
  // retorno do popup ("login cancelado").
  authDomain: SAME_ORIGIN_AUTH.includes(location.hostname) ? location.host : env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** true quando o .env tem a configuração do projeto recalchi-manage */
export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (firebaseConfigured) {
  app = initializeApp(config);
  // initializeAuth (e não getAuth) para funcionar dentro do WebView do Android
  // e do Electron, que não suportam o resolver de popup/redirect.
  // o resolver de popup só é usado no navegador (login com Google); os apps entram pelo navegador do sistema
  const web = location.protocol === 'https:' || location.protocol === 'http:';
  const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    ...(web && !native ? { popupRedirectResolver: browserPopupRedirectResolver } : {}),
  });
  db = getFirestore(app);
}

export { app, auth, db };

export const MANAGE_URL: string = env.VITE_RECALCHI_MANAGE_URL || '';

/** Caminho do vault do usuário no Firestore, seguindo a convenção do Recalchi Manage. */
export const vaultPath = (uid: string) => ['manage', 'modulo', 'quartzo', uid] as const;

/**
 * Bloqueio de cofres pelo PIN/biometria do aparelho.
 *
 *  - Android (app):   biometria ou PIN/padrão/senha do celular (plugin nativo).
 *  - Navegador:       autenticador do próprio aparelho via WebAuthn
 *                     (Windows Hello, tela de bloqueio do Android/iPhone).
 *  - Sem nenhum dos dois (ex.: desktop Electron): PIN do Quartzo, guardado
 *    só neste aparelho como hash PBKDF2.
 *
 * O bloqueio protege o acesso pela interface; as notas continuam protegidas
 * no servidor pelas regras do Firestore (só o dono lê).
 */
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { isNativeApp } from './googleAuth';

export type LockMethod = 'native' | 'webauthn' | 'pin';

interface DeviceLock {
  webauthnId?: string;
  pin?: { salt: string; hash: string; iter: number };
}

const keyOf = (space: string) => `quartzo.lock.${space}`;
const read = (space: string): DeviceLock => { try { return JSON.parse(localStorage.getItem(keyOf(space)) || '{}'); } catch { return {}; } };
const write = (space: string, v: DeviceLock) => { try { localStorage.setItem(keyOf(space), JSON.stringify(v)); } catch { /* ignore */ } };

const isCapacitor = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

/** Melhor método disponível neste aparelho. */
export async function lockMethod(): Promise<LockMethod> {
  if (isCapacitor()) {
    try {
      const r = await BiometricAuth.checkBiometry();
      if (r.isAvailable || r.deviceIsSecure) return 'native';
    } catch { /* sem plugin: cai no PIN */ }
    return 'pin';
  }
  if (!isNativeApp() && window.isSecureContext && window.PublicKeyCredential) {
    try {
      if (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) return 'webauthn';
    } catch { /* ignore */ }
  }
  return 'pin';
}

export const methodLabel: Record<LockMethod, string> = {
  native: 'biometria ou PIN do celular',
  webauthn: 'bloqueio do aparelho (Windows Hello, digital ou PIN da tela)',
  pin: 'PIN do Quartzo',
};

export const hasPin = (space: string) => !!read(space).pin;
export const hasWebAuthn = (space: string) => !!read(space).webauthnId;

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

async function pbkdf2(pin: string, salt: Uint8Array<ArrayBuffer>, iter: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return b64(bits);
}

export async function setPin(space: string, pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iter = 210_000;
  write(space, { ...read(space), pin: { salt: b64(salt), hash: await pbkdf2(pin, salt, iter), iter } });
}

export async function checkPin(space: string, pin: string): Promise<boolean> {
  const p = read(space).pin;
  if (!p) return false;
  return (await pbkdf2(pin, unb64(p.salt), p.iter)) === p.hash;
}

/** Registra o autenticador do aparelho (pede a verificação do usuário já no cadastro). */
async function registerWebAuthn(space: string, label: string) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Quartzo' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: label, displayName: label },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error('O aparelho não confirmou.');
  write(space, { ...read(space), webauthnId: b64(cred.rawId) });
}

async function verifyWebAuthn(space: string) {
  const id = read(space).webauthnId;
  if (!id) throw Object.assign(new Error('Autenticador não cadastrado neste aparelho.'), { code: 'not-enrolled' });
  const r = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64(id) }],
      userVerification: 'required',
      timeout: 60_000,
    },
  });
  if (!r) throw new Error('O aparelho não confirmou.');
}

/**
 * Pede a autenticação do aparelho (biometria/PIN do celular ou WebAuthn).
 * No primeiro uso do WebAuthn neste aparelho, cadastra o autenticador.
 */
export async function deviceAuth(space: string, reason: string, label: string): Promise<void> {
  const m = await lockMethod();
  if (m === 'native') {
    await BiometricAuth.authenticate({
      reason,
      androidTitle: 'Quartzo',
      androidSubtitle: reason,
      allowDeviceCredential: true,
      cancelTitle: 'Cancelar',
    });
    return;
  }
  if (m === 'webauthn') {
    if (!read(space).webauthnId) await registerWebAuthn(space, label);
    else await verifyWebAuthn(space);
    return;
  }
  throw Object.assign(new Error('Este aparelho não tem bloqueio próprio; use o PIN do Quartzo.'), { code: 'use-pin' });
}

// ------------------------------------------------------------ cofres desbloqueados nesta sessão
const unlocked = new Set<string>();
let hiddenAt = 0;
const RELOCK_MS = 2 * 60_000;
const subs = new Set<() => void>();

export const isUnlocked = (vaultId: string) => unlocked.has(vaultId);
export function markUnlocked(vaultId: string) { unlocked.add(vaultId); subs.forEach((f) => f()); }
export function lockAll() { unlocked.clear(); subs.forEach((f) => f()); }
export function onLockChange(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; }

// trava de novo se o app ficar em segundo plano por mais de 2 minutos
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > RELOCK_MS) lockAll();
});

export function lockErrorMessage(e: unknown): string {
  const err = e as { code?: string; name?: string; message?: string };
  if (err?.name === 'NotAllowedError') return 'Autenticação cancelada ou expirada.';
  if (err?.code === 'userCancel' || err?.code === 'appCancel' || err?.code === 'systemCancel') return 'Autenticação cancelada.';
  if (err?.code === 'biometryLockout') return 'Muitas tentativas. Use o PIN do aparelho.';
  return err?.message || 'Não foi possível autenticar.';
}

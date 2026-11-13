import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db as firestore, vaultPath } from './firebase';
import { deviceId, getDB, newId, type Note } from './db';
import { seedIfEmpty, uniquePath } from './notes';

export type SyncState = 'offline' | 'idle' | 'syncing' | 'error' | 'local';

type Listener = (s: SyncState, detail?: string) => void;

/**
 * Motor de sincronização local-first.
 *  - IndexedDB (Dexie) é a fonte da verdade no dispositivo.
 *  - Alterações locais ficam com synced=0 e são enviadas em lote (debounce).
 *  - O servidor é escutado em tempo real (onSnapshot); a versão mais nova vence.
 *  - Se os dois lados mudaram desde a última sincronização, nada se perde:
 *    a versão do servidor fica na nota e a local vira "Nota (conflito ...)".
 */
export class SyncEngine {
  private unsub: Unsubscribe | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pushing = false;
  private listeners = new Set<Listener>();
  private state: SyncState = 'idle';
  private firstSnapshot = true;

  constructor(private uid: string) {}

  onState(fn: Listener) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(s: SyncState, detail?: string) {
    this.state = s;
    this.listeners.forEach((l) => l(s, detail));
  }

  private notesCol() {
    const [a, b, c, d] = vaultPath(this.uid);
    return collection(firestore!, a, b, c, d, 'notes');
  }

  start() {
    if (!firestore) return;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    if (!navigator.onLine) this.set('offline');

    // Documento raiz do vault (metadados para o Recalchi Manage listar)
    const [a, b, c, d] = vaultPath(this.uid);
    setDoc(
      doc(firestore, a, b, c, d),
      { app: 'quartzo', lastSeenAt: serverTimestamp(), lastDevice: deviceId() },
      { merge: true },
    ).catch(() => void 0);

    this.unsub = onSnapshot(
      this.notesCol(),
      { includeMetadataChanges: false },
      async (snap) => {
        try {
          // ignora ecos locais (escritas ainda pendentes deste aparelho)
          const changes = snap
            .docChanges()
            .filter((ch) => !ch.doc.metadata.hasPendingWrites)
            .map((ch) => ({ id: ch.doc.id, data: ch.doc.data() }));
          await this.applyRemote(changes);
          if (this.firstSnapshot) {
            this.firstSnapshot = false;
            if (snap.empty) await seedIfEmpty();
            await getDB().meta.put({ key: 'seeded', value: true });
          }
          this.schedulePush(0);
          if (navigator.onLine && !this.pushing) this.set('idle');
        } catch (e) {
          this.set('error', String(e));
        }
      },
      (err) => this.set('error', err.code === 'permission-denied'
        ? 'Sem permissão no Firestore — publique as regras do Quartzo (docs/firestore.rules.quartzo).'
        : err.message),
    );
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
    if (this.timer) clearTimeout(this.timer);
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  private handleOnline = () => this.schedulePush(0);
  private handleOffline = () => this.set('offline');

  private async applyRemote(changes: { id: string; data: Record<string, unknown> }[]) {
    const local = getDB();
    await local.transaction('rw', local.notes, async () => {
      for (const { id, data } of changes) {
        const remote = {
          path: String(data.path ?? 'Sem título.md'),
          content: String(data.content ?? ''),
          createdAt: Number(data.createdAt ?? Date.now()),
          updatedAt: Number(data.updatedAt ?? 0),
          deleted: (data.deleted ? 1 : 0) as 0 | 1,
          pinned: (data.pinned ? 1 : 0) as 0 | 1,
        };
        const mine = await local.notes.get(id);
        if (!mine) {
          await local.notes.put({ id, ...remote, synced: 1, remoteUpdatedAt: remote.updatedAt });
          continue;
        }
        if (remote.updatedAt <= mine.remoteUpdatedAt) continue; // já conhecida
        if (data.device === deviceId() && remote.updatedAt <= mine.updatedAt) {
          // eco do nosso próprio envio
          await local.notes.update(id, { remoteUpdatedAt: remote.updatedAt });
          continue;
        }
        if (mine.synced === 0 && mine.remoteUpdatedAt < remote.updatedAt && mine.content !== remote.content && !mine.deleted) {
          // Conflito real: preserva a versão local como cópia
          const copyPath = mine.path.replace(/\.md$/i, ` (conflito ${new Date().toLocaleString('pt-BR').replace(/[/:]/g, '-')}).md`);
          await local.notes.add({ ...mine, id: newId(), path: copyPath, synced: 0, remoteUpdatedAt: 0, updatedAt: Date.now() });
        }
        await local.notes.put({ id, ...remote, synced: 1, remoteUpdatedAt: remote.updatedAt });
      }
    });
  }

  schedulePush(delay = 1200) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.push(), delay);
  }

  private async push() {
    if (!firestore || this.pushing) return;
    if (!navigator.onLine) return this.set('offline');
    const local = getDB();
    const pending = await local.notes.where('synced').equals(0).toArray();
    if (!pending.length) return this.set('idle');
    this.pushing = true;
    this.set('syncing', `${pending.length} alteração(ões)`);
    try {
      for (const n of pending) {
        // garante que o caminho não colida com nota vinda de outro aparelho
        const path = n.deleted ? n.path : await uniquePath(n.path, n.id);
        const payload = {
          path,
          content: n.content,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
          deleted: !!n.deleted,
          pinned: !!n.pinned,
          device: deviceId(),
          size: n.content.length,
          serverAt: serverTimestamp(),
        };
        await setDoc(doc(this.notesCol(), n.id), payload);
        // só marca como sincronizada se não houve nova edição durante o envio
        await local.notes
          .where('id')
          .equals(n.id)
          .modify((cur: Note) => {
            if (cur.updatedAt === n.updatedAt) {
              cur.synced = 1;
              cur.path = path;
            }
            cur.remoteUpdatedAt = Math.max(cur.remoteUpdatedAt, n.updatedAt);
          });
      }
      this.set('idle');
    } catch (e) {
      this.set('error', (e as Error).message);
      this.schedulePush(10_000);
    } finally {
      this.pushing = false;
    }
  }
}

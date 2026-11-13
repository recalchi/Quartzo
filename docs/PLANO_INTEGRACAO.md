# Plano de integração — Quartzo × Recalchi Manage

> Objetivo: um app de notas particular (desktop, web e Android) que usa **o mesmo login do
> Recalchi Manage** (Firebase `recalchi-manage`), sincroniza em tempo real e, numa segunda
> etapa, vira um módulo dentro da plataforma.

## Visão da arquitetura

```
 ┌──────────── Dispositivos ────────────┐          ┌──────── Firebase (recalchi-manage) ───────┐
 │ Desktop (Electron, quartzo://)       │          │ Authentication  ← mesmo usuário do Manage │
 │ Web/PWA (navegador, instalável)      │  ⇄ sync  │ Firestore                                 │
 │ Android (Capacitor, APK)             │          │   manage/modulo/quartzo/{uid}             │
 │                                      │          │   manage/modulo/quartzo/{uid}/notes/{id}  │
 │ IndexedDB local (Dexie) = offline    │          │ Storage (fase 3: anexos)                  │
 └──────────────────────────────────────┘          └───────────────────────────────────────────┘
                                                                ▲
                                     Recalchi Manage (Express) ─┘  rota /quartzo + API (fase 2/3)
```

**Princípios**
- **Local-first:** a nota é salva primeiro no aparelho; o envio ao Firestore acontece em lote,
  com reenvio automático ao voltar a internet.
- **Privacidade por padrão:** cada usuário só acessa `manage/modulo/quartzo/{seu uid}`.
- **Sem perda de dados:** se dois aparelhos editarem a mesma nota offline, a versão do servidor
  fica na nota e a local vira uma cópia "(conflito …)".
- **Formato aberto:** notas são Markdown puro; importação/exportação de pastas `.md`
  (compatível com vaults do Obsidian).

---

## Fase 0 — Base do app ✅ (este repositório)

- [x] Editor Markdown (CodeMirror 6) com destaque, busca e autocompletar de `[[links]]`
- [x] Modo leitura e lado a lado, callouts `> [!tip]`, tarefas clicáveis, tabelas
- [x] Backlinks, links não resolvidos, sumário, tags, grafo de conexões
- [x] Pastas, notas fixadas, lixeira com restauração, nota do dia, busca rápida (Ctrl+P) e comandos
- [x] Importar pasta / vault do Obsidian e exportar `.zip`
- [x] Login com e-mail/senha do Recalchi Manage + modo offline
- [x] Motor de sync Firestore em tempo real com detecção de conflito
- [x] PWA instalável, shell desktop Electron e projeto Android (Capacitor)
- [x] Identidade visual própria (cristal de quartzo)

## Fase 1 — Colocar para rodar no dia a dia (1–2 dias)

| # | Tarefa | Onde | Observação |
|---|--------|------|------------|
| 1 | Criar `.env` a partir de `.env.example` com o `firebaseConfig` web | Quartzo | mesmo app web do Manage ou um app web novo "Quartzo" no console |
| 2 | Colar `docs/firestore.rules.quartzo` em `firebase/firestore.rules` | Recalchi Manage | antes do `match /{document=**}` final |
| 3 | `npm run rules:deploy:dry` → `npm run rules:deploy` | Recalchi Manage | sem isso o sync mostra "Sem permissão" |
| 4 | Gerar APK (`npm run android:apk`) e instalar no celular | Quartzo | APK em `release/` |
| 5 | Gerar desktop portable (`npm run desktop:dist`) | Quartzo | `.exe` em `release/` |
| 6 | Importar o vault atual (menu ⋯ → Importar pasta) | app | ignora `.obsidian/` |

## Fase 2 — Quartzo dentro do Recalchi Manage (1 semana)

1. **Hospedar a versão web na mesma origem do Manage** (`https://<domínio>/quartzo/`):
   - `npm run build` no Quartzo e copiar `dist/` para `public/quartzo/` do Manage
     (ou `app.use('/quartzo', express.static(...))` em `src/app.js`).
   - Por estar **na mesma origem**, o Firebase Auth compartilha a sessão (IndexedDB por origem):
     quem já está logado no Manage abre o Quartzo **sem logar de novo** (SSO de fato).
2. **Entrada no menu do Manage:** card/ícone "Quartzo · Notas" no `base.njk` e no SPA `client/`.
3. **Controle de acesso:** liberar o módulo por nível/claim (`kind == 'colaborador'` ou flag
   `modules.quartzo` no doc do usuário) — o app já lê o usuário pelo mesmo `uid`.
4. **Pipeline de deploy:** GitHub Action no Quartzo que gera o `dist/` como artefato; o deploy do
   Manage (`host.js` / Docker) baixa a última release.

## Fase 3 — Integração de dados (2–3 semanas)

- **Notas ligadas a entidades do Manage:** frontmatter
  `manage: { tipo: projeto, id: XYZ }` → botão "abrir no ProjetoManager" e, no Manage, aba
  "Notas" em projetos/leads/clientes listando notas que apontam para aquele ID.
- **Anexos/imagens:** Firebase Storage em `quartzo/{uid}/{noteId}/{arquivo}` com regra de dono;
  colar imagem no editor faz upload e insere `![](url)`.
- **IA com Claude (rota existente `/api/ai`):** resumir nota, gerar tarefas, perguntar ao vault
  ("o que decidi sobre X?") — o backend valida o ID token do Firebase antes de ler as notas.
- **Templates corporativos:** atas de reunião, 1:1, fechamento mensal FP&A, publicados pelo
  admin em `manage/config/quartzo_templates`.
- **Compartilhar nota (somente leitura):** reaproveitar o mecanismo de link com hash do
  ProjetoManager (`PROJECT_SHARE_PEPPER`).

## Fase 4 — Padrão profissional contínuo

- **Qualidade:** testes unitários (Vitest) para `links.ts`, `markdown.ts` e `sync.ts`;
  testes E2E (Playwright) do fluxo login → editar → sync; CI rodando `typecheck` + build a cada push.
- **Releases:** versionamento semântico, `CHANGELOG.md`, GitHub Releases com APK assinado
  (keystore fora do repositório, em `D:\DevTools\keys`) e `.exe` do desktop; depois Play Store
  (faixa de teste interno).
- **Observabilidade:** Crashlytics/Sentry no app, métricas de uso por módulo no Manage.
- **Segurança:** App Check no Firebase, CSP no desktop, revisão das regras a cada fase,
  criptografia ponta-a-ponta opcional para notas sensíveis.
- **Backups:** exportação automática semanal do vault (Cloud Function → Storage).
- **Colaboração em tempo real** (futuro): CRDT (Yjs) para editar a mesma nota em dupla.

---

## Modelo de dados

```ts
// manage/modulo/quartzo/{uid}/notes/{noteId}
{
  path: 'Projetos/Quartzo.md', // pasta + título
  content: '# Markdown…',
  createdAt: 1731456000000,    // ms (relógio do aparelho)
  updatedAt: 1731456999000,    // ms — usado para "última versão vence"
  deleted: false,              // lixeira (exclusão lógica)
  pinned: false,
  device: 'a1b2c3d4e5f6',      // aparelho que gravou por último
  size: 1234,
  serverAt: Timestamp          // carimbo do servidor (auditoria)
}
```

## Riscos e decisões

| Tema | Decisão |
|------|---------|
| Obsidian é software proprietário | O Quartzo é **código próprio**, inspirado no fluxo de trabalho; nenhum arquivo do Obsidian é copiado. Compatibilidade via Markdown. |
| Limite de 1 MB por documento | Notas acima de ~900 KB são bloqueadas pela regra; anexos vão para o Storage (fase 3). |
| Login Google no Android | Fase 1 usa e-mail/senha (igual ao Manage). Google Sign-In nativo exige plugin + SHA-1 no console. |
| Relógio do aparelho errado | `serverAt` grava o horário do servidor; migrar a comparação para ele se houver conflitos frequentes. |

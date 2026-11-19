# Piano di evoluzione di context-memory

Data: 14 novembre 2026. Repository: `claude-code`. Baseline ispezionata: commit `6288350`.

Questo documento è un piano eseguibile per un agente LLM. Il piano originale è seguito dalla registrazione delle evidenze correnti; consultare docs/VERIFICATION.md per distinguere implementazione da accettazione live. Il piano copre tutte le cinque migliorie richieste. Eseguire le fasi nell'ordine indicato, aggiornando lo stato e le evidenze al termine di ciascuna.

## 1. Obiettivo e definizione del risultato

Rendere il plugin affidabile nelle sessioni lunghe, utile dopo la compattazione e semplice da utilizzare in qualsiasi cartella, misurandone costi e benefici.

| ID | Miglioria | Risultato osservabile |
| --- | --- | --- |
| M1 | Checkpoint durante lavori lunghi e compattazione | Il modello riceve un promemoria anche senza un nuovo messaggio utente; il checkpoint salvato viene protetto prima della compattazione. |
| M2 | Recupero del testo completo | Un output testuale acquisito dal plugin oltre 32.768 caratteri è recuperabile integralmente tramite pagine limitate. |
| M3 | Handoff assistito | Una sessione esporta un checkpoint con provenienza; un'altra lo visualizza e lo importa esplicitamente. |
| M4 | Installazione personale tra progetti | Claude parte nella cartella scelta dall'utente e carica il plugin senza dover indicare ogni volta `--plugin-dir`. |
| M5 | Misurazione | Un confronto riproducibile quantifica correttezza, token, latenza e spazio su disco, distinguendo misure da stime. |

Non promettere un checkpoint sempre aggiornato: un promemoria può essere ignorato dal modello. Non promettere un risparmio di token prima di averlo misurato. Non chiamare il recupero testuale un backup completo della conversazione.

## 2. Stato iniziale verificato

Leggere questi file prima di modificare codice:

| File | Responsabilità attuale |
| --- | --- |
| `mods/context-memory/hooks/register.ts` | Registrazione strumenti, checkpoint, indice storico, uso del contesto e comando handoff. |
| `mods/context-memory/tests/register.test.ts` | 14 casi di test presenti; mock del filesystem e degli eventi del motore. |
| `mods/context-memory/hooks/hooks.json` | Carica `register.ts`. |
| `mods/context-memory/.claude-plugin/plugin.json` | Nome `context-memory`, versione `0.1.0`. |
| `mods/context-memory/README.md` | Contratti, limiti, avvio da altre cartelle e comandi di verifica. |
| `mods/types/claude-code.d.ts` | Contratto locale dell'API dei function hook. |
| `mods/tsconfig.json` | Typecheck condiviso di hook e test. |
| `.claude-plugin/marketplace.json` | Catalogo upstream con identità Anthropic; non usarlo come catalogo personale del fork. |

Il codice attuale salva i dati in `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/context-memory/<encoded-session-id>/`:

- `notes.txt`: unica copia corrente del checkpoint, massimo 16.384 byte UTF-8.
- `history/<id>.json`: proiezione testuale di messaggi osservati, massimo 32.768 unità UTF-16 per record.
- Una lettura restituisce al massimo 12.000 unità UTF-16; una ricerca legge al massimo 100 record e restituisce 10 estratti da 500 unità.
- `prompt.submit` aggiunge il promemoria al 75%; oggi non deduplica gli avvisi.
- `session.append` osserva dopo `next(e)`, esclude subagent, messaggi in coda e append negati, e serializza le scritture.
- `prompt.context` ricarica le note quando il motore ricostruisce il contesto.
- `/context-handoff` stampa le note; non esporta un bundle strutturato e non importa altre sessioni.

I 14 test risultavano superati nella consegna precedente; **non sono stati rieseguiti per scrivere questo piano**. Ricostruire la baseline prima dell'implementazione.

Durante questa ispezione era già presente un file non tracciato `mods/context-memory/tsconfig.json`, che estende `./.claude-plugin/types/tsconfig.json`. Non cancellarlo, sovrascriverlo o includerlo in commit senza averne verificato origine e validità. Non confonderlo con il typecheck condiviso.

## 3. Invarianti obbligatorie

1. La compattazione nativa resta responsabile della conversazione. Non sostituire `messages`, non ricostruire coppie tool use/result e non implementare rollover CLM.
2. Note e storico sono dati di riferimento fallibili, non istruzioni nuove né autorizzazioni. Mantenere questa distinzione nel prompt e negli import.
3. Un errore di archivio, diagnostica o promemoria non deve bloccare prompt, tool esterni o compattazione. Un salvataggio esplicitamente richiesto deve invece comunicare il proprio fallimento.
4. Non richiamare `next(e)` due volte per tentare di recuperare un errore. Conservare il risultato già ottenuto dal motore.
5. Gli hook della sessione principale devono escludere `agentId !== undefined`; non leggere le note del padre dai subagent.
6. Nessuna scansione del transcript completo nel percorso di ogni tool call. Nessun nuovo servizio, database, embedding o dipendenza runtime per queste migliorie.
7. Nel runtime degli hook usare le API `$` dichiarate. Non presupporre Node.js, `process`, `Buffer`, filesystem nativo o moduli npm disponibili.
8. Il progetto è scelto dalla working directory della sessione, non dalla cartella del plugin. Non introdurre un launcher che faccia `cd` nel repository del plugin.
9. Le note correnti restano in `notes.txt`; eventuali metadati non devono diventare una seconda copia corrente da sincronizzare.
10. File vecchi devono restare leggibili. Non migrare tutto l'archivio all'avvio e non cancellare dati automaticamente.
11. Mantenere espliciti i limiti: un processo scrittore per sessione, scritture non transazionali, archivio iniziato quando il plugin viene caricato, media e thinking esclusi.

## 4. API: fatti e verifiche preliminari

I simboli seguenti sono presenti in `mods/types/claude-code.d.ts`. Cercarli per nome; i numeri di riga possono cambiare.

| Simbolo | Contratto da rispettare |
| --- | --- |
| `ToolCallResult.context` | Consente un promemoria dopo il risultato di un tool; preservare `result`, `ref`, `text`, flag e contesto già presenti. Verificare la consegna in una sessione reale. |
| `session.compact` / `SessionCompactInput` | Trigger `manual`, `auto`, `plugin`, `precompute`; contiene `instructions`, `messages`, eventuale `agentId`. |
| `SessionCompactResult` | Unione tra risultato con `messages` e risultato con `skip`. **Non contiene `compact_summary`**. |
| `$.session.compact()` | Chiamata tra turni; rifiuta durante un turno attivo. Non serve a M1 e non va chiamata dal tool hook. |
| `$.session.info()` / `SessionInfo` | Fornisce `transcriptPath`, anche vuoto. Il tipo locale non prova che un vecchio binario la implementi: verificare sulla versione scelta. |
| `$.session.messages()` | Restituisce al massimo le ultime 4.096 voci; non è un archivio illimitato né offre qui una ricerca persistente per UUID. |
| `$.fs.read` / `FsReadOptions` | Lettura dell'intero file; nessuna opzione di offset/limit dichiarata. Non inventare letture a intervalli. |
| `$.session.cwd()`, `root()`, `repo()` | Informazioni sulla cartella e sul repository. `SessionRepo` non contiene branch o commit; nei worktree `repo.root` può essere la radice del working tree principale. |
| `turn.complete` | Include durata, motivo, eventuale usage. Escludere i subagent quando si misura la sessione principale. |
| `session.measure`, `$.session.usage()` | Uso e costi; `breakdown: 'summary'` è una stima locale, `full` può effettuare richieste di conteggio. |

La documentazione ufficiale conferma che un mod è un plugin con un modulo di function hook; i contratti specifici vanno verificati sul binario scelto. Fonte: [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview).

Context7 è stato interrogato durante la preparazione ma ha risposto `Monthly quota exceeded`. Per ripristinarlo usare `npx ctx7@latest login` oppure configurare `CONTEXT7_API_KEY`. Le fonti di questo piano sono il codice locale e la documentazione ufficiale; non attribuire a Context7 una verifica riuscita.

## 5. Ordine di esecuzione e disciplina di lavoro

Ordine: **P0 → M5a → M1 → M2 → M3 → M4 → M5b → verifica finale**.

M5a prepara gli scenari e raccoglie la baseline prima che cambino i comportamenti. M5b esegue il confronto finale. M3 riusa i metadati e lo storage consolidati nelle fasi precedenti.

Per ogni fase:

1. Leggere obiettivo, contratto, test e criteri di uscita della fase.
2. Controllare lo stato Git e preservare modifiche estranee.
3. Implementare soltanto la fase corrente, senza modificare le dichiarazioni API per far compilare codice non supportato.
4. Eseguire i test mirati e il typecheck. Correggere i difetti introdotti prima di proseguire.
5. Aggiornare README e tabella di avanzamento in fondo a questo documento.
6. Registrare comando, versione del binario, esito ed eventuali limiti nella documentazione di verifica.
7. Preparare un diff autonomo e revisionabile per fase. Commit/push secondo le istruzioni attive; lo stato del remote non è un criterio di successo funzionale.

Non segnare una fase completata solo perché compila. Una limitazione del runtime deve produrre un esito `BLOCKED` per la parte dipendente, con riproduttore; proseguire sulle parti indipendenti.

### P0 — Baseline e prove di compatibilità

**File:** creare `mods/context-memory/docs/VERIFICATION.md`. Eventuali test di contratto in `tests/compatibility.test.ts`.

1. Annotare `git rev-parse HEAD`, `git status --short`, sistema operativo e versione di Claude.
2. Usare inizialmente Claude Code `2.1.325`, versione documentata dal plugin; non aggiornare globalmente la CLI per svolgere il lavoro.
3. Eseguire i comandi della sezione 12. Annotare separatamente test, typecheck e validazione manifest.
4. Verificare nel dispatcher di test: aggiunta di `ToolCallResult.context`, tutte le varianti di `SessionCompactResult`, lettura di `session.info`, cwd e repository.
5. Un mock dimostra il comportamento del plugin, non la disponibilità dell'API nel binario. Fare anche un piccolo smoke test locale con la versione fissata e una sessione di prova.
6. Se `session.info()` manca nel binario, marcarlo come capacità opzionale: M2 deve funzionare con i propri blocchi anche senza riferimento al transcript. Non cambiare versione silenziosamente.
7. Non usare `scripts/ci/typecheck-mods.sh`: il README generale lo menziona ma il file non esiste nel checkout ispezionato. Usare `tsc -p mods/tsconfig.json`.

**Uscita:** baseline riproducibile e matrice delle capacità, con `verificata`, `assente` o `non provata` per ogni API utilizzata.

## 6. M1 — Promemoria durante il lavoro e protezione del checkpoint

### Scelta progettuale

Usare `tool.call` dopo `next(e)` per ricordare al modello di salvare le note durante una catena di strumenti. Riutilizzare la stessa logica in `prompt.submit`. Prima della compattazione salvare una copia dell'ultimo checkpoint disponibile e passarlo al summarizer come riferimento delimitato.

Non avviare un secondo modello per generare note, non interrompere una catena di tool per forzare `/compact` e non aggiungere turni sintetici. Questa fase migliora frequenza e resistenza alla compattazione; non garantisce che il modello abbia aggiornato le note.

### File e passi

- Modificare `hooks/register.ts`, `tests/register.test.ts` e `README.md`.
- Creare `hooks/checkpoint.ts` solo per concentrare politica del promemoria e snapshot; tenere gli hook nel punto di registrazione esistente.
- Test dedicati: `tests/checkpoint.test.ts`.

1. Introdurre una funzione pura che decide se mostrare il promemoria. Soglie iniziali: 75% e 90%, al massimo un avviso per soglia per ciclo di compattazione.
2. Separare lo stato per session ID: soglie già notificate, ultimo checkpoint riuscito, numero di messaggi archiviati al salvataggio, stato del tentativo di compattazione. Una `Map` dentro `register` basta; non creare un servizio globale.
3. Deduplicare anche tool paralleli: dopo aver letto usage, riservare sincronicamente la soglia prima di altri `await`. Un errore di consegna deve lasciare uno stato diagnostico, non una raffica di retry.
4. Per i tool estranei al plugin: `await next(e)` una volta; se sessione principale, risultato non negato e soglia nuova, restituire una copia del risultato aggiungendo una stringa breve a `context`.
5. Conservare tutti i campi del risultato e gli elementi di `context` già presenti. Per il primo rilascio non aggiungere il promemoria ai risultati negati o falliti.
6. Escludere i tool `mcp__context-memory__*` dal promemoria post-tool: leggere o scrivere le note non deve generare un ciclo di richieste.
7. Fare usare la stessa politica a `prompt.submit`; conservare esclusione di comandi e prompt meta. Un avviso già emesso dopo un tool non va ripetuto al successivo prompt.
8. Dopo una scrittura riuscita di `context_notes`, registrare la revisione salvata. Non azzerare le soglie a ogni salvataggio, altrimenti la sessione sopra il 75% chiederà subito un altro checkpoint.
9. Aggiungere un hook `session.compact`: per subagent e `precompute`, passare attraverso senza snapshot né reset. Per `manual`, `auto`, `plugin`, attendere le scritture già accodate e tentare una copia del checkpoint corrente in `checkpoints/<id>.json`.
10. Lo snapshot contiene `schemaVersion`, session ID, trigger, data, testo esatto delle note e indice dell'ultimo record noto. Non contiene testo inventato se le note sono vuote; in tal caso registrare `checkpoint_missing`.
11. Se le note sono disponibili, aggiungerle a `e.instructions` in una sezione delimitata come dati di riferimento. Preservare il testo delle istruzioni preesistenti; massimo 16 KiB per le note, più una breve cornice. Non cambiare `e.messages`.
12. Chiamare `next` una volta. Se il risultato ha `skip`, non segnare una compattazione riuscita e non resettare le soglie. Se contiene `messages`, restituirlo intatto e aprire un nuovo ciclo di avvisi.
13. Non copiare automaticamente il sommario in `notes.txt`: manca un campo sommario stabile e si sovrascriverebbe il checkpoint deliberato del modello.
14. Un errore prima di `next` deve lasciare proseguire la compattazione con gli input originali. Un errore di diagnostica dopo `next` deve restituire il risultato già ottenuto. Non mascherare un errore effettivo del motore come successo.
15. Esporre in `context_usage` un oggetto aggiuntivo `memory` con stato del checkpoint, ultimo avviso e ultimo errore, preservando i campi usage esistenti. Limitare le stringhe diagnostiche.

### Test obbligatori

- 74%: nessun avviso; 75%: uno; 80%: nessuno nuovo; 90%: uno nuovo.
- Due tool concorrenti alla stessa soglia: un solo avviso.
- Usage assente, percentuale non valida o lettura fallita: tool e prompt invariati.
- Risultato con `ref`, `text` e `context` preesistente: nessuna perdita di campi.
- Subagent, tool del plugin, prompt comando/meta: nessun avviso automatico.
- Note salvate: niente ripetizione immediata della stessa soglia.
- Compattazione manuale/automatica: snapshot leggibile, istruzioni originali presenti, messaggi originali passati senza riscrittura.
- `precompute` e `skip`: nessun falso successo, nessun reset.
- Disco pieno prima di compattare: il motore viene comunque chiamato una sola volta.
- Ricostruzione del contesto dopo compattazione: checkpoint presente e blocchi originali conservati.

**Uscita:** test verdi e una prova reale con più tool nello stesso turno che mostri la consegna del promemoria. Registrare separatamente se il modello lo ha seguito. Una catena senza tool continua a dipendere dal prompt e dalla compattazione: dichiarare questo limite.

## 7. M2 — Recupero completo del testo acquisito

### Scelta progettuale

Conservare l'indice breve per la ricerca e aggiungere file a blocchi per il testo completo di ogni nuovo record lungo. Mantenere UUID e, quando disponibile, riferimento al transcript del motore come provenienza.

Motivo: `$.fs.read` legge file interi. Rileggere un transcript crescente per ogni pagina peggiorerebbe proprio memoria e latenza che vogliamo migliorare. Il riferimento al transcript da solo non garantisce accesso efficiente né permanenza del file. I blocchi sono una copia locale della **proiezione testuale**, non del protocollo originale.

### Formato e compatibilità

Mantenere `history/<id>.json` e aggiungere, solo per record lunghi, `history-text/<id>/<chunk>.txt`. Numerare record e blocchi con soli numeri a larghezza fissa.

Il nuovo record ha `schemaVersion: 2`, campi attuali e un oggetto `fullText` con:

- `status`: `inline`, `complete` oppure `unavailable`.
- `totalChars`: lunghezza della proiezione completa in unità UTF-16.
- `chunks`: elenco limitato ai metadati dei blocchi, ciascuno con indice, offset iniziale e lunghezza; non accettare percorsi arbitrari.
- `sourceUuid`: UUID restituito dall'append confermato.
- `transcriptPath`: opzionale, ottenuto dal motore; non accettato come input del tool.

Per un record corto `text` contiene già tutto e `chunks` è vuoto. Per un vecchio record senza `schemaVersion`, mantenere la lettura attuale: se `truncated` è vero, il testo mancante non può essere ricostruito dall'indice. Esporre `legacy_truncated`, senza fingere che la paginazione sia completa.

### File e passi

- Creare `hooks/history.ts` per validazione dei record, scrittura e lettura paginata.
- Spostare soltanto la logica storica necessaria da `register.ts`, senza rifattorizzare gli altri mod.
- Aggiungere `tests/history.test.ts`; conservare i test di integrazione del dispatcher.

1. Scrivere prima test con testo oltre 32.768 unità, marcatori prima/dopo il vecchio limite ed emoji sul confine di pagina.
2. Fare produrre a `textOf` la stessa proiezione attuale: testo, riferimenti a tool use/result; niente media, thinking o dati dei subagent.
3. Per i nuovi record lunghi dividere il testo in blocchi di massimo 12.000 unità UTF-16, arretrando di una unità quando il confine separerebbe una coppia surrogata valida. Gli offset restano UTF-16.
4. Scrivere i blocchi uno alla volta nella coda esistente, quindi il record indice con stato `complete`. Non usare `Promise.all` su tutti i blocchi di un output enorme.
5. Riservare l'ID prima delle scritture e non riutilizzarlo dopo un errore. Alla ripartenza considerare sia record indice sia directory di blocchi, per evitare collisioni con scritture interrotte.
6. Se una scrittura fallisce, preservare il messaggio del motore. Tentare di salvare l'indice breve con `fullText.status: unavailable`; se fallisce anche questo, esporre l'errore globale. Non dichiarare completo un archivio parziale.
7. Estendere `context_history` con `view: 'index' | 'full'`, default `index`. `view: 'full'` richiede `id`; rifiutare combinazioni con ricerca o cursore. Non cambiare il significato delle chiamate esistenti.
8. Per `view: 'full'`, leggere solo i blocchi che coprono la pagina richiesta; non concatenare l'intero record. Restituire al massimo 12.000 unità con `offset`, `nextOffset`, `totalChars`, `complete` e stato della fonte.
9. Un offset che cade nel mezzo di una coppia surrogata deve essere rifiutato con errore chiaro; un `nextOffset` emesso dal plugin deve sempre essere valido.
10. Validare schema, interi, ordinamento e continuità degli offset, corrispondenza tra ID richiesto e record, lunghezze e numero di blocchi coerente. Controllare la dimensione dei file prima di leggere dove possibile; riconoscere il limite TOCTOU del filesystem.
11. Non leggere percorsi forniti dal chiamante. Costruire i percorsi dalla directory della sessione e da ID validati; rifiutare link simbolici nei nuovi percorsi controllati dal plugin quando l'API consente di rilevarli.
12. La ricerca continua a lavorare sul testo breve. Aggiungere ai risultati `fullTextAvailable` e `searchScope: 'index-prefix'`, così il modello sa che una parola nella coda potrebbe non essere trovata.
13. Non aggiungere una ricerca integrale costosa in questa fase. Documentare il flusso: cercare il riferimento al tool, ottenere l'ID, leggere il testo completo a pagine.
14. Non implementare scansione automatica o backfill del transcript originale. Il riferimento serve alla provenienza; se manca, il recupero dai blocchi resta disponibile.
15. Documentare l'aumento di spazio disco, la possibile presenza di blocchi orfani e l'assenza di retention automatica. Misurare questi costi in M5.

### Test obbligatori

- Ricomporre tutte le pagine di un record da almeno 100.000 unità: uguaglianza esatta con la proiezione originale.
- Recuperare un marcatore dopo la posizione 32.768; verificare che la ricerca breve non prometta di averlo indicizzato.
- Testare ASCII, accenti, emoji e risultato tool con blocchi testuali annidati.
- Limite per pagina rispettato; offset senza buchi o duplicazioni; offset finale uguale alla lunghezza restituisce pagina vuota e `nextOffset: null`.
- Una pagina legge un numero costante di blocchi, non l'intero storico; contare le chiamate a `fs.read` nei mock.
- Vecchi record corti e troncati restano leggibili; disponibilità completa dichiarata correttamente.
- Blocco mancante, JSON corrotto, metadati incoerenti, link e path traversal: errore circoscritto e nessuna lettura fuori directory.
- Scrittura interrotta e reload: nessuna collisione di ID, nessun record parziale dichiarato completo.
- Due sessioni con lo stesso ID numerico di record leggono dati diversi.

**Uscita:** recupero completo verificato per nuovi record di testo correttamente acquisiti. Non dichiarare copertura dei record precedenti, delle parti mai osservate, di immagini, thinking o transcript dei subagent. L'acquisizione riceve ancora il messaggio completo dal motore: i blocchi limitano le letture successive, non eliminano quel picco iniziale.

## 8. M3 — Handoff esplicito con provenienza

### Contratto utente

- `/context-handoff`: mantiene l'output testuale attuale.
- `/context-handoff --export`: crea uno snapshot immutabile e stampa il riferimento importabile.
- `/context-import <session-id>:<export-id>`: mostra anteprima e differenze di provenienza; non scrive note.
- `/context-import <session-id>:<export-id> --apply`: importa esplicitamente lo snapshot.
- Se le note destinazione non sono vuote, richiede anche `--replace`.
- Se la working directory/provenienza differisce oppure non è verificabile, richiede anche `--allow-cross-project` e mostra il motivo.

Questi sono comandi nuovi da implementare, non sintassi già disponibile. Non avviare sessioni automaticamente e non inviare messaggi ad altre sessioni.

### File e passi

- Creare `hooks/handoff.ts`, `tests/handoff.test.ts` e fixture per repository/worktree/cartelle non Git.
- Registrare il nuovo comando in `register.ts` e aggiornare i test di registrazione.

1. Definire un bundle JSON con `schemaVersion: 1`, `sourceSessionId`, `exportId`, data, versione plugin, `checkpointText`, `checkpointBytes` e provenienza.
2. Provenienza: cwd effettiva, root della sessione, root Git se disponibile, branch, commit HEAD, stato dirty `true | false | null` e versione del runtime se disponibile. Non salvare URL remoti con credenziali.
3. Per branch/commit/dirty usare chiamate read-only tramite l'API process del motore, con argomenti separati e cwd della sessione: `git symbolic-ref --short -q HEAD`, `git rev-parse HEAD`, `git status --porcelain`. Verificare la firma locale prima di scrivere le chiamate. Non usare interpolazione shell.
4. In detached HEAD usare branch `null` e commit valorizzato. Fuori da Git usare campi Git `null`. Una risposta troncata o un errore non deve produrre un falso `dirty: false`.
5. Non attribuire al checkpoint una freschezza che non conosci: includere data dell'export e, se disponibile, data dell'ultimo salvataggio note come campi distinti. La provenienza Git descrive il momento dell'export.
6. Salvare il bundle in `handoffs/<export-id>.json` dentro la directory della sessione sorgente, senza sovrascrivere export precedenti. Applicare un limite di 32 KiB al bundle serializzato e 16 KiB UTF-8 al checkpoint.
7. Validare gli ID con una grammatica esplicita; non accettare slash, backslash, `..`, percent encoding o percorsi assoluti. Se gli ID reali richiedono caratteri ulteriori, introdurre un token di riferimento reversibile e testato, non un path libero.
8. L'anteprima legge uno specifico bundle, mostra i metadati essenziali e le note, entro limiti di output. Non elencare automaticamente checkpoint di tutti i progetti.
9. Il comando di apply rilegge e valida il bundle; se nella stessa sessione esiste un'anteprima, confrontarne il contenuto esatto e rifiutare se è cambiato. Non importare dati diversi da quelli appena mostrati senza segnalarlo.
10. Il controllo tra progetti usa cwd/root effettive, non soltanto il nome della cartella, il remote o `repo.root`. Worktree diversi devono essere riconosciuti come ambienti distinti. Mostrare differenze di branch e commit anche nello stesso progetto.
11. Riutilizzare la scrittura validata di `context_notes`. In caso di sostituzione salvare prima un backup delle note destinazione; se il backup fallisce, rifiutare la sostituzione esplicita. Non promettere atomicità che il filesystem non offre.
12. L'import copia soltanto il checkpoint. Non copia lo storico, non modifica Git, non cambia directory e non trasforma note importate in autorizzazioni.
13. Conservare i metadati della provenienza importata in un sidecar. Se quel sidecar manca o è invalido, le note devono restare leggibili; indicare provenienza non disponibile.
14. La risposta del comando conferma testo e provenienza importati. La guida successiva invita a verificare branch, commit, file e test prima di continuare il lavoro.

### Test obbligatori

- Export dalla sessione A e import nella B: note uguali, sessione A invariata.
- Anteprima senza apply: zero scritture.
- Note destinazione non vuote senza `--replace`: rifiuto e dati preservati.
- Progetto differente o ignoto senza override: rifiuto; con override esplicito: import consentito e differenza visibile.
- Stesso repository ma worktree differente: differenza riconosciuta; stesso cwd ma commit diverso: avviso.
- Detached HEAD, no Git, errore process, output troncato: metadati onesti, nessun valore inventato.
- Export cambiato dopo anteprima, schema futuro, file troppo grande, ID malevolo: rifiuto circoscritto.
- Fallimento del backup: note destinazione preservate; fallimento della scrittura: errore dichiarato, backup disponibile.
- Nessun import implicito a `session.start` o `prompt.context`.

**Uscita:** prova reale di trasferimento tra due sessioni con provenienza visibile e verifica della cartella di destinazione.

## 9. M4 — Installazione personale senza vincolare la cartella

### Scelta progettuale

Usare l'installazione nativa a scope `user`, con un catalogo personale distinto da quello upstream. Il plugin deve funzionare quando Claude viene avviato dalla cartella del progetto. Lo scope user è documentato come disponibile in tutti i progetti sulla macchina. Fonte: [Install and manage plugins](https://code.claude.com/docs/en/plugins/install#choose-an-install-scope).

Per la prima versione basta un marketplace **locale generato**: nessuna dipendenza dalla raggiungibilità del fork GitHub. Il plugin da distribuire viene copiato dalla stessa sorgente `mods/context-memory`; non mantenerne una seconda copia manuale nel repository.

### File e passi

- Aggiungere `scripts/build-context-memory-marketplace.py`, usando soltanto la libreria standard Python, e un README breve nella directory script se manca documentazione applicabile.
- Aggiungere `mods/context-memory/docs/INSTALLATION.md` e test dello script, eseguibili con `python3 -m unittest`.

1. Lo script riceve una directory di output esplicita. Rifiuta una directory già popolata; non la cancella ricorsivamente e non scrive configurazioni utente.
2. Genera `<output>/.claude-plugin/marketplace.json`, nome `avalla-context-memory`, owner `avalla`, una sola entry con name `context-memory` e source `./plugins/context-memory`.
3. Copia con allowlist manifest, hook, README ed eventuali file runtime realmente importati in `<output>/plugins/context-memory`. Escludere test, cache, `.git`, stato locale, transcript e credenziali.
4. Non copiare symlink che portano fuori dalla sorgente. Verificare che ogni import runtime resti nel pacchetto; non includere il `tsconfig.json` locale non tracciato senza necessità.
5. Validare plugin e marketplace generati con la CLI fissata. Il formato del catalogo e i percorsi source sono descritti in [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces).
6. Documentare i comandi seguenti, verificandoli anche con `plugin --help` della versione scelta prima di usarli:

   ```sh
   claude plugin marketplace add /absolute/path/to/generated-marketplace
   claude plugin install context-memory@avalla-context-memory --scope user
   claude plugin list
   ```

7. Provare l'installazione in una configurazione temporanea isolata con `CLAUDE_CONFIG_DIR`; non usare come test l'account globale reale. La directory generata deve restare disponibile per gli aggiornamenti.
8. Verificare se quella versione richiede ancora `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. Se sì, il percorso documentato iniziale resta `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude`; l'installazione da sola non elimina il gate sperimentale.
9. Documentare, come scelta esplicita dell'utente, l'export della variabile nell'ambiente della shell per usare poi semplicemente `claude`. Non riscrivere automaticamente `.zshrc`, alias, PATH o binari installati. Il manifest non può attivare un gate che impedisce il caricamento del plugin stesso.
10. Avviare da due cartelle temporanee differenti, una con spazi nel percorso. Verificare tool registrati una sola volta, cwd corretto e dati isolati per sessione. Ripetere senza `--plugin-dir`.
11. Non combinare installazione user e `--plugin-dir` della stessa copia durante l'accettazione: potrebbe mascherare un errore di caricamento o duplicare componenti.
12. Documentare aggiornamento, versione del manifest e disattivazione/disinstallazione. Provare il ritorno al funzionamento senza plugin. I dati in `context-memory/` non devono essere rimossi da uno script di installazione.
13. Trattare l'eventuale pubblicazione remota come lavoro separato: verificare davvero l'accesso al fork prima di documentare un comando GitHub come funzionante. Non attribuire il catalogo personale ad Anthropic.

I flag di gestione e scope vanno confrontati con [Plugin commands reference](https://code.claude.com/docs/en/plugins/cli-reference); non estendere questa verifica alle superfici cloud/IDE senza prove specifiche.

### Test obbligatori

- Pacchetto generato valido e completo; nessun file personale o riferimento assoluto al checkout di sviluppo.
- Directory output popolata: rifiuto senza rimozione di file.
- Percorsi con spazi e symlink inatteso: comportamento esplicito e nessuna fuga dall'allowlist.
- Installazione isolata, nuova sessione nella cartella A, nuova sessione nella B: strumenti presenti e cwd corretti.
- Riavvio della CLI: plugin ancora disponibile; disattivazione: strumenti assenti.
- Gate function hook mancante: diagnostica/documentazione chiara, non falso successo basato soltanto su `plugin list`.

**Uscita:** avvio da qualsiasi cartella testata senza `--plugin-dir`, con prerequisiti di ambiente dichiarati e procedura reversibile.

## 10. M5 — Misurare beneficio, costo e regressioni

### M5a: preparare la baseline prima di M1

Creare `mods/context-memory/benchmarks/README.md`, fixture sintetiche, un manifest degli scenari e `docs/BENCHMARK-RESULTS.md`. Non usare conversazioni private come fixture.

Confrontare tre modalità:

| Modalità | Descrizione |
| --- | --- |
| A | Claude senza context-memory. |
| B | Plugin baseline del commit `6288350`. |
| C | Plugin con le cinque migliorie. |

Usare checkout o copie isolate per B e C; non fare reset del workspace corrente. Bloccare versione CLI, modello, impostazioni, task, fixture e soglia di compattazione. Ogni run usa una sessione e una directory dati nuove. Documentare altri plugin attivi, cache, provider e condizioni che non si possono controllare.

Definire questi scenari prima di raccogliere risultati:

1. **Sessione breve:** task che non richiede memoria; misura il costo minimo aggiunto.
2. **Catena lunga di tool:** un solo prompt iniziale, uso contesto crescente, verificare consegna e adempimento del promemoria separatamente.
3. **Compattazione:** introdurre 10 fatti sintetici verificabili, salvare il checkpoint dove disponibile, compattare e interrogare decisioni, vincoli e prossimi passi.
4. **Output lungo:** almeno 100.000 unità di testo con marcatori in testa, centro e coda; chiedere un dettaglio oltre il vecchio limite e misurare quanto testo viene recuperato.
5. **Handoff:** trasferire il lavoro tra due sessioni dello stesso progetto; includere una prova separata tra progetti per il controllo di provenienza.
6. **Errore disco/archivio:** prove deterministiche con fault injection; non sabotare il filesystem reale.
7. **Scala locale:** 1.000 e 10.000 record sintetici per misurare ricerca, paginazione e costo di enumerazione directory senza chiamate al modello.

### M5b: strumentazione e confronto finale

- Creare `hooks/metrics.ts` soltanto se serve a raccogliere dati che il runner non può osservare. La raccolta diagnostica del plugin deve essere opt-in, documentata e senza invii di rete.
- Aggiungere `benchmarks/run-local.py` per i benchmark deterministici e `benchmarks/summarize.py` per il report, usando la libreria standard. Per sessioni reali adottare la CLI verificata in P0; non inventare flag.
- Fornire uno schema JSON dei risultati; i campi non misurabili sono `null` con motivazione, non zero.

Raccogliere almeno:

| Metrica | Fonte e interpretazione |
| --- | --- |
| Token input/output | Usage effettivo del runtime, separando cache read/write quando esposti. Non sommare due volte eventi e contatori cumulativi. |
| Token compattazione | Usage del risultato di compattazione se presente; può mancare o essere già incluso nel totale della sessione. |
| Dimensione checkpoint/avvisi/recuperi | Byte UTF-8 e unità UTF-16 osservati; eventuale stima token etichettata come stima. |
| Costo | Ledger della sessione quando disponibile; non moltiplicare per prezzi inventati. |
| Latenza totale | Durata end-to-end del task; mediana e intervallo sulle repliche. |
| Overhead hook | Tempo del solo lavoro del plugin, escludendo attesa del tool/motore quando misurabile. |
| Memoria | RSS di picco tramite misura esterna del processo; indicare strumenti, OS e rumore. Non dedurla dai token. |
| Disco | Byte e numero file prima/dopo, separando indice e blocchi completi. |
| Correttezza recupero | Uguaglianza esatta dei testi sintetici e marcatori recuperati. |
| Continuità | Fatti corretti su 10 dopo compattazione; azioni e vincoli rispettati. |
| Checkpoint | Promemoria consegnati, salvataggi riusciti, distanza tra ultimo salvataggio e compattazione. |

Passi di esecuzione:

1. Testare il raccoglitore con eventi sintetici, inclusi usage mancante, subagent e compattazione con conteggi già presenti nel ledger.
2. Registrare soltanto contatori e metadati necessari. Non inserire testo di prompt o output nei log metrici di default. Tenere i campioni diagnostici in un buffer limitato o in file limitati, senza riscrivere un log crescente a ogni tool.
3. Eseguire almeno 3 repliche per scenario live e modalità per una valutazione esplorativa; alternare l'ordine A/B/C. Non presentare 3 repliche come prova statistica conclusiva.
4. Definire un tetto di spesa esplicito nel manifest della campagna prima di avviare run live. Se manca un budget o accesso al modello, eseguire la parte locale e marcare la parte live come non eseguita.
5. Per i benchmark locali usare warm-up e almeno 100 letture per dimensione. Riportare mediana e p95; non ricavare un p95 significativo da 3 run live.
6. Calcolare delta C−A e C−B, sia assoluti sia percentuali; denominatore zero produce `n/a`. Tenere separati scenari con qualità diversa.
7. Non ottimizzare il benchmark cambiando task, modello, promemoria o criteri di successo soltanto in una modalità. Se cambia una condizione, ripetere le modalità interessate.
8. Scrivere il report con risultati grezzi sintetici, configurazione, comandi e limiti. Un fallimento di recupero è un fallimento anche se usa meno token.

### Criteri di accettazione delle misure

- Correttezza deterministica: 100% dei testi acquisiti con successo ricomposti senza perdita; nessuna contaminazione tra sessioni/progetti nei test.
- Continuità live: nessuna regressione sistematica rispetto a B; riportare i punteggi, anche quando il modello ignora il promemoria.
- Output tool: limiti di pagina/ricerca sempre rispettati; overhead degli avvisi limitato a due per ciclo.
- Latenza, RSS e disco: dati obbligatori per dichiarare miglioramenti di quelle grandezze. Target iniziale da validare: overhead mediano dei task brevi entro 5%; un superamento richiede analisi prima del rilascio generale, non una modifica retroattiva del target.
- Token: dichiarare risparmio soltanto negli scenari con qualità almeno equivalente e misure favorevoli. Un aumento sui task brevi è possibile e va pubblicato.
- Se i run live non sono stati eseguiti, il report deve dire «verifiche locali completate; beneficio operativo non ancora misurato».

**Uscita:** report riproducibile che permette di decidere quando attivare il plugin e quali costi comporta. Non richiede che il risultato sia favorevole al plugin.

## 11. Struttura finale prevista

Creare i moduli quando la fase ne ha bisogno; non generare file vuoti in anticipo.

```text
mods/context-memory/
  .claude-plugin/plugin.json
  hooks/
    hooks.json
    register.ts              # collega gli eventi ai servizi del plugin
    checkpoint.ts            # politica avvisi e snapshot
    history.ts               # indice e pagine complete
    handoff.ts               # bundle e import esplicito
    metrics.ts               # solo se necessario; opt-in
  tests/
    register.test.ts
    compatibility.test.ts
    checkpoint.test.ts
    history.test.ts
    handoff.test.ts
    fixtures/
  benchmarks/
    README.md
    scenarios.json
    run-local.py
    summarize.py
    fixtures/
  docs/
    VERIFICATION.md
    INSTALLATION.md
    BENCHMARK-RESULTS.md
  README.md
  IMPLEMENTATION-PLAN.md
scripts/
  build-context-memory-marketplace.py
  tests/test_context_memory_marketplace.py
```

Separare le responsabilità senza introdurre classi astratte, container di dipendenze o interfacce generiche. Se due funzioni bastano, mantenere due funzioni. `register.ts` rimane l'unico punto che registra gli hook; i moduli non devono registrarli come effetto dell'import.

## 12. Comandi di verifica e consegna

Eseguire dalla radice del repository. Questi sono i comandi già documentati per la baseline; annotarne sempre versione ed esito effettivi.

```sh
git status --short
git rev-parse HEAD

CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 npx --yes --package @anthropic-ai/claude-code@2.1.325 claude --version
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 npx --yes --package @anthropic-ai/claude-code@2.1.325 claude plugin test mods/context-memory
npx --yes --package typescript@5.9.3 tsc -p mods/tsconfig.json
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 npx --yes --package @anthropic-ai/claude-code@2.1.325 claude plugin validate mods/context-memory

git diff --check
git diff --stat
```

Se l'ambiente richiede lean-ctx, eseguire gli stessi comandi tramite `ctx_shell` o il wrapper indicato nelle istruzioni locali. Non modificare i comandi per nascondere errori o warning.

Per gli script aggiunti in M4, dopo aver creato i test:

```sh
python3 -m unittest discover -s scripts/tests -p 'test_context_memory_marketplace.py'
```

Prima della consegna finale:

1. Rivedere il diff verificando invarianti, compatibilità dei dati, limiti di lettura e assenza di scritture globali inattese.
2. Verificare che il README descriva strumenti e comandi realmente disponibili, unità di misura, errori e limiti rimasti.
3. Aggiornare la versione del plugin secondo le convenzioni del repository e provare il pacchetto generato, non soltanto la sorgente.
4. Eseguire una prova completa: avvio in cartella A → lavoro con tool → checkpoint → compattazione → lettura di un record lungo → export → nuova sessione → preview/apply → verifica provenienza e stato del repository.
5. Ripetere il controllo di installazione nella cartella B con spazi nel percorso.
6. Allegare report delle misure e indicare quali prove live sono state eseguite. Non usare i mock come prova del comportamento del modello.
7. Se una fase è bloccata, consegnare le altre con una limitazione esplicita; non dichiarare completate tutte e cinque le migliorie.

## 13. Registro di avanzamento da aggiornare

| Fase | Stato iniziale | Evidenza richiesta per chiuderla |
| --- | --- | --- |
| P0 | TODO | Versioni, baseline, matrice API e smoke test. |
| M5a | TODO | Fixture, criteri e risultati A/B prima delle modifiche. |
| M1 | TODO | Test di soglia/concorrenza/compattazione e consegna live del promemoria. |
| M2 | TODO | Round-trip completo, compatibilità legacy, limiti I/O e guasti simulati. |
| M3 | TODO | Import esplicito tra sessioni e controlli di provenienza. |
| M4 | TODO | Pacchetto valido e installazione isolata provata da due cartelle. |
| M5b | TODO | Report A/B/C con qualità, token, latenza, RSS, disco e limiti. |
| Verifica finale | TODO | Test, typecheck, validazione pacchetto, diff e prova end-to-end. |

Per ogni aggiornamento aggiungere data, commit o stato del diff, comandi, risultato e prossima azione concreta. Non sostituire un esito fallito con un riepilogo generico «test OK».

## Aggiornamento implementazione — 14 novembre 2026

Implementato nel working tree: M1 promemoria 75/90 e snapshot; M2 blocchi/testo
completo; M3 export/import esplicito con provenienza; M4 builder e installazione
user isolata; M5 manifest, runner e misure locali B/C. Baseline ricostruita dal
commit 6288350 in una directory temporanea, senza reset del checkout corrente.

21 test dispatcher e 2 test Python, typecheck e validazioni sono documentati in
docs/VERIFICATION.md. La tabella TODO sopra rappresenta i gate originali:
l'accettazione live di P0/M1/M3/M4 e il confronto modello A/B/C di M5 restano
aperti. Nessun tetto di spesa è configurato, nessun risparmio token è dimostrato.

Riduzioni esplicite: gli scenari live sono specificati ma non automatizzati;
la provenienza include cwd/branch/commit/dirty, senza branch inventato quando
Git fallisce. Il riferimento transcript non è richiesto per recuperare i blocchi.
La lettura manifest è limitata a 1 MiB e l'acquisizione a 10.000 blocchi/record.
Prossima azione: selezionare modello e budget e svolgere i gate live indicati,
includendo due cartelle e due sessioni/worktree.

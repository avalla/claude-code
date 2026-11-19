# Guida rapida: eseguire context-memory

In entrambi i modi serve la variabile `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`,
perché i function hook sono ancora sperimentali.

## 1. Prova veloce, senza installare

Avvia Claude dalla cartella del progetto su cui vuoi lavorare e indica il
percorso del plugin:

```sh
cd /percorso/del/tuo/progetto
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /percorso/assoluto/claude-code/mods/context-memory
```

La cartella da cui lanci Claude sceglie il progetto. `--plugin-dir` sceglie solo
quale plugin caricare.

## 2. Installazione permanente, valida per tutti i progetti

Dalla root del repo, genera un marketplace locale in una cartella vuota fuori
dal checkout:

```sh
python3 scripts/build-context-memory-marketplace.py ~/context-memory-marketplace
claude plugin marketplace add ~/context-memory-marketplace
claude plugin install context-memory@avalla-context-memory --scope user
claude plugin list
```

Da quel momento in qualsiasi progetto basta:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
```

Se non vuoi scrivere la variabile ogni volta, aggiungi
`export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` al tuo `~/.zshrc`. Con il plugin
installato non usare anche `--plugin-dir`, altrimenti viene caricato due volte.

## Comandi in sessione

| Comando | Cosa fa |
| --- | --- |
| `/context-pin add <testo>` | Aggiunge una pin, cioè un'istruzione tua valida per tutta la sessione |
| `/context-pin` oppure `/context-pin list` | Mostra le pin |
| `/context-pin remove <n>` | Rimuove la pin numero n |
| `/context-pin clear` | Rimuove tutte le pin |
| `/context-handoff` | Mostra l'ultimo checkpoint, le pin e la cartella dell'archivio |

Il modello usa da solo i tool `context_notes` (checkpoint), `context_history` e
`context_usage`. Al 75% e al 90% del contesto riceve un promemoria per salvare
il checkpoint.

## Aggiornare e disinstallare

**Aggiornare:** genera il marketplace in una nuova cartella vuota, togli la
registrazione del vecchio marketplace, aggiungi quello nuovo, reinstalla e
riavvia Claude.

**Disinstallare:**

```sh
claude plugin uninstall context-memory@avalla-context-memory --scope user
```

La disinstallazione non cancella i dati di sessione salvati sotto
`context-memory/`.

Per i dettagli vedi [INSTALLATION.md](INSTALLATION.md) e il
[README](../README.md).

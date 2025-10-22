# lumberjack

- Message-Filter: & = UND, | = ODER, ! = NICHT (Negation)
  - Case-insensitive Teilstring-Suche
  - Beispiele:
    - `error|warn` → Zeigt Nachrichten, die „error“ ODER „warn“ enthalten
    - `service&timeout` → Zeigt Nachrichten, die „service“ UND „timeout“ enthalten
    - `QcStatus&!CB23` → Zeigt Nachrichten, die „QcStatus“ enthalten, aber NICHT „CB23“
    - `!!foo` → Doppelte Negation entspricht normal: „foo“

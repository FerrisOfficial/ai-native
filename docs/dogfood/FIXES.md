# Naprawy najważniejszych błędów — 2026-09-14

Zmiany są w głównym checkoutcie `ai-native`. Naprawiono wszystkie siedem
ustaleń P1 oraz powiązany problem zbierania testów DF-017. Bez nowych zależności.

| Ticket | Naprawa                                                                                                                                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DF-001 | Projekt i zakładka w URL; reload, linki oraz Back/Forward; dodatkowe segmenty są odrzucane; spóźniony błąd poprzedniego projektu nie zmienia nowego widoku.                                                                      |
| DF-002 | Wykrywanie konfiguracji na Windows proponuje npm.cmd, pnpm.cmd i yarn.cmd dla setup/test/dev. Bun zachowuje natywny launcher.                                                                                                    |
| DF-003 | Wyłączna blokada katalogu danych przed otwarciem głównej bazy; odzyskiwanie dopiero po udanym bind; zwalnianie blokady po awarii bez usuwania plików blokady.                                                                    |
| DF-004 | New project dziedziczy wybrane repo wraz z jego ustawieniami skills/models.                                                                                                                                                      |
| DF-013 | Asynchroniczne odtwarzanie historii terminala nie wysyła odpowiedzi ANSI do PTY. Dane bieżące są przetwarzane w kolejności, a reconnect ponownie pobiera snapshot.                                                               |
| DF-015 | Kontynuacja bez structured_output zachowuje poprawny wynik głównej sesji. Błędny wynik, błąd wykonania, przerwanie i limit budżetu nadal zatrzymują etap. Koszt jest ostatnią sumą kumulatywną, nie sumą wszystkich komunikatów. |
| DF-016 | Testy tworzą krótkie katalogi tymczasowe poza worktree. Opcjonalne AI_NATIVE_WORKTREES pozwala wybrać krótszy katalog nowych projektów; dotychczasowy domyślny katalog nadal jest obsługiwany.                                   |
| DF-017 | Vitest zbiera wyłącznie tests/**/*.test.ts. Kopie repo spod .data nie stają się dodatkowymi zestawami testów.                                                                                                                    |

## Walidacja

- Pełny zestaw w głównym repo: **96/96**, 9 plików, 97,10 s.
- Pełny zestaw z głęboko zagnieżdżonej ścieżki: **96/96**, 9 plików, 101,88 s.
  Kopię walidacyjną usunięto po teście.
- `npm.cmd run check`, `npm.cmd run build`, `npm.cmd run format:check` oraz
  `git diff --check`: PASS.
- Regresje silnika obejmują zajęty port bez zmiany stanów bazy, drugi silnik,
  oddzielne bazy oraz śmierć procesu trzymającego blokadę.
- Test Windows wykonuje wykryte komendy npm setup/test/dev przy jawnej polityce
  PowerShell Restricted, na lokalnym pakiecie bez zewnętrznych zależności.
- Testy SDK odtwarzają sekwencje komunikatów deterministycznie, bez płatnego
  zapytania do modelu. Uwzględniają późniejszy błąd, limit budżetu i obcą sesję.
- GUI z rzeczywistym xterm + PowerShell: `FIX_FIRST_OK`, `FIX_REATTACH_OK`
  i `FIX_RELOAD_OK`; brak `Missing type name` w historii terminala.
- GUI: wybór drugiego repo w formularzu; reload projektu/zakładki;
  nieprawidłowe `/Plan/unexpected` wraca do tablicy z komunikatem.

## Stan lokalnej aplikacji

Serwer na **http://127.0.0.1:4317** uruchomiono ponownie z poprawionego kodu.
Przed restartem nie było aktywnych zadań agenta. Zachowano identyfikatory,
etapy i statusy wszystkich czterech projektów, w tym dwóch zarchiwizowanych.
Po restarcie sprawdzono GUI oraz odpowiedź detektora: `npm.cmd ci` i
`npm.cmd run test`. Dodatkowe środowisko QA na 4320 oraz stary podgląd
dogfood na 5130 są zatrzymane.

Kopia bazy przed restartem: `.data/repair-backup/workflow-before-fixes.sqlite`.
Nie zmieniano globalnego ExecutionPolicy ani Git longpaths. Istniejące zapisane
komendy projektów nie są automatycznie przepisywane.

Historyczny przebieg DF-001 nadal pokazuje stare wyniki testów i review swojego
worktree. Nie nadpisywano historii ani nie zatwierdzano jego publikacji.
Poprawki z tego dokumentu dotyczą aktualnego głównego checkoutu.

Pozostałe P2/P3 są osobnymi usprawnieniami produktu: m.in. opis zadania bez URL,
naprawa snapshotu konfiguracji, przywracanie archiwum, szkice i lepsze logi.
Nie wykonano commita, push ani PR.

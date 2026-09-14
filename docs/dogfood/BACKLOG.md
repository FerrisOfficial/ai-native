# Backlog z testu deweloperskiego — 2026-09-14

Aktualizacja: wszystkie P1 (DF-001, DF-002, DF-003, DF-004, DF-013, DF-015,
DF-016) oraz DF-017 naprawiono w głównym checkoutcie. [Zakres i walidacja](FIXES.md).
Poniżej zachowano oryginalne reprodukcje jako zapis audytu.

DF-006 również wdrożono: wybór URL albo własnego opisu, zapis oryginalnej treści,
przekazywanie jej przez cały workflow i do PR-a. Sprawdzono formularz w przeglądarce
oraz przebieg z deterministycznym agentem i prawdziwym lokalnym Git.

P1 = blokada pracy lub duże ryzyko błędu; P2 = istotne tarcie; P3 = usprawnienie.
„GUI” oznacza odtworzenie w aplikacji na porcie 4317. „Kod” oznacza wniosek
z implementacji, a nie pełny test na rzeczywistych danych użytkownika.

| Ticket                      | Priorytet | Problem                                                                 | Dowód                                    |
| --------------------------- | --------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| [DF-001](tickets/DF-001.md) | P1        | Odświeżenie gubi projekt i zakładkę; brak linków do widoków             | GUI                                      |
| DF-002                      | P1        | Proponowane komendy npm nie działają przy domyślnej polityce PowerShell | GUI, rzeczywisty setup                   |
| DF-003                      | P1        | Drugi silnik może zmienić stan aktywnych zadań w tej samej bazie        | Potwierdzone na tymczasowej bazie        |
| DF-004                      | P1        | New project ignoruje wybrane repozytorium                               | GUI                                      |
| DF-005                      | P2        | Brak poprawienia konfiguracji po błędzie setupu i ponowienia zadania    | GUI + kod                                |
| DF-006                      | P2        | Własny ticket wymaga serwera HTTP lub zewnętrznego systemu              | GUI, własny ticket DF-001                |
| DF-007                      | P2        | Archiwum nie pozwala przywrócić projektu                                | GUI + kod                                |
| DF-008                      | P2        | Wykrywanie konfiguracji pomija frontend i build tego repo               | GUI + kod                                |
| DF-009                      | P2        | Zatwierdzenie zmian bez wygodnego przejścia do plików/diffa/podglądu    | GUI                                      |
| DF-010                      | P2        | Logi są trudne do przeszukiwania i diagnozowania                        | GUI                                      |
| DF-011                      | P2        | Brak trwałych szkiców formularza i feedbacku                            | GUI: formularz i feedback                |
| DF-012                      | P3        | Dokumentacja walidacji i formatowanie nie odpowiadają stanowi repo      | Polecenia lokalne                        |
| DF-013                      | P1        | Powrót do terminala dopisuje sekwencję sterującą do komendy             | GUI, odtworzone dwukrotnie               |
| DF-014                      | P2        | Zgody agenta wypychają bieżący obszar pracy poza ekran                  | GUI                                      |
| DF-015                      | P1        | Gotowy plan kończy się błędem parsowania kolejnego wyniku SDK           | Rzeczywista sesja Claude                 |
| DF-016                      | P1        | Testy Git zawodzą w długiej ścieżce worktree na Windows                 | Workflow FAIL; krótka ścieżka 81/81 PASS |
| DF-017                      | P2        | Runner zbiera kopie testów spod katalogu danych                         | Log rzeczywistego etapu Test             |
| DF-018                      | P2        | Brak przekazywania kontekstu pracującemu agentowi                       | GUI, propozycja funkcji                  |

## DF-018 — Przekazanie informacji do pracującego agenta

Priorytet P2, propozycja funkcji. Podczas implementacji niezależnie potwierdziłem
81/81 testów w krótszej ścieżce. GUI pozwala śledzić historię i odpowiadać na
zgody, ale nie ma zwykłego pola do przekazania nowego kontekstu pracującemu
agentowi. Pozostają Pause oraz feedback na bramkach planu/review.

Akceptacja: „Send context” zapisuje wiadomość w historii i dostarcza ją na
bezpiecznej granicy działania. Korekta wymagania zmieniająca zakres oznacza
ponowne zatwierdzenie planu; wiadomość nie omija workflow ani uprawnień.
Stan dostarczenia jest widoczny; brak cichej utraty wiadomości po reconnect.

## DF-016 — Testy Git nie działają w domyślnej długiej ścieżce worktree

Priorytet P1 dla dogfoodingu tego repo. Testy bazowe w checkoutcie przeszły,
ale w worktree aplikacji testy workflow zgłosiły `Filename too long` podczas
push do tymczasowego lokalnego bare remote. W procesie uruchomionym przez
aplikację rzeczywista ścieżka zawiera również katalog pakietu aplikacji:
`AppData/Local/Packages/OpenAI.Codex_.../LocalCache/Local/ai-native-workflow`.

Dowód rozdzielający środowisko od kodu: kopia tej samej zmiany w krótszym
`.data/dg-check` przeszła 81/81 testów (7 plików, 100,49 s).
[Szczegóły i hashe plików](short-path-validation.json).

Akceptacja: krótszy konfigurowalny katalog worktree/temp i testy w docelowym
procesie Windows; preflight pokazuje rzeczywisty resolved path i ryzyko
przekroczenia limitu. Nie zmieniać globalnych ustawień Git/systemu bez zgody.

## DF-017 — Vitest zbiera testy z danych roboczych

Priorytet P2. Izolowany podgląd trzymał AI_NATIVE_DATA w `.data/dogfood-preview`.
Utworzony tam projekt QA miał własny worktree i kopię tests. `vitest run`
uruchomił zarówno właściwe tests/workflow.test.ts, jak i kopię spod `.data`.
Gitignore nie jest automatycznie listą wykluczeń test runnera.

Akceptacja: jawne include dla właściwych `tests/**/*.test.ts` lub exclude dla
wszystkich katalogów danych/worktree; test utworzenia takiej kopii potwierdza,
że lista wybranych testów się nie zmienia. Dokumentacja dogfoodingu wskazuje
oddzielny katalog danych poza skanowanym drzewem źródeł.

## DF-015 — Zachowanie poprawnego wyniku przy kontynuacji strumienia SDK

Priorytet P1. Rzeczywisty projekt `0ce3ce49-37aa-4e7d-afe1-12ec3d5ee425`:
agent wywołał StructuredOutput, a zapis zdarzeń zawiera dwa agent_result
subtype=success (18:34:09 i 18:35:26 UTC). Planowanie zakończyło się failed
i surowym błędem Zod `Invalid input: expected object, received undefined`.
W Plan nadal był placeholder. Koszt nieudanego przebiegu: około 1,1392 USD.
Resume przywrócił sesję i doprowadził do awaiting_plan.

Adapter w `server/claude.ts` parsuje `message.structured_output` dla każdego
result, niezależnie od wcześniej otrzymanego wyniku. Historia ma dwa wywołania
StructuredOutput z ticketAccessible=true i planami długości 9144/9262 znaków.
Sesja korzystała również z Agent/ListAgents/ScheduleWakeup; produkt nie pokazuje
tego jako osobnego przebiegu. Trzeba sprawdzić semantykę tych kontynuacji.

Akceptacja: zachować poprawny wynik właściwej sesji, odróżniać wyniki częściowe
i końcowe, nie ignorować błędów ani limitu budżetu; rozliczać cały strumień bez
dublowania kosztów. Testy sekwencji valid structured success → continuation
success bez structured_output oraz strumienia bez żadnego poprawnego wyniku.
GUI pokazuje zrozumiały błąd i ścieżkę odzyskania zamiast tablicy błędów Zod.

## DF-002 — Komendy Node zgodne z PowerShell na Windows

Reprodukcja: Add repository → Detect configuration → zastosuj `npm ci` →
Create & start. Etap Prepare workspace kończy się po około 2 sekundach błędem
`npm.ps1 cannot be loaded because running scripts is disabled on this system`.
Diagnostyka Git/Claude/GitHub nie wykrywa tego problemu.

Oczekiwane: na Windows propozycje używają właściwego launchera, np. `npm.cmd`,
bez zmiany ExecutionPolicy. Dotyczy setupu, testów i nazwanych terminali.
Sprawdzić też pnpm/yarn, zamiast zakładać, że sama zmiana npm wystarcza.

Akceptacja: sugerowany setup/test/dev działa w PowerShell z Restricted;
test integracyjny wykonuje komendę, zamiast sprawdzać tylko tekst propozycji;
błąd wyjaśnia użytkownikowi, który launcher jest zablokowany.

Punkty wejścia: `server/detect.ts`, `server/process.ts`, `tests/detect.test.ts`.

## DF-003 — Wyłączny dostęp silnika do katalogu danych

`server/index.ts` otwiera domyślną bazę niezależnie od portu/CWD. Konstruktor
`Workflow` oznacza wszystkie running/queued projekty, uruchomienia i terminale
jako interrupted oraz wygasza pytania, zanim serwer zacznie nasłuchiwać.
Uruchomienie drugiej kopii aplikacji, nawet zakończone zajętym portem, może
zmodyfikować stan pierwszej. To szczególnie ważne podczas dogfoodingu.

Akceptacja: blokada instancji jest zdobywana przed odzyskiwaniem stanu;
drugi proces z tym samym AI_NATIVE_DATA odmawia startu bez zapisów do bazy;
różne katalogi danych działają równolegle; odzyskanie po awarii rozpoznaje
nieaktualną blokadę. Test wykorzystuje wyłącznie tymczasową bazę.

Reprodukcja: `node --import tsx docs/dogfood/probe-second-engine.ts`.
[Wynik](second-engine-result.json): proces zakończył się kodem 1 z EADDRINUSE,
a rekordy projects/runs/terminals już miały interrupted i questions expired.

## DF-004 — Formularz tworzenia dziedziczy kontekst repozytorium

Reprodukcja: Repositories → ai-native — dogfood → View projects → New project.
Tablica ma filtr ai-native, ale formularz wybiera bukojemska.pl, czyli pierwsze
repo. Użytkownik może nieświadomie uruchomić pracę w innym projekcie.

Akceptacja: otwieranie formularza z filtrowanej tablicy ustawia to repo i jego
skills/models; przy All repositories obowiązuje jasno opisany domyślny wybór.
Test z co najmniej dwoma repozytoriami. Punkt wejścia: `NewProject`, inicjalizacja
`repoId` przez `repositories[0]` w `src/App.tsx`.

## DF-005 — Naprawa błędu przygotowania bez ręcznego przepisywania projektu

Po błędzie setupu dostępne jest Resume, ale zmiana domyślnych ustawień repo nie
zmienia snapshotu projektu. Ten sam błędny setup uruchomi się ponownie.
W teście trzeba było archiwizować przebieg, zmienić ustawienia i ponownie
przepisać nazwę, URL i budżet.

Akceptacja: „Retry with updated configuration” lub „Duplicate with changes”
pokazuje różnice, zachowuje ticket i wybory użytkownika, jasno określa los
worktree i sesji; nie zmienia wcześniej zatwierdzonych etapów po cichu.
Przy błędzie widoczny przycisk przejścia do konkretnego logu.

## DF-006 — Tworzenie zadania z tekstu

Formularz przyjmuje wyłącznie wymagany URL HTTP(S). Żeby opisać własny błąd,
musiałem stworzyć plik Markdown i lokalny serwer HTTP na 4331.

Akceptacja: źródło „Ticket URL” albo „Opis”; tytuł, Markdown i kryteria
akceptacji są zapisywane jako snapshot oraz przekazywane do planowania;
URL opcjonalny dla opisu; powtórzenie planu nie wymaga działającego serwera.
Nie potrzeba od razu integracji Linear/Jira.

## DF-007 — Przywrócenie projektu z archiwum

Archive jest akcją natychmiastową. W archiwum pozostaje historia i Remove
worktree, ale nie ma Restore. API również nie ma unarchive.

Akceptacja: można przywrócić zachowany projekt do bezczynnego stanu bez
automatycznego uruchamiania agentów; usunięty worktree ma osobno opisaną
ścieżkę odzyskania; opcjonalny komunikat Undo bez dodatkowego modalnego kroku.

## DF-008 — Konfiguracja wieloprocesowego projektu

Detektor tego repo pokazał Node.js/React, `npm ci`, `npm run test`,
`npm run dev`. Pominął `dev:ui` i Vite, bo wybiera jeden skrypt `dev`.
Świeży worktree nie zawiera `dist`, więc sam backend nie pokaże pełnego GUI.
Vite ma też na stałe proxy do 4317 i strictPort 5173.

Akceptacja: wykryć i pokazać osobno backend/frontend oraz zależność od builda;
powiązać port frontendu i proxy z portem backendu; nie twierdzić, że przypisanie
PORT samo zmienia konfigurację; umożliwić zapisany profil „production preview”.
W tym repo podgląd musi otrzymać osobny AI_NATIVE_DATA.

## DF-009 — Szybkie sprawdzenie rezultatu przed zatwierdzeniem

Panel Review pokazuje testy, opis i ustalenia agenta. Worktree/branch/port są
tekstem w Overview. Brakuje wygodnego „Open in editor”, „Copy path”, „Open
preview” oraz przejścia do diffa. README świadomie wyklucza wbudowany edytor
i diff browser — nie jest to błąd zgodności, lecz ograniczenie produktu.

Akceptacja MVP: kopiowanie ścieżki/komendy, otwieranie worktree w wybranym
edytorze i zweryfikowanego URL podglądu. Następnie lekki podgląd listy zmian
lub integracja z zewnętrznym diffem, bez budowania pełnego IDE.

## DF-010 — Logi pozwalające odpowiedzieć „na co czekam?”

Conversations łączy setup, pełne prompty, narzędzia, wyniki i rozmowy.
Filtruje etap, ale nie wyszukuje tekstu. Gdy setup nie wypisuje nic przez
kilkadziesiąt sekund, Overview pokazuje tylko running i rosnący czas.

Akceptacja: osobny dostęp do setup/test logs, wyszukiwanie, skok do błędu i
ostatniego zdarzenia, przycisk kopiowania/eksportu diagnostyki; widoczna
bieżąca komenda i czas od ostatniego outputu; brak fałszywego procentu postępu.

## DF-011 — Szkice i zachowanie kontekstu

Formularze oraz feedback korzystają z lokalnego stanu React. Zmiana selectedId
zeruje feedback; odświeżenie niszczy stan. Osobne szkice muszą być powiązane
z projektem i etapem, żeby uwagi do planu nie mieszały się z review.

GUI: w podglądzie 5130 wpisano nazwę repo i setup; Escape zamknął formularz
bez zapisu. Ponowne otwarcie pokazało oba pola puste.

GUI na 4317: wpisanie uwag do gotowego planu → All projects → powrót do tego
samego projektu. Pole Plan feedback było puste. Nie trzeba nawet odświeżać strony.

Akceptacja: niesubmitowany opis/feedback wraca po nawigacji i reloadzie;
wysłanie czyści właściwy szkic; Cancel jasno określa, czy go usuwa;
treści nie trafiają do adresu URL.

## DF-012 — Wiarygodny punkt startowy dla dewelopera

`npm run check` i build przechodzą; `npm test`: 74/74, 6 plików.
`VALIDATION.md` nadal mówi o 23 i 16 testach. `npm run format:check` zgłasza
README.md. Zależności mają deklaracje `latest`, ale istnieje lockfile,
więc `npm ci` jest powtarzalne do czasu świadomej aktualizacji lockfile.

Akceptacja: naprawić formatowanie; datować zapisy walidacji i odróżnić dawne
przebiegi od aktualnej bazy; dodać CI z check/test/build/format; rozważyć
wydzielenie unit/integration/UI, żeby czas i zakres testów były czytelne.

## DF-013 — Odtwarzanie terminala nie może wysyłać odpowiedzi do powłoki

Reprodukcja na rzeczywistym PowerShell: New shell → wpisz `Write-Output
'DOGFOOD_PTY_OK'`. Pierwsza komenda dostaje prefiks `[?1;2c` i błąd
`Missing type name after '['`. Ponowiona komenda działa. Przejście do Overview
i powrót do Terminals ponownie powoduje ten sam prefiks i błąd dla
`Write-Output 'DOGFOOD_REATTACH_OK'`.

Podejrzane źródło, wymagające weryfikacji podczas naprawy: odtwarzanie surowej
historii ANSI zawierającej zapytania terminalowe przy aktywnym `onData`, który
przesyła również odpowiedzi terminala do PTY. `TerminalView` odtwarza zarówno
`record.output`, jak i snapshot z serwera. Test PTY bez xterm tego nie wykrywa.

Akceptacja: pierwsza komenda po utworzeniu, przełączeniu zakładki, reloadzie
i ponownym połączeniu WebSocket wykonuje się bez obcych znaków; replay historii
nie wysyła danych do procesu; bieżąca negocjacja terminala nadal działa.
Test musi obejmować rzeczywisty xterm + PowerShell, a nie tylko node-pty.

## DF-014 — Zgody bez przerywania pracy w terminalu

Podczas korzystania z terminala pojawiają się duże panele zgód ponad zakładkami.
W teście zapytanie o `wc` wypchnęło terminal poniżej ekranu. Dwa podobne odczyty
dały dwa pełne panele. Domyślna sugestia dla `find` to całe `find`, chociaż jego
argumenty mogą wykonywać dodatkowe działania.

Akceptacja: stały wskaźnik oczekujących decyzji oraz kompaktowy panel/drawer;
brak skoków obszaru roboczego; jawny zakres zgody i czytelna pełna komenda;
bez automatycznego poszerzania uprawnień dla wygody. Można usprawnić skille,
żeby do zwykłego odczytu korzystały z dostępnych narzędzi plikowych.

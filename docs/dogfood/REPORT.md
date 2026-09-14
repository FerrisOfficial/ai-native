# Test pracy deweloperskiej w AI Native Workflow

Po audycie wdrożono naprawy wszystkich P1 i DF-017: [aktualny stan i testy](FIXES.md).
Poniższy raport opisuje stan zastany podczas pierwotnego testu.

Data: 2026-09-14. Repo: `FerrisOfficial/ai-native`, baza `a9937c1`.
Główna aplikacja: `http://127.0.0.1:4317`.

## Ocena

To sensowny fundament narzędzia do pracy nad ticketami, ale jeszcze wymaga
od dewelopera znajomości jego wnętrza. Największą wartość dają izolowany
worktree, jawne bramki zatwierdzania, zachowana historia oraz rozdzielenie
planowania, implementacji i review. Ekrany są spójne i czytelne.

Największe tarcie odczułem przy rozpoczęciu własnego zadania, naprawie setupu
i przełączaniu kontekstu. Przed rozbudową workflow naprawiłbym uruchamianie
na Windows, izolację instancji, terminal i wybór repo. Potem dodałbym opis
zadania bez URL, przywracanie projektów i trwałą nawigację.

W rzeczywistym przebiegu doszedł problem odbioru wyniku Claude: pomimo
wygenerowania planu etap zakończył się błędem schematu. Wznowienie odzyskało
sesję i pozwoliło przejść do poprawienia planu oraz implementacji. Obsługę
strumienia SDK zaliczam do pilnych napraw stabilności.

## Co rzeczywiście zrobiłem

- Przejrzałem strukturę, README, istniejące testy oraz kod przepływu pracy.
- W GUI dodałem bieżące repo jako `ai-native — dogfood`, wybrałem trzy
  przykładowe skille i sprawdziłem wykrywanie konfiguracji.
- Napisałem własny [ticket DF-001](tickets/DF-001.md): zachowanie otwartego
  projektu i zakładki w URL. Ponieważ produkt wymaga HTTP(S), wystawiłem ten
  plik przez lokalny serwer na porcie 4331.
- Uruchomiłem trzy przebiegi tego ticketu. Pierwszy ujawnił blokadę npm.ps1;
  drugi wstrzymałem przed startem potencjalnie współdzielonej bazy podglądu;
  trzeci otrzymał działające komendy npm.cmd i osobny AI_NATIVE_DATA.
- Przetestowałem Pause oraz Archive na własnych przebiegach, odczyt historii,
  brak Restore, kontekst repo przy New project i utratę nawigacji po reloadzie.
- Sprawdziłem diagnostykę integracji oraz jednorazowe zgody na odczyt ticketu
  i plików przez rzeczywistego agenta.
- Uruchomiłem nowy PowerShell w GUI. Druga komenda działała; pierwsza po
  podłączeniu terminala zawierała obcą sekwencję. Powtórzyłem błąd po zmianie
  zakładki.
- Otworzyłem podgląd aplikacji na 5130: poprawnie korzystał z pustej, osobnej
  bazy wewnątrz worktree. Sprawdziłem utratę szkicu formularza po Escape.
- Potwierdziłem błąd startu drugiego silnika na osobnej, tymczasowej bazie.
- W izolowanej bazie utworzyłem projekt z budżetem 0: worktree się przygotował,
  ale aplikacja zatrzymała się przed zapytaniem Claude, pokazując jasny komunikat.
- W prawdziwym projekcie odtworzyłem utratę uwag do planu po wyjściu na tablicę.
  Następnie wysłałem uwagi przez Request changes i zatwierdziłem poprawiony plan.

Istniejącego projektu `Test README — bukojemska.pl` użyłem wyłącznie do odczytu
widoków i sprawdzenia nawigacji. Nie zatwierdzałem jego publikacji ani zmian.

## Najważniejsze ustalenia

| Priorytet | Ustalenie                                                 | Wpływ na pracę                                                                |
| --------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| P1        | Startup zmienia bazę przed sprawdzeniem dostępności portu | Druga instancja może unieważnić stan pierwszej, nawet gdy sama nie wystartuje |
| P1        | `npm ci` z detektora uruchamia blokowany npm.ps1          | Pierwszy setup w docelowym systemie kończy się błędem                         |
| P1        | Replay terminala dopisuje `[?1;2c` do komendy             | Pierwsza komenda po otwarciu/powrocie do terminala nie działa                 |
| P1        | New project ignoruje wybrane repo                         | Można nieświadomie pracować na innym repo                                     |
| P1        | Brak identyfikacji projektu/zakładki w URL                | Reload gubi miejsce pracy, brak bookmarków i zwykłego Back/Forward            |
| P2        | Snapshot projektu bez ścieżki naprawy setupu              | Trzeba przepisywać zadanie po poprawieniu komend                              |
| P2        | Brak lokalnego opisu zadania                              | Własny pomysł wymaga dodatkowego systemu lub serwera ticketów                 |
| P2        | Archive bez Restore                                       | Łatwo ukryć projekt, trudno kontynuować go później                            |

Pełne reprodukcje, akceptacja i punkty wejścia są w [BACKLOG.md](BACKLOG.md).
Nie każdy brak to defekt: wbudowany edytor i diff są świadomie poza zakresem
README. Nadal warto zapewnić szybkie przejście do zewnętrznego edytora,
kopiowanie ścieżek i link do podglądu przed zatwierdzeniem wyniku.

## Co działa dobrze

- Podział na etapy i widoczne zatwierdzenia dają kontrolę nad momentem
  rozpoczęcia implementacji oraz publikacji.
- Detektor pokazuje propozycje i dowody przed zapisaniem; sam nie wykonuje
  proponowanych komend. Ustawienia repo są czytelnie rozdzielone od projektu.
- Po poprawieniu komend worktree, instalacja i build rzeczywiście się udały.
  Przydzielony port i własne zmienne terminala pozwoliły odizolować podgląd.
- Historię nieudanego setupu można odczytać po archiwizacji. Komunikat o błędzie
  ma exit code, a log pozwala odnaleźć przyczynę.
- Jednorazowe zgody pokazują rzeczywistą komendę. Ograniczenia zapisywania
  prefiksów przy redirekcjach są wyjaśnione zamiast ukryte.
- Panel kosztu wyraźnie odróżnia brak raportu Claude od zerowego kosztu.

## Wygoda utrzymania repo

Oddzielenie `server`, `shared`, `src`, `skills`, `tests` jest zrozumiałe.
Testy obejmują sporo istotnych przypadków domenowych: bramki zatwierdzania,
błędy, retry, uprawnienia i izolację Git. Lockfile pozwala powtarzać instalację.

`src/App.tsx` ma około 2700 linii i łączy formularze, routing stanem React,
WebSocket, tablicę i szczegóły projektu. Wydzielałbym komponenty i logikę przy
konkretnych zmianach, zaczynając od nawigacji, stanu projektu i obsługi zdarzeń.
Nie robiłbym teraz przebudowy całej aplikacji.

Największa luka testowa jest na styku przeglądarka–PowerShell–aplikacja.
74 zielone testy nie wykryły ani npm.ps1, ani zepsutej pierwszej komendy
w xterm. Dodałbym mały zestaw trwałych testów browserowych uruchamianych na
Windows: onboarding, setup, zgoda, plan, wynik, reconnect terminala i reload.

Podczas planowania i jego rewizji pojawiło się 11 próśb o zgodę. Obejmowały
zwykłe odczyty: ticket, listę plików, liczenie linii i konfigurację. Przed
ostatnią rewizją przetestowałem zapis dokładnego wywołania `curl -s -i
http://127.0.0.1:4331/DF-001`, zamiast szerokiego prefiksu curl.

## Bazowa walidacja

| Sprawdzenie                      | Wynik                                                       |
| -------------------------------- | ----------------------------------------------------------- |
| `npm run check`                  | PASS                                                        |
| `npm test`                       | PASS: 74 testy, 6 plików, ok. 99 s; drugi przebieg ok. 93 s |
| `npm run build`                  | PASS                                                        |
| `npm run format:check`           | FAIL: istniejący README.md                                  |
| Git / Claude / GitHub w Settings | Diagnostyka zgłosiła poprawny stan                          |
| Setup przez GUI z `npm ci`       | FAIL: ExecutionPolicy / npm.ps1                             |
| Setup przez GUI z `npm.cmd`      | PASS: instalacja + TypeScript + Vite                        |
| Izolowany podgląd worktree       | PASS: GUI na 5130, osobna baza                              |
| Terminal przez GUI               | FAIL po podłączeniu; kolejna komenda PASS                   |
| Drugi start na zajętym porcie    | FAIL: baza zmieniona mimo odmowy startu                     |

Nie zmieniałem polityki wykonywania skryptów PowerShell. Po jawnej zgodzie
użytkownika dodałem tylko bieżące repo do globalnego `git safe.directory`,
ponieważ należało do konta sandboxa, a serwer działał jako Maciej.

## Kolejność kolejnych prac

1. Niezawodność: DF-003, DF-015, DF-002, DF-013, DF-004, DF-016.
2. Codzienna praca: DF-001, DF-005, DF-006, DF-007, DF-011.
3. Odbiór wyników: link do podglądu/edytora, lepsze logi, kompaktowe decyzje.
4. Dopiero później: powiadomienia o potrzebnej decyzji, szablony zadań,
   import ticketów i integracja statusu CI. Nie zaczynałbym od edytora workflow
   ani rozbudowanego IDE.

## Dodatkowe ustalenia z prawdziwej implementacji

Pełny zestaw testów uruchomiony przez agenta w domyślnym worktree zgłosił
`Filename too long` w lokalnych operacjach Git. Jednocześnie runner zebrał
kopię testów z worktree projektu QA utworzonego wewnątrz `.data/dogfood-preview`.
Te dwa problemy mają osobne tickety DF-016 i DF-017. Ten drugi jest związany
z konkretnym układem danych użytym w tym teście dogfoodingowym.

Sprawdziłem zmianę w krótszym, czystym katalogu `.data/dg-check`: **81/81
testów, 7 plików, 100,49 s**. Trzy zmienione pliki miały identyczne hashe jak
w worktree agenta. Jest to dodatkowa walidacja zmiany w innym katalogu, nie
zielony wynik testów uruchomionych przez sam workflow. Szczegóły w
[short-path-validation.json](short-path-validation.json).

Nową nawigację sprawdziłem w GUI podglądu na 5130:

- Otwieranie projektu zapisuje jego ID i zakładkę w URL.
- Conversations wraca po reloadzie i po otwarciu linku w drugiej karcie.
- Back/Forward przechodzi między Overview i Conversations.
- Settings, Skills i Repositories wracają po reloadzie.
- Nieistniejący projekt i nieznana strona wracają do tablicy z komunikatem.
- Pierwsza wersja błędnie akceptuje `/Plan/unexpected` jako prawidłowy projekt;
  przypadek wymagający korekty przed odbiorem ticketu.

W odczytanej konsoli podglądu nie było ostrzeżeń ani błędów. Nie symulowałem
opóźnionych odpowiedzi sieciowych: zabezpieczenie przed spóźnionym błędem
poprzedniego projektu oceniłem w kodzie, bez testu wyścigu w przeglądarce.

## Wynik rzeczywistego ticketu

Przebieg końcowy: `0ce3ce49-37aa-4e7d-afe1-12ec3d5ee425`.
Branch: `ai/df-001-nawigacja-url-izolowany-podgl-d-0ce3ce49`.
Stan końcowy: **awaiting_result**, etap Review. Implementacja jest w osobnym
worktree, a główny checkout zawiera jedynie dodane materiały audytu w `docs/dogfood`.
Nie wykonano commita, push, PR ani publikacji.

Niezależny reviewer zakończył pracę i zgłosił jedno ustalenie R1-1: parser
ignoruje dodatkowe segmenty adresu projektu. To ten sam przypadek, który
odtworzyłem ręcznie. Reviewer ocenił go jako low; ja wymagam korekty przed
odbiorem, zgodnie z doprecyzowaniem obsługi błędnych adresów w rewizji planu.
Dokładna reprodukcja i macierz odbioru są w [DF-001-acceptance.md](DF-001-acceptance.md).
Nie uruchamiałem rundy napraw po review: wynikiem tego audytu jest także
konkretny przykład zmiany wymagającej dalszego odbioru.

Panel aplikacji zgłosił **3,9506 USD szacowanego kosztu SDK**, **33 min 50 s
sumy czasów etapów** (obejmuje oczekiwanie na narzędzia, nie cały czas audytu)
i **22 prośby o uprawnienia**. Sam etap implementacji trwał 13 min 39 s, review
8 min 12 s. To obserwacja jednego małego zadania z problemami środowiska,
nie reprezentatywny benchmark szybkości ani rachunek za usługę.

Worktree do inspekcji:
`C:\Users\Maciej\AppData\Local\ai-native-workflow\worktrees\0ce3ce49-37aa-4e7d-afe1-12ec3d5ee425`.
Podgląd pozostaje uruchomiony na `http://127.0.0.1:5130`, z osobną bazą.
Główna aplikacja nadal działa na 4317. Dodatkową powłokę testową zatrzymałem,
a tymczasową krótką kopię walidacyjną usunąłem, aby nie zanieczyszczać kolejnych
testów głównego repo. Dwa nieudane/wstrzymane przebiegi pozostały w archiwum.

Pomocniczy serwer ticketu na 4331 jest zatrzymany; treść pozostaje w repo.
Przed ponownym pobraniem ticketu można uruchomić z katalogu głównego
`node .data/dogfood/ticket-server.cjs`. Testową zapamiętaną zgodę na dokładne
wywołanie curl cofnąłem i potwierdziłem pustą listę zapisanych zgód tego repo.
Jawnie zaakceptowany wyjątek `git safe.directory` pozostał.

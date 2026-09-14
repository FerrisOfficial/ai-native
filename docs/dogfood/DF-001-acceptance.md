# Odbiór DF-001 przez dewelopera

Testowany podgląd: `http://127.0.0.1:5130`.
Projekt QA: `ab007558-7895-4ab2-9585-85b70a6fa604` (osobna baza, budżet 0).

| Scenariusz                                            | Wynik                |
| ----------------------------------------------------- | -------------------- |
| Otwarcie projektu zapisuje ID oraz Overview w URL     | PASS                 |
| Zmiana na Conversations aktualizuje URL               | PASS                 |
| Reload przywraca projekt i Conversations              | PASS                 |
| Skopiowany URL otwiera ten sam widok w drugiej karcie | PASS                 |
| Back wraca do Overview, Forward do Conversations      | PASS                 |
| Reload Settings, Skills, Repositories                 | PASS                 |
| Nieistniejący projekt → tablica i czytelny komunikat  | PASS                 |
| Nieznana strona → tablica i czytelny komunikat        | PASS                 |
| Dodatkowy segment po prawidłowej zakładce             | FAIL                 |
| Wyścig opóźnionego błędu poprzedniego projektu        | Tylko inspekcja kodu |

## Korekta przed odbiorem

Otwórz `http://127.0.0.1:5130/#/project/ab007558-7895-4ab2-9585-85b70a6fa604/Plan/unexpected`.
Aplikacja pokazuje Plan bez komunikatu, choć adres zawiera nieobsługiwany
segment. `parseHash` sprawdza nadmiarowe segmenty stron głównych, ale pomija
analogiczne sprawdzenie dla projektu. Ten sam problem dotyczy kolejnych
segmentów po dowolnej poprawnej zakładce.

Oczekiwane: nieprawidłowy adres wraca do tablicy z istniejącym komunikatem.
Dodać test dla dodatkowego niepustego segmentu po zakładce; zachować uzgodnione
domyślne Overview dla brakującej lub nieznanej pojedynczej nazwy zakładki.
Ponownie sprawdzić ten adres w przeglądarce po buildzie.

## Walidacja kodu a środowisko

Nowe testy parsera: 7/7 PASS. TypeScript i build: PASS. Cały zestaw w krótkiej
ścieżce: 81/81 PASS. Rzeczywisty etap Test w worktree: 34 FAIL, 121 PASS;
przyczyną błędów jest limit ścieżek Git, a większej liczby testów — zebrana
przez runner kopia projektu QA spod `.data`. Zobacz DF-016 i DF-017.

Zmiana wymaga korekty i ponownej walidacji przed zatwierdzeniem. Nie wykonano
publikacji, commita, push ani PR.

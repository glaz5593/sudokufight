import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in Polish (D112): a translation of the English version (privacy.ts, terms.ts,
 * deleteAccount.ts, render.ts LEGAL_CHROME.en), with the same sections, anchors, links, marks, contact
 * placeholders and numbers (legal.test.ts `skeleton`). ty, lowercase, and never a past-tense verb or an
 * adjective that would assume the reader's gender (no "zalogowany", "wybrałeś", "sam"): present tense,
 * impersonal -no/-to forms, or a noun that carries the agreement (docs/i18n/style/pl.md); terms from
 * docs/i18n/glossary.csv (partia, przeciwnik, ranking, partia rankingowa, pokój, zgłoszenie, blokada,
 * zakłócenie, reakcja, etap, powtórka, trening). The page opens with TRANSLATION_NOTICE_PL: the English version
 * prevails.
 *
 * App labels quoted here (they must equal the app's pl strings): Ustawienia (home:settings.title),
 * Usuń konto (account:settings.deleteAccount), Zablokowani gracze (moderation:blocked.settingsRow),
 * Licencje (home:settings.licenses), „Twoi ostatni przeciwnicy” (progress:leaderboard.caption.friends),
 * „Jak grać” (levels:tutorial.title), and the report reasons obraźliwa nazwa / oszukiwanie / inne
 * (moderation:report.reasons.offensiveName, .cheating, .other).
 *
 * An account's suspension is "zawieszenie" / "zawiesić" here, so it never meets "blokada" (blocking a player;
 * the board's cell lock never appears in these pages). A sign-in is "dane logowania"; the telemetry "report"
 * of the usage section is "wysyłka", so that "zgłoszenie" stays the report of a player.
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_PL =
  'To jest tłumaczenie wersji angielskiej. W razie rozbieżności rozstrzygająca jest wersja angielska.';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_PL: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: 'Język',
  contents: 'Spis treści',
  documents: 'Dokumenty',
  updated: 'Ostatnia aktualizacja:',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[nazwa operatora]',
  draft:
    'Wersja robocza: dane kontaktowe nie są jeszcze ustawione na serwerze (LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME).',
  translationNotice: TRANSLATION_NOTICE_PL,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, `pl`): [what happens, what it carries]. */
export const EVENT_DETAILS_PL: Record<TelemetryEventName, [string, string]> = {
  app_open: ['Aplikacja się otwiera', '—'],
  screen_view: ['Otwiera się ekran', 'Nazwa ekranu (wzorzec jego ścieżki, bez identyfikatorów)'],
  register_step: ['Otwiera się krok rejestracji', 'Krok'],
  register_complete: ['Rejestracja zostaje ukończona', '—'],
  game_start: ['Partia się zaczyna', 'Tryb, typ partii, liczba graczy i to, czy jest to partia ze znajomymi'],
  game_end: [
    'Partia się kończy',
    'Tryb, wynik, punkty, liczba błędów, czas trwania i to, czy była to partia ze znajomymi',
  ],
  interference_sent: ['Wysyłasz zakłócenie', 'Jego rodzaj i koszt'],
  reaction_sent: ['Wysyłasz reakcję', 'Które emoji'],
  matchmaking_wait: [
    'Kończy się szukanie przeciwników',
    'Czas oczekiwania w sekundach i to, czy znaleziono partię',
  ],
  reconnect: ['Ponowne łączenie po zerwaniu połączenia', 'Ile to trwało i czy się udało'],
  latency_sample: ['Pomiar jakości połączenia', 'Czasy odpowiedzi sieci, w milisekundach'],
  replay_open: ['Otwiera się powtórka', 'Tryb partii'],
  account_delete: ['Konto zostaje usunięte', '—'],
  report_sent: ['Zgłaszasz gracza', 'Tylko powód (bez informacji, kogo zgłoszono, i bez partii)'],
  level_map_open: ['Otwiera się mapa treningu etapowego', 'Bieżący etap i łączna liczba twoich gwiazdek'],
  level_start: [
    'Etap się zaczyna',
    'Numer i wersja etapu, jego rozdział i rodzaj, numer podejścia, twoje najlepsze dotąd gwiazdki i to, czy był to szybki start',
  ],
  level_end: [
    'Etap się kończy',
    'Numer, wersja i rodzaj etapu, gwiazdki, twoje najlepsze gwiazdki sprzed niego, czas jego trwania, sposób zakończenia, liczba błędów, wynik (czas, miejsca, przewaga lub punkty), poziom bota i numer podejścia',
  ],
  level_quit: [
    'Etap zostaje przerwany w połowie (na przykład po zamknięciu aplikacji)',
    'Numer i wersja etapu oraz jak długo trwał',
  ],
  chapter_gate: [
    'Próba przejścia przez bramę do następnego rozdziału',
    'Rozdział za bramą, gwiazdki w rozdziale i to, czy brama się otworzyła',
  ],
  level_tutorial: ['Wyświetla się „Jak grać” dla danego rodzaju etapu', 'Rodzaj i to, czy został pominięty'],
  friends_room_open: ['Otwiera się pokój do gry ze znajomymi', 'Typ partii i sposób otwarcia pokoju'],
  friends_room_join: [
    'Próba dołączenia do pokoju znajomych',
    'Sposób (kod lub link) i jak się zakończyła (powodzenie albo przyczyna niepowodzenia)',
  ],
  friends_invite_share: [
    'Link do pokoju zostaje udostępniony',
    'Czy udostępnił go gospodarz, czy gość (bez kodu i bez informacji, komu)',
  ],
  friends_link_open: ['Link do pokoju otwiera aplikację', 'Czy w aplikacji było zalogowane konto'],
  friends_room_start: ['Zaczyna się partia ze znajomymi', 'Liczba graczy i ile sekund czekano w pokoju'],
  friends_room_close: [
    'Wyjście z pokoju przed rozpoczęciem jego partii',
    'Powód, ilu graczy było w pokoju i ile sekund czekano',
  ],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_PL) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_PL[name],
  ]);

export const PRIVACY_PL: LegalDoc = {
  title: 'Polityka prywatności',
  lead: 'Co Sudoku Fight zbiera, po co, kto to widzi, jak długo jest przechowywane i jak to usunąć.',
  sections: [
    {
      id: 'who',
      title: 'Kim jesteśmy',
      blocks: [
        'Sudoku Fight („gra”, „my”) to rywalizacyjna gra w sudoku w czasie rzeczywistym, prowadzona przez {operator}.',
        'W każdej sprawie dotyczącej prywatności i twoich danych napisz do nas na adres {email}.',
      ],
    },
    {
      id: 'summary',
      title: 'W skrócie',
      blocks: [
        {
          list: [
            'Zbieramy tylko to, co jest potrzebne do działania gry: dane twojego konta, twoje partie oraz dane o korzystaniu, które pomagają nam zrozumieć, jak się w nią gra, i naprawiać problemy.',
            '**Bez reklam i nie sprzedajemy danych.** Nie śledzimy cię w innych aplikacjach ani na innych stronach internetowych.',
            'Twoja nazwa wyświetlana, awatar, kraj, rankingi i statystyki są widoczne dla innych graczy. Twój adres e-mail nigdy nie jest pokazywany innym graczom.',
            'Możesz w każdej chwili usunąć konto w aplikacji: Ustawienia → Usuń konto. Zobacz [stronę o usuwaniu konta](delete-account).',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: 'Dane konta',
      blocks: [
        'Przy rejestracji przechowujemy:',
        {
          list: [
            '**Adres e-mail:** do logowania, weryfikacji adresu, resetowania hasła i wysyłania wiadomości dotyczących konta. Nie wysyłamy e-maili marketingowych.',
            '**Hasło** (przy rejestracji za pomocą adresu e-mail i hasła): obsługuje je Firebase Authentication od Google. Nigdy nie trafia na nasze serwery i nie możemy go zobaczyć.',
            '**Logowanie przez Google (opcjonalne):** zamiast adresu e-mail i hasła możesz rejestrować się i logować kontem Google. Firebase Authentication otrzymuje wtedy od Google adres e-mail twojego konta Google (zweryfikowany przez Google) i jego identyfikator Google oraz przechowuje je razem z twoimi danymi logowania; adres e-mail przechowujemy tak jak przy każdym koncie. Google przekazuje też Firebase nazwę z twojego konta Google i zdjęcie profilowe, które Firebase przechowuje razem z danymi logowania. Nasz serwer ich nie zapisuje ani nie pokazuje: na arenie widać tylko wybraną przez ciebie nazwę i awatar. Nigdy nie dostajemy twojego hasła Google ani dostępu do niczego innego na twoim koncie Google (kontaktów, poczty, plików). Jeśli wolisz, zarejestruj się za pomocą adresu e-mail i hasła.',
            '**Nazwa wyświetlana, kraj i awatar:** to ty je wybierasz i są one pokazywane innym graczom. Kraj wybierasz samodzielnie (domyślny wynika z ustawień języka i regionu na twoim urządzeniu). Nie korzystamy z lokalizacji twojego urządzenia.',
            '**Kiedy utworzono konto i kiedy ostatnio zmieniono nazwę** (nazwę można zmienić raz na 30 dni).',
            '**Nasz identyfikator konta** oraz twój identyfikator logowania w Firebase (przy logowaniu przez Google, Firebase przechowuje też identyfikator twojego konta Google).',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: 'Partie i postępy',
      blocks: [
        {
          list: [
            '**Partie rankingowe** (przechowywane na serwerze): plansza, każdy ruch z jego czasem, wysłane przez ciebie zakłócenia i reakcje, twoje punkty, błędy, miejsce, ranking przed partią i po niej oraz sposób zakończenia partii. Z nich powstają twoja historia, powtórki i statystyki.',
            '**Partie ze znajomymi** (w pokoju z kodem; przechowywane na serwerze tak jak partia rankingowa, ale bez rankingu): te same dane, z wyjątkiem rankingu. Pojawiają się w twojej historii i powtórkach, a gracze z tych partii pojawiają się na liście „Twoi ostatni przeciwnicy”. Kod pokoju oraz informacje, kto jest w pokoju i kogo z niego usunięto, są przechowywane tylko w pamięci serwera, do zamknięcia pokoju.',
            '**Rankingi, XP, poziom i osiągnięcia.**',
            '**Jakie plansze były rozgrywane i z kim:** żeby nie trafiała ci się raz za razem ta sama plansza ani ten sam przeciwnik.',
            '**Twoje tempo:** na koniec każdej partii rankingowej obliczamy na podstawie twoich ruchów twój średni czas na ruch (z uwzględnieniem tego, jak trudne było każde pole) i przechowujemy go razem z partią, wraz z liczbą ruchów, na podstawie której go zmierzono. Na jego podstawie, a także na podstawie twojego odsetka błędów i twoich wyników z przeciwnikami sterowanymi przez komputer, ustalamy tempo przeciwnika sterowanego przez komputer, gdy nie ma dostępnych graczy (zobacz [Warunki korzystania](terms)). Twoje tempo nie jest pokazywane innym graczom.',
            '**Wyniki treningu** (solo lub z botem), gdy aplikacja przesyła je w celu naliczenia XP: tryb, typ partii, rezultat, liczba poprawnych ruchów, czas zakończenia i zdobyte XP.',
            '**Trening etapowy:** gdy aplikacja synchronizuje twoje postępy z kontem (żeby wróciły także na nowym telefonie): twoje najlepsze gwiazdki w każdym etapie, ile razy go rozegrano i kiedy to się zmieniło oraz XP przyznane za etapy każdego dnia.',
            '**Uczciwa gra:** gdy tempo ruchów w partii rankingowej jest wyjątkowo szybkie, zapisujemy wpis, który sprawdzi człowiek. Nic nie dzieje się z tego powodu automatycznie.',
            '**Zgłoszenia i blokady:** zobacz „Zgłoszenia i blokady” poniżej.',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: 'Dane o korzystaniu',
      blocks: [
        'Aby zrozumieć, jak korzysta się z gry, aplikacja przesyła zdarzenia na nasz serwer. Każde zdarzenie ma własny losowy identyfikator i czas z twojego telefonu; serwer dodaje czas, w którym je otrzymał.',
        'Każda wysyłka zawiera też **identyfikator instalacji**: losową liczbę tworzoną przy pierwszym uruchomieniu i przechowywaną w aplikacji. Nie opiera się on na danych twojego urządzenia i znika po odinstalowaniu aplikacji. Razem z nim przesyłane są system (iOS lub Android) i wersja aplikacji.',
        'Po zalogowaniu zdarzenia i instalacja są powiązane z twoim kontem. Bez połączenia zdarzenia czekają na twoim telefonie i są wysyłane później.',
        'Zdarzenia:',
        { table: { head: ['Zdarzenie', 'Kiedy', 'Co zawiera'], rows: eventRows() } },
        'Te same zdarzenia trafiają też do **Google Analytics for Firebase**, które dodaje identyfikator instalacji aplikacji, dane urządzenia i systemu, dane o korzystaniu (na przykład długość sesji) oraz przybliżoną lokalizację (kraj i region), którą Google ustala na podstawie adresu IP. Mamy je skonfigurowane bez funkcji reklamowych: bez identyfikatora reklamowego i bez personalizacji reklam.',
      ],
    },
    {
      id: 'crashes',
      title: 'Raporty o awariach i błędach',
      blocks: [
        {
          list: [
            '**W aplikacji, Firebase Crashlytics od Google:** gdy aplikacja ulega awarii lub napotyka błąd, wysyłany jest raport ze szczegółami błędu, modelem urządzenia, wersjami systemu i aplikacji, identyfikatorem instalacji Crashlytics oraz, po zalogowaniu, naszym identyfikatorem konta. Bez twojego adresu e-mail i nazwy.',
            '**Na serwerze, Sentry:** gdy serwer napotyka błąd, wysyłany jest techniczny raport na jego temat, czasem z identyfikatorem konta, którego dotyczy. Bez adresów e-mail i bez haseł.',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'Adres IP',
      blocks: [
        'Gdy aplikacja się łączy, nasz serwer widzi twój adres IP. Używamy go **wyłącznie w pamięci serwera**, aby ograniczać liczbę zapytań i chronić przed ich zalewem, i nie zapisujemy go w naszej bazie danych.',
        'Nasz dostawca hostingu może przez krótki czas przechowywać zwykłe logi dostępu.',
      ],
    },
    {
      id: 'device',
      title: 'Co zostaje tylko na twoim telefonie',
      blocks: [
        {
          list: [
            'Twoje partie treningowe i ich historia.',
            'Twoje postępy w treningu etapowym: gwiazdki, podejścia i otwarte przez ciebie bramy (kopia jest przechowywana także na serwerze: zobacz „Partie i postępy”).',
            'Twoje ustawienia: dźwięk, wibracje, ograniczenie ruchu i język.',
            'Kopia twojego profilu, żeby aplikacja otwierała się bez połączenia.',
            'Kolejki jeszcze niewysłanych zdarzeń i wyników treningu oraz identyfikator instalacji.',
            'Twoje dane logowania (przechowywane przez Firebase), a przy logowaniu przez Google także wybrane przez ciebie konto (przechowywane przez Usługi Google Play, dopóki się nie wylogujesz).',
          ],
        },
        'Wszystko to jest usuwane po odinstalowaniu aplikacji. Wylogowanie usuwa kopię profilu. Usunięcie konta nie usuwa partii treningowych ani postępów w treningu etapowym z twojego telefonu: aby usunąć także je, odinstaluj aplikację.',
      ],
    },
    {
      id: 'not-collected',
      title: 'Czego nie zbieramy',
      blocks: [
        'Kontaktów, zdjęć, mikrofonu, aparatu, dokładnej lokalizacji, identyfikatorów reklamowych ani danych płatniczych. W grze nie ma czatu: reakcje to emoji z ustalonej listy.',
      ],
    },
    {
      id: 'public',
      title: 'Co widzą inni gracze',
      blocks: [
        {
          list: [
            'Twoją nazwę wyświetlaną, awatar, kraj (jako flagę), rankingi, poziom i osiągnięcia.',
            'Na twojej karcie gracza i w tabelach wyników: liczbę partii, odsetek wygranych, serie, najlepszy ruch, średnią liczbę błędów, ostatnie wyniki, zakłócenie, które wysyłasz najczęściej, i datę dołączenia (miesiąc i rok).',
            'W trakcie partii: twoje punkty, błędy, zakłócenia i reakcje oraz to, czy jesteś online.',
            'W pokoju do gry ze znajomymi: każdy, kto ma jego kod lub link i wejdzie do pokoju, widzi nazwę, awatar, flagę i ogólny ranking wszystkich osób w pokoju oraz to, czy są w nim w tej chwili. Sam kod i sam link nie zawierają żadnych danych osobowych.',
            'Powtórki i szczegóły partii: widzą je tylko gracze tej partii.',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: 'Zgłoszenia i blokady',
      blocks: [
        {
          list: [
            '**Zgłaszanie gracza:** gdy kogoś zgłaszasz, przechowujemy autora zgłoszenia, zgłoszonego gracza, powód (obraźliwa nazwa, oszukiwanie lub inne), partię rankingową, jeśli zgłoszenie z niej pochodzi, oraz czas zgłoszenia. Zgłoszenie nie zawiera dowolnego tekstu. Zgłoszony gracz nie dowiaduje się, kto go zgłosił.',
            '**Blokowanie:** przechowujemy zablokowanych przez ciebie graczy i czas blokady. Dzięki temu nie trafiasz z nimi do tej samej partii, a ich reakcje nie są ci pokazywane. Nikt nie jest powiadamiany o zablokowaniu, a blokada nikogo nie ukrywa w tabelach wyników.',
            '**Rozpatrywanie zgłoszeń:** operator gry sprawdza każde zgłoszenie w ciągu 48 godzin. Może zastąpić obraźliwą nazwę tymczasową (gracz jest wtedy proszony o wybranie nowej nazwy) albo zawiesić konto w zakresie partii rankingowych i zmian w koncie. Każde takie działanie trafia do wewnętrznego dziennika, wraz z adresem administratora, który je podjął, a przy zastąpieniu nazwy także ze starą i nową nazwą. Nazwa zastąpiona w ten sposób trafia na listę nazw, których nikt nie może ponownie wybrać (sama nazwa, niepowiązana z żadnym graczem).',
            '**Usunięcie zawieszonego konta:** usunięcie konta nie znosi zawieszenia. Gdy zawieszone konto zostaje usunięte, przechowujemy jednokierunkowy odcisk (hash) jego identyfikatora logowania i zweryfikowanego adresu e-mail, a nie sam identyfikator ani sam adres. Nowe konto z tymi samymi danymi logowania zaczyna jako zawieszone, dopóki administrator go nie sprawdzi, a odcisk jest wtedy usuwany. Jest to nasz prawnie uzasadniony interes, a także interes każdego gracza, w zapewnieniu uczciwej gry.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: 'Do czego używamy danych',
      blocks: [
        {
          list: [
            '**Do prowadzenia gry:** twoje konto, partie, rankingi, dobieranie przeciwników, historia i tabele wyników. Jest to niezbędne do wykonania naszej umowy z tobą (Warunków korzystania).',
            '**Bezpieczeństwo i uczciwa gra:** limity zapytań, wykrywanie anomalii, zapobieganie oszustwom oraz rozpatrywanie zgłoszeń i blokad. Jest to nasz prawnie uzasadniony interes, a także interes każdego gracza.',
            '**Do ulepszania gry:** aby wiedzieć, które ekrany są używane i w które tryby się gra, znajdować problemy i naprawiać awarie. To również prawnie uzasadniony interes, bez reklam i bez profilu marketingowego.',
            '**E-maile serwisowe:** wyłącznie weryfikacja adresu i resetowanie hasła.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Komu udostępniamy dane',
      blocks: [
        '**Nie sprzedajemy** danych i nie przekazujemy ich reklamodawcom ani brokerom danych. Nasi dostawcy usług przetwarzają je wyłącznie w naszym imieniu:',
        {
          list: [
            '**Google (Firebase):** logowanie (Authentication, w tym logowanie przez Google), raporty o awariach (Crashlytics) i dane o korzystaniu (Analytics).',
            '**Fly.io:** hosting serwera.',
            '**Neon:** baza danych (PostgreSQL).',
            '**Sentry:** raporty o błędach serwera.',
          ],
        },
        'Ujawnimy też dane, gdy wymaga tego prawo, albo w celu ochrony gry i jej graczy. Jeśli gra przejdzie na innego właściciela, dane przejdą razem z nią, a niniejsza polityka nadal będzie się do nich stosować.',
      ],
    },
    {
      id: 'transfers',
      title: 'Gdzie są dane',
      blocks: [
        'Serwer i baza danych znajdują się obecnie w Unii Europejskiej (Frankfurt, Niemcy). Google i Sentry mogą też przetwarzać dane w Stanach Zjednoczonych i w innych krajach, stosując własne zabezpieczenia przekazywania danych (takie jak standardowe klauzule umowne UE).',
      ],
    },
    {
      id: 'retention',
      title: 'Jak długo przechowujemy dane',
      blocks: [
        {
          list: [
            '**Dane konta:** tak długo, jak istnieje konto.',
            '**Gdy usuwasz konto:** twój adres e-mail, kraj, awatar i powiązanie z danymi logowania są usuwane od razu, a twoja nazwa wyświetlana zostaje zastąpiona anonimowym identyfikatorem (stara nazwa od razu znów staje się dostępna). Usuwane są też twoje dane logowania w Firebase, razem z tym, co Firebase przechowywał z Google. Jeśli logujesz się przez Google, aplikacja cofa też dostęp do twojego konta Google, który jej przyznano.',
            '**Postępy w treningu etapowym:** kopia na serwerze (twoje gwiazdki w każdym etapie i XP przyznane za etapy każdego dnia) jest usuwana razem z kontem. Kopia na twoim telefonie zostaje do czasu odinstalowania aplikacji.',
            '**Co zostaje po usunięciu, anonimowo:** partie rankingowe, rankingi, XP, wyniki treningu, zapisy dotyczące uczciwej gry, wysłane przez ciebie zgłoszenia i dane o korzystaniu. Nie są już powiązane z tobą, ale partie, powtórki i tabele wyników innych graczy pozostają kompletne.',
            '**Zgłoszenia, blokady i dziennik administratorów:** blokada jest przechowywana, dopóki jej nie zdejmiesz albo nie usuniesz konta (wtedy znikają wszystkie jego blokady, w obie strony). Zgłoszenia i dziennik działań administratorów są przechowywane, dopóki są potrzebne do rozpatrywania zgłoszeń i dbania o bezpieczeństwo i uczciwość gry; co jakiś czas je przeglądamy i usuwamy stare. Gdy konto zostaje usunięte, otwarte zgłoszenia jego dotyczące są zamykane, a jego nazwy są usuwane z dziennika administratorów. Jeśli było zawieszone, zostaje tylko opisany wyżej jednokierunkowy odcisk, do czasu utworzenia nowego konta z tymi samymi danymi logowania albo do usunięcia go przez nas podczas okresowego przeglądu.',
            '**Dane o korzystaniu:** przechowywane, dopóki pomagają nam zrozumieć, jak korzysta się z gry. Co jakiś czas je przeglądamy i usuwamy stare dane.',
            '**Crashlytics:** Google przechowuje raporty o awariach do 90 dni. **Analytics:** przez okres przechowywania ustawiony przez nas w Firebase.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: 'Twoje prawa',
      blocks: [
        'Możesz poprosić o wgląd w swoje dane, o ich poprawienie (nazwę, awatar i kraj możesz zmienić w aplikacji) lub usunięcie (usuń konto w aplikacji) albo sprzeciwić się ich wykorzystywaniu. Napisz do nas na adres {email}, a odpowiemy w ciągu 30 dni.',
        'Możesz też złożyć skargę do izraelskiego Urzędu Ochrony Prywatności albo do organu ochrony danych w twoim kraju.',
      ],
    },
    {
      id: 'children',
      title: 'Dzieci',
      blocks: [
        'Gra nie jest przeznaczona dla dzieci poniżej 13 lat i świadomie nie zbieramy danych na ich temat. Jeśli dowiemy się, że dziecko poniżej 13 lat założyło konto, usuniemy to konto. Tam, gdzie minimalny wiek jest wyższy, do jego osiągnięcia potrzebna jest zgoda rodzica.',
      ],
    },
    {
      id: 'security',
      title: 'Bezpieczeństwo',
      blocks: [
        'Ruch między aplikacją a serwerem jest szyfrowany (HTTPS i WSS). Hasła obsługuje Firebase i nie przechowujemy ich u siebie. Dostęp do danych na serwerze ma tylko operator gry. Żaden system nie jest w pełni bezpieczny, ale dokładamy rozsądnych starań, aby chronić twoje dane.',
      ],
    },
    {
      id: 'changes',
      title: 'Zmiany tej polityki',
      blocks: [
        'Gdy ta polityka się zmienia, aktualizujemy tutaj datę. O istotnych zmianach poinformujemy też w aplikacji.',
      ],
    },
    {
      id: 'contact',
      title: 'Kontakt',
      blocks: ['{operator} · {email}', 'Zobacz też [Warunki korzystania](terms).'],
    },
  ],
};

export const TERMS_PL: LegalDoc = {
  title: 'Warunki korzystania',
  lead: 'Zasady korzystania z Sudoku Fight. Korzystanie z gry oznacza ich akceptację.',
  sections: [
    {
      id: 'acceptance',
      title: 'Akceptacja',
      blocks: [
        'Niniejsze warunki dotyczą aplikacji Sudoku Fight i jej usług („gra”), prowadzonych przez {operator} („my”). Rejestrując się w grze lub korzystając z niej, akceptujesz te warunki oraz [Politykę prywatności](privacy).',
      ],
    },
    {
      id: 'eligibility',
      title: 'Kto może grać',
      blocks: [
        'Musisz mieć co najmniej 13 lat albo minimalny wiek określony przez prawo twojego kraju, jeśli jest on wyższy. Jeśli masz mniej niż 18 lat, potrzebujesz zgody rodzica lub opiekuna prawnego.',
      ],
    },
    {
      id: 'account',
      title: 'Twoje konto',
      blocks: [
        {
          list: [
            'Jedno konto na osobę, z twoim własnym adresem e-mail.',
            'Chroń swoje hasło (lub konto Google, którym się logujesz). Odpowiadasz za wszystko, co dzieje się na twoim koncie.',
            'Konto możesz usunąć w każdej chwili w aplikacji: Ustawienia → Usuń konto.',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: 'Nazwy wyświetlane i zachowanie',
      blocks: [
        'Twoja nazwa wyświetlana, awatar i kraj są widoczne dla wszystkich graczy. Nazwa nie może:',
        {
          list: [
            'być obraźliwa, rasistowska, o treści seksualnej, zawierać gróźb ani obelg;',
            'podszywać się pod inną osobę, innego gracza ani pracowników gry;',
            'zawierać danych osobowych (numeru telefonu, adresu), reklam ani linków.',
          ],
        },
        'Nazwy są automatycznie sprawdzane pod kątem listy zakazanych słów. Możemy zmienić nazwę, która narusza te zasady, poprosić o nową albo zawiesić konto.',
        'Reakcje w grze to emoji z ustalonej listy. W trakcie partii możesz wyciszyć przeciwnika z poziomu jego karty, a także go zablokować lub zgłosić (następna sekcja).',
      ],
    },
    {
      id: 'reports',
      title: 'Zgłaszanie i blokowanie',
      blocks: [
        'Możesz zgłosić gracza z jego karty lub z partii, podając jeden z trzech powodów: obraźliwa nazwa, oszukiwanie lub inne. **Sprawdzamy każde zgłoszenie w ciągu 48 godzin.**',
        'Jeśli zasady zostały naruszone, możemy zastąpić nazwę tymczasową (gracz jest wtedy proszony o wybranie nowej nazwy, a zasada 30 dni nie dotyczy tego wyboru), zawiesić konto w zakresie partii rankingowych i zmian w koncie do czasu zniesienia zawieszenia albo je zamknąć. Nazwy zastąpionej w ten sposób nie można wybrać ponownie. Zawieszone konto nadal można w każdej chwili usunąć, ale jego usunięcie nie znosi zawieszenia: nowe konto z tymi samymi danymi logowania zaczyna jako zawieszone, dopóki go nie sprawdzimy.',
        'Możesz też zablokować gracza: nie trafisz z nim do tej samej partii, a jego reakcje nie będą ci pokazywane. Aby zdjąć blokadę: Ustawienia → Zablokowani gracze. Blokada nikogo nie ukrywa w tabelach wyników.',
        'Nie zgłaszaj bez powodu: powtarzające się fałszywe zgłoszenia naruszają te warunki.',
      ],
    },
    {
      id: 'fair-play',
      title: 'Uczciwa gra',
      blocks: [
        'Nie wolno ci:',
        {
          list: [
            'używać programów rozwiązujących sudoku, botów, skryptów, automatyzacji ani zmodyfikowanej aplikacji;',
            'utrzymywać kilku kont, aby wpływać na rankingi, ustawiać wyników z innym graczem ani celowo przegrywać;',
            'wykorzystywać błędów gry zamiast je zgłaszać;',
            'przeciążać naszych serwerów, próbować się do nich włamać ani przeszkadzać innym graczom.',
          ],
        },
        'Serwer oznacza nietypowe partie do sprawdzenia. Jeśli zasady zostały naruszone, możemy anulować wyniki, zresetować rankingi albo zawiesić i zamknąć konto.',
      ],
    },
    {
      id: 'virtual',
      title: 'Rankingi, XP i osiągnięcia',
      blocks: [
        'Rankingi, XP, poziomy i osiągnięcia nie mają wartości pieniężnej i nie można ich przenosić ani sprzedawać. Możemy zmienić sposób ich obliczania albo je wyzerować (na przykład na początku sezonu).',
        'Gra jest darmowa. Ta wersja nie zawiera zakupów ani reklam.',
      ],
    },
    {
      id: 'service',
      title: 'Dostępność',
      blocks: [
        'Partie rankingowe wymagają połączenia z internetem. Gdy nie ma dostępnych graczy, możesz trafić na przeciwnika sterowanego przez komputer, który gra w tempie zbliżonym do twojego. Takie partie liczą się do twojego rankingu. Gra może też zaproponować partię treningową z botem, bez rankingu. Jeśli serwer zostanie ponownie uruchomiony w trakcie partii rankingowej, ta partia kończy się bez zmiany rankingu.',
        'Możemy zmieniać, wstrzymywać lub wyłączać części gry i postaramy się z wyprzedzeniem informować o istotnych zmianach.',
      ],
    },
    {
      id: 'ip',
      title: 'Własność intelektualna',
      blocks: [
        'Gra, jej projekt graficzny, kod, dźwięki i awatary należą do nas lub do tych, którzy udzielili nam na nie licencji. Udzielamy ci osobistej, niewyłącznej i niekomercyjnej licencji na korzystanie z gry zgodnie z niniejszymi warunkami. Licencje stron trzecich są wymienione w aplikacji: Ustawienia → Licencje.',
      ],
    },
    {
      id: 'stores',
      title: 'Sklepy z aplikacjami',
      blocks: [
        'Apple i Google nie są stronami niniejszych warunków i nie odpowiadają za grę. Jeśli gra została pobrana z App Store, obowiązuje też Standardowa umowa licencyjna użytkownika końcowego Apple (EULA), a Apple oraz spółki zależne Apple mogą egzekwować niniejsze warunki jako uprawnione osoby trzecie.',
      ],
    },
    {
      id: 'disclaimer',
      title: 'Wyłączenie odpowiedzialności',
      blocks: [
        'Gra jest udostępniana „w takim stanie, w jakim jest”. W zakresie dozwolonym przez prawo nie gwarantujemy, że będzie działać bez przerw i błędów, i nie odpowiadamy za szkody pośrednie, utratę danych ani utratę rankingów. Nic w niniejszych warunkach nie ogranicza praw, które przysługują ci z mocy prawa i których nie można się zrzec.',
      ],
    },
    {
      id: 'termination',
      title: 'Zakończenie',
      blocks: [
        'Możesz w każdej chwili przestać grać i usunąć konto. Możemy zawiesić lub zamknąć konto, które narusza niniejsze warunki.',
      ],
    },
    {
      id: 'changes',
      title: 'Zmiany niniejszych warunków',
      blocks: [
        'Gdy te warunki się zmieniają, aktualizujemy tutaj datę. O istotnych zmianach poinformujemy też w aplikacji. Korzystanie z gry po zmianie oznacza akceptację nowych warunków.',
      ],
    },
    {
      id: 'law',
      title: 'Prawo właściwe',
      blocks: [
        'Niniejsze warunki podlegają prawu Państwa Izrael, a wyłączną jurysdykcję mają właściwe sądy dystryktu Tel Awiwu, chyba że prawo twojego kraju przyznaje ci prawo, którego nie można się zrzec.',
      ],
    },
    {
      id: 'contact',
      title: 'Kontakt',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_PL: LegalDoc = {
  title: 'Usuwanie konta',
  lead: 'Jak usunąć konto Sudoku Fight i co się dzieje z twoimi danymi.',
  sections: [
    {
      id: 'in-app',
      title: 'W aplikacji (od razu)',
      blocks: [
        {
          list: [
            'Otwórz Sudoku Fight i wejdź w **Ustawienia**.',
            'Dotknij **Usuń konto** i potwierdź.',
            'Wpisz hasło albo, jeśli logujesz się przez Google, ponownie wybierz swoje konto Google. Konto zostaje od razu usunięte, a aplikacja wraca do ekranu logowania.',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: 'Bez aplikacji',
      blocks: [
        'Napisz do nas na adres {email} **z adresu e-mail swojego konta**, z tematem „Usuń moje konto” i swoją nazwą wyświetlaną. Upewnimy się, że prośba pochodzi od właściciela konta, i usuniemy je w ciągu 30 dni. Gdy to zrobimy, potwierdzimy to e-mailem.',
      ],
    },
    {
      id: 'what',
      title: 'Co jest usuwane, a co zostaje',
      blocks: [
        {
          list: [
            '**Usuwane od razu:** twój adres e-mail, kraj, awatar, twoje dane logowania (także w Firebase) oraz powiązanie twojego konta z twoimi instalacjami. Twoja nazwa wyświetlana zostaje zastąpiona anonimowym identyfikatorem i staje się dostępna dla innych.',
            '**Zachowywane anonimowo:** partie rankingowe, rankingi, XP, wyniki treningu, zapisy dotyczące uczciwej gry i dane o korzystaniu. Nie są już powiązane z tobą, ale partie i tabele wyników innych graczy pozostają kompletne.',
            '**Na twoim telefonie:** partie treningowe na twoim telefonie zostają do czasu odinstalowania aplikacji.',
            '**W Google:** raporty o awariach są przechowywane do 90 dni, a dane Analytics przez ustawiony okres przechowywania.',
          ],
        },
        'Więcej w [Polityce prywatności](privacy).',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_PL: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_PL,
  terms: TERMS_PL,
  'delete-account': DELETE_ACCOUNT_PL,
};

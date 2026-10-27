import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in French (D112): a translation of the English version (privacy.ts, terms.ts,
 * deleteAccount.ts, render.ts LEGAL_CHROME.en), with the same sections, anchors, links, marks, contact
 * placeholders and numbers (legal.test.ts `skeleton`). French of France, tu (docs/i18n/style/fr.md); terms from
 * docs/i18n/glossary.csv (partie, adversaire, classement, classée, salon, case, grille, signalement, blocage,
 * perturbation, entraînement, étape, niveau, replay, réaction). A no-break space (U+00A0) stands before every
 * colon, semicolon, question mark and exclamation mark, and inside the French quotation marks. The page opens
 * with TRANSLATION_NOTICE_FR: the English version prevails.
 *
 * App labels quoted here (they must equal the app's fr strings): Réglages (home:settings.title),
 * Supprimer le compte (account:settings.deleteAccount), Joueurs bloqués (moderation:blocked.settingsRow),
 * Licences (home:settings.licenses), Politique de confidentialité (home:settings.privacy), Conditions
 * d’utilisation (home:settings.terms), adversaires récents (progress:leaderboard.caption.friends, lowercased).
 *
 * A registration step is a "phase" here, never an "étape": étape is a stage of staged practice, in the same
 * events table.
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_FR =
  'Ceci est une traduction de la version anglaise. En cas de divergence, la version anglaise prévaut.';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_FR: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: 'Langue',
  contents: 'Sommaire',
  documents: 'Documents',
  updated: 'Dernière mise à jour :',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[nom de l’exploitant]',
  draft:
    'Brouillon : les coordonnées ne sont pas encore configurées sur le serveur (LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME).',
  translationNotice: TRANSLATION_NOTICE_FR,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, `fr`): [what happens, what it carries]. */
export const EVENT_DETAILS_FR: Record<TelemetryEventName, [string, string]> = {
  app_open: ['L’application s’ouvre', '—'],
  screen_view: ['Un écran s’ouvre', 'Le nom de l’écran (son modèle de route, sans identifiants)'],
  register_step: ['Une phase de l’inscription s’ouvre', 'La phase'],
  register_complete: ['L’inscription est terminée', '—'],
  game_start: [
    'Une partie commence',
    'Le mode, le type de partie, le nombre de joueurs, et s’il s’agit d’une partie entre amis',
  ],
  game_end: [
    'Une partie se termine',
    'Le mode, le résultat, les points, le nombre d’erreurs, la durée, et s’il s’agissait d’une partie entre amis',
  ],
  interference_sent: ['Tu envoies une perturbation', 'Son type et son coût'],
  reaction_sent: ['Tu envoies une réaction', 'Quel émoji'],
  matchmaking_wait: [
    'Une recherche d’adversaires se termine',
    'Les secondes d’attente, et si une partie a été trouvée',
  ],
  reconnect: ['Reconnexion après une coupure', 'Le temps que cela a pris, et si cela a fonctionné'],
  latency_sample: [
    'Une mesure de la qualité de la connexion',
    'Les temps de réponse du réseau, en millisecondes',
  ],
  replay_open: ['Un replay s’ouvre', 'Le mode de la partie'],
  account_delete: ['Le compte est supprimé', '—'],
  report_sent: ['Tu signales un joueur', 'Le motif seulement (ni qui a été signalé, ni la partie)'],
  level_map_open: [
    'La carte de l’entraînement par étapes s’ouvre',
    'L’étape actuelle et ton total d’étoiles',
  ],
  level_start: [
    'Une étape commence',
    'Le numéro et la version de l’étape, son chapitre et son type, le numéro de la tentative, tes meilleures étoiles jusque-là, et s’il s’agissait d’un démarrage rapide',
  ],
  level_end: [
    'Une étape se termine',
    'Le numéro, la version et le type de l’étape, les étoiles, tes meilleures étoiles avant elle, sa durée, la façon dont elle s’est terminée, le nombre d’erreurs, le résultat (temps, cases, avance ou points), le niveau du bot et le numéro de la tentative',
  ],
  level_quit: [
    'Une étape est quittée en cours de route (par exemple, l’application a été fermée)',
    'Le numéro et la version de l’étape, et depuis combien de temps elle était en cours',
  ],
  chapter_gate: [
    'Une tentative de franchir la porte du chapitre suivant',
    'Le chapitre derrière la porte, les étoiles du chapitre, et si la porte s’est ouverte',
  ],
  level_tutorial: ['Le « comment jouer » d’un type d’étape s’affiche', 'Le type, et si tu l’as passé'],
  friends_room_open: [
    'Un salon pour jouer entre amis est ouvert',
    'Le type de partie, et la façon dont le salon a été ouvert',
  ],
  friends_room_join: [
    'Une tentative de rejoindre un salon d’amis',
    'Comment (un code ou un lien), et comment cela s’est terminé (réussite, ou raison de l’échec)',
  ],
  friends_invite_share: [
    'Le lien d’un salon est partagé',
    'Si c’est l’hôte ou un invité qui l’a partagé (ni le code, ni avec qui)',
  ],
  friends_link_open: ['Un lien de salon ouvre l’application', 'Si ta session était ouverte'],
  friends_room_start: [
    'Une partie entre amis commence',
    'Le nombre de joueurs, et combien de secondes tu as attendu dans le salon',
  ],
  friends_room_close: [
    'Tu te retrouves hors d’un salon avant le début de sa partie',
    'La raison, combien de joueurs étaient dans le salon, et combien de secondes tu as attendu',
  ],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_FR) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_FR[name],
  ]);

export const PRIVACY_FR: LegalDoc = {
  title: 'Politique de confidentialité',
  lead: 'Ce que Sudoku Fight collecte, pourquoi, qui le voit, combien de temps c’est conservé, et comment le supprimer.',
  sections: [
    {
      id: 'who',
      title: 'Qui sommes-nous',
      blocks: [
        'Sudoku Fight (« le jeu », « nous ») est un jeu de sudoku compétitif en temps réel exploité par {operator}.',
        'Pour toute question sur la confidentialité et tes données, écris-nous à {email}.',
      ],
    },
    {
      id: 'summary',
      title: 'En bref',
      blocks: [
        {
          list: [
            'Nous ne collectons que ce qui est nécessaire au fonctionnement du jeu : les informations de ton compte, tes parties, et des données d’utilisation qui nous aident à comprendre comment on joue au jeu et à corriger les problèmes.',
            '**Pas de publicité, et nous ne vendons pas de données.** Nous ne te suivons pas dans d’autres applications ou sur d’autres sites web.',
            'Ton nom affiché, ton avatar, ton pays, tes classements et tes statistiques sont visibles par les autres joueurs. Ton adresse e-mail n’est jamais montrée aux autres joueurs.',
            'Tu peux supprimer ton compte dans l’application à tout moment : Réglages → Supprimer le compte. Consulte la [page de suppression du compte](delete-account).',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: 'Informations du compte',
      blocks: [
        'Quand tu t’inscris, nous conservons :',
        {
          list: [
            '**Adresse e-mail :** pour te connecter, vérifier l’adresse, réinitialiser ton mot de passe et t’envoyer des messages concernant ton compte. Nous n’envoyons pas d’e-mails promotionnels.',
            '**Mot de passe** (si tu t’inscris avec une adresse e-mail et un mot de passe) : géré par Firebase Authentication de Google. Il n’arrive jamais sur nos serveurs, et nous ne pouvons pas le voir.',
            '**Connexion avec Google (facultative) :** tu peux t’inscrire et te connecter avec ton compte Google au lieu d’une adresse e-mail et d’un mot de passe. Firebase Authentication reçoit alors de Google l’adresse e-mail de ton compte Google (vérifiée par Google) et son identifiant Google, et les conserve avec ta connexion ; nous conservons l’adresse e-mail comme pour tout compte. Google transmet aussi à Firebase ton nom et ta photo de profil Google, que Firebase conserve avec la connexion. Notre serveur ne les stocke pas et ne les affiche pas : dans l’arène, seuls le nom et l’avatar que tu choisis apparaissent. Nous n’obtenons jamais ton mot de passe Google, ni l’accès à quoi que ce soit d’autre dans ton compte Google (contacts, e-mails, fichiers). Si tu préfères, inscris-toi avec une adresse e-mail et un mot de passe.',
            '**Nom affiché, pays et avatar :** tu les choisis, et ils sont montrés aux autres joueurs. Tu choisis toi-même le pays (la valeur par défaut vient des réglages de langue et de région de ton appareil). Nous n’utilisons pas la localisation de ton appareil.',
            '**La date de création du compte et celle du dernier changement de nom** (un nom peut être changé une fois tous les 30 jours).',
            '**Notre identifiant de compte**, et ton identifiant de connexion Firebase (en cas de connexion avec Google, Firebase conserve aussi l’identifiant de ton compte Google).',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: 'Parties et progression',
      blocks: [
        {
          list: [
            '**Parties classées** (conservées sur le serveur) : la grille, chaque coup avec le moment où il a été joué, les perturbations et les réactions que tu as envoyées, tes points, tes erreurs, ta place, ton classement avant et après, et la façon dont la partie s’est terminée. Elles constituent ton historique, tes replays et tes statistiques.',
            '**Parties entre amis** (dans un salon avec un code ; conservées sur le serveur comme une partie classée, mais sans classement) : les mêmes informations, sauf le classement. Elles apparaissent dans ton historique et dans tes replays, et les joueurs avec qui tu as joué apparaissent sous « adversaires récents ». Le code du salon, qui est dans le salon et qui en a été retiré ne sont conservés que dans la mémoire du serveur, jusqu’à la fermeture du salon.',
            '**Classements, XP, niveau et succès.**',
            '**Les grilles que tu as jouées, et contre qui :** pour que tu ne retombes pas sur la même grille ou le même adversaire encore et encore.',
            '**Ton rythme :** à la fin de chaque partie classée, nous calculons, à partir de tes coups, ton temps moyen par coup (en tenant compte de la difficulté de chaque case), et nous le conservons avec la partie, ainsi que le nombre de coups sur lequel il a été mesuré. À partir de ce rythme, de ton taux d’erreurs et de tes résultats contre des adversaires contrôlés par ordinateur, nous fixons le rythme d’un adversaire contrôlé par ordinateur quand aucun joueur n’est disponible (voir les [Conditions d’utilisation](terms)). Ton rythme n’est pas montré aux autres joueurs.',
            '**Résultats d’entraînement** (en solo ou contre un bot), quand l’application les envoie pour les XP : le mode, le type de partie, le résultat, le nombre de coups corrects, le moment où la partie s’est terminée, et les XP qu’elle a rapportés.',
            '**Entraînement par étapes :** quand l’application synchronise ta progression avec ton compte (pour que tu la retrouves aussi sur un nouveau téléphone) : tes meilleures étoiles à chaque étape, le nombre de fois où tu l’as jouée et le moment où cela a changé, et les XP que les étapes ont rapportés chaque jour.',
            '**Fair-play :** quand le rythme des coups dans une partie classée est anormalement rapide, un enregistrement est conservé pour qu’une personne l’examine. Rien ne se passe automatiquement à cause de cela.',
            '**Signalements et blocages :** voir « Signalements et blocages » ci-dessous.',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: 'Données d’utilisation',
      blocks: [
        'Pour comprendre comment le jeu est utilisé, l’application envoie des événements à notre serveur. Chaque événement a son propre identifiant aléatoire et l’heure de ton téléphone ; le serveur y ajoute l’heure à laquelle il l’a reçu.',
        'Chaque envoi contient aussi un **identifiant d’installation** : un nombre aléatoire créé au premier lancement et conservé dans l’application. Il ne repose pas sur les caractéristiques de ton appareil, et il disparaît quand tu désinstalles l’application. Il est accompagné du système (iOS ou Android) et de la version de l’application.',
        'Quand ta session est ouverte, les événements et l’installation sont associés à ton compte. Sans connexion réseau, les événements attendent sur ton téléphone et sont envoyés plus tard.',
        'Les événements :',
        { table: { head: ['Événement', 'Quand', 'Ce qu’il contient'], rows: eventRows() } },
        'Les mêmes événements sont aussi envoyés à **Google Analytics for Firebase**, qui ajoute un identifiant de l’installation de l’application, des informations sur l’appareil et le système, des données d’utilisation (comme la durée des sessions) et une localisation approximative (pays et région) que Google déduit de l’adresse IP. Nous l’avons configuré sans fonctionnalités publicitaires : pas d’identifiant publicitaire, et pas de personnalisation des annonces.',
      ],
    },
    {
      id: 'crashes',
      title: 'Rapports de plantage et d’erreurs',
      blocks: [
        {
          list: [
            '**Dans l’application, Firebase Crashlytics de Google :** quand l’application plante ou rencontre une erreur, un rapport est envoyé avec les détails de l’erreur, le modèle de l’appareil, les versions du système et de l’application, un identifiant d’installation Crashlytics, et notre identifiant de compte quand ta session est ouverte. Ni ton adresse e-mail ni ton nom.',
            '**Sur le serveur, Sentry :** quand le serveur rencontre une erreur, un rapport technique à son sujet est envoyé, parfois avec l’identifiant du compte concerné. Pas d’e-mails ni de mots de passe.',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'Adresse IP',
      blocks: [
        'Quand l’application se connecte, notre serveur voit ton adresse IP. Nous l’utilisons **uniquement dans la mémoire du serveur**, pour limiter la fréquence des requêtes et nous protéger contre les afflux massifs de requêtes, et nous ne la stockons pas dans notre base de données.',
        'Notre hébergeur peut conserver des journaux d’accès ordinaires pendant une courte durée.',
      ],
    },
    {
      id: 'device',
      title: 'Ce qui reste uniquement sur ton téléphone',
      blocks: [
        {
          list: [
            'Tes parties d’entraînement et leur historique.',
            'Ta progression dans l’entraînement par étapes : les étoiles, les tentatives et les portes que tu as ouvertes (une copie est aussi conservée sur le serveur : voir « Parties et progression »).',
            'Tes réglages : son, vibrations, réduction des animations et langue.',
            'Une copie de ton profil, pour que l’application s’ouvre sans connexion.',
            'Les files d’attente d’événements et de résultats d’entraînement pas encore envoyés, et l’identifiant d’installation.',
            'Ta connexion (conservée par Firebase) et, en cas de connexion avec Google, le compte que tu as choisi (conservé par les services Google Play jusqu’à ta déconnexion).',
          ],
        },
        'Tout cela est supprimé quand tu désinstalles l’application. La déconnexion supprime la copie du profil. Supprimer ton compte ne supprime pas les parties d’entraînement ni la progression de l’entraînement par étapes qui se trouvent sur ton téléphone : pour les supprimer aussi, désinstalle l’application.',
      ],
    },
    {
      id: 'not-collected',
      title: 'Ce que nous ne collectons pas',
      blocks: [
        'Les contacts, les photos, le microphone, l’appareil photo, la localisation précise, les identifiants publicitaires et les informations de paiement. Le jeu n’a pas de chat : les réactions sont des émojis d’une liste fixe.',
      ],
    },
    {
      id: 'public',
      title: 'Ce que voient les autres joueurs',
      blocks: [
        {
          list: [
            'Ton nom affiché, ton avatar, ton pays (sous forme de drapeau), tes classements, ton niveau et tes succès.',
            'Sur ta carte de joueur et dans les tableaux de classement : le nombre de parties, le taux de victoires, les séries, le meilleur coup, la moyenne d’erreurs, les résultats récents, la perturbation que tu envoies le plus, et ta date d’inscription (mois et année).',
            'Pendant une partie : tes points, tes erreurs, tes perturbations et tes réactions, et si tu es en ligne.',
            'Dans un salon pour jouer entre amis : toute personne qui a son code ou son lien et qui entre dans le salon voit le nom, l’avatar, le drapeau et le classement général de toutes les personnes qui s’y trouvent, et si elles sont dans le salon en ce moment. Le code et le lien eux-mêmes ne contiennent aucune information personnelle.',
            'Les replays et les détails d’une partie : seulement les joueurs de cette partie.',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: 'Signalements et blocages',
      blocks: [
        {
          list: [
            '**Signaler un joueur :** quand tu signales quelqu’un, nous conservons qui a fait le signalement, qui a été signalé, le motif (nom offensant, triche ou autre), la partie classée si le signalement en provient, et le moment du signalement. Un signalement ne contient pas de texte libre. Le joueur signalé n’apprend pas qui l’a signalé.',
            '**Bloquer :** nous conservons les joueurs que tu as bloqués et le moment du blocage. De ce fait, on ne te met pas dans la même partie qu’eux, et leurs réactions ne te sont pas montrées. Personne n’est informé de son blocage, et un blocage ne cache personne des tableaux de classement.',
            '**Traitement des signalements :** l’exploitant du jeu examine chaque signalement sous 48 heures. Il peut remplacer un nom offensant par un nom temporaire (il est alors demandé au joueur de choisir un nouveau nom), ou suspendre un compte des parties classées et des modifications du compte. Chacune de ces actions est inscrite dans un journal interne, avec l’adresse de l’administrateur qui l’a effectuée, ainsi que l’ancien et le nouveau nom quand un nom a été remplacé. Un nom remplacé de cette manière est ajouté à une liste de noms que personne ne peut plus choisir (le nom seul, sans lien avec aucun joueur).',
            '**Un compte suspendu qui est supprimé :** supprimer un compte ne lève pas une suspension. Quand un compte suspendu est supprimé, nous conservons une empreinte à sens unique (un hachage) de son identifiant de connexion et de son adresse e-mail vérifiée, et non l’identifiant ou l’adresse eux-mêmes. Un nouveau compte avec la même connexion est suspendu dès sa création jusqu’à ce qu’un administrateur l’examine, et l’empreinte est alors supprimée. C’est notre intérêt légitime, et celui de chaque joueur, en matière de fair-play.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: 'Pourquoi nous utilisons les données',
      blocks: [
        {
          list: [
            '**Pour faire fonctionner le jeu :** ton compte, tes parties, tes classements, la recherche d’adversaires, l’historique et les tableaux de classement. C’est nécessaire pour notre accord avec toi (les Conditions d’utilisation).',
            '**Sécurité et fair-play :** limites de fréquence, détection d’anomalies, prévention de la triche, et traitement des signalements et des blocages. C’est notre intérêt légitime, et celui de chaque joueur.',
            '**Pour améliorer le jeu :** savoir quels écrans et quels modes sont joués, trouver les problèmes et corriger les plantages. C’est aussi un intérêt légitime, sans publicité et sans profil marketing.',
            '**E-mails de service :** vérification de l’adresse et réinitialisation du mot de passe uniquement.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Avec qui nous les partageons',
      blocks: [
        'Nous **ne vendons pas** de données, et nous ne les transmettons pas à des annonceurs ni à des courtiers en données. Nos prestataires de services les traitent uniquement pour notre compte :',
        {
          list: [
            '**Google (Firebase) :** connexion (Authentication, y compris la connexion avec Google), rapports de plantage (Crashlytics) et données d’utilisation (Analytics).',
            '**Fly.io :** hébergement du serveur.',
            '**Neon :** la base de données (PostgreSQL).',
            '**Sentry :** rapports d’erreurs du serveur.',
          ],
        },
        'Nous divulguerons aussi des données lorsque la loi l’exige, ou pour protéger le jeu et ses joueurs. Si le jeu passe à un autre propriétaire, les données le suivent, et la présente politique continue de s’y appliquer.',
      ],
    },
    {
      id: 'transfers',
      title: 'Où se trouvent les données',
      blocks: [
        'Le serveur et la base de données se trouvent actuellement dans l’Union européenne (Francfort, Allemagne). Google et Sentry peuvent aussi traiter des données aux États-Unis et dans d’autres pays, dans le cadre de leurs propres garanties pour les transferts de données (comme les clauses contractuelles types de l’UE).',
      ],
    },
    {
      id: 'retention',
      title: 'Combien de temps nous les conservons',
      blocks: [
        {
          list: [
            '**Informations du compte :** tant que le compte existe.',
            '**Quand tu supprimes ton compte :** ton adresse e-mail, ton pays, ton avatar et le lien avec ta connexion sont supprimés immédiatement, et ton nom affiché est remplacé par un identifiant anonyme (l’ancien nom redevient libre immédiatement). Ta connexion Firebase est aussi supprimée, avec ce qu’elle conservait de Google. Si tu te connectais avec Google, l’application révoque aussi l’accès qui lui avait été accordé à ton compte Google.',
            '**Progression de l’entraînement par étapes :** la copie sur le serveur (tes étoiles à chaque étape, et les XP que les étapes ont rapportés chaque jour) est supprimée avec le compte. La copie sur ton téléphone reste jusqu’à ce que tu désinstalles l’application.',
            '**Ce qui reste après la suppression, de façon anonyme :** les parties classées, les classements, les XP, les résultats d’entraînement, les enregistrements de fair-play, les signalements que tu as envoyés et les données d’utilisation. Ils ne sont plus liés à toi, mais les parties, les replays et les tableaux de classement des autres joueurs restent complets.',
            '**Signalements, blocages et journal d’administration :** un blocage est conservé jusqu’à ce que tu le lèves ou que tu supprimes ton compte (tous ses blocages sont alors supprimés, dans les deux sens). Les signalements et le journal des actions des administrateurs sont conservés tant qu’ils sont nécessaires pour traiter les signalements et garder le jeu sûr et équitable ; nous les examinons de temps en temps et supprimons les anciens. Quand un compte est supprimé, les signalements ouverts le concernant sont clos, et ses noms sont retirés du journal d’administration. S’il était suspendu, seule l’empreinte à sens unique décrite plus haut reste, jusqu’à ce qu’un nouveau compte avec la même connexion soit créé ou que nous la supprimions lors d’un examen périodique.',
            '**Données d’utilisation :** conservées tant qu’elles nous aident à comprendre comment le jeu est utilisé. Nous les examinons de temps en temps et supprimons les anciennes données.',
            '**Crashlytics :** Google conserve les rapports de plantage jusqu’à 90 jours. **Analytics :** pendant la durée de conservation que nous avons définie dans Firebase.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: 'Tes droits',
      blocks: [
        'Tu peux demander à voir tes données, à les corriger (tu peux changer ton nom, ton avatar et ton pays dans l’application), à les supprimer (en supprimant ton compte dans l’application), ou t’opposer à leur utilisation. Écris-nous à {email}, et nous te répondrons sous 30 jours.',
        'Tu peux aussi déposer une plainte auprès de l’Autorité de protection de la vie privée d’Israël, ou auprès de l’autorité de protection des données de ton pays.',
      ],
    },
    {
      id: 'children',
      title: 'Enfants',
      blocks: [
        'Le jeu n’est pas destiné aux enfants de moins de 13 ans, et nous ne collectons pas sciemment de données les concernant. Si nous apprenons qu’un enfant de moins de 13 ans a ouvert un compte, nous le supprimerons. Là où l’âge minimum est plus élevé, le consentement d’un parent est nécessaire jusqu’à cet âge.',
      ],
    },
    {
      id: 'security',
      title: 'Sécurité',
      blocks: [
        'Les échanges entre l’application et le serveur sont chiffrés (HTTPS et WSS). Les mots de passe sont gérés par Firebase et ne sont pas stockés chez nous. L’accès aux données sur le serveur est limité à l’exploitant du jeu. Aucun système n’est parfaitement sûr, mais nous faisons des efforts raisonnables pour protéger tes données.',
      ],
    },
    {
      id: 'changes',
      title: 'Modifications de cette politique',
      blocks: [
        'Quand cette politique change, nous mettons à jour la date ici. Nous annoncerons aussi les modifications importantes dans l’application.',
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: ['{operator} · {email}', 'Voir aussi les [Conditions d’utilisation](terms).'],
    },
  ],
};

export const TERMS_FR: LegalDoc = {
  title: 'Conditions d’utilisation',
  lead: 'Les règles d’utilisation de Sudoku Fight. Utiliser le jeu signifie que tu les acceptes.',
  sections: [
    {
      id: 'acceptance',
      title: 'Acceptation',
      blocks: [
        'Les présentes conditions s’appliquent à l’application Sudoku Fight et à ses services (« le jeu »), exploités par {operator} (« nous »). En t’inscrivant ou en utilisant le jeu, tu acceptes ces conditions et la [Politique de confidentialité](privacy).',
      ],
    },
    {
      id: 'eligibility',
      title: 'Qui peut jouer',
      blocks: [
        'Tu dois avoir au moins 13 ans, ou l’âge minimum fixé par la loi de ton pays s’il est plus élevé. Si tu as moins de 18 ans, il te faut le consentement d’un parent ou d’un tuteur.',
      ],
    },
    {
      id: 'account',
      title: 'Ton compte',
      blocks: [
        {
          list: [
            'Un compte par personne, avec ta propre adresse e-mail.',
            'Garde en sécurité ton mot de passe (ou le compte Google avec lequel tu te connectes). Tu es responsable de tout ce qui est fait avec ton compte.',
            'Tu peux supprimer ton compte à tout moment dans l’application : Réglages → Supprimer le compte.',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: 'Noms affichés et comportement',
      blocks: [
        'Ton nom affiché, ton avatar et ton pays sont visibles par tous les joueurs. Un nom ne doit pas :',
        {
          list: [
            'être offensant, raciste, sexuel, menaçant ou insultant ;',
            'usurper l’identité d’une autre personne, d’un autre joueur ou de l’équipe du jeu ;',
            'contenir des informations personnelles (un numéro de téléphone, une adresse), de la publicité ou un lien.',
          ],
        },
        'Les noms sont vérifiés automatiquement à l’aide d’une liste de mots interdits. Nous pouvons changer un nom qui enfreint ces règles, en demander un nouveau, ou suspendre le compte.',
        'Les réactions dans le jeu sont des émojis d’une liste fixe. Tu peux mettre un adversaire en sourdine depuis sa carte pendant une partie, le bloquer ou le signaler (section suivante).',
      ],
    },
    {
      id: 'reports',
      title: 'Signalement et blocage',
      blocks: [
        'Tu peux signaler un joueur depuis sa carte ou depuis la partie, pour l’un de ces trois motifs : nom offensant, triche ou autre. **Nous examinons chaque signalement sous 48 heures.**',
        'Si les règles ont été enfreintes, nous pouvons remplacer le nom par un nom temporaire (il est alors demandé au joueur de choisir un nouveau nom, et la règle des 30 jours ne s’applique pas à ce choix), suspendre le compte des parties classées et des modifications du compte jusqu’à la levée de la suspension, ou le fermer. Un nom remplacé de cette manière ne peut pas être choisi à nouveau. Un compte suspendu peut quand même être supprimé à tout moment, mais sa suppression ne lève pas la suspension : un nouveau compte avec la même connexion est suspendu dès sa création jusqu’à ce que nous l’examinions.',
        'Tu peux aussi bloquer un joueur : on ne te mettra pas dans la même partie que lui, et ses réactions ne te seront pas montrées. Lève un blocage dans Réglages → Joueurs bloqués. Un blocage ne cache personne des tableaux de classement.',
        'Ne signale personne sans raison : les faux signalements répétés enfreignent les présentes conditions.',
      ],
    },
    {
      id: 'fair-play',
      title: 'Fair-play',
      blocks: [
        'Tu ne dois pas :',
        {
          list: [
            'utiliser des solveurs de sudoku, des bots, des scripts, de l’automatisation ou une application modifiée ;',
            'avoir plusieurs comptes pour influencer les classements, arranger des résultats avec un autre joueur, ou perdre exprès ;',
            'exploiter des bugs au lieu de les signaler ;',
            'surcharger nos serveurs, tenter de t’y introduire, ou gêner les autres joueurs.',
          ],
        },
        'Le serveur marque les parties inhabituelles pour qu’elles soient examinées. Si les règles ont été enfreintes, nous pouvons annuler des résultats, réinitialiser des classements, ou suspendre et fermer le compte.',
      ],
    },
    {
      id: 'virtual',
      title: 'Classements, XP et succès',
      blocks: [
        'Les classements, les XP, les niveaux et les succès n’ont aucune valeur monétaire, et ne peuvent être ni transférés ni vendus. Nous pouvons modifier leur mode de calcul ou les réinitialiser (par exemple, au début d’une saison).',
        'Le jeu est gratuit. Cette version ne contient ni achats ni publicités.',
      ],
    },
    {
      id: 'service',
      title: 'Disponibilité',
      blocks: [
        'Les parties classées nécessitent une connexion Internet. Quand aucun joueur n’est disponible, il est possible que l’on t’oppose à un adversaire contrôlé par ordinateur qui joue à un rythme proche du tien. Ces parties comptent pour ton classement. Le jeu peut aussi proposer une partie d’entraînement contre un bot, sans classement. Si le serveur redémarre pendant une partie classée, cette partie se termine sans changement de classement.',
        'Nous pouvons modifier, suspendre ou arrêter certains éléments du jeu, et nous nous efforcerons de prévenir à l’avance des modifications importantes.',
      ],
    },
    {
      id: 'ip',
      title: 'Propriété intellectuelle',
      blocks: [
        'Le jeu, son design, son code, ses sons et ses avatars nous appartiennent ou appartiennent à ceux qui nous les ont concédés sous licence. Nous t’accordons une licence personnelle, non exclusive et non commerciale pour utiliser le jeu conformément aux présentes conditions. Les licences de tiers sont listées dans l’application : Réglages → Licences.',
      ],
    },
    {
      id: 'stores',
      title: 'Boutiques d’applications',
      blocks: [
        'Apple et Google ne sont pas parties aux présentes conditions et ne sont pas responsables du jeu. Si tu as téléchargé le jeu depuis l’App Store, le contrat de licence utilisateur final standard d’Apple (EULA) s’applique aussi, et Apple et ses filiales peuvent faire appliquer les présentes conditions en tant que tiers bénéficiaires.',
      ],
    },
    {
      id: 'disclaimer',
      title: 'Exclusion de garantie',
      blocks: [
        'Le jeu est fourni « en l’état ». Dans la mesure permise par la loi, nous ne garantissons pas qu’il fonctionnera sans interruption ni erreur, et nous ne sommes pas responsables des dommages indirects, des pertes de données ou des pertes de classement. Rien dans les présentes conditions ne limite les droits que la loi te confère et auxquels il ne peut être renoncé.',
      ],
    },
    {
      id: 'termination',
      title: 'Résiliation',
      blocks: [
        'Tu peux arrêter de jouer et supprimer ton compte à tout moment. Nous pouvons suspendre ou fermer un compte qui enfreint les présentes conditions.',
      ],
    },
    {
      id: 'changes',
      title: 'Modifications des présentes conditions',
      blocks: [
        'Quand ces conditions changent, nous mettons à jour la date ici. Nous annoncerons aussi les modifications importantes dans l’application. Utiliser le jeu après une modification signifie que tu acceptes les nouvelles conditions.',
      ],
    },
    {
      id: 'law',
      title: 'Droit applicable',
      blocks: [
        'Les présentes conditions sont régies par les lois de l’État d’Israël, et les tribunaux compétents du district de Tel Aviv ont une compétence exclusive, sauf si la loi de ton pays te confère un droit auquel il ne peut être renoncé.',
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_FR: LegalDoc = {
  title: 'Supprimer ton compte',
  lead: 'Comment supprimer ton compte Sudoku Fight, et ce qu’il advient de tes données.',
  sections: [
    {
      id: 'in-app',
      title: 'Dans l’application (immédiat)',
      blocks: [
        {
          list: [
            'Ouvre Sudoku Fight et va dans **Réglages**.',
            'Appuie sur **Supprimer le compte**, puis confirme.',
            'Saisis ton mot de passe ou, si tu te connectes avec Google, choisis à nouveau ton compte Google. Le compte est supprimé immédiatement, et l’application revient à l’écran de connexion.',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: 'Sans l’application',
      blocks: [
        'Écris-nous à {email} **depuis l’adresse e-mail de ton compte**, avec l’objet « Supprimer mon compte » et ton nom affiché. Nous vérifierons que la demande vient du titulaire du compte, et nous supprimerons ce dernier sous 30 jours. Nous te confirmerons par e-mail une fois que ce sera fait.',
      ],
    },
    {
      id: 'what',
      title: 'Ce qui est supprimé et ce qui reste',
      blocks: [
        {
          list: [
            '**Supprimé immédiatement :** ton adresse e-mail, ton pays, ton avatar, ta connexion (dans Firebase aussi), et le lien entre ton compte et tes installations. Ton nom affiché est remplacé par un identifiant anonyme et devient libre pour les autres.',
            '**Conservé de façon anonyme :** les parties classées, les classements, les XP, les résultats d’entraînement, les enregistrements de fair-play et les données d’utilisation. Ils ne sont plus liés à toi, mais les parties et les tableaux de classement des autres joueurs restent complets.',
            '**Sur ton téléphone :** les parties d’entraînement qui se trouvent sur ton téléphone y restent jusqu’à ce que tu désinstalles l’application.',
            '**Chez Google :** les rapports de plantage sont conservés jusqu’à 90 jours, et les données Analytics pendant la durée de conservation définie.',
          ],
        },
        'Plus d’informations dans la [Politique de confidentialité](privacy).',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_FR: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_FR,
  terms: TERMS_FR,
  'delete-account': DELETE_ACCOUNT_FR,
};

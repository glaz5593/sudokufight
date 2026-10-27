import type { PageTexts } from '../links';

/**
 * A room link's page in French (D113; links.ts ROOM_PAGE_TEXTS, `fr`): French of France, tu
 * (docs/i18n/style/fr.md), terms from docs/i18n/glossary.csv (salon, partie, invitation). A no-break space
 * (U+00A0) stands before every colon and question mark. No word agrees with the reader's gender.
 *
 * `path` quotes the app: "Nouvelle partie" must equal home:modes.title and "Entrer un code" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/fr/home.json (links.test.ts checks it), joined by → (left
 * to right). The store badges' words are Google's and Apple's own French ("Disponible sur Google Play",
 * "Télécharger dans l'App Store").
 */
export const ROOM_PAGE_TEXTS_FR: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'Langue',
  path: 'Nouvelle partie → Entrer un code',
  title: 'Invitation au salon {code} · Sudoku Fight',
  heading: 'On t’invite à une partie de Sudoku Fight',
  codeLabel: 'Code du salon',
  open: 'Ouvrir dans l’application',
  noApp: 'Tu n’as pas l’application ?',
  googlePlay: 'Disponible sur Google Play',
  appStore: 'Télécharger dans l’App Store',
  typeCode:
    'Tu as l’application et elle ne s’est pas ouverte ? Mets-la à jour (il te faut la version {version} ou une version ultérieure), ou tape le code : {path} → {code}.',
  testing:
    'L’application est encore en phase de test. Si tu l’as : {path} → {code}. Il te faut la version {version} ou une version ultérieure.',
  testingHeading: 'Rejoindre avec le code',
  closedNote:
    'Si le salon est déjà fermé, l’application te le dira, et tu pourras demander un nouveau code à la personne qui t’a envoyé le lien.',
  privacy: 'Politique de confidentialité',
  badTitle: 'Lien non valide · Sudoku Fight',
  badHeading: 'Ce lien est incomplet',
  badText:
    'Ce lien ne contient pas de code de salon valide. Demande le code du salon (6 chiffres) à la personne qui te l’a envoyé, puis, dans l’application : {path}.',
};

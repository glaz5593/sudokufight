import type { PageTexts } from '../links';

/**
 * A room link's page in Brazilian Portuguese (D113; links.ts ROOM_PAGE_TEXTS, `pt-BR`): Brazilian Portuguese only,
 * você, wording without gender agreement (docs/i18n/style/pt-BR.md), terms from docs/i18n/glossary.csv (sala,
 * partida, convite).
 *
 * `path` quotes the app: "Nova partida" must equal home:modes.title and "Usar código" must equal
 * home:modes.friends.join in apps/mobile/src/i18n/locales/pt-BR/home.json (links.test.ts checks it), joined by →
 * (left to right). The store badges' words are Google's and Apple's own Brazilian Portuguese ("Disponível no
 * Google Play", "Baixar na App Store").
 */
export const ROOM_PAGE_TEXTS_PT_BR: PageTexts = {
  brand: 'Sudoku Fight',
  languages: 'Idioma',
  path: 'Nova partida → Usar código',
  title: 'Convite para a sala {code} · Sudoku Fight',
  heading: 'Você recebeu um convite para uma partida de Sudoku Fight',
  codeLabel: 'Código da sala',
  open: 'Abrir no app',
  noApp: 'Não tem o app?',
  googlePlay: 'Disponível no Google Play',
  appStore: 'Baixar na App Store',
  typeCode:
    'Tem o app e ele não abriu? Atualize o app (você precisa da versão {version} ou mais recente) ou digite o código: {path} → {code}.',
  testing:
    'O app ainda está em testes. Se você já tem o app: {path} → {code}. Você precisa da versão {version} ou mais recente.',
  testingHeading: 'Entrar com o código',
  closedNote:
    'Se a sala já tiver sido fechada, o app vai avisar você, e você pode pedir um código novo a quem enviou o convite.',
  privacy: 'Política de privacidade',
  badTitle: 'Link inválido · Sudoku Fight',
  badHeading: 'Este link está incompleto',
  badText:
    'Este link não tem um código de sala válido. Peça o código da sala (6 dígitos) a quem enviou o link e depois, no app: {path}.',
};

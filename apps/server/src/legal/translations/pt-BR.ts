import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in Brazilian Portuguese (D112, Moshe 2026-10-23): a translation of the English version
 * (privacy.ts, terms.ts, deleteAccount.ts, render.ts LEGAL_CHROME.en), section by section, with the same
 * anchors, block shapes, links, contact marks ({email}, {operator}), `code` marks and numbers (legal.test.ts
 * `skeleton`). Brazilian Portuguese only, você (docs/i18n/style/pt-BR.md), Western digits (D108), the terms of
 * docs/i18n/glossary.csv (partida, adversário, rating, ranqueada, treino, fase, replay, interferência, reação,
 * denúncia, bloqueio, sala, tabuleiro, célula). The page opens with TRANSLATION_NOTICE_PT_BR: the English
 * version prevails.
 *
 * Words quoted from the app (they must equal the app's pt-BR strings, apps/mobile/src/i18n/locales/pt-BR):
 * - Configurações = home:settings.title
 * - Excluir conta = account:settings.deleteAccount
 * - Jogadores bloqueados = moderation:blocked.settingsRow
 * - Licenças = home:settings.licenses
 * - “adversários recentes” = progress:leaderboard.caption.friends (en "Your recent opponents"; quoted
 *   without "Seus", as the English quotes "recent opponents")
 * - Política de privacidade / Termos de uso = home:settings.privacy / home:settings.terms (by meaning)
 * Named the app's way, not quoted: treino em fases (home: "Treino em fases"), robô for a practice bot (home:modes.bot
 * "Treino contra robô"; "bots" stays for cheating software), alvos for a stage's spots (levels:ready.raceSpots).
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_PT_BR =
  'Esta é uma tradução da versão em inglês. Em caso de divergência, prevalece a versão em inglês.';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_PT_BR: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: 'Idioma',
  contents: 'Sumário',
  documents: 'Documentos',
  updated: 'Última atualização:',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[nome do operador]',
  draft:
    'Rascunho: os dados de contato ainda não foram configurados no servidor (LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME).',
  translationNotice: TRANSLATION_NOTICE_PT_BR,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, `pt-BR`): [what happens, what it carries]. */
export const EVENT_DETAILS_PT_BR: Record<TelemetryEventName, [string, string]> = {
  app_open: ['O aplicativo é aberto', '—'],
  screen_view: ['Uma tela é aberta', 'O nome da tela (o padrão da rota dela, sem identificadores)'],
  register_step: ['Uma etapa do cadastro é aberta', 'A etapa'],
  register_complete: ['O cadastro é concluído', '—'],
  game_start: [
    'Uma partida começa',
    'Modo, tipo de partida, número de jogadores e se é uma partida com amigos',
  ],
  game_end: [
    'Uma partida termina',
    'Modo, resultado, pontuação, número de erros, duração e se foi uma partida com amigos',
  ],
  interference_sent: ['Você envia uma interferência', 'O tipo e o custo dela'],
  reaction_sent: ['Você envia uma reação', 'Qual emoji'],
  matchmaking_wait: [
    'Uma busca por adversários termina',
    'Os segundos de espera e se uma partida foi encontrada',
  ],
  reconnect: ['Reconexão após uma queda de conexão', 'Quanto tempo levou e se funcionou'],
  latency_sample: ['Uma amostra da qualidade da conexão', 'Tempos de resposta da rede, em milissegundos'],
  replay_open: ['Um replay é aberto', 'O modo da partida'],
  account_delete: ['A conta é excluída', '—'],
  report_sent: ['Você denuncia um jogador', 'Apenas o motivo (não quem foi denunciado, nem a partida)'],
  level_map_open: ['O mapa do treino em fases é aberto', 'A fase atual e o seu total de estrelas'],
  level_start: [
    'Uma fase começa',
    'O número e a versão da fase, o capítulo e o tipo dela, o número da tentativa, suas melhores estrelas até então e se foi um início rápido',
  ],
  level_end: [
    'Uma fase termina',
    'O número, a versão e o tipo da fase, as estrelas, suas melhores estrelas antes dela, a duração dela, como terminou, o número de erros, o resultado (tempo, alvos, vantagem ou pontos), o nível do robô e o número da tentativa',
  ],
  level_quit: [
    'Uma fase é abandonada no meio (por exemplo, o aplicativo foi fechado)',
    'O número e a versão da fase, e há quanto tempo ela estava em andamento',
  ],
  chapter_gate: [
    'Uma tentativa de passar pelo portão para o próximo capítulo',
    'O capítulo atrás do portão, as estrelas do capítulo e se o portão se abriu',
  ],
  level_tutorial: ['O “como jogar” de um tipo de fase é exibido', 'O tipo e se você o pulou'],
  friends_room_open: [
    'Uma sala para jogar com amigos é aberta',
    'O tipo de partida e como a sala foi aberta',
  ],
  friends_room_join: [
    'Uma tentativa de entrar na sala de amigos',
    'Como (um código ou um link) e como terminou (com sucesso, ou o motivo da falha)',
  ],
  friends_invite_share: [
    'O link de uma sala é compartilhado',
    'Se quem compartilhou foi o anfitrião ou um convidado (não o código, nem com quem)',
  ],
  friends_link_open: ['Um link de sala abre o aplicativo', 'Se você estava com a sessão iniciada'],
  friends_room_start: [
    'Uma partida com amigos começa',
    'O número de jogadores e quantos segundos você esperou na sala',
  ],
  friends_room_close: [
    'Você fica fora de uma sala antes de a partida dela começar',
    'O motivo, quantos jogadores havia na sala e quantos segundos você esperou',
  ],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_PT_BR) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_PT_BR[name],
  ]);

export const PRIVACY_PT_BR: LegalDoc = {
  title: 'Política de privacidade',
  lead: 'O que o Sudoku Fight coleta, por quê, quem vê, por quanto tempo é guardado e como excluir.',
  sections: [
    {
      id: 'who',
      title: 'Quem somos',
      blocks: [
        'O Sudoku Fight (“o jogo”, “nós”) é um jogo de sudoku competitivo em tempo real operado por {operator}.',
        'Para qualquer dúvida sobre privacidade e sobre os seus dados, escreva para nós em {email}.',
      ],
    },
    {
      id: 'summary',
      title: 'Em resumo',
      blocks: [
        {
          list: [
            'Coletamos apenas o necessário para operar o jogo: os dados da sua conta, as suas partidas e dados de uso que nos ajudam a entender como o jogo é jogado e a corrigir problemas.',
            '**Sem anúncios, e não vendemos dados.** Não rastreamos você em outros aplicativos ou sites.',
            'Seu nome de exibição, seu avatar, seu país, seus ratings e suas estatísticas ficam visíveis para outros jogadores. Seu e-mail nunca é mostrado a outros jogadores.',
            'Você pode excluir sua conta no aplicativo a qualquer momento: Configurações → Excluir conta. Veja a [página de exclusão da conta](delete-account).',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: 'Dados da conta',
      blocks: [
        'Quando você se cadastra, guardamos:',
        {
          list: [
            '**E-mail:** para fazer login, verificar o endereço, redefinir sua senha e enviar mensagens sobre a conta. Não enviamos e-mails de marketing.',
            '**Senha** (quando você se cadastra com e-mail e senha): gerenciada pelo Firebase Authentication, do Google. Ela nunca chega aos nossos servidores, e não podemos vê-la.',
            '**Login com o Google (opcional):** você pode se cadastrar e fazer login com sua conta do Google em vez de um e-mail e uma senha. O Firebase Authentication então recebe do Google o e-mail da sua conta do Google (verificado pelo Google) e o identificador dela no Google, e os guarda junto com o seu login; nós guardamos o e-mail como em qualquer conta. O Google também fornece ao Firebase o seu nome e a sua foto de perfil do Google, que o Firebase guarda junto com o login. Nosso servidor não os armazena nem os exibe: na arena aparecem apenas o nome e o avatar que você escolhe. Nunca recebemos sua senha do Google nem acesso a qualquer outra coisa na sua conta do Google (contatos, e-mail, arquivos). Se preferir, cadastre-se com e-mail e senha.',
            '**Nome de exibição, país e avatar:** é você quem os escolhe, e eles são mostrados a outros jogadores. O país é escolhido por você (o padrão vem das configurações de idioma e região do seu dispositivo). Não usamos a localização do seu dispositivo.',
            '**Quando a conta foi criada e quando o nome foi alterado pela última vez** (um nome pode ser alterado uma vez a cada 30 dias).',
            '**Nosso identificador da conta** e o seu identificador de login do Firebase (com o login com o Google, o Firebase também guarda o identificador da sua conta do Google).',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: 'Partidas e progresso',
      blocks: [
        {
          list: [
            '**Partidas ranqueadas** (guardadas no servidor): o tabuleiro, cada jogada com o seu tempo, as interferências e as reações que você enviou, sua pontuação, seus erros, sua colocação, seu rating antes e depois, e como a partida terminou. Com elas se formam o seu histórico, os seus replays e as suas estatísticas.',
            '**Partidas com amigos** (em uma sala com código; guardadas no servidor como uma partida ranqueada, mas sem rating): os mesmos dados, exceto o rating. Elas aparecem no seu histórico e nos seus replays, e os jogadores com quem você jogou aparecem em “adversários recentes”. O código da sala, quem está nela e quem foi retirado dela ficam guardados apenas na memória do servidor, até a sala ser fechada.',
            '**Ratings, XP, nível e conquistas.**',
            '**Quais tabuleiros você jogou, e contra quem:** para que você não receba o mesmo tabuleiro ou o mesmo adversário repetidas vezes.',
            '**Seu ritmo:** ao final de cada partida ranqueada, calculamos, a partir das suas jogadas, o seu tempo médio por jogada (levando em conta a dificuldade de cada célula) e o guardamos com a partida, junto com o número de jogadas em que ele foi medido. A partir dele, da sua taxa de erros e dos seus resultados contra adversários controlados por computador, definimos o ritmo de um adversário controlado por computador quando não há jogadores disponíveis (veja os [Termos de uso](terms)). Seu ritmo não é mostrado a outros jogadores.',
            '**Resultados de treino** (solo ou contra um robô), quando o aplicativo os informa para fins de XP: modo, tipo de partida, resultado, número de jogadas corretas, quando terminou e o XP que rendeu.',
            '**Treino em fases:** quando o aplicativo sincroniza o seu progresso com a sua conta (para que ele volte também em um celular novo): suas melhores estrelas em cada fase, quantas vezes você a jogou e quando isso mudou, e o XP que as fases deram a cada dia.',
            '**Jogo limpo:** quando o ritmo das jogadas em uma partida ranqueada é excepcionalmente rápido, um registro é guardado para que uma pessoa o analise. Nada acontece automaticamente por causa disso.',
            '**Denúncias e bloqueios:** veja “Denúncias e bloqueios” abaixo.',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: 'Dados de uso',
      blocks: [
        'Para entender como o jogo é usado, o aplicativo informa eventos ao nosso servidor. Cada evento tem o seu próprio identificador aleatório e a hora do seu celular; o servidor adiciona a hora em que o recebeu.',
        'Cada envio também inclui um **identificador de instalação**: um número aleatório criado na primeira abertura e guardado no aplicativo. Ele não se baseia nos dados do seu dispositivo e desaparece quando você desinstala o aplicativo. Junto com ele vão o sistema (iOS ou Android) e a versão do aplicativo.',
        'Enquanto você estiver com a sessão iniciada, os eventos e a instalação ficam vinculados à sua conta. Sem conexão, os eventos esperam no seu celular e são enviados depois.',
        'Os eventos:',
        { table: { head: ['Evento', 'Quando', 'O que inclui'], rows: eventRows() } },
        'Os mesmos eventos também vão para o **Google Analytics for Firebase**, que adiciona um identificador da instalação do aplicativo, dados do dispositivo e do sistema, dados de uso (como a duração da sessão) e uma localização aproximada (país e região) que o Google deduz do endereço IP. Nós o configuramos sem recursos de publicidade: sem identificador de publicidade e sem personalização de anúncios.',
      ],
    },
    {
      id: 'crashes',
      title: 'Relatórios de falhas e erros',
      blocks: [
        {
          list: [
            '**No aplicativo, o Firebase Crashlytics, do Google:** quando o aplicativo falha ou encontra um erro, é enviado um relatório com os detalhes do erro, o modelo do dispositivo, as versões do sistema e do aplicativo, um identificador de instalação do Crashlytics e o nosso identificador da sua conta enquanto você estiver com a sessão iniciada. Não o seu e-mail nem o seu nome.',
            '**No servidor, o Sentry:** quando o servidor encontra um erro, é enviado um relatório técnico sobre ele, às vezes com o identificador da conta envolvida. Sem e-mails e sem senhas.',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'Endereço IP',
      blocks: [
        'Quando o aplicativo se conecta, o nosso servidor vê o seu endereço IP. Nós o usamos **apenas na memória do servidor**, para limitar a frequência de solicitações e proteger contra sobrecargas, e não o armazenamos no nosso banco de dados.',
        'Nosso provedor de hospedagem pode manter registros de acesso comuns por um curto período.',
      ],
    },
    {
      id: 'device',
      title: 'O que fica apenas no seu celular',
      blocks: [
        {
          list: [
            'Suas partidas de treino e o histórico delas.',
            'Seu progresso no treino em fases: estrelas, tentativas e os portões que você abriu (uma cópia também é guardada no servidor: veja “Partidas e progresso”).',
            'Suas configurações: som, vibração, redução de movimento e idioma.',
            'Uma cópia do seu perfil, para que o aplicativo abra sem conexão.',
            'Filas de eventos e de resultados de treino ainda não enviados, e o identificador de instalação.',
            'Seu login (guardado pelo Firebase) e, com o login com o Google, a conta que você escolheu (guardada pelos serviços do Google Play até você sair da conta).',
          ],
        },
        'Tudo isso é excluído quando você desinstala o aplicativo. Sair da conta exclui a cópia do perfil. Excluir sua conta não exclui as partidas de treino nem o progresso do treino em fases que estão no seu celular: para excluí-los também, desinstale o aplicativo.',
      ],
    },
    {
      id: 'not-collected',
      title: 'O que não coletamos',
      blocks: [
        'Contatos, fotos, microfone, câmera, localização precisa, identificadores de publicidade e dados de pagamento. O jogo não tem chat: as reações são emojis de uma lista fixa.',
      ],
    },
    {
      id: 'public',
      title: 'O que outros jogadores veem',
      blocks: [
        {
          list: [
            'Seu nome de exibição, seu avatar, seu país (como bandeira), seus ratings, seu nível e suas conquistas.',
            'No seu cartão de jogador e nos rankings: número de partidas, taxa de vitórias, sequências, melhor jogada, média de erros, resultados recentes, a interferência que você mais envia e quando você entrou no jogo (mês e ano).',
            'Durante uma partida: sua pontuação, seus erros, suas interferências e reações, e se você está online.',
            'Em uma sala para jogar com amigos: qualquer pessoa que tenha o código ou o link dela e entre na sala vê o nome, o avatar, a bandeira e o rating geral de todos que estão nela, e se estão na sala neste momento. O código e o link em si não contêm nenhuma informação pessoal.',
            'Replays e detalhes da partida: apenas os jogadores daquela partida.',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: 'Denúncias e bloqueios',
      blocks: [
        {
          list: [
            '**Denunciar um jogador:** quando você denuncia alguém, guardamos quem fez a denúncia, quem foi denunciado, o motivo (nome ofensivo, trapaça ou outro), a partida ranqueada quando a denúncia foi feita a partir de uma, e quando. Uma denúncia não tem texto livre. O jogador denunciado não fica sabendo quem fez a denúncia.',
            '**Bloquear:** guardamos os jogadores que você bloqueou e quando. Por causa do bloqueio, o jogo não coloca você na mesma partida que eles, e as reações deles não são mostradas para você. Ninguém é avisado de que foi bloqueado, e um bloqueio não esconde ninguém dos rankings.',
            '**Tratamento das denúncias:** o operador do jogo analisa cada denúncia em até 48 horas. O operador pode substituir um nome ofensivo por um nome temporário (o jogador é então solicitado a escolher um nome novo) ou suspender uma conta das partidas ranqueadas e das alterações na conta. Cada uma dessas ações é anotada em um registro interno, com o endereço do administrador que a realizou e, quando um nome foi substituído, o nome antigo e o novo. Um nome substituído dessa forma entra em uma lista de nomes que ninguém pode escolher de novo (apenas o nome, sem vínculo com nenhum jogador).',
            '**Uma conta suspensa que é excluída:** excluir uma conta não retira uma suspensão. Quando uma conta suspensa é excluída, guardamos uma impressão digital unidirecional (um hash) do identificador de login dela e do endereço de e-mail verificado dela, e não o identificador ou o endereço em si. Uma conta nova com o mesmo login começa suspensa até que um administrador a analise, e então a impressão digital é excluída. Este é o nosso interesse legítimo, e o de todos os jogadores, no jogo limpo.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: 'Para que usamos os dados',
      blocks: [
        {
          list: [
            '**Para operar o jogo:** sua conta, suas partidas, seus ratings, o pareamento, o histórico e os rankings. Isso é necessário para o nosso acordo com você (os Termos de uso).',
            '**Segurança e jogo limpo:** limites de frequência, detecção de anomalias, prevenção de trapaças e tratamento de denúncias e bloqueios. Este é o nosso interesse legítimo, e o de todos os jogadores.',
            '**Para melhorar o jogo:** saber quais telas e modos são jogados, encontrar problemas e corrigir falhas. Também é um interesse legítimo, sem publicidade e sem perfil de marketing.',
            '**E-mail de serviço:** apenas verificação do endereço e redefinição de senha.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Com quem compartilhamos os dados',
      blocks: [
        'Nós **não vendemos** dados, e não os repassamos a anunciantes nem a corretores de dados. Nossos prestadores de serviços os processam apenas em nosso nome:',
        {
          list: [
            '**Google (Firebase):** login (Authentication, incluindo o login com o Google), relatórios de falhas (Crashlytics) e dados de uso (Analytics).',
            '**Fly.io:** hospedagem do servidor.',
            '**Neon:** o banco de dados (PostgreSQL).',
            '**Sentry:** relatórios de erros do servidor.',
          ],
        },
        'Também divulgaremos dados quando a lei exigir, ou para proteger o jogo e os seus jogadores. Se o jogo passar para outro proprietário, os dados passam com ele, e esta política continua se aplicando a eles.',
      ],
    },
    {
      id: 'transfers',
      title: 'Onde estão os dados',
      blocks: [
        'O servidor e o banco de dados estão atualmente na União Europeia (Frankfurt, Alemanha). O Google e o Sentry também podem processar dados nos Estados Unidos e em outros países, de acordo com as suas próprias salvaguardas para transferências de dados (como as Cláusulas Contratuais Padrão da UE).',
      ],
    },
    {
      id: 'retention',
      title: 'Por quanto tempo guardamos os dados',
      blocks: [
        {
          list: [
            '**Dados da conta:** enquanto a conta existir.',
            '**Quando você exclui sua conta:** seu e-mail, seu país, seu avatar e o vínculo de login são excluídos imediatamente, e seu nome de exibição é substituído por um identificador anônimo (o nome antigo fica livre imediatamente). Seu login no Firebase também é excluído, com o que ele guardava do Google. Se você fez login com o Google, o aplicativo também revoga o acesso que recebeu à sua conta do Google.',
            '**Progresso do treino em fases:** a cópia no servidor (suas estrelas em cada fase e o XP que as fases deram a cada dia) é excluída com a conta. A cópia no seu celular fica até você desinstalar o aplicativo.',
            '**O que fica após a exclusão, de forma anônima:** partidas ranqueadas, ratings, XP, resultados de treino, registros de jogo limpo, denúncias que você enviou e dados de uso. Eles não estão mais vinculados a você, mas as partidas, os replays e os rankings dos outros jogadores continuam completos.',
            '**Denúncias, bloqueios e o registro de administração:** um bloqueio é guardado até você removê-lo ou excluir sua conta (então todos os bloqueios dela são excluídos, nos dois sentidos). As denúncias e o registro das ações dos administradores são guardados enquanto forem necessários para tratar denúncias e manter o jogo seguro e justo; nós os analisamos de tempos em tempos e excluímos os antigos. Quando uma conta é excluída, as denúncias abertas sobre ela são encerradas, e os nomes dela são removidos do registro de administração. Se ela estava suspensa, fica apenas a impressão digital unidirecional descrita acima, até que uma conta nova seja criada com o mesmo login ou até que a excluamos em uma revisão periódica.',
            '**Dados de uso:** guardados enquanto nos ajudarem a entender como o jogo é usado. Nós os analisamos de tempos em tempos e excluímos os dados antigos.',
            '**Crashlytics:** o Google guarda os relatórios de falhas por até 90 dias. **Analytics:** pelo período de retenção que configuramos no Firebase.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: 'Seus direitos',
      blocks: [
        'Você pode pedir para ver seus dados, corrigi-los (você pode alterar seu nome, seu avatar e seu país no aplicativo), excluí-los (excluindo sua conta no aplicativo) ou se opor ao uso deles. Escreva para nós em {email}, e responderemos em até 30 dias.',
        'Você também pode apresentar uma reclamação à Autoridade de Proteção da Privacidade de Israel ou à autoridade de proteção de dados do seu país.',
      ],
    },
    {
      id: 'children',
      title: 'Crianças',
      blocks: [
        'O jogo não é destinado a crianças menores de 13 anos, e não coletamos intencionalmente dados sobre elas. Se soubermos que uma criança menor de 13 anos abriu uma conta, nós a excluiremos. Onde a idade mínima for maior, é necessário o consentimento de um dos pais até essa idade.',
      ],
    },
    {
      id: 'security',
      title: 'Segurança',
      blocks: [
        'O tráfego entre o aplicativo e o servidor é criptografado (HTTPS e WSS). As senhas são gerenciadas pelo Firebase e não são armazenadas por nós. O acesso aos dados no servidor é limitado ao operador do jogo. Nenhum sistema é perfeitamente seguro, mas fazemos esforços razoáveis para proteger seus dados.',
      ],
    },
    {
      id: 'changes',
      title: 'Alterações nesta política',
      blocks: [
        'Quando esta política mudar, atualizamos a data aqui. Também anunciaremos no aplicativo as alterações substanciais.',
      ],
    },
    {
      id: 'contact',
      title: 'Contato',
      blocks: ['{operator} · {email}', 'Veja também os [Termos de uso](terms).'],
    },
  ],
};

export const TERMS_PT_BR: LegalDoc = {
  title: 'Termos de uso',
  lead: 'As regras para usar o Sudoku Fight. Usar o jogo significa que você as aceita.',
  sections: [
    {
      id: 'acceptance',
      title: 'Aceitação',
      blocks: [
        'Estes termos se aplicam ao aplicativo Sudoku Fight e aos seus serviços (“o jogo”), operados por {operator} (“nós”). Ao se cadastrar ou usar o jogo, você aceita estes termos e a [Política de privacidade](privacy).',
      ],
    },
    {
      id: 'eligibility',
      title: 'Quem pode jogar',
      blocks: [
        'Você precisa ter pelo menos 13 anos, ou a idade mínima definida pela lei do seu país, se for maior. Com menos de 18 anos, você precisa do consentimento de um dos pais ou de um responsável legal.',
      ],
    },
    {
      id: 'account',
      title: 'Sua conta',
      blocks: [
        {
          list: [
            'Uma conta por pessoa, com o seu próprio e-mail.',
            'Mantenha em segurança sua senha (ou a conta do Google com que você faz login). Você é responsável por tudo o que for feito com a sua conta.',
            'Você pode excluir sua conta a qualquer momento no aplicativo: Configurações → Excluir conta.',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: 'Nomes de exibição e conduta',
      blocks: [
        'Seu nome de exibição, seu avatar e seu país ficam visíveis para todos os jogadores. Um nome não pode:',
        {
          list: [
            'ser ofensivo, racista, sexual, ameaçador ou insultuoso;',
            'se passar por outra pessoa, por outro jogador ou pela equipe do jogo;',
            'conter dados pessoais (um número de telefone, um endereço), publicidade ou um link.',
          ],
        },
        'Os nomes são verificados automaticamente com uma lista de palavras bloqueadas. Podemos alterar um nome que viole estas regras, pedir um novo ou suspender a conta.',
        'As reações no jogo são emojis de uma lista fixa. Você pode silenciar um adversário pelo cartão dele durante uma partida, bloqueá-lo ou denunciá-lo (próxima seção).',
      ],
    },
    {
      id: 'reports',
      title: 'Denunciar e bloquear',
      blocks: [
        'Você pode denunciar um jogador pelo cartão dele ou pela partida, com um de três motivos: nome ofensivo, trapaça ou outro. **Analisamos cada denúncia em até 48 horas.**',
        'Se as regras tiverem sido violadas, podemos substituir o nome por um temporário (o jogador é então solicitado a escolher um nome novo, e a regra dos 30 dias não se aplica a essa escolha), suspender a conta das partidas ranqueadas e das alterações na conta até que a suspensão seja retirada, ou encerrá-la. Um nome substituído dessa forma não pode ser escolhido de novo. Uma conta suspensa ainda pode ser excluída a qualquer momento, mas excluí-la não retira a suspensão: uma conta nova com o mesmo login começa suspensa até que a analisemos.',
        'Você também pode bloquear um jogador: o jogo não colocará você na mesma partida que ele, e as reações dele não serão mostradas para você. Remova um bloqueio em Configurações → Jogadores bloqueados. Um bloqueio não esconde ninguém dos rankings.',
        'Não denuncie sem motivo: denúncias falsas repetidas violam estes termos.',
      ],
    },
    {
      id: 'fair-play',
      title: 'Jogo limpo',
      blocks: [
        'Você não pode:',
        {
          list: [
            'usar solucionadores de sudoku, bots, scripts, automação ou um aplicativo modificado;',
            'manter várias contas para influenciar ratings, combinar resultados com outro jogador ou perder de propósito;',
            'explorar bugs em vez de nos avisar sobre eles;',
            'sobrecarregar nossos servidores, tentar invadi-los ou atrapalhar outros jogadores.',
          ],
        },
        'O servidor sinaliza partidas incomuns para análise. Se as regras tiverem sido violadas, podemos anular resultados, redefinir ratings ou suspender e encerrar a conta.',
      ],
    },
    {
      id: 'virtual',
      title: 'Ratings, XP e conquistas',
      blocks: [
        'Ratings, XP, níveis e conquistas não têm valor monetário e não podem ser transferidos nem vendidos. Podemos alterar como eles são calculados ou redefini-los (por exemplo, no início de uma temporada).',
        'O jogo é gratuito. Esta versão não tem compras nem anúncios.',
      ],
    },
    {
      id: 'service',
      title: 'Disponibilidade',
      blocks: [
        'As partidas ranqueadas precisam de conexão com a internet. Quando não há jogadores disponíveis, podemos parear você com um adversário controlado por computador que joga em um ritmo parecido com o seu. Essas partidas contam para o seu rating. O jogo também pode oferecer uma partida de treino contra um robô, sem rating. Se o servidor for reiniciado durante uma partida ranqueada, essa partida termina sem alteração no rating.',
        'Podemos alterar, pausar ou encerrar partes do jogo, e tentaremos avisar com antecedência sobre alterações substanciais.',
      ],
    },
    {
      id: 'ip',
      title: 'Propriedade intelectual',
      blocks: [
        'O jogo, seu design, seu código, seus sons e seus avatares pertencem a nós ou a quem os licenciou para nós. Concedemos a você uma licença pessoal, não exclusiva e não comercial para usar o jogo de acordo com estes termos. As licenças de terceiros estão listadas no aplicativo: Configurações → Licenças.',
      ],
    },
    {
      id: 'stores',
      title: 'Lojas de aplicativos',
      blocks: [
        'A Apple e o Google não são partes destes termos e não são responsáveis pelo jogo. Se você baixou o jogo da App Store, o Contrato de Licença de Usuário Final Padrão da Apple (EULA) também se aplica, e a Apple e suas subsidiárias podem fazer valer estes termos como terceiros beneficiários.',
      ],
    },
    {
      id: 'disclaimer',
      title: 'Isenção de responsabilidade',
      blocks: [
        'O jogo é fornecido “no estado em que se encontra”. Na medida permitida pela lei, não garantimos que ele funcione sem interrupções ou erros, e não somos responsáveis por danos indiretos, perda de dados ou perda de ratings. Nada nestes termos limita direitos que a lei garante a você e aos quais não se pode renunciar.',
      ],
    },
    {
      id: 'termination',
      title: 'Encerramento',
      blocks: [
        'Você pode parar de jogar e excluir sua conta a qualquer momento. Podemos suspender ou encerrar uma conta que viole estes termos.',
      ],
    },
    {
      id: 'changes',
      title: 'Alterações nestes termos',
      blocks: [
        'Quando estes termos mudarem, atualizamos a data aqui. Também anunciaremos no aplicativo as alterações substanciais. Usar o jogo depois de uma alteração significa que você aceita os novos termos.',
      ],
    },
    {
      id: 'law',
      title: 'Lei aplicável',
      blocks: [
        'Estes termos são regidos pelas leis do Estado de Israel, e os tribunais competentes do distrito de Tel Aviv têm jurisdição exclusiva, a menos que a lei do seu país conceda a você um direito ao qual não se possa renunciar.',
      ],
    },
    {
      id: 'contact',
      title: 'Contato',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_PT_BR: LegalDoc = {
  title: 'Excluir sua conta',
  lead: 'Como excluir sua conta do Sudoku Fight e o que acontece com os seus dados.',
  sections: [
    {
      id: 'in-app',
      title: 'No aplicativo (imediato)',
      blocks: [
        {
          list: [
            'Abra o Sudoku Fight e vá para **Configurações**.',
            'Toque em **Excluir conta** e confirme.',
            'Digite sua senha ou, se você faz login com o Google, escolha sua conta do Google novamente. A conta é excluída imediatamente, e o aplicativo volta para a tela de login.',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: 'Sem o aplicativo',
      blocks: [
        'Escreva para nós em {email} **a partir do endereço de e-mail da sua conta**, com o assunto “Excluir minha conta” e o seu nome de exibição. Vamos verificar se a solicitação vem do titular da conta e excluí-la em até 30 dias. Confirmaremos por e-mail quando a exclusão for concluída.',
      ],
    },
    {
      id: 'what',
      title: 'O que é excluído e o que fica',
      blocks: [
        {
          list: [
            '**Excluído imediatamente:** seu e-mail, seu país, seu avatar, seu login (também no Firebase) e o vínculo entre a sua conta e as suas instalações. Seu nome de exibição é substituído por um identificador anônimo e fica livre para outras pessoas.',
            '**Guardado de forma anônima:** partidas ranqueadas, ratings, XP, resultados de treino, registros de jogo limpo e dados de uso. Eles não estão mais vinculados a você, mas as partidas e os rankings dos outros jogadores continuam completos.',
            '**No seu celular:** as partidas de treino que estão no seu celular ficam lá até você desinstalar o aplicativo.',
            '**No Google:** os relatórios de falhas são guardados por até 90 dias, e os dados do Analytics pelo período de retenção configurado.',
          ],
        },
        'Mais informações na [Política de privacidade](privacy).',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_PT_BR: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_PT_BR,
  terms: TERMS_PT_BR,
  'delete-account': DELETE_ACCOUNT_PT_BR,
};

import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in Spanish (D112): a translation of the English version (privacy.ts, terms.ts,
 * deleteAccount.ts, render.ts LEGAL_CHROME.en), with the same sections, anchors, links, marks, contact
 * placeholders and numbers (legal.test.ts `skeleton`). Neutral Latin American Spanish, tú (docs/i18n/style/es.md);
 * terms from docs/i18n/glossary.csv. The page opens with TRANSLATION_NOTICE_ES: the English version prevails.
 *
 * App labels quoted here (they must equal the app's es strings): Configuración (home:settings.title),
 * Eliminar cuenta (account:settings.deleteAccount), Jugadores bloqueados (moderation:blocked.settingsRow),
 * Licencias (home:settings.licenses), “rivales recientes” (progress:leaderboard.caption.friends).
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_ES =
  'Esta es una traducción de la versión en inglés. Si hay diferencias, prevalece la versión en inglés.';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_ES: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: 'Idioma',
  contents: 'Índice',
  documents: 'Documentos',
  updated: 'Última actualización:',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[nombre del operador]',
  draft:
    'Borrador: los datos de contacto aún no están configurados en el servidor (LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME).',
  translationNotice: TRANSLATION_NOTICE_ES,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, `es`): [what happens, what it carries]. */
export const EVENT_DETAILS_ES: Record<TelemetryEventName, [string, string]> = {
  app_open: ['Se abre la aplicación', '—'],
  screen_view: ['Se abre una pantalla', 'El nombre de la pantalla (su patrón de ruta, sin identificadores)'],
  register_step: ['Se abre un paso del registro', 'El paso'],
  register_complete: ['Se completa el registro', '—'],
  game_start: [
    'Empieza una partida',
    'Modo, tipo de partida, número de jugadores y si es una partida con amigos',
  ],
  game_end: [
    'Termina una partida',
    'Modo, resultado, puntos, número de errores, duración y si fue una partida con amigos',
  ],
  interference_sent: ['Envías una interferencia', 'Su tipo y su costo'],
  reaction_sent: ['Envías una reacción', 'Qué emoji'],
  matchmaking_wait: [
    'Termina una búsqueda de rivales',
    'Los segundos de espera y si se encontró una partida',
  ],
  reconnect: ['Reconexión después de una desconexión', 'Cuánto tardó y si funcionó'],
  latency_sample: [
    'Una muestra de la calidad de la conexión',
    'Tiempos de respuesta de la red, en milisegundos',
  ],
  replay_open: ['Se abre una repetición', 'El modo de la partida'],
  account_delete: ['Se elimina la cuenta', '—'],
  report_sent: [
    'Envías una denuncia sobre un jugador',
    'Solo el motivo (no a quién se denunció ni la partida)',
  ],
  level_map_open: ['Se abre el mapa de la práctica por fases', 'La fase actual y tu total de estrellas'],
  level_start: [
    'Empieza una fase',
    'El número y la versión de la fase, su capítulo y su tipo, el número del intento, tus mejores estrellas hasta ese momento y si fue un inicio rápido',
  ],
  level_end: [
    'Termina una fase',
    'El número, la versión y el tipo de la fase, las estrellas, tus mejores estrellas antes de ella, su duración, cómo terminó, el número de errores, el resultado (tiempo, casillas, ventaja o puntos), el nivel del bot y el número del intento',
  ],
  level_quit: [
    'Se abandona una fase a la mitad (por ejemplo, se cerró la aplicación)',
    'El número y la versión de la fase, y cuánto tiempo llevaba en curso',
  ],
  chapter_gate: [
    'Un intento de pasar la puerta al siguiente capítulo',
    'El capítulo detrás de la puerta, las estrellas del capítulo y si la puerta se abrió',
  ],
  level_tutorial: ['Se muestra el “cómo se juega” de un tipo de fase', 'El tipo y si lo omitiste'],
  friends_room_open: ['Se abre una sala para jugar con amigos', 'El tipo de partida y cómo se abrió la sala'],
  friends_room_join: [
    'Un intento de unirse a la sala de unos amigos',
    'Cómo (un código o un enlace) y cómo terminó (con éxito, o por qué falló)',
  ],
  friends_invite_share: [
    'Se comparte el enlace de una sala',
    'Si lo compartió el anfitrión o un invitado (no el código, ni con quién)',
  ],
  friends_link_open: ['Un enlace de sala abre la aplicación', 'Si tenías la sesión iniciada'],
  friends_room_start: [
    'Empieza una partida con amigos',
    'El número de jugadores y cuántos segundos esperaste en la sala',
  ],
  friends_room_close: [
    'Quedas fuera de una sala antes de que empiece su partida',
    'El motivo, cuántos jugadores había en la sala y cuántos segundos esperaste',
  ],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_ES) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_ES[name],
  ]);

export const PRIVACY_ES: LegalDoc = {
  title: 'Política de privacidad',
  lead: 'Qué recopila Sudoku Fight, por qué, quién lo ve, cuánto tiempo se conserva y cómo eliminarlo.',
  sections: [
    {
      id: 'who',
      title: 'Quiénes somos',
      blocks: [
        'Sudoku Fight (“el juego”, “nosotros”) es un juego de sudoku competitivo en tiempo real operado por {operator}.',
        'Si tienes cualquier pregunta sobre la privacidad y tus datos, escríbenos a {email}.',
      ],
    },
    {
      id: 'summary',
      title: 'En resumen',
      blocks: [
        {
          list: [
            'Solo recopilamos lo necesario para operar el juego: los datos de tu cuenta, tus partidas y datos de uso que nos ayudan a entender cómo se juega y a corregir problemas.',
            '**Sin anuncios, y no vendemos datos.** No hacemos seguimiento de tu actividad en otras aplicaciones ni sitios web.',
            'Otros jugadores pueden ver tu nombre visible, tu avatar, tu país, tus puntuaciones y tus estadísticas. Tu correo electrónico nunca se muestra a otros jugadores.',
            'Puedes eliminar tu cuenta en la aplicación en cualquier momento: Configuración → Eliminar cuenta. Consulta la [página de eliminación de la cuenta](delete-account).',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: 'Datos de la cuenta',
      blocks: [
        'Cuando te registras, conservamos:',
        {
          list: [
            '**Correo electrónico:** para iniciar sesión, verificar la dirección, restablecer tu contraseña y enviarte mensajes sobre la cuenta. No enviamos correos de marketing.',
            '**Contraseña** (cuando te registras con correo electrónico y contraseña): la gestiona Firebase Authentication de Google. Nunca llega a nuestros servidores y no podemos verla.',
            '**Iniciar sesión con Google (opcional):** puedes registrarte e iniciar sesión con tu cuenta de Google en lugar de un correo electrónico y una contraseña. En ese caso, Firebase Authentication recibe de Google el correo electrónico de tu cuenta de Google (verificado por Google) y su identificador de Google, y los conserva junto con tu inicio de sesión; nosotros conservamos el correo electrónico como con cualquier cuenta. Google también le proporciona a Firebase tu nombre y tu foto de perfil de Google, que Firebase conserva junto con el inicio de sesión. Nuestro servidor no los almacena ni los muestra: en la arena solo aparecen el nombre y el avatar que tú eliges. Nunca obtenemos tu contraseña de Google ni acceso a nada más de tu cuenta de Google (contactos, correo electrónico, archivos). Si lo prefieres, regístrate con correo electrónico y contraseña.',
            '**Nombre visible, país y avatar:** los eliges tú, y se muestran a otros jugadores. El país lo eliges tú (el valor predeterminado proviene de la configuración de idioma y región de tu dispositivo). No usamos la ubicación de tu dispositivo.',
            '**Cuándo se creó la cuenta y cuándo se cambió el nombre por última vez** (el nombre se puede cambiar una vez cada 30 días).',
            '**Nuestro identificador de la cuenta** y tu identificador de inicio de sesión de Firebase (con el inicio de sesión con Google, Firebase también conserva el identificador de tu cuenta de Google).',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: 'Partidas y progreso',
      blocks: [
        {
          list: [
            '**Partidas clasificatorias** (se conservan en el servidor): el tablero, cada jugada con su tiempo, las interferencias y las reacciones que enviaste, tus puntos, tus errores, tu posición, tu puntuación antes y después, y cómo terminó la partida. Con ellos se forman tu historial, tus repeticiones y tus estadísticas.',
            '**Partidas con amigos** (en una sala con código; se conservan en el servidor como una partida clasificatoria, pero sin puntuación): los mismos datos, salvo la puntuación. Aparecen en tu historial y en tus repeticiones, y los jugadores con los que jugaste aparecen en “rivales recientes”. El código de la sala, quién está en ella y a quién se retiró de ella se conservan solo en la memoria del servidor, hasta que la sala se cierra.',
            '**Puntuaciones, XP, nivel y logros.**',
            '**Qué tableros jugaste y contra quién:** para que no te toque el mismo tablero o el mismo rival una y otra vez.',
            '**Tu ritmo:** al final de cada partida clasificatoria calculamos, a partir de tus jugadas, tu tiempo promedio por jugada (teniendo en cuenta la dificultad de cada casilla), y lo conservamos con la partida, junto con el número de jugadas con que se midió. A partir de él, de tu tasa de errores y de tus resultados contra rivales controlados por computadora, fijamos el ritmo de un rival controlado por computadora cuando no hay jugadores disponibles (consulta los [Términos de uso](terms)). Tu ritmo no se muestra a otros jugadores.',
            '**Resultados de práctica** (en solitario o contra un bot), cuando la aplicación los informa para obtener XP: modo, tipo de partida, resultado, número de jugadas correctas, cuándo terminó y el XP que otorgó.',
            '**Práctica por fases:** cuando la aplicación sincroniza tu progreso con tu cuenta (para que también vuelva en un teléfono nuevo): tus mejores estrellas en cada fase, cuántas veces la jugaste y cuándo cambió eso, y el XP que dieron las fases cada día.',
            '**Juego limpio:** cuando el ritmo de las jugadas en una partida clasificatoria es inusualmente rápido, se guarda un registro para que una persona lo revise. Nada ocurre automáticamente por ello.',
            '**Denuncias y bloqueos:** consulta “Denuncias y bloqueos” más abajo.',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: 'Datos de uso',
      blocks: [
        'Para entender cómo se usa el juego, la aplicación informa eventos a nuestro servidor. Cada evento tiene su propio identificador aleatorio y la hora de tu teléfono; el servidor agrega la hora en que lo recibió.',
        'Cada informe también incluye un **identificador de instalación**: un número aleatorio que se genera en el primer inicio y se conserva en la aplicación. No se basa en los datos de tu dispositivo y desaparece cuando desinstalas la aplicación. Junto con él se envían el sistema (iOS o Android) y la versión de la aplicación.',
        'Mientras tienes la sesión iniciada, los eventos y la instalación se vinculan a tu cuenta. Sin conexión, los eventos esperan en tu teléfono y se envían más tarde.',
        'Los eventos:',
        { table: { head: ['Evento', 'Cuándo', 'Qué incluye'], rows: eventRows() } },
        'Los mismos eventos también se envían a **Google Analytics for Firebase**, que agrega un identificador de la instalación de la aplicación, datos del dispositivo y del sistema, datos de uso (como la duración de la sesión) y una ubicación aproximada (país y región) que Google deduce de la dirección IP. Lo configuramos sin funciones publicitarias: sin identificador de publicidad y sin personalización de anuncios.',
      ],
    },
    {
      id: 'crashes',
      title: 'Informes de fallos y errores',
      blocks: [
        {
          list: [
            '**En la aplicación, Firebase Crashlytics de Google:** cuando la aplicación falla o encuentra un error, se envía un informe con los detalles del error, el modelo del dispositivo, las versiones del sistema y de la aplicación, un identificador de instalación de Crashlytics y nuestro identificador de tu cuenta mientras tienes la sesión iniciada. No tu correo electrónico ni tu nombre.',
            '**En el servidor, Sentry:** cuando el servidor encuentra un error, se envía un informe técnico sobre él, a veces con el identificador de la cuenta involucrada. Sin correos electrónicos ni contraseñas.',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'Dirección IP',
      blocks: [
        'Cuando la aplicación se conecta, nuestro servidor ve tu dirección IP. La usamos **solo en la memoria del servidor**, para limitar la frecuencia de las solicitudes y proteger el servicio contra saturaciones, y no la almacenamos en nuestra base de datos.',
        'Nuestro proveedor de alojamiento puede conservar registros de acceso habituales durante un tiempo breve.',
      ],
    },
    {
      id: 'device',
      title: 'Lo que se queda solo en tu teléfono',
      blocks: [
        {
          list: [
            'Tus partidas de práctica y su historial.',
            'Tu progreso en la práctica por fases: estrellas, intentos y las puertas que abriste (también se conserva una copia en el servidor: consulta “Partidas y progreso”).',
            'Tu configuración: sonido, vibración, reducción de movimiento e idioma.',
            'Una copia de tu perfil, para que la aplicación se abra sin conexión.',
            'Colas de eventos y de resultados de práctica aún no enviados, y el identificador de instalación.',
            'Tu inicio de sesión (lo conserva Firebase) y, con el inicio de sesión con Google, la cuenta que elegiste (la conservan los servicios de Google Play hasta que cierras sesión).',
          ],
        },
        'Todo esto se elimina cuando desinstalas la aplicación. Al cerrar sesión se elimina la copia del perfil. Eliminar tu cuenta no elimina las partidas de práctica ni el progreso de la práctica por fases que están en tu teléfono: para eliminarlos también, desinstala la aplicación.',
      ],
    },
    {
      id: 'not-collected',
      title: 'Lo que no recopilamos',
      blocks: [
        'Contactos, fotos, micrófono, cámara, ubicación precisa, identificadores de publicidad y datos de pago. El juego no tiene chat: las reacciones son emojis de una lista fija.',
      ],
    },
    {
      id: 'public',
      title: 'Lo que ven otros jugadores',
      blocks: [
        {
          list: [
            'Tu nombre visible, tu avatar, tu país (como bandera), tus puntuaciones, tu nivel y tus logros.',
            'En tu tarjeta de jugador y en las tablas de clasificación: número de partidas, porcentaje de victorias, rachas, mejor jugada, promedio de errores, resultados recientes, la interferencia que más envías y cuándo te uniste (mes y año).',
            'Durante una partida: tus puntos, errores, interferencias y reacciones, y si estás en línea.',
            'En una sala para jugar con amigos: cualquier persona que tenga su código o su enlace y entre en la sala ve el nombre, el avatar, la bandera y la puntuación general de todos los que están en ella, y si están en la sala en este momento. El código y el enlace en sí no contienen ninguna información personal.',
            'Repeticiones y detalles de la partida: solo los jugadores de esa partida.',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: 'Denuncias y bloqueos',
      blocks: [
        {
          list: [
            '**Denunciar a un jugador:** cuando denuncias a alguien, conservamos quién hizo la denuncia, a quién se denunció, el motivo (nombre ofensivo, trampas u otro), la partida clasificatoria cuando la denuncia se hizo desde una, y cuándo. Una denuncia no tiene texto libre. Al jugador denunciado no se le informa quién lo denunció.',
            '**Bloquear:** conservamos qué jugadores bloqueaste y cuándo. Debido al bloqueo, no se te pone en la misma partida que ellos, y no se te muestran sus reacciones. Nadie recibe aviso cuando se le bloquea, y un bloqueo no oculta a nadie de las tablas de clasificación.',
            '**Gestión de las denuncias:** el operador del juego revisa cada denuncia en un plazo de 48 horas. Puede reemplazar un nombre ofensivo por uno temporal (en ese caso, se le pide al jugador que elija un nombre nuevo) o suspender una cuenta de las partidas clasificatorias y de los cambios en la cuenta. Cada una de estas acciones queda en un registro interno, con la dirección del administrador que la realizó y, cuando se reemplazó un nombre, el nombre anterior y el nuevo. Un nombre reemplazado de esta forma pasa a una lista de nombres que nadie puede volver a elegir (solo el nombre, sin vínculo con ningún jugador).',
            '**Una cuenta suspendida que se elimina:** eliminar una cuenta no levanta una suspensión. Cuando se elimina una cuenta suspendida, conservamos una huella unidireccional (un hash) de su identificador de inicio de sesión y de su dirección de correo electrónico verificada, no el identificador ni la dirección en sí. Una cuenta nueva con el mismo inicio de sesión empieza suspendida hasta que un administrador la revisa, y entonces se elimina la huella. Este es nuestro interés legítimo, y el de todos los jugadores, en el juego limpio.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: 'Para qué usamos los datos',
      blocks: [
        {
          list: [
            '**Para operar el juego:** tu cuenta, tus partidas, tus puntuaciones, el emparejamiento, el historial y las tablas de clasificación. Esto es necesario para nuestro acuerdo contigo (los Términos de uso).',
            '**Seguridad y juego limpio:** límites de frecuencia, detección de anomalías, prevención de trampas y gestión de denuncias y bloqueos. Este es nuestro interés legítimo, y el de todos los jugadores.',
            '**Para mejorar el juego:** saber qué pantallas y modos se juegan, encontrar problemas y corregir fallos. También es un interés legítimo, sin publicidad y sin perfil de marketing.',
            '**Correo electrónico de servicio:** solo verificación de la dirección y restablecimiento de la contraseña.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Con quién los compartimos',
      blocks: [
        '**No vendemos** datos, y no los transferimos a anunciantes ni a intermediarios de datos. Nuestros proveedores de servicios los procesan solo por cuenta nuestra:',
        {
          list: [
            '**Google (Firebase):** inicio de sesión (Authentication, incluido el inicio de sesión con Google), informes de fallos (Crashlytics) y datos de uso (Analytics).',
            '**Fly.io:** alojamiento del servidor.',
            '**Neon:** la base de datos (PostgreSQL).',
            '**Sentry:** informes de errores del servidor.',
          ],
        },
        'También divulgaremos datos cuando la ley lo exija, o para proteger el juego y a sus jugadores. Si el juego pasa a otro propietario, los datos pasan con él, y esta política seguirá aplicándose a ellos.',
      ],
    },
    {
      id: 'transfers',
      title: 'Dónde están los datos',
      blocks: [
        'El servidor y la base de datos se encuentran actualmente en la Unión Europea (Fráncfort, Alemania). Google y Sentry también pueden procesar datos en los Estados Unidos y en otros países, conforme a sus propias garantías para las transferencias de datos (como las cláusulas contractuales tipo de la UE).',
      ],
    },
    {
      id: 'retention',
      title: 'Cuánto tiempo los conservamos',
      blocks: [
        {
          list: [
            '**Datos de la cuenta:** mientras exista la cuenta.',
            '**Cuando eliminas tu cuenta:** tu correo electrónico, tu país, tu avatar y el vínculo de inicio de sesión se eliminan de inmediato, y tu nombre visible se reemplaza por un identificador anónimo (el nombre anterior queda libre de inmediato). También se elimina tu inicio de sesión de Firebase, con lo que este conservaba de Google. Si iniciaste sesión con Google, la aplicación también revoca el acceso que se le otorgó a tu cuenta de Google.',
            '**Progreso de la práctica por fases:** la copia del servidor (tus estrellas en cada fase y el XP que dieron las fases cada día) se elimina con la cuenta. La copia de tu teléfono se queda hasta que desinstalas la aplicación.',
            '**Lo que queda tras la eliminación, de forma anónima:** partidas clasificatorias, puntuaciones, XP, resultados de práctica, registros de juego limpio, denuncias que enviaste y datos de uso. Ya no están vinculados a ti, pero las partidas, las repeticiones y las tablas de clasificación de los demás jugadores se mantienen completas.',
            '**Denuncias, bloqueos y el registro de administración:** un bloqueo se conserva hasta que lo quitas o eliminas tu cuenta (entonces se eliminan todos sus bloqueos, en ambos sentidos). Las denuncias y el registro de las acciones de los administradores se conservan mientras sean necesarios para gestionar denuncias y mantener el juego seguro y justo; los revisamos de vez en cuando y eliminamos los antiguos. Cuando se elimina una cuenta, se cierran las denuncias abiertas sobre ella y sus nombres se eliminan del registro de administración. Si estaba suspendida, solo queda la huella unidireccional descrita arriba, hasta que se cree una cuenta nueva con el mismo inicio de sesión o hasta que la eliminemos en una revisión periódica.',
            '**Datos de uso:** se conservan mientras nos ayuden a entender cómo se usa el juego. Los revisamos de vez en cuando y eliminamos los datos antiguos.',
            '**Crashlytics:** Google conserva los informes de fallos hasta 90 días. **Analytics:** durante el período de conservación que configuramos en Firebase.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: 'Tus derechos',
      blocks: [
        'Puedes pedir ver tus datos, corregirlos (puedes cambiar tu nombre, tu avatar y tu país en la aplicación), eliminarlos (eliminando tu cuenta en la aplicación) u oponerte a su uso. Escríbenos a {email} y te responderemos en un plazo de 30 días.',
        'También puedes presentar una reclamación ante la Autoridad de Protección de la Privacidad de Israel o ante la autoridad de protección de datos de tu país.',
      ],
    },
    {
      id: 'children',
      title: 'Menores de edad',
      blocks: [
        'El juego no está dirigido a menores de 13 años, y no recopilamos a sabiendas datos sobre ellos. Si nos enteramos de que un menor de 13 años abrió una cuenta, la eliminaremos. Donde la edad mínima sea mayor, se necesita el consentimiento del padre o la madre hasta esa edad.',
      ],
    },
    {
      id: 'security',
      title: 'Seguridad',
      blocks: [
        'El tráfico entre la aplicación y el servidor está cifrado (HTTPS y WSS). Las contraseñas las gestiona Firebase y nosotros no las almacenamos. El acceso a los datos del servidor está limitado al operador del juego. Ningún sistema es perfectamente seguro, pero hacemos esfuerzos razonables para proteger tus datos.',
      ],
    },
    {
      id: 'changes',
      title: 'Cambios en esta política',
      blocks: [
        'Cuando esta política cambie, actualizaremos aquí la fecha. También anunciaremos en la aplicación los cambios sustanciales.',
      ],
    },
    {
      id: 'contact',
      title: 'Contacto',
      blocks: ['{operator} · {email}', 'Consulta también los [Términos de uso](terms).'],
    },
  ],
};

export const TERMS_ES: LegalDoc = {
  title: 'Términos de uso',
  lead: 'Las reglas para usar Sudoku Fight. Usar el juego significa que las aceptas.',
  sections: [
    {
      id: 'acceptance',
      title: 'Aceptación',
      blocks: [
        'Estos términos se aplican a la aplicación Sudoku Fight y a sus servicios (“el juego”), operados por {operator} (“nosotros”). Al registrarte o usar el juego, aceptas estos términos y la [Política de privacidad](privacy).',
      ],
    },
    {
      id: 'eligibility',
      title: 'Quién puede jugar',
      blocks: [
        'Debes tener al menos 13 años, o la edad mínima que establezca la ley de tu país si es mayor. Si tienes menos de 18 años, necesitas el consentimiento de tu padre, tu madre o tu tutor.',
      ],
    },
    {
      id: 'account',
      title: 'Tu cuenta',
      blocks: [
        {
          list: [
            'Una cuenta por persona, con tu propio correo electrónico.',
            'Mantén segura tu contraseña (o la cuenta de Google con la que inicias sesión). Eres responsable de todo lo que se haga con tu cuenta.',
            'Puedes eliminar tu cuenta en cualquier momento en la aplicación: Configuración → Eliminar cuenta.',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: 'Nombres visibles y conducta',
      blocks: [
        'Todos los jugadores pueden ver tu nombre visible, tu avatar y tu país. Un nombre no debe:',
        {
          list: [
            'ser ofensivo, racista, sexual, amenazante ni insultante;',
            'suplantar a otra persona, a otro jugador ni al personal del juego;',
            'contener datos personales (un número de teléfono, una dirección), publicidad ni un enlace.',
          ],
        },
        'Los nombres se comprueban automáticamente con una lista de palabras bloqueadas. Podemos cambiar un nombre que infrinja estas reglas, pedir uno nuevo o suspender la cuenta.',
        'Las reacciones en el juego son emojis de una lista fija. Puedes silenciar a un rival desde su tarjeta durante una partida, bloquearlo o denunciarlo (siguiente sección).',
      ],
    },
    {
      id: 'reports',
      title: 'Denunciar y bloquear',
      blocks: [
        'Puedes denunciar a un jugador desde su tarjeta o desde la partida, con uno de tres motivos: nombre ofensivo, trampas u otro. **Revisamos cada denuncia en un plazo de 48 horas.**',
        'Si se infringieron las reglas, podemos reemplazar el nombre por uno temporal (en ese caso, se le pide al jugador que elija un nombre nuevo, y la regla de los 30 días no se aplica a esa elección), suspender la cuenta de las partidas clasificatorias y de los cambios en la cuenta hasta que se levante la suspensión, o cerrarla. Un nombre reemplazado de esta forma no se puede volver a elegir. Una cuenta suspendida se puede eliminar igualmente en cualquier momento, pero eliminarla no levanta la suspensión: una cuenta nueva con el mismo inicio de sesión empieza suspendida hasta que la revisemos.',
        'También puedes bloquear a un jugador: no se te pondrá en la misma partida que esa persona, y no se te mostrarán sus reacciones. Quita un bloqueo en Configuración → Jugadores bloqueados. Un bloqueo no oculta a nadie de las tablas de clasificación.',
        'No denuncies sin motivo: las denuncias falsas repetidas infringen estos términos.',
      ],
    },
    {
      id: 'fair-play',
      title: 'Juego limpio',
      blocks: [
        'No debes:',
        {
          list: [
            'usar solucionadores de sudoku, bots, scripts, automatización ni una aplicación modificada;',
            'tener varias cuentas para influir en las puntuaciones, acordar resultados con otro jugador ni perder a propósito;',
            'aprovechar fallos del juego en lugar de informarnos de ellos;',
            'sobrecargar nuestros servidores, intentar acceder a ellos sin autorización ni perjudicar a otros jugadores.',
          ],
        },
        'El servidor marca las partidas inusuales para revisarlas. Si se infringieron las reglas, podemos anular resultados, restablecer puntuaciones o suspender y cerrar la cuenta.',
      ],
    },
    {
      id: 'virtual',
      title: 'Puntuaciones, XP y logros',
      blocks: [
        'Las puntuaciones, el XP, los niveles y los logros no tienen valor monetario, y no se pueden transferir ni vender. Podemos cambiar cómo se calculan o restablecerlos (por ejemplo, al comienzo de una temporada).',
        'El juego es gratuito. Esta versión no tiene compras ni anuncios.',
      ],
    },
    {
      id: 'service',
      title: 'Disponibilidad',
      blocks: [
        'Las partidas clasificatorias necesitan conexión a internet. Cuando no hay jugadores disponibles, es posible que te emparejemos con un rival controlado por computadora que juega a un ritmo similar al tuyo. Esas partidas cuentan para tu puntuación. El juego también puede ofrecerte una partida de práctica contra un bot, sin puntuación. Si el servidor se reinicia durante una partida clasificatoria, esa partida termina sin cambios en la puntuación.',
        'Podemos cambiar, pausar o interrumpir partes del juego, y procuraremos avisar con antelación de los cambios sustanciales.',
      ],
    },
    {
      id: 'ip',
      title: 'Propiedad intelectual',
      blocks: [
        'El juego, su diseño, su código, sus sonidos y sus avatares nos pertenecen a nosotros o a quienes nos otorgaron una licencia sobre ellos. Te otorgamos una licencia personal, no exclusiva y no comercial para usar el juego conforme a estos términos. Las licencias de terceros se enumeran en la aplicación: Configuración → Licencias.',
      ],
    },
    {
      id: 'stores',
      title: 'Tiendas de aplicaciones',
      blocks: [
        'Apple y Google no son partes de estos términos y no son responsables del juego. Si descargaste el juego desde el App Store, también se aplica el Contrato de Licencia de Usuario Final Estándar de Apple (EULA), y Apple y sus subsidiarias pueden hacer cumplir estos términos como terceros beneficiarios.',
      ],
    },
    {
      id: 'disclaimer',
      title: 'Exención de responsabilidad',
      blocks: [
        'El juego se ofrece “tal cual”. En la medida en que la ley lo permita, no garantizamos que funcione sin interrupciones ni errores, y no somos responsables de daños indirectos, pérdida de datos ni pérdida de puntuaciones. Nada en estos términos limita los derechos que la ley te otorga y a los que no se puede renunciar.',
      ],
    },
    {
      id: 'termination',
      title: 'Terminación',
      blocks: [
        'Puedes dejar de jugar y eliminar tu cuenta en cualquier momento. Podemos suspender o cerrar una cuenta que infrinja estos términos.',
      ],
    },
    {
      id: 'changes',
      title: 'Cambios en estos términos',
      blocks: [
        'Cuando estos términos cambien, actualizaremos aquí la fecha. También anunciaremos en la aplicación los cambios sustanciales. Usar el juego después de un cambio significa que aceptas los nuevos términos.',
      ],
    },
    {
      id: 'law',
      title: 'Ley aplicable',
      blocks: [
        'Estos términos se rigen por las leyes del Estado de Israel, y los tribunales competentes del distrito de Tel Aviv tienen jurisdicción exclusiva, salvo que la ley de tu país te otorgue un derecho al que no se pueda renunciar.',
      ],
    },
    {
      id: 'contact',
      title: 'Contacto',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_ES: LegalDoc = {
  title: 'Eliminar tu cuenta',
  lead: 'Cómo eliminar tu cuenta de Sudoku Fight y qué pasa con tus datos.',
  sections: [
    {
      id: 'in-app',
      title: 'En la aplicación (de inmediato)',
      blocks: [
        {
          list: [
            'Abre Sudoku Fight y ve a **Configuración**.',
            'Toca **Eliminar cuenta** y confirma.',
            'Escribe tu contraseña o, si inicias sesión con Google, vuelve a elegir tu cuenta de Google. La cuenta se elimina de inmediato y la aplicación vuelve a la pantalla de inicio de sesión.',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: 'Sin la aplicación',
      blocks: [
        'Escríbenos a {email} **desde la dirección de correo electrónico de tu cuenta**, con el asunto “Eliminar mi cuenta” y tu nombre visible. Comprobaremos que la solicitud proviene del titular de la cuenta y la eliminaremos en un plazo de 30 días. Te lo confirmaremos por correo electrónico cuando esté hecho.',
      ],
    },
    {
      id: 'what',
      title: 'Qué se elimina y qué se conserva',
      blocks: [
        {
          list: [
            '**Se eliminan de inmediato:** tu correo electrónico, tu país, tu avatar, tu inicio de sesión (también en Firebase) y el vínculo entre tu cuenta y tus instalaciones. Tu nombre visible se reemplaza por un identificador anónimo y queda libre para otros.',
            '**Se conservan de forma anónima:** partidas clasificatorias, puntuaciones, XP, resultados de práctica, registros de juego limpio y datos de uso. Ya no están vinculados a ti, pero las partidas y las tablas de clasificación de los demás jugadores se mantienen completas.',
            '**En tu teléfono:** las partidas de práctica de tu teléfono se quedan ahí hasta que desinstalas la aplicación.',
            '**En Google:** los informes de fallos se conservan hasta 90 días, y los datos de Analytics durante el período de conservación configurado.',
          ],
        },
        'Más información en la [Política de privacidad](privacy).',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_ES: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_ES,
  terms: TERMS_ES,
  'delete-account': DELETE_ACCOUNT_ES,
};

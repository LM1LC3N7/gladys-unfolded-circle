// -----------------------------------------------------------------------------
// The texts users read in Gladys (connection status, the configuration
// button, command errors), in English and French.
// -----------------------------------------------------------------------------

const both = (en, fr) => ({ en, fr });

/** "14:05 UTC" for a time in ms. */
const clock = (ms) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

/** "5 min", "2 h". */
export function duration(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

export const T = {
  missing: both(
    'Type the address of the remote and its API key in the configuration (see the guide).',
    "Saisissez l'adresse de la télécommande et sa clé API dans la configuration (voir le guide).",
  ),
  invalidHost: both(
    'The address of the remote is not a plain address (for example 192.168.1.20 or remote.local).',
    "L'adresse de la télécommande n'est pas une simple adresse (par exemple 192.168.1.20 ou remote.local).",
  ),
  refused: (nextAt) =>
    both(
      `The remote refused the API key (revoked, or another remote). Paste a new key in the configuration and save, or click "Reconnect". Next try by itself at ${clock(nextAt)}.`,
      `La télécommande a refusé la clé API (révoquée, ou autre télécommande). Collez une nouvelle clé dans la configuration et enregistrez, ou cliquez sur « Se reconnecter ». Prochain essai automatique à ${clock(nextAt)}.`,
    ),
  paused: (until) =>
    both(
      `The remote asked to slow down (429) or is busy (5xx): paused until ${clock(until)}.`,
      `La télécommande demande de ralentir (429) ou est occupée (5xx) : en pause jusqu'à ${clock(until)}.`,
    ),
  tls: (error) =>
    both(
      `The certificate of the remote was refused (${error}). Type its address without https:// (the local API is plain HTTP).`,
      `Le certificat de la télécommande a été refusé (${error}). Saisissez son adresse sans https:// (l'API locale est en HTTP simple).`,
    ),
  connecting: both('Connecting to the remote…', 'Connexion à la télécommande…'),
  asleep: (wait) =>
    both(
      `The remote does not answer (asleep, or off the network): next reading in ${duration(wait)}.`,
      `La télécommande ne répond pas (en veille, ou hors du réseau) : prochaine lecture dans ${duration(wait)}.`,
    ),
  failing: (error, wait) =>
    both(
      `The remote does not answer as expected (${error}): next reading in ${duration(wait)}.`,
      `La télécommande ne répond pas comme prévu (${error}) : prochaine lecture dans ${duration(wait)}.`,
    ),
  connected: (count) =>
    both(
      `Connected: ${count} activit${count === 1 ? 'y' : 'ies'} on the remote.`,
      `Connecté : ${count} activité(s) sur la télécommande.`,
    ),
  dataReset: both(
    'The saved data was unreadable and was reset.',
    'Les données enregistrées étaient illisibles et ont été réinitialisées.',
  ),
  reconnectRefusedAgain: both(
    'Tried once: the remote still refuses the API key.',
    'Essai unique : la télécommande refuse toujours la clé API.',
  ),
};

/** Messages of the commands, in English (Gladys shows the error of the ack as is). */
export const E = {
  unknownRemote: 'Unknown remote',
  notCommand: (key) => `"${key}" cannot be commanded`,
  unknownActivity: 'This activity is no longer on the remote: nothing sent',
  notConfigured: 'The address or the API key of the remote is missing: nothing sent',
  blocked: 'The remote refused the API key: nothing sent (see the configuration)',
  paused: 'The remote asked to slow down: start not sent (a stop still is)',
  late: 'No time left for this command: nothing sent',
  cancelled: 'Cancelled by a later stop of the same activity: nothing sent',
  unreachable: 'The remote is unreachable (asleep, or off the network): nothing sent',
  unconfirmed:
    'Command sent, without confirmation: the remote did not answer in time (it may be asleep)',
  refusedCommand: (status) =>
    `Refused by the remote (${status}): command not done; the API key is checked by a reading`,
  tls: 'The certificate of the remote was refused (https://): nothing sent; use its http:// address',
  rateLimited: 'The remote asked to slow down (429): command not done',
  failed: (status) => `The remote answered ${status}: command not done`,
};

# Unfolded Circle Remote pour Gladys

Cette intégration amène dans Gladys une télécommande **Unfolded Circle Remote
Two** ou **Remote 3**, par l'API locale de la télécommande (Core API REST,
documentée par Unfolded Circle) : sans cloud, tout reste sur votre réseau.

> **Attention : jamais testé avec un vrai appareil.** Cette intégration n'a
> jamais été testée avec un vrai appareil : elle a été écrite d'après la
> bibliothèque pyUnfoldedCircleRemote et testée seulement avec des réponses
> simulées. Vos retours sont les bienvenus sur le forum de Gladys.

Non officielle, sans lien avec Unfolded Circle.

## Ce que montre la télécommande

| Fonctionnalité        | Type          | Valeurs                                                    |
| --------------------- | ------------- | ---------------------------------------------------------- |
| Batterie              | lecture seule | niveau de charge, en %                                     |
| En charge             | lecture seule | 1 sur son socle ou son câble, 0 sinon                      |
| Joignable             | lecture seule | 1 la télécommande a répondu à la dernière lecture, 0 sinon |
| Mode d'alimentation   | texte         | Normal, Inactive, Économie d’énergie, En veille            |
| Activité en cours     | texte         | noms des activités en marche, « — » si aucune              |
| _activité_ : en cours | lecture seule | 1 l'activité est en marche, 0 arrêtée (une par activité)   |
| Démarrer _activité_   | bouton        | démarre l'activité (`activity.on`)                         |
| Arrêter _activité_    | bouton        | arrête l'activité (`activity.off`)                         |

Démarrer et arrêter sont des **boutons**, pas un interrupteur : un « tout
éteindre » d'un assistant vocal ou d'une scène ne peut pas les déclencher.
L'état de chaque activité peut servir de déclencheur de scène.

Les activités sont celles que vous avez créées sur la télécommande (50 au
plus). Une activité ajoutée sur la télécommande apparaît dans l'onglet
**Découverte** à la lecture suivante ; une activité supprimée garde ses
fonctionnalités dans Gladys (son historique n'est pas perdu), mais ses boutons
répondent qu'elle n'existe plus.

## Configuration

1. **Adresse de la télécommande** : son adresse IP ou son nom sur votre
   réseau (réglages de la télécommande, Wi-Fi). Donnez-lui de préférence une
   adresse fixe dans votre box. Un port peut suivre (`192.168.1.20:8080`).
2. **Clé API** : voir ci-dessous.
3. **Intervalle de lecture** : 30 secondes à 5 minutes (1 minute par défaut).
4. Enregistrez. La télécommande apparaît dans l'onglet **Découverte** :
   ajoutez-la.

La clé est gardée par Gladys dans sa base, jamais réaffichée, et envoyée
seulement à votre télécommande, dans l'en-tête `Authorization` de chaque
requête. L'API locale de la télécommande est en HTTP simple : la clé circule
en clair sur votre réseau local, comme pour l'application web de la
télécommande.

### Créer une clé API

La clé se crée avec le code PIN du configurateur web de la télécommande
(affiché sur la télécommande dans les réglages du profil, rubrique
configurateur web). Depuis un ordinateur du même réseau :

```bash
curl -u web-configurator:<PIN> -X POST http://<adresse>/api/auth/api_keys \
  -H 'Content-Type: application/json' \
  -d '{"name": "Gladys", "scopes": ["admin"]}'
```

La réponse contient `api_key` : copiez sa valeur dans le champ **Clé API**.
Elle n'est montrée qu'une fois. Le PIN n'est jamais demandé par
l'intégration. Pour révoquer la clé plus tard :
`GET /api/auth/api_keys` (avec le PIN) puis
`DELETE /api/auth/api_keys/<key_id>`.

## Veille

Pour économiser sa batterie, la télécommande se met en veille et coupe son
Wi-Fi : elle ne répond plus. « Joignable » passe à 0, les autres valeurs
gardent leur dernière lecture, et l'intégration réessaie à chaque intervalle
(jamais plus vite). Les valeurs reviennent dès son réveil (un appui, une
prise en main, le socle). Un bouton pressé pendant la veille répond que la
télécommande est injoignable : rien n'est envoyé. L'intégration ne réveille
pas la télécommande (pas de Wake-on-LAN dans cette version).

Pendant la veille, chaque lecture ne coûte qu'une requête (la liste des
activités) : la batterie et le mode ne sont demandés que si elle a répondu.

> **Question aux testeurs** : dites-nous sur le forum si des lectures toutes
> les 30 secondes empêchent la télécommande de se mettre en veille ou vident
> sa batterie plus vite. En cas de doute, gardez 1 minute ou plus.

## Commandes

- « Démarrer » est envoyé dans l'ordre des appuis, une commande à la fois.
- « Arrêter » part tout de suite, sans attendre les démarrages en file, et
  annule les démarrages de la même activité qui attendaient encore. Il est
  toujours essayé une fois, même pendant une pause ou quand la clé est tenue
  pour refusée, et même pour une activité que l'intégration n'a pas encore
  relue.
- Chaque commande doit aboutir en 3,5 secondes (Gladys attend 5 secondes).
  Si la télécommande ne répond pas à temps, Gladys affiche « envoyée, sans
  confirmation » et l'état est relu deux secondes plus tard.
- Après des commandes, les relectures sont regroupées : une au plus toutes
  les 10 secondes.
- Une commande refusée par la télécommande (401 ou 403) n'arrête pas
  l'intégration : une lecture vérifie aussitôt la clé, et seule une lecture
  refusée la tient pour refusée.

## Statut et erreurs

- **Clé refusée** (révoquée, ou une autre télécommande à cette adresse) :
  l'intégration s'arrête et ne réessaie toute seule qu'après 1 heure, puis
  6 heures, puis toutes les 24 heures. Cet arrêt est gardé après un
  redémarrage. Collez une nouvelle clé (essayée aussitôt, même si une
  lecture était en cours) ou cliquez sur **Se reconnecter** (un seul essai).
- **Trop de requêtes (429) ou télécommande occupée (5xx)** : une pause de
  1 minute à 6 heures (5 minutes par défaut pour un 5xx, 15 minutes pour un
  429), gardée après un redémarrage. Pendant la pause, rien n'est lu et
  « Démarrer » est refusé ; « Arrêter » part quand même (un seul essai). Un
  5xx de la liste des activités déclenche la pause ; un 5xx de la batterie,
  du mode d'alimentation ou de l'identité d'une télécommande déjà connue
  (aussi au redémarrage, à une nouvelle clé ou à « Se reconnecter ») laisse
  seulement ces valeurs de côté : l'identité enregistrée est gardée et
  redemandée 6 heures plus tard, les activités restent suivies. Seule la
  toute première lecture de l'identité, sans laquelle il n'y a pas
  d'appareil, met en pause sur un 5xx. Un 429 déclenche toujours la pause.
- **Certificat refusé** : une adresse en `https://` avec un certificat
  auto-signé est refusée ; le statut le dit et rien n'est envoyé. Saisissez
  l'adresse sans `https://` (l'API locale est en HTTP simple).
- **Pas de réponse** : voir « Veille ».

## Confidentialité

L'intégration parle seulement à votre télécommande, sur votre réseau. Elle lit
`/api/pub/version` (sans clé), `/api/system`, `/api/system/power`,
`/api/system/power/battery` et `/api/activities`, et envoie les commandes
d'activité à `/api/entities/<activité>/command`. Rien ne part vers Internet.

## Remerciements

Port en JavaScript de
[pyUnfoldedCircleRemote](https://github.com/jackjpowell/py-unfolded-circle)
(MIT), la bibliothèque de l'intégration Home Assistant de Jack Powell.

// GET /api/favori.js : code chargé par un favori court depuis une page du jeu. Aucun pour l'instant.

import { HttpError } from './http.js';

export function favoriScript() {
  throw new HttpError(404, "Aucun code de favori n'est servi ici.");
}

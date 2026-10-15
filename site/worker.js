// Point d'entrée quand le site est déployé comme Worker Cloudflare (wrangler.jsonc) plutôt que comme projet Pages :
// /api/* va au même routeur que les Pages Functions (functions/api/[[path]].js), le reste aux fichiers de public/
// (servis par Cloudflare, avec public/_headers). En projet Pages, ce fichier est ignoré.
import { onRequest } from './functions/api/[[path]].js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return onRequest({
        request,
        env,
        params: { path: url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean) },
        data: {},
        waitUntil: (p) => ctx.waitUntil(p),
        next: () => env.ASSETS.fetch(request),
      });
    }
    return env.ASSETS.fetch(request);
  },
};

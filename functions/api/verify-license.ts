// Cloudflare Pages Function: POST /api/verify-license
// Server configuration (Cloudflare dashboard → Pages project → Settings → Variables):
//   GUMROAD_PRODUCT_ID  the product id shown on the Gumroad product's license key settings.
import { handleVerifyRequest } from '../../server/license';

interface Env {
  GUMROAD_PRODUCT_ID?: string;
}

export const onRequest = (ctx: { request: Request; env: Env }) => handleVerifyRequest(ctx.request, ctx.env.GUMROAD_PRODUCT_ID);

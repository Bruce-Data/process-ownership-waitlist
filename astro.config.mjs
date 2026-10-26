import { defineConfig } from 'astro/config';

// Static site for Cloudflare Pages — no adapter needed.
// Form POSTs to a separate Worker (see worker/ and wrangler.toml).
export default defineConfig({
  output: 'static',
  site: 'https://process-ownership-waitlist.pages.dev',
});

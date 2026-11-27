import {writeFileSync} from 'node:fs';

// Only explicit repository variables become public browser configuration.
// Private Google and OAuth secrets belong on the authentication backend.
export function browserImageryConfig(env = process.env) {
  const out = {};
  for (const [name,field,min] of [
    ['ESRI_API_KEY','esriKey',20],
    ['GOOGLE_MAPS_BROWSER_API_KEY','googleMapsKey',20],
    ['GITHUB_CLIENT_ID','githubClientId',10],
  ]) {
    const value = env[name] || '';
    if (!value) continue;
    if (!new RegExp('^[A-Za-z0-9._-]{'+min+',}$').test(value)) throw new Error(name+' has an unexpected format');
    out[field] = value;
  }
  if (env.AUTH_BACKEND_ORIGIN) {
    const url = new URL(env.AUTH_BACKEND_ORIGIN);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('AUTH_BACKEND_ORIGIN must be a bare HTTPS origin');
    out.authBackendOrigin = url.origin;
  }
  if (env.GITHUB_ADMIN_REPO) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_ADMIN_REPO)) throw new Error('Invalid GITHUB_ADMIN_REPO');
    out.adminRepo = env.GITHUB_ADMIN_REPO;
  }
  return out;
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1],'file:').href) {
  const config = browserImageryConfig();
  writeFileSync('styles/imagery-config.json',JSON.stringify(config)+'\n');
  console.log('Imagery configuration written; OAuth backend '+(config.authBackendOrigin?'configured':'not configured')+'.');
}

// @ts-check
/**
 * lib/apec-signin.mjs — sign in to APEC in a browser page, with the login the agents use
 * (lib/freemotion-credentials.mjs, domain www.apec.fr).
 *
 * #25: since 2026-10-01 APEC's bot check stopped the scan's route lookups almost at once, from a
 * fresh, never-signed-in profile. The user chose (2026-10-12) to do the lookups inside a signed-in
 * session, like the agents. APEC keeps the sign-in for the browser session only (checked 2026-10-12:
 * gone after a restart), so each lookup run signs in once; the profile it runs in is kept
 * (freemotion-night/apec-route.mjs), with its cookies and cookie choice.
 *
 * Steps as found on 2026-10-12: the cookie banner (Didomi) is dismissed without accepting, "Mon
 * espace" opens the sign-in box (#emailid, #password, "Se connecter"), and a signed-in page greets
 * with "Bonjour". A CAPTCHA is reported, never worked around.
 */
import { loadCredentials } from './freemotion-credentials.mjs';
import { isCaptchaPage } from './camoufox-page.mjs';

/**
 * @param {import('playwright').Page} page
 * @param {{ cred?: { email?: string, username?: string, password?: string } | null, root?: string }} [opts]
 * @returns {Promise<{ ok: boolean, why?: string }>}
 */
export async function signInApec(page, { cred, root } = {}) {
  const login = cred ?? loadCredentials('www.apec.fr', root ? { root } : {});
  const email = login?.email || login?.username;
  if (!email || !login?.password) return { ok: false, why: 'no APEC login saved (lib/freemotion-credentials.mjs)' };
  await page.goto('https://www.apec.fr/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500 + Math.random() * 2000);
  if (isCaptchaPage(await page.content())) return { ok: false, why: 'CAPTCHA on the home page' };
  const consent = page.locator('#didomi-notice-disagree-button, #didomi-notice-agree-button').first();
  if (await consent.isVisible().catch(() => false)) { await consent.click(); await page.waitForTimeout(1000); }
  await page.locator('a[aria-label="Mon espace"]').first().click();
  await page.waitForTimeout(1500 + Math.random() * 1000);
  await page.locator('#emailid').fill(email);
  await page.locator('#password').fill(login.password);
  await page.waitForTimeout(600 + Math.random() * 800);
  await page.locator('button.popin-btn-primary:has-text("Se connecter")').click();
  await page.waitForTimeout(6000);
  const html = await page.content();
  if (isCaptchaPage(html)) return { ok: false, why: 'CAPTCHA at sign-in' };
  const text = await page.evaluate(() => document.body.innerText);
  return /Bonjour/.test(text) ? { ok: true } : { ok: false, why: 'not signed in after "Se connecter" (wrong login, or the page changed)' };
}

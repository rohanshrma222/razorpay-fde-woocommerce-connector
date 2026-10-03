import "dotenv/config";
import crypto from "node:crypto";

export interface WooCommerceConfig {
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export class WooCommerceAuthError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "WooCommerceAuthError";
  }
}

export function loadWooCommerceConfig(): WooCommerceConfig {
  const siteUrl = process.env.WC_SITE_URL;
  const consumerKey = process.env.WC_CONSUMER_KEY;
  const consumerSecret = process.env.WC_CONSUMER_SECRET;
  if (!siteUrl || !consumerKey || !consumerSecret) {
    throw new Error(
      "Missing WooCommerce credentials — set WC_SITE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET in .env (see .env.example)"
    );
  }
  return { siteUrl: siteUrl.replace(/\/+$/, ""), consumerKey, consumerSecret };
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * Signs a request per WooCommerce's OAuth 1.0a "one-legged" scheme — required
 * over plain HTTP. (A deployment serving WooCommerce over real HTTPS could use
 * simpler Basic Auth with the same consumer key/secret instead.)
 */
export function signRequestUrl(
  url: string,
  method: string,
  config: WooCommerceConfig,
  extraParams: Record<string, string> = {}
): string {
  const [baseUrl, existingQuery] = url.split("?");
  const queryParams: Record<string, string> = {};
  if (existingQuery) {
    for (const [key, value] of new URLSearchParams(existingQuery)) {
      queryParams[key] = value;
    }
  }

  const oauthParams: Record<string, string> = {
    ...queryParams,
    ...extraParams,
    oauth_consumer_key: config.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };

  const sortedKeys = Object.keys(oauthParams).sort();
  const paramString = sortedKeys
    .map((key) => `${percentEncode(key)}=${percentEncode(oauthParams[key])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join("&");

  // One-legged OAuth1.0a: no token secret, just the consumer secret + "&".
  const signingKey = `${percentEncode(config.consumerSecret)}&`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  const allParams: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  const finalQuery = Object.keys(allParams)
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
    .join("&");

  return `${baseUrl}?${finalQuery}`;
}

/** Startup check — confirms credentials work before the MCP server advertises any tools. */
export async function whoami(config: WooCommerceConfig): Promise<{ siteUrl: string }> {
  const url = signRequestUrl(`${config.siteUrl}/wp-json/wc/v3/orders`, "GET", config, {
    per_page: "1",
  });

  let res: Response;
  try {
    res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) });
  } catch (err) {
    throw new WooCommerceAuthError(
      `Could not reach WooCommerce store at ${config.siteUrl}: ${(err as Error).message}`
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new WooCommerceAuthError(
      `WooCommerce authentication failed (HTTP ${res.status}) — check WC_CONSUMER_KEY/WC_CONSUMER_SECRET`,
      res.status
    );
  }
  if (!res.ok) {
    throw new WooCommerceAuthError(
      `WooCommerce store returned HTTP ${res.status} — is the store running and reachable?`,
      res.status
    );
  }

  return { siteUrl: config.siteUrl };
}

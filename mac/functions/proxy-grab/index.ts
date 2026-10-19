// Edge function: fetches free proxy lists from public sources server-side,
// bypassing browser CORS restrictions. Returns a deduplicated, validated list
// of "ip:port" strings for the requested protocol.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const IP_PORT_RE =
  /\b((?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d):(?:[1-9]\d{0,4}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])\b/g;

// Raw text sources grouped by protocol. These are plain ip:port lists.
const TEXT_SOURCES: Record<string, string[]> = {
  http: [
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/protocols.txt/http",
    "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
    "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/all-proxies.txt",
    "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all",
    "https://www.proxy-list.download/api/v1/get?type=http",
    "https://raw.githubusercontent.com/sunny9577/proxy/master/proxy_list.txt",
    "https://raw.githubusercontent.com/MuRongPI/Proxy/main/http.txt",
    "https://raw.githubusercontent.com/ze3ora/proxy-list/master/proxy-list.txt",
  ],
  https: [
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/all-proxies.txt",
    "https://api.proxyscrape.com/v2/?request=getproxies&protocol=https&timeout=10000&country=all&ssl=all&anonymity=all",
    "https://www.proxy-list.download/api/v1/get?type=https",
    "https://raw.githubusercontent.com/MuRongPI/Proxy/main/https.txt",
  ],
  socks4: [
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt",
    "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/all-proxies.txt",
    "https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks4&timeout=10000&country=all",
    "https://www.proxy-list.download/api/v1/get?type=socks4",
    "https://raw.githubusercontent.com/MuRongPI/Proxy/main/socks4.txt",
  ],
  socks5: [
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
    "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/all-proxies.txt",
    "https://raw.githubusercontent.com/Stormsia/free-proxy-list/main/socks5.txt",
    "https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks5&timeout=10000&country=all",
    "https://www.proxy-list.download/api/v1/get?type=socks5",
    "https://raw.githubusercontent.com/MuRongPI/Proxy/main/socks5.txt",
  ],
};

// HTML pages that need to be scraped for ip:port. Kept small since parsing HTML
// is unreliable; the raw .txt sources above are the primary feed.
const HTML_SOURCES: string[] = [
  "https://proxyscrape.com/free-proxy-list",
  "https://geonode.com/free-proxy-list",
  "https://raw.githubusercontent.com/Stormsia/proxy-list/gh-pages/index.html",
];

function extractProxies(text: string, seen: Set<string>, out: string[]) {
  let m: RegExpExecArray | null;
  IP_PORT_RE.lastIndex = 0;
  while ((m = IP_PORT_RE.exec(text)) !== null) {
    const p = m[0];
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ProxyGrabber/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let type = (url.searchParams.get("type") || "http").toLowerCase();
    if (!(type in TEXT_SOURCES)) type = "http";
    const includeHtml = (url.searchParams.get("html") || "1") === "1";

    const textUrls = TEXT_SOURCES[type];
    const seen = new Set<string>();
    const proxies: string[] = [];
    const sources: { url: string; ok: boolean; count: number }[] = [];

    // Fetch text sources in parallel.
    const textResults = await Promise.allSettled(
      textUrls.map(async (u) => {
        const body = await fetchWithTimeout(u);
        const before = proxies.length;
        extractProxies(body, seen, proxies);
        return { url: u, ok: true, count: proxies.length - before };
      })
    );
    textResults.forEach((r, i) => {
      if (r.status === "fulfilled") sources.push(r.value);
      else sources.push({ url: textUrls[i], ok: false, count: 0 });
    });

    // Optionally scrape a couple of HTML pages for extra proxies.
    if (includeHtml) {
      const htmlResults = await Promise.allSettled(
        HTML_SOURCES.map(async (u) => {
          const body = await fetchWithTimeout(u);
          const before = proxies.length;
          extractProxies(body, seen, proxies);
          return { url: u, ok: true, count: proxies.length - before };
        })
      );
      htmlResults.forEach((r, i) => {
        if (r.status === "fulfilled") sources.push(r.value);
        else sources.push({ url: HTML_SOURCES[i], ok: false, count: 0 });
      });
    }

    const okSources = sources.filter((s) => s.ok).length;

    return new Response(
      JSON.stringify({
        type,
        total: proxies.length,
        sources_ok: okSources,
        sources_total: sources.length,
        sources,
        proxies,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

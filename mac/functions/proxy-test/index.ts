// Edge function: tests a list of proxies server-side via real TCP connections
// and returns the ones that respond correctly for the given protocol.
//
// POST JSON: { type: "http"|"https"|"socks4"|"socks5", proxies: ["ip:port", ...] }
// Response:   { type, tested, working: ["ip:port", ...] }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TEST_TIMEOUT_MS = 5000;
const TEST_TARGET_HOST = "1.1.1.1";
const TEST_TARGET_IP = new Uint8Array([1, 1, 1, 1]);
const TEST_TARGET_PORT = 80;

function parseProxy(p: string): { ip: string; port: number } | null {
  const idx = p.lastIndexOf(":");
  if (idx < 0) return null;
  const ip = p.slice(0, idx);
  const port = parseInt(p.slice(idx + 1), 10);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;
  if (isNaN(port) || port < 1 || port > 65535) return null;
  return { ip, port };
}

function ipToBytes(ip: string): Uint8Array {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  return new Uint8Array(parts);
}

function portToBytes(port: number): [number, number] {
  return [(port >> 8) & 0xff, port & 0xff];
}

async function testHttpProxy(ip: string, port: number): Promise<boolean> {
  // HTTP proxy: send an absolute-URI GET request through the proxy.
  const conn = await Deno.connect({ hostname: ip, port });
  try {
    const req =
      `GET http://${TEST_TARGET_HOST}/generate_204 HTTP/1.1\r\n` +
      `Host: ${TEST_TARGET_HOST}\r\n` +
      `Connection: close\r\n\r\n`;
    await conn.write(new TextEncoder().encode(req));
    const buf = new Uint8Array(64);
    const n = await conn.read(buf);
    if (!n || n < 12) return false;
    const line = new TextDecoder().decode(buf.subarray(0, n));
    return /^HTTP\/1\.[01] [23]\d\d/.test(line);
  } finally {
    conn.close();
  }
}

async function testHttpsProxy(ip: string, port: number): Promise<boolean> {
  // HTTPS via HTTP proxy uses CONNECT. A 200 response to CONNECT means the
  // tunnel was established (proxy is alive and forwarding).
  const conn = await Deno.connect({ hostname: ip, port });
  try {
    const req =
      `CONNECT ${TEST_TARGET_HOST}:443 HTTP/1.1\r\n` +
      `Host: ${TEST_TARGET_HOST}:443\r\n\r\n`;
    await conn.write(new TextEncoder().encode(req));
    const buf = new Uint8Array(64);
    const n = await conn.read(buf);
    if (!n || n < 12) return false;
    const line = new TextDecoder().decode(buf.subarray(0, n));
    return /^HTTP\/1\.[01] 2\d\d/.test(line);
  } finally {
    conn.close();
  }
}

async function testSocks4(ip: string, port: number): Promise<boolean> {
  const conn = await Deno.connect({ hostname: ip, port });
  try {
    const [pHi, pLo] = portToBytes(TEST_TARGET_PORT);
    const ipBytes = ipToBytes(TEST_TARGET_HOST);
    // VN=4 CD=1 DSTPORT DSTIP USERID(empty) NULL
    const req = new Uint8Array([0x04, 0x01, pHi, pLo, ipBytes[0], ipBytes[1], ipBytes[2], ipBytes[3], 0x00]);
    await conn.write(req);
    const resp = new Uint8Array(8);
    const n = await conn.read(resp);
    if (!n || n < 8) return false;
    // VN=0 CD=90 (0x5a) means granted
    return resp[1] === 0x5a;
  } finally {
    conn.close();
  }
}

async function testSocks5(ip: string, port: number): Promise<boolean> {
  const conn = await Deno.connect({ hostname: ip, port });
  try {
    // Greeting: version 5, 1 method, no auth (0x00)
    await conn.write(new Uint8Array([0x05, 0x01, 0x00]));
    const g = new Uint8Array(2);
    let n = await conn.read(g);
    if (!n || n < 2 || g[0] !== 0x05 || g[1] !== 0x00) return false;
    // Connect request to 1.1.1.1:80
    const [pHi, pLo] = portToBytes(TEST_TARGET_PORT);
    const ipBytes = ipToBytes(TEST_TARGET_HOST);
    const req = new Uint8Array([0x05, 0x01, 0x00, 0x01, ipBytes[0], ipBytes[1], ipBytes[2], ipBytes[3], pHi, pLo]);
    await conn.write(req);
    const r = new Uint8Array(10);
    n = await conn.read(r);
    if (!n || n < 2 || r[0] !== 0x05) return false;
    return r[1] === 0x00; // 0x00 = succeeded
  } finally {
    conn.close();
  }
}

async function testOne(type: string, proxy: string): Promise<boolean> {
  const parsed = parseProxy(proxy);
  if (!parsed) return false;
  const { ip, port } = parsed;
  const tester =
    type === "socks4" ? testSocks4 : type === "socks5" ? testSocks5 : type === "https" ? testHttpsProxy : testHttpProxy;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TEST_TIMEOUT_MS);
    const result = await Promise.race([
      tester(ip, port),
      new Promise<boolean>((_, reject) => ctrl.signal.addEventListener("abort", () => reject(new Error("timeout")))),
    ]);
    clearTimeout(t);
    return result;
  } catch {
    return false;
  }
}

// Run tests with bounded concurrency so we don't open hundreds of sockets.
async function testBatch(type: string, list: string[], concurrency: number): Promise<string[]> {
  const working: string[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (cursor < list.length) {
      const i = cursor++;
      if (await testOne(type, list[i])) working.push(list[i]);
    }
  });
  await Promise.all(workers);
  return working;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const type = String(body?.type || "http").toLowerCase();
    const proxies: string[] = Array.isArray(body?.proxies) ? body.proxies.filter((p) => typeof p === "string") : [];

    if (proxies.length === 0) {
      return new Response(
        JSON.stringify({ type, tested: 0, working: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const working = await testBatch(type, proxies, 20);

    return new Response(
      JSON.stringify({ type, tested: proxies.length, working }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

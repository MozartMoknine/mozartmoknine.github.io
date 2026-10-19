

/* ------------------------------------------------------------------ */
/* App shell + navigation                                              */
/* ------------------------------------------------------------------ */

const SUPABASE_URL = 'https://kahnxhsqdjzbljfdytyw.supabase.co';

const PROXY_API = `${SUPABASE_URL}/functions/v1/proxy-grab`;
const PROXY_TEST_API = `${SUPABASE_URL}/functions/v1/proxy-test`;

const app = document.querySelector('#app')
app.innerHTML = `
  <header class="topbar">
    <div class="brand">Toolbox</div>
    <nav class="nav">
      <button class="nav-link active" data-page="mac">MAC Generator</button>
      <button class="nav-link" data-page="proxy">Proxy Grabber</button>
    </nav>
  </header>
  <main class="page" id="page"></main>
`

const $page = app.querySelector('#page')
const navLinks = app.querySelectorAll('.nav-link')

function setActiveNav(name) {
  navLinks.forEach((b) => b.classList.toggle('active', b.dataset.page === name))
}

function renderPage(name) {
  setActiveNav(name)
  if (name === 'proxy') renderProxyPage()
  else renderMacPage()
}

navLinks.forEach((b) => b.addEventListener('click', () => renderPage(b.dataset.page)))

/* ================================================================== */
/* MAC GENERATOR PAGE                                                  */
/* ================================================================== */

const MAX_DISPLAY = 500000
const BATCH = 50000

function renderMacPage() {
  $page.innerHTML = `
    <section class="hero">
      <h1>MAC Address Generator</h1>
      <p class="subtitle">Enter a MAC prefix, generate every unique combination, and save it as a .txt file.</p>
    </section>

    <section class="panel">
      <label class="field">
        <span class="label">MAC prefix</span>
        <input id="prefix" type="text" inputmode="text" autocomplete="off"
          placeholder="00:1A:79" value="00:1A:79" spellcheck="false" />
        <span class="hint">2 to 5 octets. Use <code>:</code> or <code>-</code> as a separator.</span>
      </label>

      <div class="actions">
        <button id="generate" type="button" class="primary">Generate</button>
        <button id="save" type="button" class="ghost" disabled>Save .txt</button>
        <button id="clear" type="button" class="ghost" disabled>Clear</button>
      </div>

      <div id="status" class="status" hidden></div>
      <div id="progressWrap" class="progress" hidden>
        <div id="progressBar" class="progress-bar"></div>
      </div>

      <label class="field textarea-field">
        <span class="label" id="resultLabel">Generated MACs</span>
        <textarea id="output" rows="18" spellcheck="false" readonly placeholder="Your generated MAC addresses will appear here..."></textarea>
      </label>
    </section>

    <footer class="foot">No duplicate MACs are produced. Large sets are generated in batches so the page never freezes.</footer>
  `

  const $prefix = $page.querySelector('#prefix')
  const $generate = $page.querySelector('#generate')
  const $save = $page.querySelector('#save')
  const $clear = $page.querySelector('#clear')
  const $output = $page.querySelector('#output')
  const $resultLabel = $page.querySelector('#resultLabel')
  const $status = $page.querySelector('#status')
  const $progressWrap = $page.querySelector('#progressWrap')
  const $progressBar = $page.querySelector('#progressBar')

  let generated = []

  function normalizePrefix(raw) {
    const cleaned = String(raw || '').trim().toUpperCase().replace(/[\s.-]/g, ':')
    const parts = cleaned.split(':').filter((p) => p.length > 0)
    if (parts.length < 2 || parts.length > 5) return null
    const octets = []
    for (const p of parts) {
      if (!/^[0-9A-F]{1,2}$/.test(p)) return null
      octets.push(p.padStart(2, '0'))
    }
    return octets.join(':')
  }

  function suffixToOctets(value, suffixOctets) {
    const all = []
    let v = value
    for (let i = 0; i < suffixOctets; i++) {
      all.push((v & 0xff).toString(16).padStart(2, '0').toUpperCase())
      v = Math.floor(v / 256)
    }
    return all
  }

  function setStatus(text, kind = 'info') {
    $status.hidden = !text
    $status.textContent = text || ''
    $status.dataset.kind = kind
  }

  function setProgress(done, total) {
    if (total <= 0) {
      $progressWrap.hidden = true
      return
    }
    $progressWrap.hidden = false
    $progressBar.style.width = Math.min(100, Math.round((done / total) * 100)) + '%'
  }

  async function generate() {
    const prefix = normalizePrefix($prefix.value)
    if (!prefix) {
      setStatus('Please enter a valid MAC prefix (e.g. 00:1A:79).', 'error')
      return
    }
    const suffixOctets = 6 - prefix.split(':').length
    const total = Math.pow(256, suffixOctets)
    if (total > 16777216) {
      setStatus('Prefix is too short — please use at least 2 octets.', 'error')
      return
    }

    $generate.disabled = true
    $prefix.disabled = true
    $save.disabled = true
    $clear.disabled = true
    $output.value = ''
    $resultLabel.textContent = 'Generating…'
    setStatus(`Generating ${total.toLocaleString()} unique MACs for prefix ${prefix}…`, 'info')
    setProgress(0, total)

    generated = []
    const prefixPart = prefix + ':'
    let i = 0

    await new Promise((resolve) => {
      function step() {
        const end = Math.min(i + BATCH, total)
        for (; i < end; i++) {
          generated.push(prefixPart + suffixToOctets(i, suffixOctets).join(':'))
        }
        setProgress(i, total)
        if (i < total) setTimeout(step, 0)
        else resolve()
      }
      step()
    })

    if (generated.length <= MAX_DISPLAY) {
      $output.value = generated.join('\n')
    } else {
      const half = MAX_DISPLAY / 2
      $output.value =
        generated.slice(0, half).join('\n') +
        `\n… ${generated.length - MAX_DISPLAY} more hidden to keep the box responsive …\n` +
        generated.slice(generated.length - half).join('\n')
    }

    $resultLabel.textContent = `Generated MACs — ${generated.length.toLocaleString()} total`
    setProgress(total, total)
    setStatus(
      generated.length > MAX_DISPLAY
        ? `Done. ${generated.length.toLocaleString()} MACs generated. The box shows a preview; saving writes the full set.`
        : `Done. ${generated.length.toLocaleString()} unique MACs generated.`,
      'ok'
    )
    $save.disabled = false
    $clear.disabled = false
    $generate.disabled = false
    $prefix.disabled = false
  }

  function save() {
    if (generated.length === 0) return
    const prefix = normalizePrefix($prefix.value) || 'macs'
    const safeName = prefix.replace(/[^0-9A-F:]/g, '').replace(/:/g, '-') + '.txt'
    downloadBlob(new Blob([generated.join('\n') + '\n'], { type: 'text/plain' }), safeName)
    setStatus(`Saved ${generated.length.toLocaleString()} MACs to ${safeName}`, 'ok')
  }

  function clearAll() {
    generated = []
    $output.value = ''
    $resultLabel.textContent = 'Generated MACs'
    $progressWrap.hidden = true
    setStatus('', 'info')
    $save.disabled = true
    $clear.disabled = true
  }

  $generate.addEventListener('click', generate)
  $save.addEventListener('click', save)
  $clear.addEventListener('click', clearAll)
  $prefix.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') generate()
  })
}

/* ================================================================== */
/* PROXY GRABBER PAGE                                                  */
/* ================================================================== */

// Proxies are fetched server-side via a Supabase Edge Function, which avoids
// browser CORS restrictions entirely. The function pulls from many free public
// proxy list sources (TheSpeedX, monosans, ProxyScrape, proxy-list.download,
// iplocate, Stormsia, MuRongPI and others) and returns a deduped ip:port list.

const PROXY_MAX_DISPLAY = 20000
const PROXY_TEST_BATCH = 250 // proxies sent per test request to avoid huge payloads

function renderProxyPage() {
  $page.innerHTML = `
    <section class="hero">
      <h1>Proxy Grabber</h1>
      <p class="subtitle">Pull free public proxies from multiple GitHub sources, filter out duplicates and bad lines, and save them as a .txt file.</p>
    </section>

    <section class="panel">
      <label class="field">
        <span class="label">Proxy type</span>
        <select id="ptype">
          <option value="http">HTTP</option>
          <option value="https">HTTPS</option>
          <option value="socks4">SOCKS4</option>
          <option value="socks5">SOCKS5</option>
        </select>
        <span class="hint">Proxies are fetched from public lists (TheSpeedX, monosans, ProxyScrape, proxy-list.download).</span>
      </label>

      <div class="actions">
        <button id="grab" type="button" class="primary">Grab</button>
        <button id="test" type="button" class="ghost" disabled>Test</button>
        <button id="removeDead" type="button" class="ghost" disabled>Delete dead</button>
        <button id="save" type="button" class="ghost" disabled>Save .txt</button>
        <button id="clear" type="button" class="ghost" disabled>Clear</button>
      </div>

      <div id="status" class="status" hidden></div>
      <div id="progressWrap" class="progress" hidden>
        <div id="progressBar" class="progress-bar"></div>
      </div>

      <label class="field textarea-field">
        <span class="label" id="resultLabel">Proxies</span>
        <textarea id="output" rows="18" spellcheck="false" readonly placeholder="Click Grab to fetch proxies..."></textarea>
      </label>
    </section>

    <footer class="foot">Public proxies are unreliable and slow — use them at your own risk. No guarantees any given proxy will work.</footer>
  `

  const $ptype = $page.querySelector('#ptype')
  const $grab = $page.querySelector('#grab')
  const $test = $page.querySelector('#test')
  const $removeDead = $page.querySelector('#removeDead')
  const $save = $page.querySelector('#save')
  const $clear = $page.querySelector('#clear')
  const $output = $page.querySelector('#output')
  const $resultLabel = $page.querySelector('#resultLabel')
  const $status = $page.querySelector('#status')
  const $progressWrap = $page.querySelector('#progressWrap')
  const $progressBar = $page.querySelector('#progressBar')

  let proxies = []
  let workingSet = new Set() // proxies confirmed alive by the last Test run

  function setStatus(text, kind = 'info') {
    $status.hidden = !text
    $status.textContent = text || ''
    $status.dataset.kind = kind
  }

  function setProgress(done, total) {
    $progressWrap.hidden = total <= 0
    if (total > 0) $progressBar.style.width = Math.min(100, Math.round((done / total) * 100)) + '%'
  }

  function renderOutput() {
    if (proxies.length === 0) {
      $output.value = ''
      $resultLabel.textContent = 'Proxies'
      return
    }
    if (proxies.length <= PROXY_MAX_DISPLAY) {
      $output.value = proxies.join('\n')
    } else {
      const half = PROXY_MAX_DISPLAY / 2
      $output.value =
        proxies.slice(0, half).join('\n') +
        `\n… ${proxies.length - PROXY_MAX_DISPLAY} more hidden to keep the box responsive …\n` +
        proxies.slice(proxies.length - half).join('\n')
    }
    const live = workingSet.size
    $resultLabel.textContent = live
      ? `Proxies — ${proxies.length.toLocaleString()} total · ${live.toLocaleString()} tested alive`
      : `Proxies — ${proxies.length.toLocaleString()} total`
  }

  function setControls({ grab, test, removeDead, save, clear, type }) {
    $grab.disabled = grab === false
    $test.disabled = test === false
    $removeDead.disabled = removeDead === false
    $save.disabled = save === false
    $clear.disabled = clear === false
    $ptype.disabled = type === false
  }

  async function grab() {
    const type = $ptype.value
    workingSet = new Set()
    setControls({ grab: false, test: false, removeDead: false, save: false, clear: false, type: false })
    $output.value = ''
    $resultLabel.textContent = 'Grabbing…'
    setStatus(`Fetching ${type.toUpperCase()} proxies from public lists (server-side)…`, 'info')
    setProgress(0, 1)

    try {
      const res = await fetch(`${PROXY_API}?type=${encodeURIComponent(type)}&html=1`, {
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      })

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`)
      }

      const data = await res.json()

      if (!data || !Array.isArray(data.proxies)) {
        throw new Error('Unexpected response from server.')
      }

      setProgress(1, 1)
      proxies = data.proxies

      if (proxies.length === 0) {
        $output.value = ''
        $resultLabel.textContent = 'Proxies'
        setStatus(
          data.sources_ok === 0
            ? 'No proxy sources could be reached right now. Try again in a moment.'
            : 'Sources were reached but no valid proxies were parsed.',
          'error'
        )
        setControls({ grab: true, test: false, removeDead: false, save: false, clear: true, type: true })
        return
      }

      renderOutput()
      setStatus(
        `${data.sources_ok}/${data.sources_total} source(s) responded. ${proxies.length.toLocaleString()} unique ${type.toUpperCase()} proxies.`,
        'ok'
      )
      setControls({ grab: true, test: true, removeDead: false, save: true, clear: true, type: true })
    } catch (err) {
      setProgress(0, 0)
      $output.value = ''
      $resultLabel.textContent = 'Proxies'
      setStatus(
        `Grab failed: ${err.message || 'network error'}. Please try again.`,
        'error'
      )
    } finally {
      $grab.disabled = false
      $ptype.disabled = false
    }
  }

  async function testProxies() {
    if (proxies.length === 0) return
    const type = $ptype.value
    setControls({ grab: false, test: false, removeDead: false, save: false, clear: false, type: false })
    $resultLabel.textContent = 'Testing…'
    setStatus(`Testing ${proxies.length.toLocaleString()} ${type.toUpperCase()} proxies (5s timeout each, 20 parallel)…`, 'info')
    setProgress(0, proxies.length)

    workingSet = new Set()
    let tested = 0

    try {
      for (let i = 0; i < proxies.length; i += PROXY_TEST_BATCH) {
        const chunk = proxies.slice(i, i + PROXY_TEST_BATCH)
        const res = await fetch(PROXY_TEST_API, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ type, proxies: chunk }),
        })
        if (!res.ok) throw new Error(`Server returned ${res.status}`)
        const data = await res.json()
        if (!data || !Array.isArray(data.working)) throw new Error('Unexpected response from server.')
        for (const p of data.working) workingSet.add(p)
        tested += chunk.length
        setProgress(tested, proxies.length)
      }

      renderOutput()
      setStatus(
        `Tested ${proxies.length.toLocaleString()} proxies. ${workingSet.size.toLocaleString()} are alive.`,
        'ok'
      )
      setControls({ grab: true, test: true, removeDead: workingSet.size > 0, save: true, clear: true, type: true })
    } catch (err) {
      setStatus(`Test failed: ${err.message || 'network error'}.`, 'error')
      setControls({ grab: true, test: true, removeDead: workingSet.size > 0, save: true, clear: true, type: true })
    }
  }

  function removeDead() {
    if (workingSet.size === 0) return
    const before = proxies.length
    proxies = proxies.filter((p) => workingSet.has(p))
    setStatus(`Removed ${(before - proxies.length).toLocaleString()} dead proxies. ${proxies.length.toLocaleString()} working proxies remain.`, 'ok')
    renderOutput()
    if (proxies.length === 0) {
      setControls({ grab: true, test: false, removeDead: false, save: false, clear: false, type: true })
    } else {
      setControls({ grab: true, test: true, removeDead: false, save: true, clear: true, type: true })
    }
  }

  function save() {
    if (proxies.length === 0) return
    const name = `proxies_${$ptype.value}.txt`
    downloadBlob(new Blob([proxies.join('\n') + '\n'], { type: 'text/plain' }), name)
    setStatus(`Saved ${proxies.length.toLocaleString()} proxies to ${name}`, 'ok')
  }

  function clearAll() {
    proxies = []
    workingSet = new Set()
    $output.value = ''
    $resultLabel.textContent = 'Proxies'
    $progressWrap.hidden = true
    setStatus('', 'info')
    setControls({ grab: true, test: false, removeDead: false, save: false, clear: false, type: true })
  }

  $grab.addEventListener('click', grab)
  $test.addEventListener('click', testProxies)
  $removeDead.addEventListener('click', removeDead)
  $save.addEventListener('click', save)
  $clear.addEventListener('click', clearAll)
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

renderPage('mac')

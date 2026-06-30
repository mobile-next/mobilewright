// Mobilewright Inspector frontend. No framework, no build step.

// ---- Pure locator utilities ----

const DEFAULT_HIDDEN_TESTIDS = new Set(['android:id/content'])

function locatorKey(locator) {
  if (locator.kind === 'role') return `role:${locator.value}:${locator.name ?? ''}`
  return `${locator.kind}:${locator.value}`
}

function escQ(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function locatorLabel(locator) {
  if (locator.kind === 'testId') return `getByTestId('${escQ(locator.value)}')`
  if (locator.kind === 'role') {
    return locator.name
      ? `getByRole('${escQ(locator.value)}', { name: '${escQ(locator.name)}' })`
      : `getByRole('${escQ(locator.value)}')`
  }
  if (locator.kind === 'label') return `getByLabel('${escQ(locator.value)}')`
  if (locator.kind === 'text') return `getByText('${escQ(locator.value)}')`
  return ''
}

function buildDuplicateSet(elements) {
  const counts = new Map()
  for (const el of elements) {
    if (!el.locator) continue
    const key = locatorKey(el.locator)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const dupes = new Set()
  for (const [k, n] of counts) if (n > 1) dupes.add(k)
  return dupes
}

// ---- ScreenshotPane ----
// Owns the screenshot image, SVG highlight overlay, and placeholder state.

class ScreenshotPane {
  #img
  #overlay
  #placeholder
  #placeholderTitle
  #placeholderSub
  #logicalWidth = 0
  #logicalHeight = 0
  #elements = []
  #hiddenIndices = new Set()
  #selectedIndex = null
  #onClickCb = null
  #screenshotPane  // cached pane element for #constrainSize
  // O(1) lookup from element index to its SVG rect; rebuilt on each renderHighlights call.
  #rectByIndex = new Map()

  constructor() {
    this.#img = document.getElementById('screenshot-img')
    this.#overlay = document.getElementById('highlight-overlay')
    this.#placeholder = document.getElementById('no-device-msg')
    this.#placeholderTitle = document.getElementById('placeholder-title')
    this.#placeholderSub = document.getElementById('placeholder-sub')
    this.#screenshotPane = document.getElementById('screenshot-pane')
    window.addEventListener('resize', () => this.#constrainSize())
  }

  onElementClick(cb) { this.#onClickCb = cb }

  get isScreenshotHidden() { return this.#img.hidden }

  showPlaceholder(title, sub = '', loading = false) {
    this.#placeholder.hidden = false
    this.#img.hidden = true
    this.#overlay.setAttribute('hidden', '')
    this.#placeholderTitle.textContent = title
    this.#placeholderSub.textContent = sub
    this.#placeholder.classList.toggle('loading', loading)
  }

  showScreenshot(dataUrl, logicalWidth = 0, logicalHeight = 0) {
    this.#logicalWidth = logicalWidth
    this.#logicalHeight = logicalHeight
    this.#placeholder.hidden = true
    this.#placeholder.classList.remove('loading')
    this.#img.hidden = false
    this.#overlay.removeAttribute('hidden')
    this.#img.src = dataUrl
    this.#img.onload = () => this.#constrainSize()
  }

  renderHighlights(elements, hiddenIndices, selectedIndex) {
    this.#elements = elements
    this.#hiddenIndices = hiddenIndices
    this.#selectedIndex = selectedIndex
    this.#buildRects()
  }

  setSelectedIndex(index) {
    // O(1): deselect old rect, select new one directly via index map.
    this.#rectByIndex.get(this.#selectedIndex)?.classList.remove('selected')
    this.#selectedIndex = index
    this.#rectByIndex.get(index)?.classList.add('selected')
  }

  #buildRects() {
    this.#overlay.innerHTML = ''
    this.#rectByIndex.clear()
    for (const el of this.#visibleElements()) {
      const { x, y, width, height } = el.bounds
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect.setAttribute('x', x)
      rect.setAttribute('y', y)
      rect.setAttribute('width', width)
      rect.setAttribute('height', height)
      rect.classList.add('highlight-rect')
      if (el.index === this.#selectedIndex) rect.classList.add('selected')
      rect.addEventListener('click', () => this.#onClickCb?.(el.index))
      rect.addEventListener('mouseenter', () => rect.classList.add('hovered'))
      rect.addEventListener('mouseleave', () => rect.classList.remove('hovered'))
      this.#rectByIndex.set(el.index, rect)
      this.#overlay.appendChild(rect)
    }
  }

  #visibleElements() {
    return this.#elements.filter(el =>
      el.bounds &&
      el.isVisible &&
      !this.#hiddenIndices.has(el.index) &&
      el.bounds.width > 0 &&
      el.bounds.height > 0
    )
  }

  #constrainSize() {
    if (this.#img.hidden) return
    const cs = getComputedStyle(this.#screenshotPane)
    const availH = this.#screenshotPane.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    this.#img.style.maxHeight = availH + 'px'
    const vw = this.#logicalWidth || this.#img.naturalWidth
    const vh = this.#logicalHeight || this.#img.naturalHeight
    this.#overlay.setAttribute('width', this.#img.offsetWidth)
    this.#overlay.setAttribute('height', this.#img.offsetHeight)
    this.#overlay.setAttribute('viewBox', `0 0 ${vw} ${vh}`)
  }
}

// ---- ElementsPane ----
// Owns the element list: rendering rows, selection state, visibility toggles.

class ElementsPane {
  #list
  #onClickCb = null
  #onToggleCb = null
  // O(1) lookup from element index to its row element; rebuilt on each render call.
  #rowByIndex = new Map()
  #selectedRow = null

  constructor() {
    this.#list = document.getElementById('elements-list')
    this.#list.setAttribute('role', 'list')
  }

  onElementClick(cb) { this.#onClickCb = cb }
  onToggleHidden(cb) { this.#onToggleCb = cb }

  render(elements, hiddenIndices) {
    this.#list.innerHTML = ''
    this.#rowByIndex.clear()
    this.#selectedRow = null
    if (elements.length === 0) {
      const msg = document.createElement('div')
      msg.className = 'pane-message'
      msg.textContent = 'No elements'
      this.#list.appendChild(msg)
      return
    }
    const dupes = buildDuplicateSet(elements)
    for (const el of elements) {
      const row = this.#buildRow(el, hiddenIndices, dupes)
      this.#rowByIndex.set(el.index, row)
      this.#list.appendChild(row)
    }
  }

  setSelectedIndex(index) {
    // O(1): deselect previous row, select new one directly via index map.
    this.#selectedRow?.classList.remove('selected')
    this.#selectedRow = this.#rowByIndex.get(index) ?? null
    if (this.#selectedRow) {
      this.#selectedRow.classList.add('selected')
      this.#selectedRow.scrollIntoView({ block: 'nearest' })
    }
  }

  updateRowVisibility(index, hidden) {
    const row = this.#rowByIndex.get(index)
    if (!row) return
    row.classList.toggle('element-hidden', hidden)
    const btn = row.querySelector('.vis-btn')
    if (btn) {
      btn.textContent = hidden ? '○' : '◉'
      btn.title = hidden ? 'Show on screenshot' : 'Hide from screenshot'
      btn.setAttribute('aria-label', hidden ? 'Show on screenshot' : 'Hide from screenshot')
      btn.setAttribute('aria-pressed', String(!hidden))
    }
  }

  #buildRow(el, hiddenIndices, dupes) {
    const row = document.createElement('div')
    row.className = 'element-row'
    row.setAttribute('role', 'listitem')
    row.tabIndex = 0
    row.dataset.index = el.index
    if (!el.locator) row.classList.add('no-locator')
    if (hiddenIndices.has(el.index)) row.classList.add('element-hidden')

    const locLabel = el.locator ? locatorLabel(el.locator) : null
    row.setAttribute('aria-label', locLabel ?? `${el.type ?? 'unknown'} (no locator)`)

    const badge = document.createElement('span')
    badge.className = `locator-badge badge-${el.locator?.kind ?? 'none'}`
    badge.textContent = el.locator?.kind ?? 'none'
    row.appendChild(badge)

    const value = document.createElement('span')
    value.className = 'locator-value'
    value.textContent = locLabel ?? '(no locator)'
    if (locLabel) value.title = locLabel
    row.appendChild(value)

    if (el.locator && dupes.has(locatorKey(el.locator))) {
      const warn = document.createElement('span')
      warn.className = 'duplicate-warning'
      warn.textContent = 'dup'
      warn.title = 'Multiple elements share this locator'
      row.appendChild(warn)
    }

    const type = document.createElement('span')
    type.className = 'element-type'
    type.textContent = el.type ?? ''
    row.appendChild(type)

    const isHidden = hiddenIndices.has(el.index)
    const visBtn = document.createElement('button')
    visBtn.className = 'vis-btn'
    visBtn.textContent = isHidden ? '○' : '◉'
    visBtn.title = isHidden ? 'Show on screenshot' : 'Hide from screenshot'
    visBtn.setAttribute('aria-label', isHidden ? 'Show on screenshot' : 'Hide from screenshot')
    visBtn.setAttribute('aria-pressed', String(!isHidden))
    visBtn.addEventListener('click', e => { e.stopPropagation(); this.#onToggleCb?.(el.index) })
    row.appendChild(visBtn)

    row.addEventListener('click', () => this.#onClickCb?.(el.index))
    row.addEventListener('keydown', e => {
      if (e.target !== row) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.#onClickCb?.(el.index)
      }
    })
    return row
  }
}

// ---- Inspector ----
// Orchestrates device management, the refresh cycle, and shared selection/visibility state.

class Inspector {
  #state = {
    devices: [],
    activeId: null,
    elements: [],
    selectedIndex: null,
    logicalWidth: 0,
    logicalHeight: 0,
    hiddenIndices: new Set(),
  }
  // Persists user visibility overrides across refreshes: locatorKey -> 'hidden' | 'visible'.
  // Pruned on each refresh to keys present in the new element list.
  #userOverrides = new Map()
  #autoRefreshTimer = null
  #tickInFlight = false
  #refreshInFlight = false
  #connectInFlight = false
  #consecutiveErrors = 0
  static #MAX_CONSECUTIVE_ERRORS = 3

  #screenshotPane = new ScreenshotPane()
  #elementsPane = new ElementsPane()
  #deviceSelect = document.getElementById('device-select')
  #refreshBtn = document.getElementById('refresh-btn')
  #autoRefreshToggle = document.getElementById('auto-refresh-toggle')
  #autoRefreshInterval = document.getElementById('auto-refresh-interval')
  #statusBar = document.getElementById('status-bar')

  constructor() {
    this.#screenshotPane.onElementClick(i => this.#selectElement(i))
    this.#elementsPane.onElementClick(i => this.#selectElement(i))
    this.#elementsPane.onToggleHidden(i => this.#toggleHidden(i))

    this.#refreshBtn.addEventListener('click', () => this.refresh())
    this.#deviceSelect.addEventListener('change', () => {
      const opt = this.#deviceSelect.selectedOptions[0]
      if (!opt?.value) return
      const device = this.#state.devices.find(d => d.id === opt.value)
      if (device) this.#connectDevice(device)
    })
    this.#autoRefreshToggle.addEventListener('change', () => this.#applyAutoRefresh())
    this.#autoRefreshInterval.addEventListener('change', () => this.#applyAutoRefresh())

    this.#loadDevices()
  }

  async refresh() {
    if (!this.#state.activeId) return
    if (this.#refreshInFlight) return
    this.#refreshInFlight = true
    this.#refreshBtn.disabled = true

    try {
      const res = await fetch('/api/inspect')
      if (res.status === 503) return  // another inspect in flight, skip this tick — no state changed yet
      this.#setStatus('Loading...', 'loading')
      if (this.#screenshotPane.isScreenshotHidden) {
        this.#screenshotPane.showPlaceholder('Loading screenshot...', '', true)
      }
      if (res.status === 409) {
        this.#state.activeId = null
        this.#state.elements = []
        this.#state.hiddenIndices = new Set()
        this.#state.selectedIndex = null
        this.#screenshotPane.showPlaceholder('Device disconnected', 'Select a device to continue')
        this.#elementsPane.render([], new Set())
        this.#screenshotPane.renderHighlights([], new Set(), null)
        this.#setStatus('Device disconnected', 'error')
        this.#renderDevicePicker()
        return
      }
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? res.statusText)
      }
      const data = await res.json()
      this.#state.elements = data.elements ?? []
      this.#state.selectedIndex = null
      this.#state.logicalWidth = data.screen?.width ?? 0
      this.#state.logicalHeight = data.screen?.height ?? 0

      // Prune overrides for locator keys no longer present in the new element list.
      const liveKeys = new Set(
        this.#state.elements.filter(el => el.locator).map(el => locatorKey(el.locator))
      )
      for (const k of this.#userOverrides.keys()) {
        if (!liveKeys.has(k)) this.#userOverrides.delete(k)
      }

      this.#state.hiddenIndices = this.#computeHiddenIndices()

      this.#screenshotPane.showScreenshot(data.screenshot, this.#state.logicalWidth, this.#state.logicalHeight)
      this.#elementsPane.render(this.#state.elements, this.#state.hiddenIndices)
      this.#screenshotPane.renderHighlights(this.#state.elements, this.#state.hiddenIndices, null)
      this.#setStatus(`${this.#state.elements.length} elements`)
      this.#consecutiveErrors = 0
    } catch (err) {
      this.#consecutiveErrors++
      this.#setStatus('Refresh failed: ' + err.message, 'error')
      if (this.#screenshotPane.isScreenshotHidden) {
        this.#screenshotPane.showPlaceholder('Could not load screenshot', err.message)
      }
      if (this.#consecutiveErrors >= Inspector.#MAX_CONSECUTIVE_ERRORS) {
        this.#stopAutoRefresh()
        this.#setStatus(`Auto-refresh stopped after ${this.#consecutiveErrors} consecutive failures`, 'error')
      }
    } finally {
      this.#refreshInFlight = false
      this.#refreshBtn.disabled = false
    }
  }

  async #loadDevices() {
    try {
      await this.#fetchDevices()
      if (this.#state.activeId) {
        await this.refresh()
      }
    } catch (err) {
      this.#setStatus('Could not load devices: ' + err.message, 'error')
    }
  }

  async #fetchDevices() {
    const res = await fetch('/api/devices')
    if (!res.ok) throw new Error(`Device list failed: ${res.status}`)
    const data = await res.json()
    const prevActiveId = this.#state.activeId
    this.#state.devices = data.devices ?? []
    this.#state.activeId = data.activeId ?? null
    if (this.#state.activeId !== prevActiveId) this.#userOverrides.clear()
    this.#renderDevicePicker()
    if (prevActiveId && !this.#state.activeId) {
      this.#state.elements = []
      this.#state.selectedIndex = null
      this.#state.hiddenIndices = new Set()
      this.#elementsPane.render([], new Set())
      this.#screenshotPane.showPlaceholder('Device disconnected', 'Select a device to continue')
      this.#setStatus('Device disconnected', 'error')
    }
  }

  #renderDevicePicker() {
    const currentIds = [...this.#deviceSelect.options].filter(o => o.value).map(o => o.value)
    const newIds = this.#state.devices.map(d => d.id)
    const sameList = currentIds.length === newIds.length && currentIds.every((id, i) => id === newIds[i])
    if (sameList && this.#deviceSelect.value === (this.#state.activeId ?? '')) return

    this.#deviceSelect.innerHTML = ''
    if (this.#state.devices.length === 0) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = 'No devices connected'
      this.#deviceSelect.appendChild(opt)
      return
    }
    if (!this.#state.activeId) {
      const placeholder = document.createElement('option')
      placeholder.value = ''
      placeholder.textContent = 'Select a device'
      placeholder.disabled = true
      placeholder.selected = true
      this.#deviceSelect.appendChild(placeholder)
    }
    for (const d of this.#state.devices) {
      const opt = document.createElement('option')
      opt.value = d.id
      opt.dataset.platform = d.platform
      opt.textContent = `${d.name} (${d.platform}, ${d.type})`
      if (d.id === this.#state.activeId) opt.selected = true
      this.#deviceSelect.appendChild(opt)
    }
  }

  async #connectDevice(device) {
    if (this.#connectInFlight) return
    this.#connectInFlight = true
    this.#setStatus('Connecting...', 'loading')
    this.#screenshotPane.showPlaceholder('Connecting...', device.name ?? device.id, true)
    this.#refreshBtn.disabled = true
    this.#deviceSelect.disabled = true
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(device.id)}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: device.platform }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? res.statusText)
      }
      this.#state.activeId = device.id
      this.#userOverrides.clear()
      this.#renderDevicePicker()
      await this.refresh()
    } catch (err) {
      this.#setStatus('Connect failed: ' + err.message, 'error')
      this.#screenshotPane.showPlaceholder('Connect failed', err.message)
      this.#renderDevicePicker()
    } finally {
      this.#connectInFlight = false
      this.#deviceSelect.disabled = false
      this.#refreshBtn.disabled = false
    }
  }

  #selectElement(index) {
    this.#state.selectedIndex = index
    this.#screenshotPane.setSelectedIndex(index)
    this.#elementsPane.setSelectedIndex(index)
  }

  #toggleHidden(index) {
    const el = this.#state.elements.find(el => el.index === index)
    const key = el?.locator ? locatorKey(el.locator) : null
    const nowHidden = this.#state.hiddenIndices.has(index)
    // Only persist overrides for unique locator keys — shared keys would affect all duplicates.
    const isDupe = key ? buildDuplicateSet(this.#state.elements).has(key) : false

    if (nowHidden) {
      this.#state.hiddenIndices.delete(index)
      if (key && !isDupe) this.#userOverrides.set(key, 'visible')
    } else {
      this.#state.hiddenIndices.add(index)
      if (key && !isDupe) this.#userOverrides.set(key, 'hidden')
    }

    this.#screenshotPane.renderHighlights(this.#state.elements, this.#state.hiddenIndices, this.#state.selectedIndex)
    this.#elementsPane.updateRowVisibility(index, this.#state.hiddenIndices.has(index))
  }

  #computeHiddenIndices() {
    const dupes = buildDuplicateSet(this.#state.elements)
    return new Set(
      this.#state.elements
        .filter(el => {
          const key = el.locator ? locatorKey(el.locator) : null
          const override = key && !dupes.has(key) ? this.#userOverrides.get(key) : undefined
          if (override === 'visible') return false
          if (override === 'hidden') return true
          return el.locator?.kind === 'testId' && DEFAULT_HIDDEN_TESTIDS.has(el.locator.value)
        })
        .map(el => el.index)
    )
  }

  #applyAutoRefresh() {
    clearInterval(this.#autoRefreshTimer)
    this.#autoRefreshTimer = null
    this.#autoRefreshInterval.disabled = !this.#autoRefreshToggle.checked
    this.#consecutiveErrors = 0  // reset when user manually reconfigures auto-refresh
    if (this.#autoRefreshToggle.checked) {
      const ms = Number(this.#autoRefreshInterval.value)
      this.#autoRefreshTimer = setInterval(async () => {
        if (this.#tickInFlight) return
        this.#tickInFlight = true
        try {
          await this.#fetchDevices().catch(() => {})
          await this.refresh()
        } finally {
          this.#tickInFlight = false
        }
      }, ms)
    }
  }

  // Called from the error path only — unregisters the timer and unchecks the toggle.
  #stopAutoRefresh() {
    clearInterval(this.#autoRefreshTimer)
    this.#autoRefreshTimer = null
    this.#autoRefreshToggle.checked = false
    this.#autoRefreshInterval.disabled = true
  }

  #setStatus(msg, type = '') {
    this.#statusBar.textContent = msg
    this.#statusBar.className = type
  }
}

// ---- Theme ----

function applyTheme(name) {
  document.documentElement.setAttribute('data-theme', name)
  localStorage.setItem('mobilewright-inspector-theme', name)
  const sel = document.getElementById('theme-select')
  if (sel) sel.value = name
}

document.getElementById('theme-select')?.addEventListener('change', e => applyTheme(e.target.value))

// ---- Bootstrap ----

applyTheme(localStorage.getItem('mobilewright-inspector-theme') || 'void')
new Inspector()

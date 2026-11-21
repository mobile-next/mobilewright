import { DetailPane, Inspector, ScreenshotPane, applyTheme, escQ, locatorCode, makeResizable } from './app.js'
import { ViewTreePane } from './view-tree.js'
import { insertBeforeBodyEnd } from './codegen-source.js'

// What the generated code runs under: the @mobilewright/test runner, or a plain script using the library.
// Recorded lines are the same for both, since each exposes `device` and `screen`; only the wrapper differs.
const TARGETS = {
  test: {
    render: (platform, body) => `import { test, expect } from '@mobilewright/test';

test('test', async ({ device, screen }) => {
${body}});
`,
    bodyEnd: '});',
    indent: '  ',
  },
  library: {
    render: (platform, body) => `import { ${platform}, expect } from 'mobilewright';

const device = await ${platform}.launch();
const { screen } = device;

${body}await device.close();
`,
    bodyEnd: 'await device.close();',
    indent: '',
  },
}

const DEFAULT_TARGET = 'test'

const DEFAULT_PLATFORM = 'ios'

const TREE_OPEN_STORAGE_KEY = 'mobilewright-codegen-tree-open'

const TARGET_STORAGE_KEY = 'mobilewright-codegen-target'

const COPIED_FEEDBACK_MS = 1500

const ERROR_TOAST_MS = 5000

const GESTURE_NAMES = { tap: 'Tap', doubleTap: 'Double tap', longPress: 'Long press' }

// The Inspector hides its detail pane on every refresh, which continuous refresh would do constantly,
// so it gets a no-op stand-in and the Recorder drives the real DetailPane itself.
const noDetailPane = { onClose() {}, show() {}, hide() {} }

// Only elements whose locator the query engine resolves back to them can be recorded by locator.
function hasRecordableLocator(el) {
  return Boolean(el.locator && el.match)
}

// What each click mode records. Text and value mirror locator.getText() / getValue() in core,
// so the generated assertion compares against exactly what the test will read.
const CLICK_MODES = {
  tap: {
    accepts: hasRecordableLocator,
  },
  assertText: {
    accepts: el => hasRecordableLocator(el) && textOf(el) !== '',
    code: el => `await expect(screen.${locatorCode(el)}).toHaveText('${escQ(textOf(el))}');`,
  },
  assertValue: {
    accepts: el => hasRecordableLocator(el) && el.value !== null,
    code: el => `await expect(screen.${locatorCode(el)}).toHaveValue('${escQ(String(el.value))}');`,
  },
}

function textOf(el) {
  return String(el.text ?? el.label ?? el.value ?? '')
}

function canFill(el) {
  return el.isEditable && hasArea(el) && hasRecordableLocator(el)
}

function hasArea(el) {
  return Boolean(el.bounds && el.bounds.width > 0 && el.bounds.height > 0)
}

function readTarget() {
  try {
    const target = localStorage.getItem(TARGET_STORAGE_KEY)
    return target in TARGETS ? target : DEFAULT_TARGET
  } catch {
    return DEFAULT_TARGET
  }
}

function renderSource(target, platform, lines) {
  const { render, indent } = TARGETS[target]
  return render(platform, lines.map(line => `${indent}${line}\n`).join(''))
}

function readTreeOpen() {
  try {
    return localStorage.getItem(TREE_OPEN_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function centerOf({ x, y, width, height }) {
  return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) }
}

class Recorder {
  #editor = document.getElementById('code-editor')
  #recordBtn = document.getElementById('record-btn')
  #errorToast = document.getElementById('error-toast')
  #errorToastTimer = null
  // Every control above the device screen, and the subset that are hardware buttons.
  #deviceControls = [...document.querySelectorAll('.device-btn')]
  #hardwareButtons = [...document.querySelectorAll('.device-btn[data-button]')]
  #assertButtons = [...document.querySelectorAll('.assert-btn')]
  #treeBtn = document.getElementById('tree-btn')
  #copyBtn = document.getElementById('copy-btn')
  #treePane = document.getElementById('tree-pane')
  #geoForm = document.getElementById('geo-popover')
  #urlForm = document.getElementById('url-popover')
  #fillForm = document.getElementById('fill-popover')
  #fillBtn = document.getElementById('fill-btn')
  #detailPane = new DetailPane()
  #gestureButtons = [...document.querySelectorAll('.gesture-btn[data-gesture]')]
  #detailElement = null
  // The element Fill was clicked for; kept apart since a refresh can change the detail element meanwhile.
  #fillElement = null
  #viewTree
  #isRecording = true
  #clickMode = 'tap'
  #inspector
  #targetSelect = document.getElementById('target-select')
  #target = readTarget()
  #platform = DEFAULT_PLATFORM
  // Every recorded line, so switching target can rebuild the source around them.
  #lines = []

  constructor() {
    const screenshotPane = new ScreenshotPane({ showAllHighlights: false })
    const viewTree = new ViewTreePane(document.getElementById('view-tree'))
    this.#viewTree = viewTree
    this.#inspector = new Inspector({
      screenshotPane,
      elementsPane: viewTree,
      detailPane: noDetailPane,
      onActiveDeviceChange: device => {
        this.#enableDeviceControlsFor(device)
        this.#setPlatform(device?.platform ?? this.#platform)
      },
      continuousRefresh: true,
    })
    this.#targetSelect.value = this.#target
    this.#renderSource()
    this.#targetSelect.addEventListener('change', () => this.#setTarget(this.#targetSelect.value))
    this.#recordBtn.addEventListener('click', () => this.#setRecording(!this.#isRecording))
    for (const btn of this.#assertButtons) {
      btn.addEventListener('click', () => this.#setClickMode(this.#clickMode === btn.dataset.mode ? 'tap' : btn.dataset.mode))
    }
    // Shift targets any element, since Shift-click only finds it in the view tree.
    const acceptsFor = isShift => isShift ? hasArea : CLICK_MODES[this.#clickMode].accepts
    screenshotPane.onScreenHover((x, y, isShift) => {
      screenshotPane.showHoverBox(x === null ? null : screenshotPane.elementAt(x, y, acceptsFor(isShift)))
    })
    screenshotPane.onScreenTap((x, y, isShift) => {
      if (isShift) {
        this.#revealInTree(screenshotPane.elementAt(x, y, hasArea))
        return
      }
      const el = screenshotPane.elementAt(x, y, CLICK_MODES[this.#clickMode].accepts)
      if (el) {
        this.#clickElement(el)
        return
      }
      if (this.#clickMode === 'tap') {
        this.#perform('Tap', '/api/tap', { x, y }, `await screen.tap(${x}, ${y});`)
      }
    })
    viewTree.onElementHover(el => screenshotPane.showHoverBox(el && hasArea(el) ? el : null))
    viewTree.onRowClick(el => {
      // An armed assertion takes the click; otherwise the row just shows its details.
      if (this.#clickMode !== 'tap') {
        this.#clickElement(el)
        return
      }
      viewTree.selectElement(el)
      this.#showDetail(el)
    })
    viewTree.onSelectedElementChange(el => this.#showDetail(el))
    this.#detailPane.onClose(() => {
      this.#detailElement = null
      viewTree.clearSelection()
    })
    for (const btn of this.#gestureButtons) {
      btn.addEventListener('click', () => this.#performGesture(btn.dataset.gesture, this.#detailElement))
    }
    this.#treeBtn.addEventListener('click', () => this.#setTreeOpen(this.#treePane.hidden))
    this.#copyBtn.addEventListener('click', () => this.#copyTest())
    this.#setTreeOpen(readTreeOpen())
    for (const btn of this.#hardwareButtons) {
      const button = btn.dataset.button
      btn.addEventListener('click', () => this.#perform(btn.title, '/api/press-button', { button }, `await screen.pressButton('${button}');`))
    }
    this.#geoForm.addEventListener('submit', e => {
      e.preventDefault()
      const latitude = Number(this.#geoForm.elements.latitude.value)
      const longitude = Number(this.#geoForm.elements.longitude.value)
      this.#setGeolocation({ latitude, longitude }, `await device.setGeolocation({ latitude: ${latitude}, longitude: ${longitude} });`)
    })
    document.getElementById('geo-reset-btn').addEventListener('click', () => {
      this.#setGeolocation(null, 'await device.setGeolocation(null);')
    })
    this.#urlForm.addEventListener('submit', e => {
      e.preventDefault()
      this.#openUrl(this.#urlForm.elements.url.value.trim())
    })
    this.#fillForm.addEventListener('submit', e => {
      e.preventDefault()
      this.#fill(this.#fillElement, this.#fillForm.elements.text.value)
    })
    this.#fillBtn.addEventListener('click', () => {
      this.#fillElement = this.#detailElement
    })
  }

  // Same outcome whether the element was clicked on the screenshot or in the view tree.
  #clickElement(el) {
    const mode = CLICK_MODES[this.#clickMode]
    if (this.#clickMode !== 'tap') {
      // Assertions only read the screen; an element without text/value does nothing.
      if (mode.accepts(el)) {
        if (this.#isRecording) {
          this.#appendLine(mode.code(el))
        }
        this.#setClickMode('tap')
      }
      return
    }
    this.#performGesture('tap', el)
  }

  // Performs the gesture at the element's center, the same point the locator action hits when
  // the test runs; records it by locator when there is one, by coordinates otherwise.
  #performGesture(gesture, el) {
    if (!el || !hasArea(el)) {
      return
    }
    const center = centerOf(el.bounds)
    const code = hasRecordableLocator(el)
      ? `await screen.${locatorCode(el)}.${gesture}();`
      : `await screen.${gesture}(${center.x}, ${center.y});`
    this.#perform(GESTURE_NAMES[gesture], '/api/tap', { ...center, gesture }, code)
  }

  // Shift-click: select the element in the view tree and show its details, without touching the device.
  #revealInTree(el) {
    if (!el) {
      return
    }
    this.#setTreeOpen(true)
    this.#viewTree.selectElement(el)
    this.#showDetail(el)
  }

  #showDetail(el) {
    this.#detailElement = el
    if (!el) {
      this.#detailPane.hide()
      return
    }
    this.#detailPane.show(el)
    for (const btn of this.#gestureButtons) {
      btn.disabled = !hasArea(el)
    }
    // Only text fields can be filled, and the screen has no typing API, so fill is recorded by locator.
    this.#fillBtn.disabled = !canFill(el)
  }

  async #openUrl(url) {
    this.#urlForm.hidePopover()
    await this.#perform('Open URL', '/api/open-url', { url }, `await device.openUrl('${escQ(url)}');`)
  }

  // Taps, clears and types at the element's center, the same steps locator.fill() takes.
  async #fill(el, text) {
    this.#fillForm.hidePopover()
    this.#fillForm.reset()
    if (!el || !canFill(el)) {
      return
    }
    const code = `await screen.${locatorCode(el)}.fill('${escQ(text)}');`
    await this.#perform('Fill', '/api/fill', { ...centerOf(el.bounds), text }, code)
  }

  async #setGeolocation(geolocation, codeLine) {
    this.#geoForm.hidePopover()
    await this.#perform('Set location', '/api/geolocation', { geolocation }, codeLine)
  }

  async #copyTest() {
    const icon = this.#copyBtn.querySelector('.codicon')
    try {
      await navigator.clipboard.writeText(this.#editor.value)
    } catch (err) {
      this.#showError(`Copy failed: ${err.message}`)
      return
    }
    icon.classList.replace('codicon-files', 'codicon-check')
    this.#copyBtn.title = 'Copied'
    setTimeout(() => {
      icon.classList.replace('codicon-check', 'codicon-files')
      this.#copyBtn.title = 'Copy test'
    }, COPIED_FEEDBACK_MS)
  }

  #setTreeOpen(isOpen) {
    this.#treePane.hidden = !isOpen
    this.#treeBtn.setAttribute('aria-pressed', String(isOpen))
    try {
      localStorage.setItem(TREE_OPEN_STORAGE_KEY, String(isOpen))
    } catch {
      // storage unavailable (private mode); the toggle still works for this page
    }
  }

  // One assertion per click on an assert button, then back to tapping, like Playwright's recorder.
  #setClickMode(clickMode) {
    this.#clickMode = clickMode
    for (const btn of this.#assertButtons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === clickMode))
    }
    document.body.dataset.clickMode = clickMode
  }

  #showError(message) {
    this.#errorToast.textContent = message
    this.#errorToast.hidden = false
    clearTimeout(this.#errorToastTimer)
    this.#errorToastTimer = setTimeout(() => {
      this.#errorToast.hidden = true
    }, ERROR_TOAST_MS)
  }

  // Inserted into the editor rather than re-rendered, so edits made by hand are kept.
  #appendLine(codeLine) {
    const { bodyEnd, indent } = TARGETS[this.#target]
    this.#lines.push(codeLine)
    this.#editor.value = insertBeforeBodyEnd(this.#editor.value, bodyEnd, `${indent}${codeLine}`)
  }

  // Rebuilds the whole source from the recorded lines; edits made by hand are lost.
  #renderSource() {
    this.#editor.value = renderSource(this.#target, this.#platform, this.#lines)
  }

  #setTarget(target) {
    this.#target = target
    try {
      localStorage.setItem(TARGET_STORAGE_KEY, target)
    } catch {
      // storage unavailable (private mode); the choice still applies to this page
    }
    this.#renderSource()
  }

  // The library script launches by platform, so its source follows the selected device.
  #setPlatform(platform) {
    if (platform === this.#platform) {
      return
    }
    this.#platform = platform
    if (this.#target === 'library') {
      this.#renderSource()
    }
  }

  #setRecording(isRecording) {
    this.#isRecording = isRecording
    this.#recordBtn.setAttribute('aria-pressed', String(isRecording))
    this.#recordBtn.title = isRecording ? 'Stop recording' : 'Start recording'
  }

  // iOS has no back or app-switch button, so those stay disabled there.
  #enableDeviceControlsFor(device) {
    for (const btn of this.#deviceControls) {
      const isAndroidOnly = 'androidOnly' in btn.dataset
      btn.disabled = !device || (isAndroidOnly && device.platform !== 'android')
    }
  }

  // Runs an action on the device, records its code line, then refreshes the screenshot.
  async #perform(actionName, url, body, codeLine) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? res.statusText)
      }
    } catch (err) {
      this.#showError(`${actionName} failed: ${err.message}`)
      return
    }
    if (this.#isRecording) {
      this.#appendLine(codeLine)
    }
    await this.#inspector.refresh()
  }
}

makeResizable(document.getElementById('screenshot-splitter'), document.getElementById('screenshot-pane'), '--screenshot-width', 1)
makeResizable(document.getElementById('tree-splitter'), document.getElementById('tree-pane'), '--tree-width', -1)
makeResizable(document.getElementById('detail-splitter'), document.getElementById('detail-pane'), '--detail-height', -1, 'y')

applyTheme(localStorage.getItem('mobilewright-inspector-theme') || 'void')
new Recorder()

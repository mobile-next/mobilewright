import { DetailPane, Inspector, ScreenshotPane, applyTheme, escQ, locatorCode, makeResizable } from './app.js'
import { ViewTreePane } from './view-tree.js'

const INITIAL_SOURCE = `import { test, expect } from '@mobilewright/test';

test('test', async ({ device, screen }) => {
});
`

const TEST_BODY_END = '});'

const TREE_OPEN_STORAGE_KEY = 'mobilewright-codegen-tree-open'

const COPIED_FEEDBACK_MS = 1500

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

function hasArea(el) {
  return Boolean(el.bounds && el.bounds.width > 0 && el.bounds.height > 0)
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

function insertBeforeTestBodyEnd(source, line) {
  const end = source.lastIndexOf(TEST_BODY_END)
  if (end === -1) {
    return source + line + '\n'
  }
  return source.slice(0, end) + line + '\n' + source.slice(end)
}

class Recorder {
  #editor = document.getElementById('code-editor')
  #recordBtn = document.getElementById('record-btn')
  #statusBar = document.getElementById('status-bar')
  // Every control above the device screen, and the subset that are hardware buttons.
  #deviceControls = [...document.querySelectorAll('.device-btn')]
  #hardwareButtons = [...document.querySelectorAll('.device-btn[data-button]')]
  #assertButtons = [...document.querySelectorAll('.assert-btn')]
  #treeBtn = document.getElementById('tree-btn')
  #copyBtn = document.getElementById('copy-btn')
  #treePane = document.getElementById('tree-pane')
  #geoForm = document.getElementById('geo-popover')
  #detailPane = new DetailPane()
  #gestureButtons = [...document.querySelectorAll('.gesture-btn')]
  #detailElement = null
  #viewTree
  #isRecording = true
  #clickMode = 'tap'
  #inspector

  constructor() {
    const screenshotPane = new ScreenshotPane({ showAllHighlights: false })
    const viewTree = new ViewTreePane(document.getElementById('view-tree'))
    this.#viewTree = viewTree
    this.#inspector = new Inspector({
      screenshotPane,
      elementsPane: viewTree,
      detailPane: noDetailPane,
      onActiveDeviceChange: device => this.#enableDeviceControlsFor(device),
      continuousRefresh: true,
    })
    this.#editor.value = INITIAL_SOURCE
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
      this.#statusBar.textContent = `Copy failed: ${err.message}`
      this.#statusBar.className = 'error'
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

  #appendLine(codeLine) {
    this.#editor.value = insertBeforeTestBodyEnd(this.#editor.value, `  ${codeLine}`)
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
      this.#statusBar.textContent = `${actionName} failed: ${err.message}`
      this.#statusBar.className = 'error'
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

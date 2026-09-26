// Collapsible view-tree sidebar for codegen. Plugs into Inspector as its elements pane:
// Inspector calls render() with each new element list (depth-first, each with a depth).

const INDENT_PX = 14

// Stable across refreshes: the element's position among its siblings, all the way up.
// Keeps collapsed branches collapsed when the screen changes a little.
function pathKeysOf(elements) {
  const keys = []
  const stack = []  // [{ depth, key, childCount }]
  let rootCount = 0
  for (const el of elements) {
    while (stack.length && stack[stack.length - 1].depth >= el.depth) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]
    const siblingIndex = parent ? parent.childCount++ : rootCount++
    const key = `${parent?.key ?? ''}/${siblingIndex}:${el.type}`
    keys.push(key)
    stack.push({ depth: el.depth, key, childCount: 0 })
  }
  return keys
}

function nameOf(el) {
  return el.label ?? el.text ?? (el.value !== null ? String(el.value) : null)
}

export class ViewTreePane {
  #container
  #rows = []  // [{ el, row, key, hasChildren }]
  #collapsedKeys = new Set()
  #onHoverCb = null
  #onClickCb = null
  #onSelectedChangeCb = null
  #selectedKey = null

  constructor(container) {
    this.#container = container
    this.#container.setAttribute('role', 'tree')
  }

  onElementHover(cb) { this.#onHoverCb = cb }
  onRowClick(cb) { this.#onClickCb = cb }
  // Fires after each render with the selected element's fresh snapshot, or null once it is gone.
  onSelectedElementChange(cb) { this.#onSelectedChangeCb = cb }

  selectElement(el) {
    this.#selectedKey = this.#rows.find(r => r.el === el)?.key ?? null
    this.#markSelected()
  }

  clearSelection() {
    this.#selectedKey = null
    this.#markSelected()
  }

  // Elements-pane interface Inspector expects; the tree has no selection or visibility toggles.
  onElementClick() {}
  onToggleHidden() {}
  setSelectedIndex() {}
  updateRowVisibility() {}

  render(elements) {
    this.#container.innerHTML = ''
    const keys = pathKeysOf(elements)
    this.#rows = elements.map((el, i) => {
      const hasChildren = elements[i + 1]?.depth > el.depth
      const row = this.#buildRow(el, keys[i], hasChildren)
      this.#container.appendChild(row)
      return { el, row, key: keys[i], hasChildren }
    })
    this.#applyCollapsed()
    this.#markSelected()
    if (this.#selectedKey) {
      const selected = this.#rows.find(r => r.key === this.#selectedKey)
      if (!selected) {
        this.#selectedKey = null
      }
      this.#onSelectedChangeCb?.(selected?.el ?? null)
    }
  }

  #markSelected() {
    for (const { row, key } of this.#rows) {
      row.classList.toggle('selected', key === this.#selectedKey)
      row.setAttribute('aria-selected', String(key === this.#selectedKey))
    }
  }

  #buildRow(el, key, hasChildren) {
    const row = document.createElement('div')
    row.className = 'tree-row'
    row.setAttribute('role', 'treeitem')
    row.setAttribute('aria-level', String(el.depth + 1))
    row.style.paddingLeft = `${el.depth * INDENT_PX}px`
    if (!el.isVisible) {
      row.classList.add('offscreen')
    }

    // Leaves get a plain spacer: a disabled button would swallow clicks meant for the row.
    const twisty = document.createElement(hasChildren ? 'button' : 'span')
    twisty.className = 'tree-twisty codicon'
    if (hasChildren) {
      twisty.tabIndex = -1
      twisty.setAttribute('aria-label', 'Toggle children')
      twisty.addEventListener('click', e => {
        e.stopPropagation()
        this.#toggle(key)
      })
    }
    row.appendChild(twisty)

    const type = document.createElement('span')
    type.className = 'tree-type'
    type.textContent = el.type
    row.appendChild(type)

    const name = nameOf(el)
    if (name) {
      const nameEl = document.createElement('span')
      nameEl.className = 'tree-name'
      nameEl.textContent = ` - ${name}`
      row.appendChild(nameEl)
    }

    row.title = name ? `${el.type} - ${name}` : el.type
    row.addEventListener('mouseenter', () => this.#onHoverCb?.(el))
    row.addEventListener('mouseleave', () => this.#onHoverCb?.(null))
    row.addEventListener('click', () => this.#onClickCb?.(el))
    return row
  }

  #toggle(key) {
    if (this.#collapsedKeys.has(key)) {
      this.#collapsedKeys.delete(key)
    } else {
      this.#collapsedKeys.add(key)
    }
    this.#applyCollapsed()
  }

  // Hide every row below a collapsed ancestor; rows are depth-first, so descendants are contiguous.
  #applyCollapsed() {
    let hideDeeperThan = Infinity
    for (const { el, row, key, hasChildren } of this.#rows) {
      if (el.depth <= hideDeeperThan) {
        hideDeeperThan = Infinity
      }
      row.hidden = el.depth > hideDeeperThan
      const isCollapsed = hasChildren && this.#collapsedKeys.has(key)
      if (hasChildren) {
        row.setAttribute('aria-expanded', String(!isCollapsed))
        row.firstChild.classList.toggle('codicon-chevron-right', isCollapsed)
        row.firstChild.classList.toggle('codicon-chevron-down', !isCollapsed)
      }
      if (!row.hidden && isCollapsed) {
        hideDeeperThan = el.depth
      }
    }
  }
}

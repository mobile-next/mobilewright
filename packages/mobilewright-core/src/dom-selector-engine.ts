// Browser-injectable selector engine injected once per Page via session.evaluate().
// Defines window.__mw with Playwright-compatible DOM matching helpers.
// Written from scratch against the W3C accName spec and HTML-AAM spec,
// matching Playwright's observable behavior for the common cases.

export const DOM_SELECTOR_ENGINE = `
(function () {
  // ─── Text helpers ────────────────────────────────────────────

  function normalizeWhiteSpace(value) {
    return value.replace(/[\\u200b\\u00ad]/g, '').replace(/\\s+/g, ' ').trim();
  }

  function shouldSkipForTextMatching(el) {
    const nodeName = el.nodeName;
    return nodeName === 'SCRIPT' || nodeName === 'NOSCRIPT' || nodeName === 'STYLE' || nodeName === 'TEMPLATE' ||
      (el.ownerDocument.head && el.ownerDocument.head.contains(el));
  }

  // Returns the full text content of an element, recursing into children but
  // skipping script/style nodes. Matches Playwright's elementText().full.
  function elementFullText(el) {
    if (shouldSkipForTextMatching(el)) {
      return '';
    }
    if ((el.nodeName === 'INPUT') && (el.type === 'submit' || el.type === 'button')) {
      return el.value;
    }
    let text = '';
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        text += child.nodeValue || '';
      } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
        text += elementFullText(child);
      }
    }
    return text;
  }

  function elementNormalizedText(el) {
    return normalizeWhiteSpace(elementFullText(el));
  }

  // Mirrors Playwright's elementMatchesText(): returns whether the element's
  // text matches AND whether a child also matches (to find the innermost match).
  // Returns 'none' | 'self' | 'selfAndChildren'.
  function elementMatchesText(el, matcher) {
    if (shouldSkipForTextMatching(el)) {
      return 'none';
    }
    if (!matcher(elementNormalizedText(el))) {
      return 'none';
    }
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 && matcher(elementNormalizedText(child))) {
        return 'selfAndChildren';
      }
    }
    return 'self';
  }

  // Iterates all elements in document order (like querySelectorAll('*')),
  // returning only the innermost matching elements — mirrors Playwright's
  // internal:text engine behavior.
  function findByText(root, textOrRegex, exact) {
    const matcher = buildTextMatcher(textOrRegex, exact);
    const result = [];
    const all = root.querySelectorAll('*');
    for (const el of all) {
      const match = elementMatchesText(el, matcher);
      if (match === 'self') {
        result.push(el);
      }
      // 'selfAndChildren' → skip the parent, child will be pushed when visited
    }
    return result;
  }

  function buildTextMatcher(textOrRegex, exact) {
    if (textOrRegex instanceof RegExp) {
      return text => textOrRegex.test(text);
    }
    if (exact) {
      return text => text === textOrRegex;
    }
    // Playwright default: case-sensitive substring on normalised text
    return text => text.includes(textOrRegex);
  }

  // ─── Attribute helpers ───────────────────────────────────────

  // Used by getByPlaceholder, getByAltText, getByTitle.
  // Playwright default (exact=false): case-insensitive substring.
  function findByAttr(root, attrName, textOrRegex, exact) {
    const elements = Array.from(root.querySelectorAll('[' + attrName + ']'));
    return elements.filter(el => {
      const value = el.getAttribute(attrName) || '';
      if (textOrRegex instanceof RegExp) {
        return textOrRegex.test(value);
      }
      if (exact) {
        return value === textOrRegex;
      }
      return value.toLowerCase().includes(textOrRegex.toLowerCase());
    });
  }

  // ─── ARIA role computation ────────────────────────────────────

  const kAncestorPreventingLandmark = 'article,aside,main,nav,section';

  const kInputTypeToRole = {
    button: 'button', checkbox: 'checkbox', image: 'button',
    number: 'spinbutton', radio: 'radio', range: 'slider',
    reset: 'button', submit: 'button',
  };

  // https://w3c.github.io/html-aam/#html-element-role-mappings
  const kImplicitRole = {
    A:          el => el.hasAttribute('href') ? 'link' : null,
    AREA:       el => el.hasAttribute('href') ? 'link' : null,
    ARTICLE:    () => 'article',
    ASIDE:      () => 'complementary',
    BLOCKQUOTE: () => 'blockquote',
    BUTTON:     () => 'button',
    CAPTION:    () => 'caption',
    CODE:       () => 'code',
    DATALIST:   () => 'listbox',
    DD:         () => 'definition',
    DEL:        () => 'deletion',
    DETAILS:    () => 'group',
    DFN:        () => 'term',
    DIALOG:     () => 'dialog',
    DT:         () => 'term',
    EM:         () => 'emphasis',
    FIELDSET:   () => 'group',
    FIGURE:     () => 'figure',
    FOOTER:     el => el.closest(kAncestorPreventingLandmark) ? null : 'contentinfo',
    FORM:       el => (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) ? 'form' : null,
    H1: () => 'heading', H2: () => 'heading', H3: () => 'heading',
    H4: () => 'heading', H5: () => 'heading', H6: () => 'heading',
    HEADER:     el => el.closest(kAncestorPreventingLandmark) ? null : 'banner',
    HR:         () => 'separator',
    HTML:       () => 'document',
    IMG:        el => (el.getAttribute('alt') === '' && !el.getAttribute('title') && !el.hasAttribute('tabindex')) ? 'presentation' : 'img',
    INPUT:      el => {
      const type = (el.type || '').toLowerCase();
      if (type === 'search') {
        return el.hasAttribute('list') ? 'combobox' : 'searchbox';
      }
      if (['email','tel','text','url',''].includes(type)) {
        return el.hasAttribute('list') ? 'combobox' : 'textbox';
      }
      if (type === 'hidden') {
        return null;
      }
      if (type === 'file') {
        return 'button';
      }
      return kInputTypeToRole[type] || 'textbox';
    },
    INS:        () => 'insertion',
    LI:         () => 'listitem',
    MAIN:       () => 'main',
    MARK:       () => 'mark',
    MATH:       () => 'math',
    MENU:       () => 'list',
    METER:      () => 'meter',
    NAV:        () => 'navigation',
    OL:         () => 'list',
    OPTGROUP:   () => 'group',
    OPTION:     () => 'option',
    OUTPUT:     () => 'status',
    P:          () => 'paragraph',
    PROGRESS:   () => 'progressbar',
    SEARCH:     () => 'search',
    SECTION:    el => (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) ? 'region' : null,
    SELECT:     el => (el.hasAttribute('multiple') || el.size > 1) ? 'listbox' : 'combobox',
    STRONG:     () => 'strong',
    SUB:        () => 'subscript',
    SUP:        () => 'superscript',
    SVG:        () => 'img',
    TABLE:      () => 'table',
    TBODY:      () => 'rowgroup',
    TD:         el => {
      const tableEl = el.closest('table');
      const tableRole = tableEl ? getExplicitRole(tableEl) : null;
      return (tableRole === 'grid' || tableRole === 'treegrid') ? 'gridcell' : 'cell';
    },
    TEXTAREA:   () => 'textbox',
    TFOOT:      () => 'rowgroup',
    TH:         el => {
      const scope = el.getAttribute('scope');
      return (scope === 'row' || scope === 'rowgroup') ? 'rowheader' : 'columnheader';
    },
    THEAD:      () => 'rowgroup',
    TIME:       () => 'time',
    TR:         () => 'row',
    UL:         () => 'list',
  };

  const kValidRoles = new Set(['alert','alertdialog','application','article','banner','blockquote','button','caption','cell','checkbox','code','columnheader','combobox','complementary','contentinfo','definition','deletion','dialog','directory','document','emphasis','feed','figure','form','generic','grid','gridcell','group','heading','img','insertion','link','list','listbox','listitem','log','main','mark','marquee','math','meter','menu','menubar','menuitem','menuitemcheckbox','menuitemradio','navigation','none','note','option','paragraph','presentation','progressbar','radio','radiogroup','region','row','rowgroup','rowheader','scrollbar','search','searchbox','separator','slider','spinbutton','status','strong','subscript','superscript','switch','tab','table','tablist','tabpanel','term','textbox','time','timer','toolbar','tooltip','tree','treegrid','treeitem']);

  function getExplicitRole(el) {
    const tokens = (el.getAttribute('role') || '').split(/\\s+/).map(role => role.trim());
    return tokens.find(role => kValidRoles.has(role)) || null;
  }

  function getImplicitRole(el) {
    const fn = kImplicitRole[el.tagName];
    return fn ? fn(el) : null;
  }

  function isNativelyFocusable(el) {
    const tag = el.tagName;
    if (['BUTTON','DETAILS','SELECT','TEXTAREA'].includes(tag)) {
      return true;
    }
    if (tag === 'A' || tag === 'AREA') {
      return el.hasAttribute('href');
    }
    if (tag === 'INPUT') {
      return (el.type || '').toLowerCase() !== 'hidden';
    }
    return false;
  }

  function getAriaRole(el) {
    const explicit = getExplicitRole(el);
    if (!explicit) {
      return getImplicitRole(el);
    }
    // Presentation conflict resolution: explicit none/presentation is overridden
    // when element is focusable or has global ARIA attributes.
    if (explicit === 'none' || explicit === 'presentation') {
      if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ||
          !isNaN(Number(el.getAttribute('tabindex'))) || isNativelyFocusable(el)) {
        return getImplicitRole(el) || explicit;
      }
    }
    return explicit;
  }

  // ─── Accessible name (W3C accName, simplified) ───────────────

  function getIdRefs(el, attrValue) {
    if (!attrValue) {
      return [];
    }
    const root = el.getRootNode() || document;
    return attrValue.split(/\\s+/).filter(Boolean).flatMap(id => {
      try {
        const found = (root.querySelector ? root : document).querySelector('#' + CSS.escape(id));
        return found ? [found] : [];
      } catch (e) {
        return [];
      }
    });
  }

  // Priority: aria-labelledby > aria-label > native label/alt/placeholder/title > content
  function getAccessibleName(el, visited) {
    if (!visited) {
      visited = new Set();
    }
    if (visited.has(el)) {
      return '';
    }
    visited.add(el);

    // 1. aria-labelledby
    const labelledByRefs = getIdRefs(el, el.getAttribute('aria-labelledby'));
    if (labelledByRefs.length) {
      return normalizeWhiteSpace(labelledByRefs.map(ref => getAccessibleName(ref, visited)).join(' '));
    }

    // 2. aria-label
    const ariaLabel = (el.getAttribute('aria-label') || '').trim();
    if (ariaLabel) {
      return ariaLabel;
    }

    const tag = el.tagName;

    // 3. input[type=button/submit/reset]
    if (tag === 'INPUT') {
      const type = (el.type || '').toLowerCase();
      if (['button','submit','reset'].includes(type)) {
        const val = (el.value || '').trim();
        if (val) {
          return val;
        }
        if (type === 'submit') {
          return 'Submit';
        }
        if (type === 'reset') {
          return 'Reset';
        }
        return el.getAttribute('title') || '';
      }
      if (type === 'image') {
        const alt = (el.getAttribute('alt') || '').trim();
        return alt || el.getAttribute('title') || 'Submit';
      }
    }

    // 4. Associated <label> elements (INPUT, SELECT, TEXTAREA, BUTTON, METER, OUTPUT, PROGRESS)
    if (['INPUT','TEXTAREA','SELECT','BUTTON','METER','OUTPUT','PROGRESS'].includes(tag)) {
      const labels = el.labels;
      if (labels && labels.length) {
        return normalizeWhiteSpace(Array.from(labels).map(label => elementFullText(label)).join(' '));
      }
    }

    // 5. img / area alt
    if (tag === 'IMG' || tag === 'AREA') {
      const alt = (el.getAttribute('alt') || '').trim();
      return alt || el.getAttribute('title') || '';
    }

    // 6. SVG: first <title> child
    if (tag === 'SVG' || el.ownerSVGElement) {
      const title = el.querySelector(':scope > title');
      if (title) {
        return normalizeWhiteSpace(elementFullText(title));
      }
    }

    // 7. table -> caption
    if (tag === 'TABLE') {
      const caption = el.querySelector(':scope > caption');
      if (caption) {
        return normalizeWhiteSpace(elementFullText(caption));
      }
      return el.getAttribute('summary') || el.getAttribute('title') || '';
    }

    // 8. fieldset -> legend
    if (tag === 'FIELDSET') {
      const legend = el.querySelector(':scope > legend');
      if (legend) {
        return normalizeWhiteSpace(elementFullText(legend));
      }
      return el.getAttribute('title') || '';
    }

    // 9. figure -> figcaption
    if (tag === 'FIGURE') {
      const cap = el.querySelector(':scope > figcaption');
      if (cap) {
        return normalizeWhiteSpace(elementFullText(cap));
      }
      return el.getAttribute('title') || '';
    }

    // 10. Roles that allow name-from-content
    const kNameFromContentRoles = new Set(['button','cell','checkbox','columnheader','gridcell','heading','link','menuitem','menuitemcheckbox','menuitemradio','option','radio','row','rowheader','switch','tab','tooltip','treeitem']);
    const role = getAriaRole(el);
    if (role && kNameFromContentRoles.has(role)) {
      return normalizeWhiteSpace(elementFullText(el));
    }

    // 11. placeholder fallback for inputs
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const placeholder = el.getAttribute('placeholder') || '';
      const title = el.getAttribute('title') || '';
      return title || placeholder;
    }

    return el.getAttribute('title') || '';
  }

  // ─── Label detection (for getByLabel) ────────────────────────

  function getElementLabels(el) {
    // aria-labelledby
    const refs = getIdRefs(el, el.getAttribute('aria-labelledby'));
    if (refs.length) {
      return refs.map(ref => normalizeWhiteSpace(elementFullText(ref)));
    }

    // aria-label
    const ariaLabel = (el.getAttribute('aria-label') || '').trim();
    if (ariaLabel) {
      return [ariaLabel];
    }

    // HTML label elements (INPUT[not hidden], BUTTON, METER, OUTPUT, PROGRESS, SELECT, TEXTAREA)
    const tag = el.tagName;
    const isLabelable = (tag === 'INPUT' && (el.type || '').toLowerCase() !== 'hidden') ||
                        ['BUTTON','METER','OUTPUT','PROGRESS','SELECT','TEXTAREA'].includes(tag);
    if (isLabelable && el.labels && el.labels.length) {
      return Array.from(el.labels).map(label => normalizeWhiteSpace(elementFullText(label))).filter(Boolean);
    }

    return [];
  }

  // ─── findByRole ───────────────────────────────────────────────

  // Playwright internal mode: name match is substring by default (not exact).
  function findByRole(root, role, name, exact) {
    const result = [];
    for (const el of root.querySelectorAll('*')) {
      if (getAriaRole(el) !== role) {
        continue;
      }
      if (name !== undefined) {
        const accessibleName = normalizeWhiteSpace(getAccessibleName(el));
        const nameNorm = name instanceof RegExp ? name : normalizeWhiteSpace(String(name));
        if (name instanceof RegExp) {
          if (!name.test(accessibleName)) {
            continue;
          }
        } else if (exact) {
          if (accessibleName !== nameNorm) {
            continue;
          }
        } else {
          // Internal mode default: substring match
          if (!accessibleName.includes(nameNorm)) {
            continue;
          }
        }
      }
      result.push(el);
    }
    return result;
  }

  // ─── findByLabel ─────────────────────────────────────────────

  function findByLabel(root, textOrRegex, exact) {
    const matcher = buildTextMatcher(textOrRegex, exact);
    const result = [];
    for (const el of root.querySelectorAll('*')) {
      const labels = getElementLabels(el);
      if (labels.some(label => matcher(label))) {
        result.push(el);
      }
    }
    return result;
  }

  // ─── Expose on window ────────────────────────────────────────

  window.__mw = {
    findByText,
    findByRole,
    findByLabel,
    findByAttr,
    getAriaRole,
    getAccessibleName,
    normalizeWhiteSpace,
    elementNormalizedText,
  };
})();
`;

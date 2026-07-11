---
sidebar_position: 8
title: Locators
---

# Locators

`getByRole()` lets a single test target the same element on both Android and iOS,
even though each platform names its native classes differently. Mobilewright does
this by normalizing the native type reported by the device and mapping it to a
semantic **role**.

## How a native type becomes a role

When you call `screen.getByRole('textfield')`, the query engine:

1. Takes the raw native type from the UI dump
   (Android: `android.widget.EditText`, iOS: `XCUIElementTypeTextField`).
2. **Normalizes** it — strips the Android package prefix (`android.widget.`,
   `androidx.*`, …) and the iOS `XCUIElementType` prefix — leaving a bare name
   (`edittext`, `textfield`).
3. Matches that bare name against the role's class list.

`getByType()` skips normalization and matches the **raw** native class instead, so
use it (or `getByLabel()` / `getByTestId()`) for classes that have no role mapping.

## Android class → role

Android reports the base framework class (e.g. `android.widget.EditText`, even when
the app uses `AppCompatEditText`).

| Native class | `getByRole()` |
| --- | --- |
| `android.widget.Button` | `button` |
| `android.widget.ImageButton` | `button` |
| `android.widget.EditText` | `textfield` |
| `android.widget.TextView` | `text` |
| `android.widget.ImageView` | `image` |
| `android.widget.Switch` | `switch` |
| `android.widget.ToggleButton` | `switch` |
| `android.widget.CheckBox` | `checkbox` |
| `android.widget.SeekBar` | `slider` |
| `android.widget.ListView` | `list` |
| `androidx.recyclerview.widget.RecyclerView` | `list` |
| `android.widget.ScrollView` | `list` |
| `android.widget.LinearLayout` | `listitem` |
| `android.widget.RelativeLayout` | `listitem` |
| `android.widget.Toolbar` | `header` |

### React Native (Android)

| Native class | `getByRole()` |
| --- | --- |
| `…textinput.ReactEditText` | `textfield` |
| `…text.ReactTextView` | `text` |
| `…image.ReactImageView` | `image` |
| `…scroll.ReactScrollView` | `list` |
| `…view.ReactViewGroup` | `button` — only when `clickable="true"` or `accessible="true"` |

## iOS class → role

| Native class | `getByRole()` |
| --- | --- |
| `XCUIElementTypeButton` | `button` |
| `XCUIElementTypeTextField` | `textfield` |
| `XCUIElementTypeSecureTextField` | `textfield` |
| `XCUIElementTypeSearchField` | `textfield` |
| `XCUIElementTypeStaticText` | `text` |
| `XCUIElementTypeTextView` | `text` — see note below |
| `XCUIElementTypeImage` | `image` |
| `XCUIElementTypeSwitch` | `switch` |
| `XCUIElementTypeSlider` | `slider` |
| `XCUIElementTypeTable` | `list` |
| `XCUIElementTypeCollectionView` | `list` |
| `XCUIElementTypeScrollView` | `list` |
| `XCUIElementTypeCell` | `listitem` |
| `XCUIElementTypeOther` | `listitem` |
| `XCUIElementTypeTab` | `tab` |
| `XCUIElementTypeTabBar` | `tab` |
| `XCUIElementTypeLink` | `link` |
| `XCUIElementTypeNavigationBar` | `header` |

## Notes and known gaps

- **Classes with no role.** Anything not listed above has no role mapping —
  `getByRole()` won't find it. Target it with `getByType('<raw.native.Class>')`,
  `getByLabel()`, or `getByTestId()`. Examples: Android `Spinner`, `RadioButton`,
  `RadioGroup`, `CheckedTextView`; iOS `Picker`, `DatePicker`.

- **iOS source filtering.** mobilecli currently surfaces only a subset of iOS
  classes — `Button`, `TextField`, `SecureTextField`, `SearchField`, `Switch`,
  `StaticText`, `Image`, `Icon`, `WebView`. Other rows in the iOS table
  (`Slider`, `Table`, `CollectionView`, `Cell`, `Tab`, `NavigationBar`, `Link`,
  `TextView`) are filtered out before they reach the query engine, so `getByRole()`
  cannot match them yet even though the mapping exists.

- **`TextView` is platform-ambiguous.** On Android, `TextView` is a static label
  (`text`). On iOS, `XCUIElementTypeTextView` is an editable multiline input
  (`UITextView` / SwiftUI `TextEditor`), which is closer to `textfield`. Both
  normalize to the same `textview` token, so they currently share the `text` role.
  Aligning an *editable* iOS text view with `textfield` (matching the web/ARIA model,
  where `<textarea>` and `<input>` are both `textbox`) is tracked separately.

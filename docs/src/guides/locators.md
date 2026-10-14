---
sidebar_position: 8
title: Locators
---

# Locators

`getByRole()` lets a single test target the same element on both Android and iOS,
even though each platform names its native classes differently. Mobilewright does
this by normalizing the native type reported by the device and mapping it to a
semantic **role**.

## Where each locator looks

Every element in the UI dump carries a handful of attributes. Each `getBy…()` locator
reads one of them, but Android and iOS fill those attributes from different native
properties.

### The same text field on both platforms

Here is one text field from the Mobilewright playground app (Basic UI screen), as each
platform's accessibility layer reports it. The user has typed into it.

**Android** (`AccessibilityNodeInfo`):

```json
{
  "class": "android.widget.EditText",
  "text": "Hello World",
  "hint": "Text Field",
  "content-desc": "text_field",
  "resource-id": "com.mobilenext.playground:id/text_field",
  "enabled": true,
  "focused": true
}
```

**iOS** (XCUITest element snapshot):

```json
{
  "elementType": "XCUIElementTypeTextField",
  "identifier": "text_field",
  "label": "",
  "value": "hello",
  "placeholderValue": "Enter text",
  "enabled": true,
  "hasFocus": true
}
```

### Which native property feeds which locator

| Attribute | Android source | iOS source | Locator / assertion |
| --- | --- | --- | --- |
| type | `class` | `elementType` | `getByRole()` (normalized), `getByType()` (raw) |
| label | `content-desc` (`contentDescription`) | `label` (`accessibilityLabel`) | `getByLabel()`, `getByRole(…, { name })` |
| testId | `resource-id` (`android:id`) | `identifier` (`accessibilityIdentifier`) | `getByTestId()` |
| text | `text` | — never reported | `getByText()`, `toHaveText()` |
| value | slider position (`RangeInfo`), text field content | `value` (`accessibilityValue`) | `toHaveValue()`, `getValue()` |
| placeholder | `hint` (`hintText`) | `placeholderValue` | `getByPlaceholder()` |
| checked | `checked` | switch `value` of `"1"` | `toBeChecked()` |

A few rules that follow from this table:

- **`getByText()` falls back.** It matches the first non-empty of text, label, then
  value. iOS never reports text, so on iOS `getByText()` matches the label, or for a
  text field without a label, what the user typed.
- **`getByRole(…, { name })` reads the label first**, then text. An iOS text field
  without an `accessibilityLabel` has no name, so match it by role alone or by another
  locator.
- **`getByTestId()` accepts the short Android id.** `getByTestId('text_field')`
  matches `com.mobilenext.playground:id/text_field`, so one test id works on both
  platforms.
- **There is no `getByValue()`.** A value changes as the user interacts, so find the
  element another way and assert on it with `toHaveValue()`.
- **Not every accessibility property is visible to tests.** XCUITest does not expose
  `accessibilityHint` or `accessibilityTraits`, and Android's `tooltipText` and
  `stateDescription` are not reported, so no locator can match them.

:::note
Android reports `value` for text fields and sliders, and iOS reports `checked` for
switches, starting with the mobilecli release that includes
[mobilecli#455](https://github.com/mobile-next/mobilecli/pull/455). With older mobilecli
versions, `toHaveValue()` on Android and `toBeChecked()` on iOS do not match.
:::

### Finding the text field

Each of these finds the field above (Basic UI has three text fields on Android and two on iOS):

```ts
// test id: identical on both platforms
screen.getByTestId('text_field');

// role: the native class, normalized; without a name it matches every text field
screen.getByRole('textfield').first();
screen.getByRole('textfield', { name: 'text_field' }); // Android only: iOS has no label here

// label: Android content-desc / iOS accessibilityLabel
screen.getByLabel('text_field'); // Android only, for the same reason

// placeholder: Android hint / iOS placeholderValue
screen.getByPlaceholder('Text Field'); // Android
screen.getByPlaceholder('Enter text'); // iOS

// text: Android text / iOS falls back to value
screen.getByText('Hello World'); // Android
screen.getByText('hello'); // iOS
```

And to check what the user typed:

```ts
const field = screen.getByTestId('text_field');
await expect(field).toHaveValue('hello');
```

Prefer `getByTestId()`, then `getByRole()` with a name, for locators that survive
copy changes and work on both platforms. Placeholder and text differ between the two
apps here, which is common, so they make weaker cross-platform locators.

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
| `android.widget.RadioButton` | `radio` |
| `android.widget.SeekBar` | `slider` |
| `android.widget.ProgressBar` | `progressbar` |
| `android.widget.Spinner` | `combobox` |
| `android.widget.ListView` | `list` |
| `androidx.recyclerview.widget.RecyclerView` | `list` |
| `android.widget.ScrollView` | `list` |
| `android.widget.LinearLayout` | `listitem` |
| `android.widget.RelativeLayout` | `listitem` |
| `android.widget.Toolbar` | `header` |

### AndroidX / Material Components

Some dumps surface the AndroidX or Material Components subclass name directly instead
of the collapsed framework class above — these are also recognized:

| Native class | `getByRole()` |
| --- | --- |
| `androidx.appcompat.widget.AppCompatButton` | `button` |
| `com.google.android.material.button.MaterialButton` | `button` |
| `com.google.android.material.floatingactionbutton.FloatingActionButton` | `button` |
| `androidx.appcompat.widget.AppCompatRadioButton` | `radio` |
| `androidx.appcompat.widget.AppCompatSpinner` | `combobox` |
| `androidx.appcompat.widget.AppCompatEditText` | `textfield` |
| `com.google.android.material.textfield.TextInputEditText` | `textfield` |
| `androidx.appcompat.widget.AppCompatTextView` | `text` |
| `com.google.android.material.textview.MaterialTextView` | `text` |
| `androidx.appcompat.widget.AppCompatImageView` | `image` |
| `com.google.android.material.imageview.ShapeableImageView` | `image` |

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
| `XCUIElementTypeProgressIndicator` | `progressbar` |
| `XCUIElementTypeActivityIndicator` | `progressbar` |
| `XCUIElementTypeAlert` | `alert` |
| `XCUIElementTypeSheet` | `alert` |
| `XCUIElementTypePicker` | `combobox` |
| `XCUIElementTypePickerWheel` | `combobox` |
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
  `getByLabel()`, or `getByTestId()`. Examples: Android `RadioGroup`,
  `CheckedTextView`; iOS `DatePicker`.

- **iOS source filtering.** mobilecli keeps the iOS dump small, so not every
  element reaches the query engine. `Button`, `TextField`, `SecureTextField`,
  `SearchField`, `TextView`, `Switch`, `WebView`, `Slider`, `Picker` and
  `PickerWheel` are always included. Every other class in the iOS table is
  included only when it has a label, name or `accessibilityIdentifier` — so
  `getByRole('list')` finds a labeled `Table` but not an anonymous one.
  `XCUIElementTypeOther` is included only when it carries an
  `accessibilityIdentifier`. Requires mobilecli 1.0.13 or later; earlier
  versions only surface `Button`, `TextField`, `SecureTextField`, `SearchField`,
  `TextView`, `Switch`, `WebView`, `StaticText`, `Image` and `Icon`.

- **`TextView` is platform-ambiguous.** On Android, `TextView` is a static label
  (`text`). On iOS, `XCUIElementTypeTextView` is an editable multiline input
  (`UITextView` / SwiftUI `TextEditor`), which is closer to `textfield`. Both
  normalize to the same `textview` token, so they currently share the `text` role.
  Aligning an *editable* iOS text view with `textfield` (matching the web/ARIA model,
  where `<textarea>` and `<input>` are both `textbox`) is tracked separately.

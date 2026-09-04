# Interaction and Motion Contract

This document defines how Annote should feel and how each animated surface moves through its lifecycle. It is the baseline for future interaction changes.

## Experience Principles

1. **Preserve spatial continuity.** Controls expand from their resting position. Composers originate near the selected element. Nothing should appear to teleport before or after an animation.
2. **Respond immediately, animate second.** Pointer, focus, and pressed states respond within the same frame. Longer motion communicates a mode or spatial change, not basic acknowledgement.
3. **Keep transient interactions local.** Hover, marker positioning, tooltip travel, composer shake, and CSS expansion update existing DOM nodes. They must not trigger a full Shadow DOM render.
4. **One primary surface at a time.** Review and composer are mutually exclusive. Opening either suspends element picking until the user explicitly returns to it.
5. **Motion must not change task state.** Collapsing is the only action that collapses the toolbar. Copying, clearing, stopping selection, opening review, and importing resolutions preserve toolbar expansion.
6. **Stay inside the viewport.** Tooltips, markers, review, and composer are clamped before or during movement. Viewport correction should not be visible as a second jump.
7. **Animate from the interaction point.** The composer opens near the click or selected element, to its right when space allows and to its left otherwise. Near the bottom edge, it grows upward.

## Runtime Ownership

The annotator is a single injected runtime mounted in an open Shadow DOM.

Use a full `render()` only for durable mode or data transitions:

- toolbar collapsed or expanded
- picker active or inactive
- review open or closed
- composer opened, saved, deleted, or closed
- annotation collection or status changed
- resolution importer opened or closed

Use direct DOM updates for high-frequency or transient behavior:

- hover outline and element label
- marker coordinates during scroll, resize, and DOM mutation
- grouped toolbar tooltip position, size, and content
- composer shake after a blocked outside click
- selected-element CSS expansion
- Add button enabled state while typing
- copy icon success feedback

This boundary prevents flicker. A transient interaction must not replace the toolbar, composer, markers, or focused input node.

## State Invariants

| State | Required behavior |
| --- | --- |
| Toolbar collapsed | Only the launcher is visible. This is the default state. |
| Toolbar expanded | Toolbar remains expanded until Collapse or Close is invoked. |
| Picker active | Page cursor communicates annotation mode; hover outline follows eligible elements. |
| Shift multi-select | A pristine composer yields to selection immediately on Shift-down without replacing its focused DOM node. Its last page-pointer target becomes a blue hover outline immediately, the cursor switches to blue from keyboard state, and both continue tracking during selection. Releasing Shift restores the composer or opens the multi-element composer; clearing the selection or returning to one target restores orange. |
| Dirty composer + Shift | Shift does not enter multi-select or dismiss the composer once comment or style changes exist. |
| Composer open | Picking is locked to the selected element. Outside clicks shake the existing composer. |
| Composer layout change | Opening or closing the style editor first closes the intent menu, so no fixed-position menu survives a composer geometry transition. |
| Four-sided style fields | Padding, margin, border width, and border radius remain four-field controls. Hovering or focusing an input identifies its side; radius inputs identify their corner. |
| Review open | Picker and composer are closed. Review button has the active orange state. |
| Import open | Review is open and stable; only the importer section enters or leaves. |
| Existing marker clicked | Composer opens in edit mode for that annotation. A second annotation is not created. |
| Copy succeeded | Copy icon becomes a check for 1400ms without a toast or hover reaction. |

## Timing Tokens

| Token | Duration | Easing | Use |
| --- | ---: | --- | --- |
| Micro feedback | 120-160ms | `ease` | hover, pressed, toast, action visibility |
| Panel entry | 180ms | `cubic-bezier(.2,.8,.2,1)` | review and launcher entry |
| Composer entry | 220ms | `cubic-bezier(.2,.8,.2,1)` | composer and CSS expansion |
| Composer exit | 150ms | `ease-in` | close, save, and delete |
| Blocked action | 260ms | `ease` | composer shake |
| Shared tooltip glide | 280ms | `cubic-bezier(.2,.8,.2,1)` | tooltip position and width |
| Toolbar shell | 400ms | `cubic-bezier(.19,1,.22,1)` | right-anchored width change |
| Toolbar controls | 560ms open, 300ms close | `cubic-bezier(.19,1,.22,1)` | opacity, blur, and scale |
| Tooltip readiness gate | 850ms | timer | prevents labels during toolbar expansion |

Durations are coordination contracts. If one changes, update dependent timers and verify interruption behavior.

## Toolbar Lifecycle

### Open

1. Keep the right and bottom edges fixed at the launcher position.
2. Animate shell width from `42px` to `289px` over 400ms.
3. Reveal controls from the same right-side origin using opacity, blur, and scale.
4. Ignore toolbar pointer input during the shell animation.
5. Suppress tooltips until 850ms, after both shell and controls have settled.
6. Do not move the toolbar farther right than its collapsed resting position at any point.

### Collapse

1. Close review, importer, and composer and stop picking.
2. Keep the toolbar's right edge fixed.
3. Fade and contract controls before the shell reaches `42px`.
4. Replace the shell with the launcher only after the 400ms close lifecycle completes.

### Close

Close removes the annotator runtime rather than collapsing it. `Escape` closes the composer first; when no composer is open, `Escape` closes the annotator.

## Grouped Tooltip Lifecycle

The toolbar uses one shared tooltip surface rather than one tooltip per button.

### Cold entry

1. Pointer enters an enabled toolbar control.
2. Wait 200ms before showing the tooltip.
3. Enter with opacity, slight scale, and a 7px rise.
4. Maintain approximately 14px of space above the control.

### Travel within the group

1. Keep the tooltip warm while the pointer crosses toolbar controls.
2. Open the next label immediately.
3. Glide the same surface to the next control over 280ms.
4. Animate the surface width to the new label width.
5. Bring replacement text from the direction of pointer travel.
6. Clamp the tooltip to an 8px viewport inset.

### Leave and reset

- Wait 120ms before closing so crossing small gaps does not blink.
- Keep the group warm for 400ms after close; re-entry during this window skips the cold delay.
- Pointer down dismisses and cools the tooltip immediately.
- Disabled controls do not open a tooltip.

## Element Picking Lifecycle

Pointer movement must never call `render()`.

1. Ignore annotator-owned Shadow DOM nodes without disabling the picker itself.
2. Resolve the eligible page element under the pointer.
3. Update only the existing outline and label nodes when the target changes.
4. Move the outline over 90ms to soften adjacent-element transitions.
5. On click, freeze the selected target and open the composer.
6. If the target already has an unresolved annotation, open that annotation in edit mode.

When a composer is open, outside page clicks are blocked. The existing composer shakes for 260ms without being recreated, losing focus, or resetting entered text.

## Composer Lifecycle

### Positioning before entry

1. Capture the click as the preferred anchor.
2. Place the composer 16px from that anchor.
3. Choose right or left before mounting based on available width.
4. Choose downward or upward growth before mounting based on available height.
5. Clamp to a 12px viewport inset.

The initial placement and transform origin must agree. A composer opening upward uses a bottom-left transform origin. It must not animate in one direction and then move to another resting position.

### Entry

- Duration: 220ms.
- Motion: fade, scale from `.96`, and translate toward the resting position.
- Focus the description textarea on the next animation frame.
- Remove the temporary entering state after 230ms, then perform a final viewport clamp.

### Selected-element CSS

- The settings icon sits beside the element selector.
- Opening rotates the icon and expands the existing CSS container over 220ms.
- Height, top spacing, opacity, and border appear as one coordinated transition.
- For an upward composer, preserve its bottom edge while content grows upward.
- Re-clamp during the next frame and after the 230ms expansion lifecycle.

### Exit

Close, Save, and Delete share the same 150ms exit animation. Data mutation and the subsequent render happen only after the animation completes.

## Marker Lifecycle

- Markers remain interactive while the picker is active.
- Scroll, resize, and observed layout mutations schedule one animation-frame update.
- Position updates mutate marker styles directly; they do not render the annotation layer again.
- Marker tooltips choose left or right and above, middle, or below based on available viewport space.
- Clicking a marker opens its composer in edit mode.
- Resolving an annotation removes its marker on the next durable state render.

## Review Lifecycle

- The review panel enters over 180ms from 10px below with a slight `.98` scale.
- Its width matches the expanded toolbar width: `289px`.
- The panel has a bounded height; the annotation list scrolls while header and footer controls stay fixed.
- Resolve controls appear only while their annotation is hovered or focused.
- Clicking an annotation header scrolls to the target and opens the edit composer.
- Opening review closes the composer and disables picking. Opening the composer closes review.
- Opening or closing the resolution importer must not resize existing annotation cards.

## Feedback Lifecycles

| Action | Feedback |
| --- | --- |
| Copy | Replace copy icon with a green check for 1400ms; disable hover and tooltip; no toast. |
| Empty Add | Keep Add disabled until the trimmed description is non-empty. |
| Outside click during composition | Shake the existing composer; preserve its DOM, focus, text, intent, and CSS state. |
| Clear with no annotations | Keep Clear disabled. |
| Resolve | Remove the resolve icon and marker after status changes. |
| Failed clipboard write | Show an error notice, then reset copy state after 1800ms. |

## Interruption Rules

- A new mode transition cancels pending tooltip timers.
- Closing a composer already marked `exiting` is ignored.
- A pending toolbar open must not re-enable tooltips after collapse begins.
- Leaving a delayed tooltip target before it opens must also dismiss any previous tooltip whose close was canceled by that handoff.
- Scroll, resize, and mutation callbacks coalesce through one `requestAnimationFrame`.
- Repeated outside clicks restart only the shake keyframe on the same composer node.
- Focus and typed content must survive every transient animation.

## Accessibility and Browser Constraints

- Icon-only controls require an `aria-label`; expanding controls also require `aria-expanded` and `aria-controls`.
- Keyboard focus opens grouped tooltips immediately. Blur and `Escape` dismiss them immediately.
- Shadow DOM focus checks must use `shadowRoot.activeElement`, not `document.activeElement`.
- `ResizeObserver`, `MutationObserver`, and Clipboard API availability vary by browser and page policy.
- CSS `backdrop-filter`, `clip-path`, and blur may render differently across engines.
- The current runtime does not yet implement `prefers-reduced-motion`. Before release, reduced motion should remove translation, scale, blur, shake, and gliding while preserving state timing and focus behavior.
- Max-height transitions assume bounded content. If the CSS property list becomes dynamic, measure the content height instead of increasing the fixed maximum.

## Regression Checklist

For every interaction change, verify:

- toolbar opens and collapses from the same right-side anchor
- no toolbar, marker, or composer flicker during page hover
- first tooltip is delayed and adjacent tooltips travel immediately
- tooltips remain inside the viewport and do not overlap the toolbar
- composer appears near the click and chooses its growth direction before entry
- CSS expansion does not move an upward composer off-screen
- outside click shakes without recreating the composer or clearing input
- review and composer never appear together
- marker positions stay attached during scroll, resize, and layout mutation
- keyboard focus, `Escape`, disabled states, and ARIA state remain correct
- no unexpected layout shift occurs at animation completion

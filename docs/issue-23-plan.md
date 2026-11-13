# Issue #23 — unsaved mission edits

1. Compare all editable brief fields with their initial values; reverting changes restores the clean state. Keep private inputs in React memory only.
2. Guard reload/close with the browser's native warning; intercept same-tab links and browser Back with an explicit discard confirmation. In-page anchors, downloads and new tabs remain usable.
3. Move edit cancellation into the guarded form. Release navigation protection only after a successful save; preserve inputs and protection on validation/server errors.
4. Exercise browser link/back/reload cancellation, explicit discard, field reversion, successful save and failed save. Run lint, types, unit/backend checks and build. Record actual validation and browser limitations.

This is a navigation warning, not autosave. Browser shutdown/crash and browser suppression of native dialogs cannot guarantee recovery. No private CSV enters browser storage.

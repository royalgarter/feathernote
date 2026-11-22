# Tag navigation (built)

**Job:** FeatherNote user (phone or desktop) with many notes finds a group by tag, narrows with more tags, and gets back to the full list. Mode: Operate.

**Decisions:** always-expanded tag strip, `#tag=` URL hash that pushes history on tag click, removable chips above the list.

## Behavior
- **Strip:** under the search box, all tags wrap onto lines, each as a button with its note count, sorted by count then name. Hidden while editing. A tag in the active filter shows as pressed (`aria-pressed`).
- **Filtering:** tapping a tag adds it to the filter (AND, same as `#a #b` today); tapping an active tag removes it. Free-text search stays separate and can combine with tags.
- **Chips:** one removable chip per active tag above the list, plus "Clear" when there are two or more. Chips and strip stay in sync with `searchTag`.
- **URL:** `#tag=work,ideas`. Tag taps push a history entry so Back undoes the last tag; typing free text replaces the entry. Load and `popstate` read the hash. The existing `#new_note`, `#edit_note-<id>` and `#search` hashes keep working and win over `#tag=`.
- **Reset:** any filter change returns to page 1 (done in the debounced `searchTag` watcher) and scrolls the list into view.
- **Editor:** a tag in the editor stays comma-separated text. Tag names containing spaces are out of scope (`TAG_QUERY_RE` rejects them today); open decision below.

## States and ranges
- 0 tags: strip hidden. Typical 5-40 tags, max a few hundred: the always-expanded wrap must cap at roughly 6 lines with a "Show all" toggle if it overflows (open decision).
- Filter with no results: empty-state line with the active chips still visible and a Clear action.
- Offline: filtering is local, nothing changes.

## Constraints
- Alpine `mainApp` state only; tag counts computed once per `notes` change (memoize like `FILTER_MEMO`), not per render.
- Buttons, 44px targets on mobile, visible focus, `aria-label` on chips' remove buttons.
- No new libraries; match existing tab indent and 1TBS.

## Decisions taken when building (were open)
1. Tags with spaces or `#` are left out of the strip (the `#tag` syntax can't express them).
2. No height cap: the strip wraps and grows.
3. Counts are global, not scoped to the text search.

## Original open decisions
1. Tags with spaces: change `TAG_QUERY_RE` to quote them (`#"my tag"`) or keep rejecting.
2. Strip height cap with "Show all" past about 6 lines, or let it grow.
3. Should the strip scope counts to the current text search, or always show global counts.

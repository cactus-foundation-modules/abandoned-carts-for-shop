// Stylesheet for the Abandoned baskets screen. Class prefix `abc-`.
//
// Real CSS rather than the inline styles this screen started life with, because
// hover, focus rings, the sticky bulk bar, the responsive collapse and the
// badge colours all need selectors that a style object cannot express. Colours
// are tokens only, so the screen tracks the admin's light and dark themes with
// no second palette to keep in step.
//
// It is shaped after the shop's own orders list on purpose. This tab sits one
// click from that screen and shows the same shop's near-misses; two lists of
// orders that look nothing alike is a worse answer than a little duplication.
export const abandonedCartsCss = `
.abc-muted{color:var(--color-text-secondary)}
.abc-nowrap{white-space:nowrap}
.abc-count{margin:0.25rem 0 0;font-size:0.875rem;color:var(--color-text-secondary)}

/* --- Tiles -------------------------------------------------------------- */
.abc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:0.75rem;margin-bottom:0.75rem}
.abc-tile{appearance:none;text-align:left;border:1px solid var(--color-border);background:var(--color-surface);border-radius:var(--radius-lg);padding:0.75rem 0.875rem;display:grid;gap:0.125rem;font:inherit;color:inherit}
button.abc-tile{cursor:pointer}
button.abc-tile:hover{border-color:var(--color-border-strong);background:var(--color-bg-subtle)}
button.abc-tile:focus-visible{outline:2px solid var(--color-border-focus);outline-offset:1px}
.abc-tile.is-active{border-color:var(--color-primary-border);background:var(--color-primary-subtle)}
.abc-tile-label{font-size:0.75rem;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;color:var(--color-text-secondary)}
.abc-tile-value{font-size:1.375rem;font-weight:600;color:var(--color-text);line-height:1.2}
.abc-tile-note{font-size:0.75rem;color:var(--color-text-secondary)}
.abc-tile.is-attention .abc-tile-value{color:var(--color-warning)}

/* --- The job health line ------------------------------------------------ */
.abc-health{display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-bottom:1rem;padding:0.5rem 0.75rem;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg-subtle);font-size:0.8125rem;color:var(--color-text-secondary)}
.abc-health.is-warning{border-color:var(--color-warning-border);background:var(--color-warning-subtle);color:var(--color-text)}
.abc-health-spacer{flex:1}

/* --- Toolbar ------------------------------------------------------------ */
.abc-toolbar{display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-bottom:0.5rem}
.abc-search{flex:1 1 220px;min-width:180px;height:36px;padding:0 0.75rem;border-radius:var(--radius-md);border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);font-size:0.875rem}
.abc-search:focus-visible{outline:2px solid var(--color-border-focus);outline-offset:1px}
.abc-select,.abc-date,.abc-number{height:36px;padding:0 0.625rem;border-radius:var(--radius-md);border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);font-size:0.8125rem}
.abc-select{padding-right:2rem;cursor:pointer}
.abc-number{width:120px}
.abc-select:focus-visible,.abc-date:focus-visible,.abc-number:focus-visible{outline:2px solid var(--color-border-focus);outline-offset:1px}
.abc-filters{display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-bottom:1rem}
.abc-filters-label{font-size:0.75rem;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;color:var(--color-text-secondary)}

.abc-seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--color-border);border-radius:var(--radius-md);overflow:hidden;background:var(--color-surface)}
.abc-seg button{appearance:none;border:0;background:transparent;color:var(--color-text-secondary);padding:0 0.75rem;height:34px;font-size:0.8125rem;font-weight:500;cursor:pointer;border-left:1px solid var(--color-border)}
.abc-seg button:first-child{border-left:0}
.abc-seg button:hover:not(.is-active){background:var(--color-bg-subtle)}
.abc-seg button.is-active{background:var(--color-primary);color:var(--color-on-primary)}
.abc-seg button:focus-visible{outline:2px solid var(--color-border-focus);outline-offset:-2px}

/* --- Bulk bar ----------------------------------------------------------- */
.abc-bulkbar{position:sticky;top:0.5rem;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem;margin-bottom:0.75rem;padding:0.5rem 0.75rem;border:1px solid var(--color-primary-border);background:var(--color-primary-subtle);border-radius:var(--radius-md)}
.abc-bulkbar-count{font-size:0.8125rem;font-weight:600;color:var(--color-primary-dark);margin-right:0.25rem}
.abc-bulkbar-spacer{flex:1}

/* --- Table -------------------------------------------------------------- */
.abc-wrap{overflow-x:auto;border:1px solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface)}
.abc-table{width:100%;border-collapse:collapse;font-size:0.875rem}
.abc-table th{position:sticky;top:0;z-index:1;text-align:left;padding:0.625rem 0.75rem;background:var(--color-bg-subtle);font-size:0.75rem;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;color:var(--color-text-secondary);border-bottom:1px solid var(--color-border);white-space:nowrap}
.abc-table td{padding:0.625rem 0.75rem;border-bottom:1px solid var(--color-border);vertical-align:top;color:var(--color-text)}
.abc-table tbody tr:hover td{background:var(--color-bg-subtle)}
.abc-table tbody tr.is-open td{background:var(--color-bg-subtle)}
.abc-table .abc-right{text-align:right}
.abc-table th.abc-sortable{cursor:pointer;user-select:none}
.abc-table th.abc-sortable:hover{color:var(--color-text)}
.abc-table th.abc-sortable:focus-visible{outline:2px solid var(--color-border-focus);outline-offset:-2px}
.abc-sort-arrow{margin-left:0.25rem;font-size:0.6875rem}
.abc-check{width:1px}

.abc-name{appearance:none;background:none;border:0;padding:0;font:inherit;font-weight:600;color:var(--color-link,var(--color-text));cursor:pointer;text-align:left}
.abc-name:hover{text-decoration:underline}
.abc-name:focus-visible{outline:2px solid var(--color-border-focus);outline-offset:2px;border-radius:2px}
.abc-sub{display:block;font-size:0.8125rem;color:var(--color-text-secondary)}

/* Badges are core's own .badge/.badge-success family, not a set of look-alikes
   defined here - the tone-to-class mapping is in the screen. */

/* --- Detail panel ------------------------------------------------------- */
.abc-detail{display:grid;gap:1.25rem;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));padding:0.25rem 0 0.75rem}
.abc-detail h3{font-size:0.75rem;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;color:var(--color-text-secondary);margin:0 0 0.5rem}
.abc-detail-line{margin:0 0 0.125rem}
.abc-actions{display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem}

.abc-log{list-style:none;margin:0;padding:0;display:grid;gap:0.625rem}
.abc-log li{display:grid;gap:0.125rem;padding-left:0.75rem;border-left:2px solid var(--color-border)}
.abc-log li.tone-sent{border-left-color:var(--color-success-border)}
.abc-log li.tone-failed{border-left-color:var(--color-error)}
.abc-log li.tone-none{border-left-color:var(--color-border)}
.abc-log-when{font-size:0.75rem;color:var(--color-text-secondary)}
.abc-log-detail{font-size:0.8125rem;color:var(--color-text-secondary)}

/* --- Unsubscribe list --------------------------------------------------- */
.abc-supp{display:grid;gap:0.375rem;margin:0;padding:0;list-style:none}
.abc-supp li{display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;justify-content:space-between;padding:0.375rem 0;border-bottom:1px solid var(--color-border);font-size:0.875rem}
.abc-supp li:last-child{border-bottom:0}

/* --- Empty and pager ---------------------------------------------------- */
.abc-empty{padding:2rem 1rem;text-align:center;color:var(--color-text-secondary)}
.abc-pager{display:flex;gap:0.75rem;align-items:center;margin-top:1rem;flex-wrap:wrap}
.abc-pager-spacer{flex:1}

@media (max-width:640px){
  .abc-table th:nth-child(4),.abc-table td:nth-child(4){display:none}
  .abc-tiles{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
}
`

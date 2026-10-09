export const galleryStyles = `
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f5f7; color: #17202a; font: 14px/1.5 system-ui; }
    button, input, select { font: inherit; }
    button, select, summary { cursor: pointer; }
    button, select, input { min-height: 38px; border: 1px solid #bac5d2; border-radius: 6px; background: white; color: inherit; padding: 6px 10px; }
    button:hover { background: #e6ebf2; }
    a { color: #1558a8; }
    button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible, summary:focus-visible { outline: 3px solid #4a90d9; outline-offset: 3px; }
    button:disabled { opacity: .45; cursor: default; }
    [hidden] { display: none !important; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    .page-header { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 20px; padding: 12px 24px; background: white; border-bottom: 1px solid #dfe3e9; }
    h1 { margin: 0; font-size: 20px; }
    .overview { color: #526171; font-size: 13px; }
    .about { margin-left: auto; position: relative; }
    .about summary { color: #526171; padding: 6px 0; }
    .about > div { position: absolute; right: 0; top: 100%; width: min(360px, calc(100vw - 32px)); z-index: 4; padding: 12px 16px; background: white; border: 1px solid #dfe3e9; border-radius: 8px; box-shadow: 0 8px 24px #17202a20; }
    .about p { margin: 6px 0; font-size: 13px; }
    .layout { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 20px; padding: 16px 24px; }
    nav { position: sticky; top: 16px; align-self: start; max-height: calc(100dvh - 32px); overflow-y: auto; }
    nav h2 { margin: 0 10px 8px; font-size: 13px; color: #526171; }
    .module-buttons { display: flex; flex-direction: column; gap: 4px; }
    .module-button { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 10px; border-color: transparent; background: transparent; text-align: left; }
    .module-button[aria-pressed="true"] { background: #1558a8; color: white; }
    .module-total { font-size: 12px; font-variant-numeric: tabular-nums; }
    .nav-help { color: #526171; font-size: 12px; margin: 12px 10px; }
    main { min-width: 0; --preview-height: 300px; }
    .toolbar { position: sticky; top: 0; z-index: 2; padding: 0 0 8px; background: #f4f5f7; border-bottom: 1px solid #dfe3e9; margin-bottom: 16px; }
    kbd { display: inline-block; padding: 1px 4px; border: 1px solid #bac5d2; border-radius: 4px; background: #f4f5f7; color: #526171; font: 11px/1.4 ui-monospace, monospace; white-space: nowrap; }
    #gallery-help { min-height: 32px; padding: 4px 8px; font-size: 12px; }
    .search-field { position: relative; flex: 1; min-width: 0; }
    .search-field input { width: 100%; padding-left: 36px; }
    .search-key { position: absolute; left: 10px; top: 9px; pointer-events: none; }
    .keyboard-guide { margin-top: 6px; font-size: 11px; color: #526171; }
    .card-version-label { display: block; margin-top: 8px; }
    article[data-selected="true"] { border-color: #4a90d9; }
    .snapshot-link[aria-current="true"] { outline: 2px solid #4a90d9; outline-offset: 2px; }
    #gallery-shortcuts { width: min(650px, calc(100% - 24px)); max-height: calc(100dvh - 32px); padding: 20px; border: 1px solid #bac5d2; border-radius: 10px; color: #17202a; background: white; }
    #gallery-shortcuts::backdrop { background: #11182099; }
    .shortcut-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .shortcut-heading h2 { margin: 0; font-size: 19px; }
    #gallery-shortcuts p { color: #526171; font-size: 12px; }
    #gallery-shortcuts dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; margin: 16px 0; font-size: 12px; }
    #gallery-shortcuts dd { margin: 0; }
    .search-row { display: flex; gap: 8px; }
    #filter { min-width: 0; flex: 1; }
    #toggle-filters { display: block; white-space: nowrap; }
    .toolbar:not(.filters-open) .filter-options { display: none; }
    .quiet-button { border-color: transparent; background: transparent; }
    .filter-options { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(100px, 1fr) minmax(160px, 1.3fr) auto; gap: 10px; margin-top: 10px; }
    label { font-size: 12px; color: #526171; }
    .more-filters { align-self: end; position: relative; }
    .more-filters summary { min-height: 38px; padding: 8px 10px; border: 1px solid #bac5d2; border-radius: 6px; background: white; }
    .more-filters > div { position: absolute; right: 0; top: calc(100% + 6px); width: 220px; padding: 12px; z-index: 3; border: 1px solid #dfe3e9; border-radius: 8px; background: white; box-shadow: 0 8px 24px #17202a20; }
    .more-filters > div label { display: block; margin-bottom: 8px; }
    .more-filters > div label:last-child { margin-bottom: 0; }
    .filter-options select { display: block; width: 100%; margin-top: 3px; color: #17202a; }
    .result-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-top: 8px; color: #526171; font-size: 12px; }
    #count { margin: 0; font-variant-numeric: tabular-nums; }
    .module-section { margin-bottom: 24px; }
    .module-heading { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
    .module-heading h2 { margin: 0; font-size: 17px; }
    .module-heading span { color: #526171; font-size: 12px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); gap: 14px; }
    article { min-width: 0; padding: 12px; background: white; border: 1px solid #dfe3e9; border-radius: 8px; overflow-wrap: anywhere; }
    article h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
    .card-meta { margin: 8px 0 0; color: #526171; font-size: 12px; }
    .variant-select { width: 100%; margin-top: 8px; font-size: 12px; }
    .snapshot-link { display: flex; align-items: center; justify-content: center; height: var(--preview-height); background: #eef1f5; border-radius: 4px; overflow: hidden; cursor: zoom-in; }
    .snapshot-link img { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
    .image-error { padding: 20px; color: #526171; font-size: 13px; }
    .variant-caption { font-size: 12px; margin: 0 0 6px; color: #526171; }
    .card-bottom { display: flex; align-items: start; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 12px; color: #526171; }
    .card-bottom details { flex: 1; min-width: 0; }
    .card-bottom code { display: block; margin-top: 6px; font-size: 11px; }
    .card-bottom summary { color: #1558a8; }
    .comparison .cards { grid-template-columns: 1fr; }
    .comparison .variants { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 12px; }
    #empty { padding: 32px; text-align: center; background: white; border: 1px solid #dfe3e9; border-radius: 8px; }
    #empty h2 { font-size: 18px; margin: 0; }
    #empty p { color: #526171; }
    @media (max-width: 1100px) and (min-width: 761px) {
      .layout { grid-template-columns: 155px minmax(0, 1fr); gap: 14px; padding: 14px 16px; }
      .filter-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      .page-header { padding: 10px 12px; gap: 2px 10px; }
      h1 { font-size: 17px; }
      .overview { order: 2; width: 100%; font-size: 11px; }
      .about { font-size: 12px; }
      .search-row button { font-size: 12px; padding: 6px 8px; white-space: nowrap; }
      #gallery-shortcuts { padding: 14px; }
      #gallery-shortcuts dl { gap: 8px; font-size: 11px; }
      .layout { display: block; padding: 0 12px 12px; }
      nav { position: static; max-height: none; margin: 8px -12px 10px; overflow: hidden; }
      nav h2, .nav-help { display: none; }
      .module-buttons { flex-direction: row; flex-wrap: nowrap; overflow-x: auto; padding: 0 12px 6px; }
      .module-button { flex-shrink: 0; font-size: 12px; border-color: #dfe3e9; background: white; padding: 7px 9px; }
      .toolbar { position: static; }
      #toggle-filters { display: block; font-size: 12px; white-space: nowrap; }
      .filter-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .more-filters > div { position: static; width: 100%; box-shadow: none; margin-top: 6px; }
      .result-row { font-size: 11px; }
      #view-hint { display: none; }
      .cards { grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); }
      .comparison .variants { grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); gap: 8px; }
      .comparison .snapshot-link { height: calc(var(--preview-height) * .75); }
    }
`;

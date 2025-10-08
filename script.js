// script.js
// ---- Config / constants
const API_BASE  = 'https://buildout-proxy.onrender.com/api';
const PAGE_SIZE = 30;
// top of file (near DEBUG)
const FORCE_REFRESH = new URLSearchParams(location.search).has('refresh');

// DEBUG: enable by visiting ?debug=1
const DEBUG = new URLSearchParams(location.search).has('debug');


let listingsGlobal = [];   // for access in search/sort
let currentTypeFilter = "";   // blank = show all types
let currentSort = { key: null, dir: 1 }
let currentListingType = ""; // '', 'lease', 'sale', 'both'

// ---- Loading overlay helpers
function showLoading() {
  const el = document.getElementById('loading');
  if (el) el.removeAttribute('hidden');
}
function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.setAttribute('hidden', '');
}

// ---- Top progress bar
let __progTimer = null;
function startProgress() {
  const wrap = document.getElementById('topProgress');
  const bar = wrap?.querySelector('.top-progress__bar');
  if (!wrap || !bar) return;
  wrap.hidden = false;
  bar.style.width = '0%';
  let w = 0;
  __progTimer = setInterval(() => {
    if (w < 80) w += 8 + Math.random()*6; // creep towards 80%
    bar.style.width = w + '%';
  }, 200);
}
function finishProgress() {
  const wrap = document.getElementById('topProgress');
  const bar = wrap?.querySelector('.top-progress__bar');
  if (!wrap || !bar) return;
  bar.style.width = '100%';
  setTimeout(() => { wrap.hidden = true; bar.style.width = '0%'; }, 250);
  if (__progTimer) { clearInterval(__progTimer); __progTimer = null; }
}


// ---------- formatters ----------
const fv = v => (v || v === 0) ? String(v) : 'N/A';       // format-or-N/A
const formatFeet = (v) => {
  if (v == null || v === '') return 'N/A';
  // numeric like 32  ->  32′   | string "32" -> 32′  | "32 ft" stays
  if (typeof v === 'number') return `${v}′`;
  const s = String(v).trim();
  if (/ft|′|’/i.test(s)) return s;            // already has units
  if (!Number.isNaN(Number(s))) return `${s}′`;
  return s;
};


function statChip({ iconId, label, value }) {
  if (value == null) return '';  // hide if empty
  return `
    <div class="stat" role="group" aria-label="${label}: ${value}">
      <span class="stat__icon" aria-hidden="true"><svg><use href="#${iconId}"></use></svg></span>
      <div>
        <div class="stat__label">${label}</div>
        <div class="stat__value">${value}</div>
      </div>
    </div>
  `;
}


// Map for property type id to label
const propertyTypes = {
  1: "Office",
  2: "Retail",
  3: "Industrial",
  5: "Land",
  6: "Multifamily",
  7: "Special Purpose",
  8: "Hospitality"
};

// --- BUILD THE PROPERTY SUBTYPES MAP ---
const propertySubtypes = {
  101: "Office Building",
  102: "Creative/Loft",
  103: "Executive Suites",
  104: "Medical",
  105: "Institutional/Governmental",
  106: "Office Warehouse",
  107: "Office Condo",
  108: "Coworking",
  109: "Lab",
  201: "Street Retail",
  202: "Strip Center",
  203: "Free Standing Building",
  204: "Regional Mall",
  205: "Retail Pad",
  206: "Vehicle Related",
  207: "Outlet Center",
  208: "Power Center",
  209: "Neighborhood Center",
  210: "Community Center",
  211: "Specialty Center",
  212: "Theme/Festival Center",
  213: "Restaurant",
  214: "Post Office",
  215: "Retail Condo",
  216: "Lifestyle Center",
  301: "Manufacturing",
  302: "Warehouse/Distribution",
  303: "Flex Space",
  304: "Research & Development",
  305: "Refrigerated/Cold Storage",
  306: "Office Showroom",
  307: "Truck Terminal/Hub/Transit",
  308: "Self Storage",
  309: "Industrial Condo",
  310: "Data Center",
  501: "Office",
  502: "Retail",
  503: "Retail-Pad",
  504: "Industrial",
  505: "Residential",
  506: "Multifamily",
  507: "Other",
  601: "High-Rise",
  602: "Mid-Rise",
  603: "Low-Rise/Garden",
  604: "Government Subsidized",
  605: "Mobile Home Park",
  606: "Senior Living",
  607: "Skilled Nursing",
  608: "Single Family Rental Portfolio",
  701: "School",
  702: "Marina",
  703: "Other",
  704: "Golf Course",
  705: "Church",
  801: "Full Service",
  802: "Limited Service",
  803: "Select Service",
  804: "Resort",
  805: "Economy",
  806: "Extended Stay",
  807: "Casino",
  1001: "Single Family",
  1002: "Townhouse / Row House",
  1003: "Condo / Co-op",
  1004: "Manufactured / Mobile Home",
  1005: "Vacation / Timeshare",
  1006: "Other Residential"
};

// ---- Helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// minimal guard that still tolerates commas or stray text
const toNum = v =>
  typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
const toText = (s) => (s ?? '').toString().replace(/</g, "&lt;").replace(/>/g, "&gt;");
// robust getter for space square footage across orgs/fields
function getSpaceSize(space) {
  const candidates = [
    space?.size_sf,
    space?.space_size,
    space?.available_sqft,
    space?.rentable_sqft,
    space?.sqft,
    space?.size, // often "52,044 SF"
  ];
  for (const c of candidates) {
    const n = toNum(c);
    if (n > 0) return n;
  }
  return 0;
}

// Determine if a lease space is considered active.
// According to Buildout's DealStatus codes, 0=Inactive, 1=Active, 2=Under Contract, 3=Closed.
// Many Buildout objects expose this status under different fields (deal_status, deal_status_id, dealStatus).
// We treat a space as active only when its status value is the numeric 1 or the string 'active'.
function isActiveLeaseSpace(space) {
  if (!space) return false;
  // Check several potential status fields.  Coerce to string for comparison or to number when numeric.
  const raw = space.deal_status ?? space.deal_status_id ?? space.dealStatus ?? space.dealStatusId ?? null;
  if (raw != null) {
    // Numeric codes: handle strings or numbers.
    const num = Number(raw);
    if (!Number.isNaN(num)) {
      return num === 1;
    }
    // String codes: case-insensitive compare
    const s = String(raw).toLowerCase();
    return s === 'active';
  }
  // If status is missing entirely, default to true so that older data without status is included.
  return true;
}

// Determine if a property or listing is considered active based on DealStatus.
// Accepts any object that may have deal status fields similar to lease spaces.
function isActiveDealStatus(item) {
  if (!item) return false;
  const raw = item.deal_status ?? item.deal_status_id ?? item.dealStatus ?? item.dealStatusId ?? null;
  if (raw != null) {
    const num = Number(raw);
    if (!Number.isNaN(num)) {
      return num === 1;
    }
    const s = String(raw).toLowerCase();
    return s === 'active';
  }
  return true;
}
// Map between string slugs and your Buildout property_type_id values
const PROP_TYPE_SLUG_TO_ID = {
  industrial: "3",
  retail:     "2",
  office:     "1",
  land:       "5",
};
const PROP_TYPE_ID_TO_SLUG = Object.fromEntries(
  Object.entries(PROP_TYPE_SLUG_TO_ID).map(([k,v]) => [v,k])
);

function getInitialFiltersFromURL() {
  const sp = new URLSearchParams(window.location.search);

  // property type: allow numeric (1/2/3/5) or slug (industrial/retail/office/land)
  let ptype = sp.get("ptype") || "";
  if (ptype) {
    const lower = ptype.toLowerCase();
    if (PROP_TYPE_SLUG_TO_ID[lower]) {
      ptype = PROP_TYPE_SLUG_TO_ID[lower];
    } else if (!["1","2","3","5"].includes(ptype)) {
      ptype = ""; // invalid -> ignore
    }
  }

  // listing type: "", "lease", "sale", "both"
  let lt = (sp.get("lt") || "").toLowerCase();
  if (!["", "lease", "sale", "both"].includes(lt)) lt = "";

  // search query
  const q = sp.get("q") || "";

  // Also accept hash like #industrial for legacy links
  if (!ptype && location.hash) {
    const h = location.hash.replace("#","").toLowerCase();
    if (PROP_TYPE_SLUG_TO_ID[h]) ptype = PROP_TYPE_SLUG_TO_ID[h];
  }

  return { ptype, lt, q };
}

function setPropertyTypeUI(id) {
  // set global + activate the right chip
  currentTypeFilter = id || "";
  document.querySelectorAll(".filter-btn").forEach(b => {
    if ((b.getAttribute("data-type") || "") === currentTypeFilter) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });
}

function setListingTypeUI(lt) {
  currentListingType = lt || "";
  const sel = document.getElementById("listingTypeSelect");
  if (sel) sel.value = currentListingType;
}

function setSearchUI(q) {
  const inp = document.getElementById("searchInput");
  if (inp) inp.value = q || "";
}

// Keep URL in sync with current filters (no reload)
function updateURLFromFilters() {
  const sp = new URLSearchParams(window.location.search);

  // property type -> slug for pretty URLs
  const slug = PROP_TYPE_ID_TO_SLUG[currentTypeFilter] || "";
  if (slug) sp.set("ptype", slug); else sp.delete("ptype");

  if (currentListingType) sp.set("lt", currentListingType); else sp.delete("lt");

  const q = (document.getElementById("searchInput")?.value || "").trim();
  if (q) sp.set("q", q); else sp.delete("q");

  const newUrl = `${window.location.pathname}?${sp.toString()}`.replace(/\?$/,"");
  history.replaceState(null, "", newUrl);
}


function debounce(fn, ms = 200) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function pillClassFromFlags(lease, sale) {
  if (lease && sale) return 'both';
  if (lease) return 'lease';
  return 'sale';
}

async function fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---- Data fetch
async function fetchAllListings() {
  const cacheKey = 'buildout:listings:v1';
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { /* ignore */ }
  }

  let allListings = [];
  let offset = 0;
  let totalCount = null;

  while (true) {
    const res = await fetchWithTimeout(`${API_BASE}/listings?limit=${PAGE_SIZE}&offset=${offset}`);
    if (!res.ok) {
      const errorText = await res.text();
      console.error("API error:", res.status, errorText);
      break;
    }
    const data = await res.json();
    if (totalCount === null) totalCount = data.count;

    const batch = data.properties || [];
    allListings = allListings.concat(batch);

    if (allListings.length >= totalCount) break;
    offset += PAGE_SIZE;

    // stay under provider rate limits
    await sleep(1250);
  }

  try { sessionStorage.setItem(cacheKey, JSON.stringify(allListings)); } catch {}
  return allListings;
}

// ---- Data fetch (lease spaces)
const PAGE_SIZE_SPACES = 200; // gentler than 1000

async function fetchAllLeaseSpaces() {
  const cacheKey = 'buildout:lease_spaces:v2';  // bump to v2 to invalidate old cache
  const cached = !FORCE_REFRESH && sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { /* ignore */ }
  }

  let all = [];
  let offset = 0;
  let totalCount = null;

  while (true) {
    const res = await fetchWithTimeout(`${API_BASE}/lease_spaces?limit=${PAGE_SIZE_SPACES}&offset=${offset}`);
    if (!res.ok) {
      console.error('lease_spaces API error:', res.status, await res.text());
      break;
    }
    const data = await res.json();
    if (totalCount === null) totalCount = data.count ?? null;

    const batch = data.lease_spaces || [];
    all = all.concat(batch);
    // after you finish building the "all" array:
    if (DEBUG) {
      window.__allLeaseSpaces = all;           // <— expose raw spaces
    }
    // If server returns a total, use it; otherwise stop when a short page arrives
    if (totalCount != null) {
      if (all.length >= totalCount) break;
    } else {
      if (batch.length < PAGE_SIZE_SPACES) break;
    }

    offset += PAGE_SIZE_SPACES;
    await sleep(900); // polite pacing
  }

  try { sessionStorage.setItem(cacheKey, JSON.stringify(all)); } catch {}
  return all;
}

// REPLACE your current loadListings() with this version
async function loadListings() {
  showLoading();                     // ← show overlay at start
  startProgress();                  // ← start top progress bar
  try {
    // Fetch listings (array), lease spaces (array), and broker response (Response) in parallel
    const [listings, leaseSpacesRaw, brokerRes] = await Promise.all([
      fetchAllListings(),
      fetchAllLeaseSpaces(),
      fetchWithTimeout(`${API_BASE}/brokers`).catch(() => null),
    ]);

    // Build spacesByProperty from active lease spaces.
    const spacesByProperty = {};
    for (const s of (leaseSpacesRaw || [])) {
      // Skip any spaces that are not active according to DealStatus.
      if (!isActiveLeaseSpace(s)) continue;
      // Determine robust parent ID from the space. Use multiple fallbacks to support different Buildout fields.
      const pid = s.property_id ?? s.property?.id ?? s.propertyId ?? s.listing_id ?? s.property_listing_id ?? null;
      if (!pid) continue;
      (spacesByProperty[pid] ??= []).push(s);
    }

    // Brokers → map by id
    let brokers = [];
    if (brokerRes && brokerRes.ok) {
      try {
        const brokersData = await brokerRes.json();
        brokers = brokersData.brokers || brokersData || [];
      } catch (_) {}
    }
    const brokerMap = Object.fromEntries((brokers || []).map(b => [b.id, b]));

    // Filter listings by deal status so that only active properties are shown
    const activeListings = (listings || []).filter(isActiveDealStatus);
    // Enrich listings with broker display, available SF, and debug payload
    listingsGlobal = activeListings.map(listing => {
      const broker1 = brokerMap[listing.broker_id];
      const broker2 = brokerMap[listing.second_broker_id];

      const brokerDisplay = [broker1, broker2]
        .filter(Boolean)
        .map(b => `<a href="mailto:${b.email}" class="broker-pill" data-email="${b.email}">${toText(b.first_name)} ${toText(b.last_name)}</a>`)
        .join(" ");

      const brokersArr = [broker1, broker2]
        .filter(Boolean)
        .map(b => ({ id: b.id, name: `${toText(b.first_name)} ${toText(b.last_name)}`, email: b.email }));

      // Determine property id for listing using multiple fallbacks matching the key used when bucketing lease spaces.
      const listingPid = listing.property_id ?? listing.property?.id ?? listing.propertyId ?? listing.listing_id ?? listing.property_listing_id ?? listing.id;
      const spaces = spacesByProperty[listingPid] || [];
      // Compute space sizes using robust getter; they are already active by filter.
      const spaceSizes = spaces.map(s => getSpaceSize(s));
      const totalAvailableSF = spaceSizes.reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);

      // Normalize building SF for later comparison / tooltip
      const buildingSF = toNum(listing.building_size_sf ?? listing.building_size);

      // Stash debug payload we can surface in tooltips & logs
      const sizeDebug = {
        spaceSizes,
        sumSpace: totalAvailableSF,
        buildingSF,
        hadSpaces: spaces.length > 0,
      };

      return {
        ...listing,
        brokerDisplay,
        brokersArr,
        totalAvailableSF,
        sizeDebug,
      };
    });

    // When debugging, expose the raw structures and diagnostics on window
    if (DEBUG) {
      // Expose diagnostic structures on the window for console inspection.
      window.listingsGlobal = listingsGlobal;
      window.__spacesByProperty = spacesByProperty;
      window.__allLeaseSpaces = leaseSpacesRaw;
      maybeLogSizeDiagnostics(listingsGlobal, spacesByProperty);
    }


    // First paint:
    // If you want initial sort/filter to apply, call filterAndSort();
    // otherwise keep your current behavior and render the full set.
    if (typeof filterAndSort === 'function') {
      filterAndSort();
    } else {
      renderTable(listingsGlobal);
    }
  } catch (err) {
    console.error('loadListings error:', err);
    listingsGlobal = [];
    if (typeof filterAndSort === 'function') filterAndSort();
    else renderTable([]);
  } finally {
    hideLoading();                   // ← always hide overlay
    finishProgress();                // ← finish top progress bar
  }
}

// ---- Rendering
function renderTable(listingsArr) {
  const tbody = document.getElementById("listing-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!listingsArr.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" style="padding:1.25rem; color:#666;">No results. Try adjusting filters or search.</td>`;
    tbody.appendChild(tr);
    return;
  }

  listingsArr.forEach(listing => {
    const location = `${listing.address || ""}, ${listing.city || ""}, ${listing.state || ""} ${listing.zip || ""}`.replace(/^,\s*/, '');
  function pickDisplaySF(listing) {
    const avail = toNum(listing.totalAvailableSF);
    const bldg  = toNum(listing.building_size_sf ?? listing.building_size);
    if (avail > 0) return avail;
    if (bldg  > 0) return bldg;
    return null;
  }

  // ...
  const _sf = pickDisplaySF(listing);
  const shownSize = _sf != null ? `${_sf.toLocaleString()} SF` : "—";


    const type = (listing.lease && listing.sale)
      ? "For Sale & Lease"
      : listing.lease
        ? "For Lease"
        : "For Sale";

    const pillClass = pillClassFromFlags(!!listing.lease, !!listing.sale);
    const image = listing.photos?.[0]?.url || "https://via.placeholder.com/300x200";
    const url = listing.lease_listing_url || listing.sale_listing_url || "#";
    const brokerDisplay = listing.brokerDisplay;

    // Brochure/Video logic
    let brochureUrl = null;
    if (type === "For Sale") brochureUrl = listing.sale_pdf_url;
    else if (type === "For Lease") brochureUrl = listing.lease_pdf_url;
    else brochureUrl = listing.sale_pdf_url || listing.lease_pdf_url;

    const videoUrl = listing.you_tube_url || listing.matterport_url || null;

    // Subtype
    const subtype = propertySubtypes[listing.property_subtype_id] || "";
    const subtypeTypeLine = [subtype, type].filter(Boolean).join(" – ");

    // Select description safely
    let description = "";
    if (listing.lease && listing.lease_description) description = listing.lease_description;
    else if (listing.sale && listing.sale_description) description = listing.sale_description;
    else description = "No description available.";

    // Main row (click/keyboard toggles details)
    const mainRow = document.createElement("tr");
    mainRow.classList.add("main-row");
    mainRow.setAttribute('tabindex', '0');
    mainRow.setAttribute('aria-expanded', 'false');

    const expandRow = document.createElement("tr");
    expandRow.classList.add("expand-row");

    const toggle = () => {
      const isOpen = mainRow.classList.toggle("open");
      expandRow.classList.toggle("open");
      mainRow.setAttribute('aria-expanded', String(isOpen));
    };
    mainRow.onclick = toggle;
    mainRow.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    };
    // Build a human-friendly tooltip revealing the raw inputs
    const sd = listing.sizeDebug || {};
    const tip = [
      `Spaces: ${sd.spaceSizes ? sd.spaceSizes.join(', ') : 'n/a'}`,
      `SumSpaces: ${sd.sumSpace ?? 'n/a'}`,
      `BuildingSF: ${sd.buildingSF ?? 'n/a'}`
    ].join(' | ');

    mainRow.innerHTML = `
      <td>${toText(location)}</td>
      <td title="${toText(tip)}">${toText(shownSize)}</td>
      <td>${brokerDisplay}</td>
      <td><span class="badge ${pillClass}">${toText(type)}</span></td>
    `;

    // Buttons
    let buttonsHtml = `<a href="${url}" class="cta" target="_blank" rel="noopener noreferrer">View Listing</a>`;
    if (brochureUrl) buttonsHtml += `<a href="${brochureUrl}" class="cta secondary" target="_blank" rel="noopener noreferrer">View Brochure</a>`;
    if (videoUrl)    buttonsHtml += `<a href="${videoUrl}" class="cta secondary" target="_blank" rel="noopener noreferrer">View Video</a>`;

    // --- Key Highlights: extract key fields from the listing ---
    const ceilingHeight = listing.ceiling_height_f ?? null;
    const dockDoors     = listing.dock_high_doors   ?? null;
    const yearBuilt     = listing.year_built        ?? null;
    const zoning        = listing.zoning            ?? null;

    // Generate highlight chips using the statChip helper. Only non-null values will render.
    const highlightChips = [
      statChip({ iconId: 'ico-height', label: 'Ceiling Height', value: ceilingHeight != null ? formatFeet(ceilingHeight) : null }),
      statChip({ iconId: 'ico-dock',   label: 'Dock Doors',     value: dockDoors }),
      statChip({ iconId: 'ico-year',   label: 'Year Built',     value: yearBuilt }),
      statChip({ iconId: 'ico-zoning', label: 'Zoning',         value: zoning })
    ].join("");
    const keyHighlightsHtml = highlightChips.trim()
      ? `
        <div class="key-highlights" role="region" aria-label="Key Property Highlights">
          <div class="key-highlights__header">
            <span class="stat__icon" aria-hidden="true"><svg><use href="#ico-height"></use></svg></span>
            <div>Key Property Highlights</div>
          </div>
          <div class="key-highlights__rule"></div>
          <div class="stats-grid">
            ${highlightChips}
          </div>
        </div>
      `
      : '';

    // Build the main content column. This contains the address, subtype/type line,
    // description, size details and action buttons. Wrapping it in
    // `.property-main` allows the CSS grid layout to treat it as the first
    // column.
    const propertyMainHtml = `
      <div class="property-main">
        <h3>${location}</h3>
        <div class="property-subtype-type">${subtypeTypeLine}</div>
        <div class="property-description">${description}</div>
        <div class="property-size">
          ${
            listing.totalAvailableSF
              ? `<strong>Available:</strong> ${listing.totalAvailableSF.toLocaleString()} SF${
                  listing.building_size_sf ? ` <span class="building-size">of ${listing.building_size_sf.toLocaleString()} SF</span>` : ""
                }`
              : (listing.building_size_sf ? `${listing.building_size_sf.toLocaleString()} SF` : "—")
              + (toNum(listing.totalAvailableSF) > 0)
   ? `<strong>Available:</strong> ${toNum(listing.totalAvailableSF).toLocaleString()} SF${
       toNum(listing.building_size_sf ?? listing.building_size) > 0
         ? ` <span class="building-size">of ${toNum(listing.building_size_sf ?? listing.building_size).toLocaleString()} SF</span>`
         : ""
     }`
   : (toNum(listing.building_size_sf ?? listing.building_size) > 0
       ? `${toNum(listing.building_size_sf ?? listing.building_size).toLocaleString()} SF`
       : "—")
          }
        </div>
        <div class="property-ctas">${buttonsHtml}</div>
      </div>
    `;

    // Wrap the highlights card in its own container.  Only render this
    // container if highlight content exists.  The CSS grid will place
    // this container in the second column.
    const highlightsSection = keyHighlightsHtml.trim()
      ? `<div class="property-highlights-container">${keyHighlightsHtml}</div>`
      : '';

    expandRow.innerHTML = `
      <td colspan="4">
        <div class="property-card">
          <img
            src="${image}"
            data-full="${image}"
            alt="Property image at ${location}"
            class="property-img"
            loading="lazy"
          >
          <div class="property-details">
            ${propertyMainHtml}
            ${highlightsSection}
          </div>
        </div>
      </td>
    `;

    // Ensure spacing between CTAs if .cta-group style is present in CSS
    // .cta-group { display:flex; gap:.5rem; }

    const tbody = document.getElementById("listing-body");
    tbody.appendChild(mainRow);
    tbody.appendChild(expandRow);
  });
}

// ---- Search / sort / filters
function updateSortIndicators() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove("asc", "desc");
    if (currentSort.key && th.getAttribute("data-sort") === currentSort.key) {
      th.classList.add(currentSort.dir === 1 ? "asc" : "desc");
    }
  });
}

function maybeLogSizeDiagnostics(listings, spacesByProperty) {
  if (!DEBUG) return;

  try {
    const rows = listings.map(l => {
      const sd = l.sizeDebug || {};
      return {
        id: l.id,
        addr: `${l.address || ''}, ${l.city || ''}`,
        type: l.property_type_id,
        lease: !!l.lease, sale: !!l.sale,
        spaces: (spacesByProperty[l.id] || []).length,
        spaceSizes: sd.spaceSizes || [],
        sumSpace: sd.sumSpace || 0,
        buildingSF: sd.buildingSF || 0
      };
    });

    // log the global picture
    console.log(`🔎 Size diagnostics for ${rows.length} listings`);
    console.table(rows.slice(0, 30)); // first 30 as a preview

    // highlight suspicious cases
    const suspicious = rows.filter(r =>
      (r.sumSpace === 0 && r.spaces > 0) ||        // have spaces, but sum is 0
      (r.sumSpace === 0 && r.buildingSF === 0)     // both zero
    );
    if (suspicious.length) {
      console.warn('⚠️ Suspicious size rows:', suspicious);
    } else {
      console.log('✅ No suspicious size rows detected');
    }
  } catch (e) {
    console.warn('size diagnostics failed', e);
  }
}

function filterAndSort() {
  const q = (document.getElementById("searchInput")?.value || "").toLowerCase();
  let arr = listingsGlobal;

  // Filter by property type
  if (currentTypeFilter) {
    arr = arr.filter(l => String(l.property_type_id) === currentTypeFilter);
  }
  if (currentListingType) {
  arr = arr.filter(l => {
    const lease = !!l.lease;
    const sale  = !!l.sale;

    // exact-match behavior:
    if (currentListingType === 'lease') return lease && !sale;
    if (currentListingType === 'sale')  return sale  && !lease;
    if (currentListingType === 'both')  return lease && sale;
    return true;
  });
}

  // Search filter
  if (q) {
    arr = arr.filter(l =>
      (l.address || "").toLowerCase().includes(q) ||
      (l.city || "").toLowerCase().includes(q) ||
      (l.state || "").toLowerCase().includes(q) ||
      (l.zip || "").toLowerCase().includes(q) ||
      (l.brokerDisplay || "").toLowerCase().includes(q) ||
      (l.lease_listing_web_title || "").toLowerCase().includes(q) ||
      (l.sale_listing_web_title || "").toLowerCase().includes(q)
    );
  }

  // Sort
  if (currentSort.key) {
    arr = [...arr].sort((a, b) => {
      let v1, v2;
      switch (currentSort.key) {
        case "location":
          v1 = `${a.address || ""} ${a.city || ""} ${a.state || ""} ${a.zip || ""}`.toLowerCase();
          v2 = `${b.address || ""} ${b.city || ""} ${b.state || ""} ${b.zip || ""}`.toLowerCase();
          break;
        case "size":
          v1 = (a.totalAvailableSF ?? a.building_size_sf ?? 0);
          v2 = (b.totalAvailableSF ?? b.building_size_sf ?? 0);
          break;
        case "brokers":
          v1 = (a.brokerDisplay || "").toLowerCase();
          v2 = (b.brokerDisplay || "").toLowerCase();
          break;
        case "type":
          v1 = (a.lease && a.sale) ? "for sale & lease" : a.lease ? "for lease" : "for sale";
          v2 = (b.lease && b.sale) ? "for sale & lease" : b.lease ? "for lease" : "for sale";
          break;
        default:
          v1 = v2 = "";
      }
      if (v1 < v2) return -1 * currentSort.dir;
      if (v1 > v2) return 1 * currentSort.dir;
      return 0;
    });
  }

  renderTable(arr);
}

// ---- DOM wiring
document.addEventListener("DOMContentLoaded", () => {
  // 1) Apply initial filters from URL BEFORE first render
  const initial = getInitialFiltersFromURL();
  if (initial.ptype) setPropertyTypeUI(initial.ptype);
  if (initial.lt !== undefined) setListingTypeUI(initial.lt);
  if (initial.q) setSearchUI(initial.q);

  // 2) Wire inputs/filters
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", debounce(() => {
      filterAndSort();
      updateURLFromFilters();
    }, 180));
    searchInput.addEventListener("focus", () => searchInput.select());
  }

  const typeSel = document.getElementById("listingTypeSelect");
  if (typeSel) {
    typeSel.addEventListener("change", () => {
      currentListingType = typeSel.value || "";
      filterAndSort();
      updateURLFromFilters();
    });
  }

  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", function () {
      currentTypeFilter = this.getAttribute("data-type") || "";
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      this.classList.add("active");
      filterAndSort();
      updateURLFromFilters();
    });
  });

  // 3) Initial load
  loadListings();
});

// ---- Image lightbox (modal)
(function initImageLightbox(){
  const modal = document.createElement('div');
  modal.className = 'image-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="image-modal__content">
      <button class="image-modal__close" aria-label="Close image (Esc)">×</button>
      <img class="image-modal__img" alt="">
    </div>
  `;
  document.body.appendChild(modal);

  const modalImg = modal.querySelector('.image-modal__img');
  const closeBtn = modal.querySelector('.image-modal__close');

  const open = (src, alt) => {
    modalImg.src = src;
    modalImg.alt = alt || 'Enlarged property image';
    modal.classList.add('open');
    document.body.classList.add('modal-open');
    closeBtn.focus({ preventScroll: true });
  };

  const close = () => {
    modal.classList.remove('open');
    document.body.classList.remove('modal-open');
    modalImg.src = '';
  };

  document.addEventListener('click', (e) => {
    const img = e.target.closest('.property-img');
    if (!img) return;
    const full = img.getAttribute('data-full') || img.src;
    const alt  = img.getAttribute('alt') || '';
    open(full, alt);
  });

  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });
})();

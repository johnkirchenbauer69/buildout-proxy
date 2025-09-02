// ---- Config / constants
const API_BASE  = 'https://buildout-proxy.onrender.com/api';
const PAGE_SIZE = 30;

let listingsGlobal = [];   // for access in search/sort
let currentTypeFilter = "";   // blank = show all types
let currentSort = { key: null, dir: 1 }

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
const toNum = (v) => Number(v) || 0;
const toText = (s) => (s ?? '').toString().replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

async function loadListings() {
  const [listings, brokerRes, leaseSpacesRes] = await Promise.all([
    fetchAllListings(),
    fetchWithTimeout(`${API_BASE}/brokers`),
    fetchWithTimeout(`${API_BASE}/lease_spaces`)
  ]);

  // Lease spaces
  const leaseSpacesData = await leaseSpacesRes.json();
  const leaseSpaces = leaseSpacesData.lease_spaces || [];

  const spacesByProperty = {};
  for (const space of leaseSpaces) {
    if (!spacesByProperty[space.property_id]) spacesByProperty[space.property_id] = [];
    spacesByProperty[space.property_id].push(space);
  }

  // Brokers mapping
  const brokersData = await brokerRes.json();
  const brokers = brokersData.brokers || brokersData;
  const brokerMap = Object.fromEntries((brokers || []).map(b => [b.id, b]));

  // Map listings, sum total available SF
  listingsGlobal = (listings || []).map(listing => {
    const broker1 = brokerMap[listing.broker_id];
    const broker2 = brokerMap[listing.second_broker_id];

    // Build a display string for brokers with sanitized names and mailto links
    const brokerDisplay = [broker1, broker2]
      .filter(Boolean)
      .map(b => `<a href="mailto:${b.email}" class="broker-pill" data-email="${b.email}">${toText(b.first_name)} ${toText(b.last_name)}</a>`)
      .join(" ");

    // Build an array of broker objects for any future programmatic needs
    const brokersArr = [broker1, broker2]
      .filter(Boolean)
      .map(b => ({ id: b.id, name: `${toText(b.first_name)} ${toText(b.last_name)}`, email: b.email }));

    // Sum all available lease space square footage for this property
    const spaces = spacesByProperty[listing.id] || [];
    const totalAvailableSF = spaces.reduce((sum, s) => sum + toNum(s.size_sf), 0);

    return { ...listing, brokerDisplay, brokersArr, totalAvailableSF };
  });

  renderTable(listingsGlobal);
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
    const shownSize = (listing.totalAvailableSF ?? listing.building_size_sf) ? `${(listing.totalAvailableSF ?? listing.building_size_sf).toLocaleString()} SF` : "—";

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

    mainRow.innerHTML = `
      <td>${toText(location)}</td>
      <td>${toText(shownSize)}</td>
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

function filterAndSort() {
  const q = (document.getElementById("searchInput")?.value || "").toLowerCase();
  let arr = listingsGlobal;

  // Filter by property type
  if (currentTypeFilter) {
    arr = arr.filter(l => String(l.property_type_id) === currentTypeFilter);
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
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", debounce(filterAndSort, 180));
  }

  // Sorting click events
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener("click", function () {
      const key = this.getAttribute("data-sort");
      if (currentSort.key === key) {
        currentSort.dir *= -1;
      } else {
        currentSort.key = key;
        currentSort.dir = 1;
      }
      filterAndSort();
      updateSortIndicators();
    });
  });

  // Filter buttons
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", function() {
      currentTypeFilter = this.getAttribute("data-type") || "";
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      this.classList.add("active");
      filterAndSort();
    });
  });

  // Initial load
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

// --- SORT INDICATORS (OPTIONAL) ---
// A single implementation of `updateSortIndicators` exists earlier in this file.
// The duplicate definition here has been removed to avoid overriding the original.
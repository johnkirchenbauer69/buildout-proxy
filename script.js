async function loadListings() {
  const [listingRes, brokerRes] = await Promise.all([
    fetch("https://buildout-proxy.onrender.com/api/listings"),
    fetch("https://buildout-proxy.onrender.com/api/brokers")
  ]);

  const listings = (await listingRes.json()).properties;
  const brokers = await brokerRes.json();

  const brokerMap = Object.fromEntries(
    brokers.map(b => [b.id, b])
  );

  const tbody = document.getElementById("listing-body");

  listings.forEach(listing => {
    const broker1 = brokerMap[listing.broker_id];
    const broker2 = brokerMap[listing.second_broker_id];

    const brokerDisplay = [broker1, broker2]
      .filter(Boolean)
      .map(b => `<a href="mailto:${b.email}">${b.first_name} ${b.last_name}</a>`)
      .join(", ");

    const title = listing.lease_listing_web_title || listing.sale_listing_web_title || "Untitled";
    const location = `${listing.address || ""}, ${listing.city || ""}, ${listing.state || ""} ${listing.zip || ""}`;
    const size = listing.building_size_sf ? `${listing.building_size_sf.toLocaleString()} SF` : "—";
    const type = listing.lease && listing.sale ? "For Sale & Lease" : listing.lease ? "For Lease" : "For Sale";
    const image = listing.photos?.[0]?.url || "https://via.placeholder.com/300x200";
    const description = listing.lease_listing_web_description || listing.sale_listing_web_description || "No description available.";
    const url = listing.lease_listing_url || listing.sale_listing_url || "#";

    const mainRow = document.createElement("tr");
    mainRow.classList.add("main-row");
    mainRow.onclick = () => mainRow.classList.toggle("open");

    mainRow.innerHTML = `
      <td>${title}</td>
      <td>${location}</td>
      <td>${size}</td>
      <td><span class="badge">${type}</span></td>
      <td>${brokerDisplay}</td>
    `;

    const expandRow = document.createElement("tr");
    expandRow.classList.add("expand-row");
    expandRow.innerHTML = `
      <td colspan="5">
        <div class="property-card">
          <img src="${image}" alt="Property Image">
          <div class="property-details">
            <h3>${title}</h3>
            <p>${description}</p>
            <a href="${url}" class="cta" target="_blank">View Listing</a>
          </div>
        </div>
      </td>
    `;

    tbody.appendChild(mainRow);
    tbody.appendChild(expandRow);
  });
}

loadListings();

  });
}

loadListings();

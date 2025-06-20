async function loadListings() {
  const res = await fetch("http://localhost:3000/api/listings"); // Replace with live proxy URL after deployment
  const data = await res.json();

  const tbody = document.getElementById("listing-body");

  data.listings.forEach(listing => {
    const mainRow = document.createElement("tr");
    mainRow.classList.add("main-row");
    mainRow.onclick = () => mainRow.classList.toggle("open");

    const status = listing.status.toLowerCase().includes('lease') && listing.status.toLowerCase().includes('sale')
      ? 'both'
      : listing.status.toLowerCase().includes('lease')
      ? 'lease'
      : 'sale';

    mainRow.innerHTML = `
      <td>${listing.title}</td>
      <td>${listing.location}</td>
      <td>${listing.size || '—'}</td>
      <td><span class="badge ${status}">${listing.status}</span></td>
    `;

    const expandRow = document.createElement("tr");
    expandRow.classList.add("expand-row");
    expandRow.innerHTML = `
      <td colspan="4">
        <div class="property-card">
          <img src="${listing.image || 'https://via.placeholder.com/300x200'}" alt="Property Image">
          <div class="property-details">
            <h3>${listing.title}</h3>
            <p>${listing.description || 'No description available.'}</p>
            <a href="${listing.url}" class="cta" target="_blank">View Listing</a>
          </div>
        </div>
      </td>
    `;

    tbody.appendChild(mainRow);
    tbody.appendChild(expandRow);
  });
}

loadListings();
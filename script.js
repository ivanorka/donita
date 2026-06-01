const navToggle = document.querySelector(".nav-toggle");
const mainNav = document.querySelector(".main-nav");
const filterButtons = document.querySelectorAll("[data-filter]");
const priceCards = document.querySelectorAll(".price-card");
const priceSearch = document.querySelector("#priceSearch");
const contactForm = document.querySelector("#contactForm");
const formStatus = document.querySelector(".form-status");
let searchTimer;

function updateIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function closeNavigation() {
  mainNav?.classList.remove("open");
  navToggle?.setAttribute("aria-expanded", "false");
}

function applyPriceFilter(matches = null) {
  const activeFilter = document.querySelector("[data-filter].active")?.dataset.filter || "all";
  const query = priceSearch?.value.trim().toLocaleLowerCase("hr-HR") || "";
  const matchedTitles = matches ? new Set(matches.map((item) => item.title)) : null;

  priceCards.forEach((card) => {
    const matchesCategory = activeFilter === "all" || card.dataset.category === activeFilter;
    const matchesSearch = matchedTitles
      ? matchedTitles.has(card.querySelector("h3")?.textContent)
      : !query || card.textContent.toLocaleLowerCase("hr-HR").includes(query);
    card.hidden = !(matchesCategory && matchesSearch);
  });
}

async function filterPrices() {
  const query = priceSearch?.value.trim() || "";

  if (!query) {
    applyPriceFilter();
    return;
  }

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error("Search request failed");
    }
    const payload = await response.json();
    applyPriceFilter(payload.results);
  } catch {
    applyPriceFilter();
  }
}

function queuePriceFilter() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(filterPrices, 180);
}

navToggle?.addEventListener("click", () => {
  const isOpen = mainNav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

mainNav?.addEventListener("click", (event) => {
  if (event.target.matches("a")) {
    closeNavigation();
  }
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    filterButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    filterPrices();
  });
});

priceSearch?.addEventListener("input", queuePriceFilter);

contactForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = contactForm.querySelector("button[type='submit']");
  const formData = new FormData(contactForm);
  const payload = Object.fromEntries(formData.entries());

  formStatus.textContent = "";
  formStatus.className = "form-status";
  submitButton.disabled = true;
  submitButton.textContent = "Šaljem...";

  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Slanje nije uspjelo.");
    }

    contactForm.reset();
    formStatus.textContent = "Hvala, upit je zaprimljen. Javit ćemo se uskoro.";
    formStatus.classList.add("success");
  } catch (error) {
    formStatus.textContent = error.message || "Trenutno ne možemo poslati upit. Molimo nazovite salon.";
    formStatus.classList.add("error");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = '<i data-lucide="send"></i>Pošalji rezervaciju';
    updateIcons();
  }
});

document.addEventListener("DOMContentLoaded", updateIcons);
window.addEventListener("load", updateIcons);

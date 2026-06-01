const navToggle = document.querySelector(".nav-toggle");
const mainNav = document.querySelector(".main-nav");
const filterButtons = document.querySelectorAll("[data-filter]");
const priceCards = document.querySelectorAll(".price-card");
const priceSearch = document.querySelector("#priceSearch");
const contactForm = document.querySelector("#contactForm");
const formStatus = document.querySelector(".form-status");
const priceEmpty = document.querySelector(".price-empty");
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

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("hr-HR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function applyPriceFilter() {
  const activeFilter = document.querySelector("[data-filter].active")?.dataset.filter || "all";
  const query = normalizeText(priceSearch?.value);
  let visibleCount = 0;

  priceCards.forEach((card) => {
    const matchesCategory = activeFilter === "all" || card.dataset.category === activeFilter;
    const matchesSearch = !query || normalizeText(card.textContent).includes(query);
    const isVisible = matchesCategory && matchesSearch;
    card.hidden = !isVisible;
    if (isVisible) {
      visibleCount += 1;
    }
  });

  if (priceEmpty) {
    priceEmpty.hidden = visibleCount > 0;
  }
}

async function filterPrices() {
  applyPriceFilter();
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
    formStatus.textContent = result.message || "Hvala, upit je zaprimljen.";
    formStatus.classList.add(result.emailSent ? "success" : "warning");
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

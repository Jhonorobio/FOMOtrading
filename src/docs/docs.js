// Policies page: highlights the section you are reading, and shows the policy version the
// server is currently asking people to accept (so the page and the consent prompt agree).
import { api } from '../services/api.js';

const links = [...document.querySelectorAll('.toc a')];
const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);

const spotlight = (id) => links.forEach((a) => a.classList.toggle('current', a.getAttribute('href') === `#${id}`));

const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) spotlight(visible.target.id);
  },
  { rootMargin: '-10% 0px -70% 0px' },
);
for (const section of sections) observer.observe(section);
if (location.hash) spotlight(location.hash.slice(1));

api
  .config()
  .then(({ policyVersion }) => {
    if (policyVersion) document.querySelector('[data-el="version"]').textContent = policyVersion;
  })
  .catch(() => {
    // Offline or no server: the version printed in the page stands.
  });

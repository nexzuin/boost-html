```ts
import NProgress from "nprogress";
import "nprogress/nprogress.css";

// Kustomisasi konfigurasi NProgress
NProgress.configure({
  minimum: 0.1, // Status awal bar saat mulai berjalan (0.0 sampai 1.0)
  easing: "ease", // Animasi CSS easing (misal: 'ease', 'linear', 'ease-in-out')
  speed: 100, // Kecepatan animasi perubahan bar dalam milidetik (ms)
  showSpinner: true, // Set ke false jika ingin menyembunyikan lingkaran spinner berputar
  trickle: true, // Set ke true agar bar bertambah panjang otomatis secara perlahan
  trickleSpeed: 200, // Seberapa sering bar otomatis bertambah panjang (dalam ms)
});

document.addEventListener("DOMContentLoaded", () => {
  // 1. Mencegat Klik pada Link (Anchors)
  document.addEventListener("click", async (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor || !shouldBoost(anchor)) return;

    // Biarkan browser membuka tab baru jika tombol modifikasi ditekan
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;

    const url = anchor.getAttribute("href");
    if (!url || url.startsWith("#")) return;

    e.preventDefault();
    await navigateTo(url);
  });

  // 2. Mencegat Submit pada Form
  document.addEventListener("submit", async (e: SubmitEvent) => {
    const target = e.target as HTMLElement;
    const form = target.closest("form");
    if (!form || !shouldBoost(form)) return;

    e.preventDefault();

    const url = form.getAttribute("action") || window.location.href;
    const method = (form.getAttribute("method") || "GET").toUpperCase();
    const formData = new FormData(form);

    const fetchOptions: RequestInit = {
      method: method,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    };

    if (method === "GET") {
      const params = new URLSearchParams(formData as any).toString();
      await navigateTo(`${url}?${params}`, fetchOptions);
    } else {
      fetchOptions.body = formData;
      await navigateTo(url, fetchOptions);
    }
  });

  // 3. Menangani Tombol Back/Forward Browser
  window.addEventListener("popstate", async () => {
    await loadContent(window.location.href, false);
  });

  function shouldBoost(element: HTMLElement): boolean {
    if (element.getAttribute("data-boost") === "false") return false;
    const boostedParent = element.closest('[data-boost="true"]');
    return !!boostedParent;
  }

  async function navigateTo(
    url: string,
    options: RequestInit = {},
  ): Promise<void> {
    const success = await loadContent(url, true, options);
    if (success) {
      window.history.pushState(null, "", url);
    } else {
      window.location.href = url;
    }
  }

  async function loadContent(
    url: string,
    pushState: boolean = true,
    options: RequestInit = {},
  ): Promise<boolean> {
    NProgress.start();

    try {
      options.headers = {
        ...options.headers,
        "X-Requested-With": "XMLHttpRequest",
        "HX-Request": "true",
      };

      const response = await fetch(url, options);
      if (!response.ok) throw new Error("Server error");

      const htmlText = await response.text();
      const parser = new DOMParser();
      const newDoc = parser.parseFromString(htmlText, "text/html");

      document.body.innerHTML = newDoc.body.innerHTML;
      if (newDoc.title) document.title = newDoc.title;

      await executeScripts(document.body);

      NProgress.done();
      return true;
    } catch (error) {
      console.error("Boost navigation failed:", error);
      NProgress.done();
      return false;
    }
  }

  async function executeScripts(container: HTMLElement): Promise<void> {
    const scripts = Array.from(container.querySelectorAll("script"));
    for (const oldScript of scripts) {
      const newScript = document.createElement("script");

      Array.from(oldScript.attributes).forEach((attr) => {
        newScript.setAttribute(attr.name, attr.value);
      });

      if (oldScript.src) {
        if (document.querySelector(`script[src="${oldScript.src}"]`)) continue;
        await new Promise<void>((resolve) => {
          newScript.onload = () => resolve();
          newScript.onerror = () => resolve();
          oldScript.parentNode?.replaceChild(newScript, oldScript);
        });
      } else {
        newScript.appendChild(document.createTextNode(oldScript.innerHTML));
        oldScript.parentNode?.replaceChild(newScript, oldScript);
      }
    }
  }
});
```
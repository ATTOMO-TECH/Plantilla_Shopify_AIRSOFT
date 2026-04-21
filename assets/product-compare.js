/**
 * Product Compare
 * Stores a list of product handles in localStorage and exposes a small pub/sub
 * so all <product-compare-*> custom elements on the page stay in sync.
 */
(function () {
  const STORAGE_KEY = 'airsoft-compare-items';
  const EVENT_NAME = 'airsoft:compare:update';

  const ProductCompareStore = {
    read() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((h) => typeof h === 'string') : [];
      } catch (e) {
        return [];
      }
    },
    write(list) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      } catch (e) {
        // storage might be unavailable (private mode, quota); fail silently
      }
      document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { items: list.slice() } }));
    },
    has(handle) {
      return this.read().indexOf(handle) !== -1;
    },
    add(handle, max) {
      const list = this.read();
      if (list.indexOf(handle) !== -1) return { ok: true, list };
      if (max && list.length >= max) {
        return { ok: false, reason: 'max', list };
      }
      list.push(handle);
      this.write(list);
      return { ok: true, list };
    },
    remove(handle) {
      const list = this.read().filter((h) => h !== handle);
      this.write(list);
      return list;
    },
    toggle(handle, max) {
      if (this.has(handle)) {
        const list = this.remove(handle);
        return { ok: true, action: 'removed', list };
      }
      const res = this.add(handle, max);
      return { ok: res.ok, reason: res.reason, action: res.ok ? 'added' : 'blocked', list: res.list };
    },
    clear() {
      this.write([]);
    },
  };

  window.ProductCompareStore = ProductCompareStore;

  // ---------------------------------------------------------------------------
  // <compare-button> — toggles a product in the comparison list
  // ---------------------------------------------------------------------------
  class CompareButton extends HTMLElement {
    constructor() {
      super();
      this.handleClick = this.handleClick.bind(this);
      this.updateState = this.updateState.bind(this);
    }

    connectedCallback() {
      this.button = this.querySelector('button');
      this.handle = this.dataset.productHandle;
      this.max = parseInt(this.dataset.max, 10) || 4;
      if (this.button) this.button.addEventListener('click', this.handleClick);
      document.addEventListener(EVENT_NAME, this.updateState);
      this.updateState();
    }

    disconnectedCallback() {
      if (this.button) this.button.removeEventListener('click', this.handleClick);
      document.removeEventListener(EVENT_NAME, this.updateState);
    }

    handleClick(event) {
      event.preventDefault();
      if (!this.handle) return;
      const result = ProductCompareStore.toggle(this.handle, this.max);
      if (!result.ok && result.reason === 'max') {
        const msg = this.dataset.maxMessage || `Maximum ${this.max} products.`;
        this.showToast(msg);
        return;
      }
      if (result.action === 'added') {
        document.dispatchEvent(new CustomEvent('airsoft:compare:drawer:open'));
      }
    }

    updateState() {
      const active = ProductCompareStore.has(this.handle);
      this.classList.toggle('is-active', active);
      if (!this.button) return;
      this.button.setAttribute('aria-pressed', active ? 'true' : 'false');
      const label = active ? this.dataset.labelActive : this.dataset.labelIdle;
      if (label) {
        const textEl = this.button.querySelector('.compare-button__label');
        if (textEl) textEl.textContent = label;
      }
    }

    showToast(message) {
      const toast = document.createElement('div');
      toast.className = 'compare-toast';
      toast.textContent = message;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('is-visible'));
      setTimeout(() => {
        toast.classList.remove('is-visible');
        setTimeout(() => toast.remove(), 300);
      }, 2500);
    }
  }
  if (!customElements.get('compare-button')) {
    customElements.define('compare-button', CompareButton);
  }

  // ---------------------------------------------------------------------------
  // <compare-drawer> — floating panel with the current selection
  // ---------------------------------------------------------------------------
  class CompareDrawer extends HTMLElement {
    constructor() {
      super();
      this.render = this.render.bind(this);
      this.openDrawer = this.openDrawer.bind(this);
      this.closeDrawer = this.closeDrawer.bind(this);
      this.handleClick = this.handleClick.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
    }

    connectedCallback() {
      this.panel = this.querySelector('[data-compare-drawer-panel]');
      this.listEl = this.querySelector('[data-compare-drawer-list]');
      this.countEl = this.querySelector('[data-compare-drawer-count]');
      this.toggleButton = this.querySelector('[data-compare-drawer-toggle]');
      this.closeButton = this.querySelector('[data-compare-drawer-close]');
      this.clearButton = this.querySelector('[data-compare-drawer-clear]');
      this.compareUrl = this.dataset.compareUrl || '/pages/comparar';

      document.addEventListener(EVENT_NAME, this.render);
      document.addEventListener('airsoft:compare:drawer:open', this.openDrawer);
      if (this.toggleButton) this.toggleButton.addEventListener('click', this.openDrawer);
      if (this.closeButton) this.closeButton.addEventListener('click', this.closeDrawer);
      if (this.clearButton) {
        this.clearButton.addEventListener('click', () => ProductCompareStore.clear());
      }
      this.addEventListener('click', this.handleClick);
      document.addEventListener('keydown', this.handleKeydown);
      this.render();
    }

    disconnectedCallback() {
      document.removeEventListener(EVENT_NAME, this.render);
      document.removeEventListener('airsoft:compare:drawer:open', this.openDrawer);
      document.removeEventListener('keydown', this.handleKeydown);
    }

    openDrawer() {
      if (!ProductCompareStore.read().length) return;
      this.classList.add('is-open');
      document.body.classList.add('compare-drawer-open');
    }

    closeDrawer() {
      this.classList.remove('is-open');
      document.body.classList.remove('compare-drawer-open');
    }

    handleKeydown(event) {
      if (event.key === 'Escape' && this.classList.contains('is-open')) {
        this.closeDrawer();
      }
    }

    handleClick(event) {
      const removeBtn = event.target.closest('[data-compare-remove]');
      if (removeBtn) {
        event.preventDefault();
        const handle = removeBtn.getAttribute('data-compare-remove');
        ProductCompareStore.remove(handle);
        return;
      }
      const backdrop = event.target.closest('[data-compare-drawer-backdrop]');
      if (backdrop) this.closeDrawer();
    }

    async render() {
      const list = ProductCompareStore.read();
      const count = list.length;
      if (this.countEl) this.countEl.textContent = String(count);
      this.classList.toggle('has-items', count > 0);
      if (!count) {
        this.closeDrawer();
        if (this.listEl) this.listEl.innerHTML = '';
        return;
      }
      if (!this.listEl) return;
      const items = await Promise.all(list.map((h) => this.fetchProduct(h)));
      this.listEl.innerHTML = items
        .map((p) => {
          if (!p) return '';
          const img = p.featured_image
            ? `<img src="${p.featured_image}&width=120" alt="${this.escapeHtml(p.title)}" width="60" height="60" loading="lazy">`
            : '';
          return `
            <li class="compare-drawer__item">
              <a class="compare-drawer__item-link" href="${p.url}">
                <span class="compare-drawer__item-media">${img}</span>
                <span class="compare-drawer__item-title">${this.escapeHtml(p.title)}</span>
              </a>
              <button
                type="button"
                class="compare-drawer__remove"
                data-compare-remove="${p.handle}"
                aria-label="Remove ${this.escapeHtml(p.title)}"
              >&times;</button>
            </li>`;
        })
        .join('');
    }

    async fetchProduct(handle) {
      try {
        const res = await fetch(`/products/${encodeURIComponent(handle)}.js`);
        if (!res.ok) return null;
        const data = await res.json();
        return {
          handle,
          title: data.title,
          url: data.url,
          featured_image: data.featured_image,
        };
      } catch (e) {
        return null;
      }
    }

    escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }
  if (!customElements.get('compare-drawer')) {
    customElements.define('compare-drawer', CompareDrawer);
  }

  // ---------------------------------------------------------------------------
  // <compare-table> — fills the comparison table on /pages/comparar
  // ---------------------------------------------------------------------------
  class CompareTable extends HTMLElement {
    constructor() {
      super();
      this.render = this.render.bind(this);
    }

    connectedCallback() {
      this.template = this.querySelector('template[data-compare-column-template]');
      this.emptyEl = this.querySelector('[data-compare-empty]');
      this.tableEl = this.querySelector('[data-compare-table]');
      document.addEventListener(EVENT_NAME, this.render);
      this.render();
    }

    disconnectedCallback() {
      document.removeEventListener(EVENT_NAME, this.render);
    }

    async render() {
      if (!this.template) return;
      const handles = ProductCompareStore.read();
      const clearCells = () => {
        this.querySelectorAll('[data-spec-row] [data-spec-cell]').forEach((c) => c.remove());
      };
      if (!handles.length) {
        if (this.emptyEl) this.emptyEl.hidden = false;
        if (this.tableEl) this.tableEl.hidden = true;
        clearCells();
        return;
      }
      if (this.emptyEl) this.emptyEl.hidden = true;
      if (this.tableEl) this.tableEl.hidden = false;

      clearCells();
      const allRows = Array.from(this.querySelectorAll('[data-spec-row]'));
      const productsRow = allRows.find((r) => r.hasAttribute('data-is-products-row'));
      const specRows = allRows.filter((r) => !r.hasAttribute('data-is-products-row'));

      const columns = await Promise.all(
        handles.map(async (handle) => {
          try {
            const res = await fetch(`/products/${encodeURIComponent(handle)}?view=compare-data`);
            if (!res.ok) return null;
            const text = await res.text();
            return JSON.parse(text.trim());
          } catch (e) {
            return null;
          }
        })
      );

      columns.forEach((product) => {
        if (!product) return;

        if (productsRow) {
          const fragment = this.template.content.cloneNode(true);
          const col = fragment.querySelector('[data-compare-column]');
          if (col) {
            col.setAttribute('data-handle', product.handle);
            col.querySelectorAll('[data-col-link]').forEach((a) => a.setAttribute('href', product.url));
            const removeBtn = col.querySelector('[data-col-remove]');
            if (removeBtn) removeBtn.setAttribute('data-compare-remove', product.handle);
            const img = col.querySelector('[data-col-image]');
            if (img) {
              if (product.featured_image) {
                const sep = product.featured_image.indexOf('?') !== -1 ? '&' : '?';
                img.src = `${product.featured_image}${sep}width=400`;
                img.alt = product.title || '';
              } else {
                img.remove();
              }
            }
            const title = col.querySelector('[data-col-title]');
            if (title) title.textContent = product.title || '';
            productsRow.appendChild(fragment);
          }
        }

        specRows.forEach((row) => {
          const ns = row.getAttribute('data-metafield-namespace');
          const key = row.getAttribute('data-metafield-key');
          const unit = row.getAttribute('data-unit') || '';
          const cell = document.createElement('td');
          cell.setAttribute('data-spec-cell', '');
          cell.className = 'compare-table__cell';
          if (ns === '__builtin') {
            this.renderBuiltinCell(cell, key, product, row);
          } else {
            const value = this.readMetafield(product, ns, key);
            if (value !== null && value !== undefined && value !== '') {
              cell.textContent = unit ? `${value} ${unit}` : String(value);
            } else {
              cell.innerHTML = '<span class="compare-table__empty">—</span>';
            }
          }
          row.appendChild(cell);
        });
      });
    }

    renderBuiltinCell(cell, key, product, row) {
      switch (key) {
        case 'price': {
          cell.innerHTML = `<strong>${product.price_formatted || this.formatMoney(product.price)}</strong>`;
          break;
        }
        case 'vendor': {
          cell.textContent = product.vendor || '—';
          break;
        }
        case 'availability': {
          const available = !!product.available;
          const labelAvail = row.dataset.labelAvailable || 'In stock';
          const labelSold = row.dataset.labelSoldOut || 'Sold out';
          cell.innerHTML = `<span class="compare-column__availability${available ? ' is-available' : ''}">${available ? labelAvail : labelSold}</span>`;
          break;
        }
        case 'add_to_cart': {
          const addLabel = row.dataset.labelAdd || 'Add to cart';
          const soldLabel = row.dataset.labelSoldOut || 'Sold out';
          if (!product.variant_id) {
            cell.innerHTML = `<span class="compare-table__empty">—</span>`;
            break;
          }
          cell.innerHTML = `
            <form action="/cart/add" method="post" enctype="multipart/form-data" data-col-form>
              <input type="hidden" name="id" value="${product.variant_id}">
              <button type="submit" class="button button--primary button--small"${product.available ? '' : ' disabled'}>
                ${product.available ? addLabel : soldLabel}
              </button>
            </form>`;
          break;
        }
        default:
          cell.innerHTML = '<span class="compare-table__empty">—</span>';
      }
    }

    readMetafield(product, namespace, key) {
      if (!product || !product.metafields || !namespace || !key) return null;
      const value = product.metafields[`${namespace}.${key}`];
      if (value === undefined || value === null) return null;
      if (typeof value === 'object') {
        try { return JSON.stringify(value); } catch (e) { return null; }
      }
      return value;
    }

    formatMoney(cents) {
      if (typeof cents !== 'number') return '';
      if (window.Shopify && window.Shopify.formatMoney) {
        return window.Shopify.formatMoney(cents);
      }
      return (cents / 100).toFixed(2);
    }
  }
  if (!customElements.get('compare-table')) {
    customElements.define('compare-table', CompareTable);
  }
})();

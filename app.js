const API_URL = "https://script.google.com/macros/s/AKfycbz-4yd5vY7-rS7ngu1DyfNNI9yNd9rNye_YQIcKoUtR94cSHugpo59vkAosdixlIqZh/exec";

const seed = {
  products: [
    { id: 1, name: 'Travel Pouch Batik', sku: 'GFT-TPB-01', minimum: 20 },
    { id: 2, name: 'Luggage Tag Kulit', sku: 'GFT-LTK-02', minimum: 15 }
  ],
  purchases: [
    { id: 'purchase-1', productId: 1, qty: 80, remaining: 56, date: '2026-08-20', batch: 'BT-260820-01', price: 25000 }
  ],
  transfers: [
    { id: 'transfer-1', productId: 1, qty: 24, date: '2026-08-21' }
  ],
  issues: [
    { id: 'issue-1', productId: 1, qty: 12, date: '2026-08-22', currency: 'USD', amount: 1200, rate: 16520 }
  ]
};

let db = JSON.parse(JSON.stringify(seed));
let view = 'dashboard';
let editingProductId = null;
let editingTransaction = null;

const app = document.getElementById('app');

const money = (value = 0) => new Intl.NumberFormat('id-ID').format(Number(value || 0));
const productById = (id) => db.products.find((product) => String(product.id) === String(id));

function sanitizeText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stockInfo(productId) {
  const product = productById(productId);
  const purchaseQty = db.purchases
    .filter((item) => String(item.productId) === String(productId))
    .reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const transferQty = db.transfers
    .filter((item) => String(item.productId) === String(productId))
    .reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const issueQty = db.issues
    .filter((item) => String(item.productId) === String(productId))
    .reduce((sum, item) => sum + Number(item.qty || 0), 0);

  return {
    total: purchaseQty - issueQty,
    warehouse: purchaseQty - transferQty,
    display: transferQty - issueQty,
    minimum: product?.minimum ?? 0
  };
}

function averageUnitCost(productId) {
  const productPurchases = db.purchases.filter((item) => String(item.productId) === String(productId));
  const totalQty = productPurchases.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  if (!totalQty) return 0;
  const totalCost = productPurchases.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0);
  return totalCost / totalQty;
}

function itemValue(productId) {
  const info = stockInfo(productId);
  const average = averageUnitCost(productId);
  return {
    average,
    total: info.total * average,
    warehouseValue: info.warehouse * average,
    displayValue: info.display * average
  };
}

function getOptions() {
  return db.products.map((product) => `<option value="${product.id}">${product.name} (${product.sku})</option>`).join('');
}

const currencies = ['USD', 'SGD', 'EUR', 'AUD', 'GBP', 'CHF', 'JPY', 'CAD', 'MYR', 'NZD', 'HKD', 'CNY', 'BND', 'SAR', 'AED', 'THB', 'PHP', 'KRW', 'INR', 'NTD', 'VND', 'QAR', 'TRY', 'OMR', 'GFT'];

function currencyOptions(selected = '') {
  const hasCustomCurrency = selected && !currencies.includes(selected);
  return `${currencies.map((currency) => `<option value="${currency}" ${currency === selected ? 'selected' : ''}>${currency}</option>`).join('')}<option value="__manual__" ${hasCustomCurrency ? 'selected' : ''}>Lainnya</option>`;
}

function renderNav() {
  document.querySelectorAll('nav button[data-v]').forEach((button) => {
    button.classList.toggle('active', button.dataset.v === view);
  });
}

function renderDashboard() {
  const rows = db.products.map((product) => {
    const info = stockInfo(product.id);
    const status = info.total <= product.minimum ? 'Restock' : 'Aman';
    return `
      <div class="stock">
        <div>
          <b>${product.name}</b>
          <div class="sku">${product.sku}</div>
        </div>
        <div class="right">${info.total}</div>
        <div class="right">${status}</div>
      </div>
    `;
  }).join('');

  const totalStock = db.products.reduce((sum, product) => sum + stockInfo(product.id).total, 0);
  const warehouseStock = db.products.reduce((sum, product) => sum + stockInfo(product.id).warehouse, 0);
  const displayStock = db.products.reduce((sum, product) => sum + stockInfo(product.id).display, 0);
  const cost = db.purchases.reduce((sum, purchase) => sum + Number(purchase.qty || 0) * Number(purchase.price || 0), 0);

  app.innerHTML = `
    <div class="page">
      <div class="heading">
        <div>
          <h1>Dashboard</h1>
          <p class="sub">Pantau kondisi stok dan transaksi.</p>
        </div>
        <button class="primary" data-action="purchase">+ Catat pembelian</button>
      </div>
      <div class="cards">
        <div class="card"><small>TOTAL STOK</small><strong>${totalStock}</strong></div>
        <div class="card"><small>DI GUDANG</small><strong>${warehouseStock}</strong></div>
        <div class="card"><small>DI ETALASE</small><strong>${displayStock}</strong></div>
        <div class="card"><small>TOTAL PEMBELIAN</small><strong>Rp ${money(cost)}</strong></div>
      </div>
      <div class="grid">
        <section class="panel">
          <h2>Stok aktual</h2>
          ${rows}
        </section>
        <section class="panel">
          <h2>Ringkasan pengeluaran</h2>
          <p>${db.issues.reduce((sum, issue) => sum + Number(issue.qty || 0), 0)} unit diberikan kepada customer.</p>
          <p>Total transaksi: ${db.issues.length}</p>
        </section>
      </div>
    </div>
  `;
}

function renderTable(type) {
  if (type === 'products') {
    app.innerHTML = `
      <div class="page">
        <div class="heading">
          <div>
            <h1>Produk</h1>
            <p class="sub">Kelola daftar produk dan minimum stock.</p>
          </div>
          <button class="primary" data-action="product">+ Tambah produk</button>
        </div>
        <section class="panel table-panel">
          <table>
            <thead>
              <tr>
                <th>PRODUK</th>
                <th>TOTAL</th>
                <th>GUDANG</th>
                <th>ETALASE</th>
                <th>MINIMUM</th>
                <th>AKSI</th>
              </tr>
            </thead>
            <tbody>
              ${db.products.map((product) => {
                const info = stockInfo(product.id);
                return `<tr>
                  <td><b>${product.name}</b><div class="sku">${product.sku}</div></td>
                  <td>${info.total}</td>
                  <td>${info.warehouse}</td>
                  <td>${info.display}</td>
                  <td>${product.minimum}</td>
                  <td><button class="edit" data-edit="${product.id}">Edit</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </section>
      </div>
    `;
    return;
  }

  const labels = {
    purchases: ['Tanggal', 'Produk', 'Batch FIFO', 'Qty', 'Harga satuan', 'Total beban', 'Sisa', 'Aksi'],
    transfers: ['Tanggal', 'Produk', 'Alur', 'Jumlah', 'Aksi'],
    issues: ['Tanggal', 'Produk', 'Jumlah', 'Valas', 'Kurs', 'Aksi']
  };

  const dataKey = type === 'purchases' ? 'purchases' : type === 'transfers' ? 'transfers' : 'issues';
  const records = db[dataKey].slice().reverse();

  const rows = records.map((record) => {
    if (type === 'purchases') {
      const product = productById(record.productId);
      return `<tr>
        <td>${record.date}</td>
        <td>${product ? product.name : '-'}</td>
        <td><span class="batch">${record.batch || '-'}</span></td>
        <td>${record.qty}</td>
        <td>Rp ${money(record.price || 0)}</td>
        <td>Rp ${money((record.qty || 0) * (record.price || 0))}</td>
        <td>${record.remaining ?? record.qty}</td>
        <td><button class="edit" data-transaction="purchase" data-edit="${record.id}">Edit</button><button class="delete" data-transaction="purchase" data-delete="${record.id}">Hapus</button></td>
      </tr>`;
    }

    if (type === 'transfers') {
      const product = productById(record.productId);
      return `<tr>
        <td>${record.date}</td>
        <td>${product ? product.name : '-'}</td>
        <td>Gudang → Etalase</td>
        <td>${record.qty}</td>
        <td><button class="edit" data-transaction="transfer" data-edit="${record.id}">Edit</button><button class="delete" data-transaction="transfer" data-delete="${record.id}">Hapus</button></td>
      </tr>`;
    }

    const product = productById(record.productId);
    return `<tr data-amount="${record.amount || 0}" data-rate="${record.rate || 0}">
      <td>${record.date}</td>
      <td>${product ? product.name : '-'}</td>
      <td>${record.qty}</td>
      <td>${record.currency || '-'} ${record.amount || 0}</td>
      <td>Rp ${money(record.rate || 0)}</td>
      <td><button class="edit" data-transaction="issue" data-edit="${record.id}">Edit</button><button class="delete" data-transaction="issue" data-delete="${record.id}">Hapus</button></td>
    </tr>`;
  }).join('');

  app.innerHTML = `
    <div class="page">
      <div class="heading">
        <div>
          <h1>${type === 'purchases' ? 'Pembelian stok' : type === 'transfers' ? 'Transfer stok' : 'Pengeluaran'}</h1>
          <p class="sub">Kelola pergerakan merchandise.</p>
        </div>
        <button class="primary" data-action="${type === 'purchases' ? 'purchase' : type === 'transfers' ? 'transfer' : 'issue'}">+ Tambah</button>
      </div>
      <section class="panel table-panel">
        <table>
          <thead>
            <tr>
              ${labels[type].map((label) => `<th>${label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    </div>
  `;
}

function movementRows() {
  const rows = [
    ...db.purchases.map((item) => ({
      date: item.date,
      type: 'Pembelian',
      product: productById(item.productId)?.name || '-',
      qty: Number(item.qty || 0),
      detail: `${item.batch || '-'} · Rp ${money(item.price || 0)}`
    })),
    ...db.transfers.map((item) => ({
      date: item.date,
      type: 'Transfer',
      product: productById(item.productId)?.name || '-',
      qty: Number(item.qty || 0),
      detail: 'Gudang → Etalase'
    })),
    ...db.issues.filter((item) => Number(item.qty || 0) > 0).map((item) => ({
      date: item.date,
      type: 'Pengeluaran',
      product: productById(item.productId)?.name || '-',
      qty: Number(item.qty || 0),
      detail: `${item.currency || '-'} ${money(item.amount || 0)} · Kurs Rp ${money(item.rate || 0)}`
    }))
  ];

  const typeFilter = document.getElementById('movementType')?.value || '';
  const sortValue = document.getElementById('movementSort')?.value || 'date-desc';

  const filtered = rows.filter((row) => !typeFilter || row.type === typeFilter);
  const [field, direction] = sortValue.split('-');

  filtered.sort((a, b) => {
    const aValue = field === 'date' ? a.date : field === 'product' ? a.product.toLowerCase() : a.qty;
    const bValue = field === 'date' ? b.date : field === 'product' ? b.product.toLowerCase() : b.qty;
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return (aValue > bValue ? 1 : -1) * (direction === 'desc' ? -1 : 1);
    }
    return (aValue > bValue ? 1 : aValue < bValue ? -1 : 0) * (direction === 'desc' ? -1 : 1);
  });

  return filtered;
}

function renderMovement() {
  const rows = movementRows();
  app.innerHTML = `
    <div class="page">
      <div class="heading">
        <div>
          <h1>Laporan pergerakan stok</h1>
          <p class="sub">Seluruh pembelian, transfer, dan pengeluaran dalam satu laporan.</p>
        </div>
      </div>
      <section class="panel table-panel">
        <div class="toolbar">
          <h2>Detail pergerakan</h2>
          <div>
            <select id="movementType">
              <option value="">Semua transaksi</option>
              <option>Pembelian</option>
              <option>Transfer</option>
              <option>Pengeluaran</option>
            </select>
            <select id="movementSort">
              <option value="date-desc">Tanggal terbaru</option>
              <option value="date-asc">Tanggal terlama</option>
              <option value="product-asc">Produk A-Z</option>
              <option value="product-desc">Produk Z-A</option>
              <option value="qty-desc">Jumlah terbesar</option>
              <option value="qty-asc">Jumlah terkecil</option>
            </select>
            <button class="primary" data-download="movement">Unduh Excel</button>
            <button class="primary" data-download="issue">Unduh Excel Pengeluaran</button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>TANGGAL</th>
              <th>JENIS</th>
              <th>PRODUK</th>
              <th>JUMLAH</th>
              <th>DETAIL TRANSAKSI</th>
            </tr>
          </thead>
          <tbody id="movementRows">
            ${rows.map((row) => `
              <tr>
                <td>${row.date}</td>
                <td><span class="badge">${row.type}</span></td>
                <td><b>${row.product}</b></td>
                <td class="mono">${row.qty} unit</td>
                <td>${row.detail}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
    </div>
  `;

  const movementType = document.getElementById('movementType');
  const movementSort = document.getElementById('movementSort');
  if (movementType) movementType.addEventListener('change', renderMovement);
  if (movementSort) movementSort.addEventListener('change', renderMovement);
}

function downloadExcel(filename, rows, columns) {
  const html = `
    <table>
      <thead><tr>${columns.map((label) => `<th>${sanitizeText(label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${sanitizeText(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  `;

  const blob = new Blob([`\ufeff<html><meta charset="UTF-8"><body>${html}</body></html>`], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportMovementExcel() {
  const rows = movementRows();
  const columns = ['Tanggal', 'Jenis Transaksi', 'Produk', 'Jumlah Unit', 'Detail Transaksi'];
  const data = rows.map((row) => [row.date, row.type, row.product, `${row.qty}`, row.detail]);
  downloadExcel(`laporan-pergerakan-${new Date().toISOString().slice(0, 10)}.xls`, data, columns);
}

function exportIssueExcel() {
  const rows = db.issues.filter((item) => Number(item.qty || 0) > 0);
  const columns = ['Tanggal', 'Produk', 'Jumlah', 'Valas', 'Jumlah Valas', 'Kurs', 'Nilai (Valas × Kurs)'];
  const data = rows.map((item) => {
    const product = productById(item.productId)?.name || '-';
    const value = Number(item.amount || 0) * Number(item.rate || 0);
    return [item.date, product, `${item.qty}`, item.currency || '-', `${item.amount || 0}`, `Rp ${money(item.rate || 0)}`, `Rp ${money(value)}`];
  });
  downloadExcel(`laporan-pengeluaran-${new Date().toISOString().slice(0, 10)}.xls`, data, columns);
}

function modal(type, id = null) {
  editingProductId = id;
  if (type === 'product') {
    const product = productById(id);
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-bg">
        <form class="modal" id="modalForm" data-kind="product" data-id="${id ?? ''}">
          <h2>${id ? 'Edit produk' : 'Tambah produk'}</h2>
          <div class="fields">
            <div class="field full">
              <label>Nama produk</label>
              <input name="name" required value="${product ? product.name : ''}">
            </div>
            <div class="field">
              <label>SKU</label>
              <input name="sku" required value="${product ? product.sku : ''}">
            </div>
            <div class="field">
              <label>Stok minimum</label>
              <input name="minimum" type="number" required value="${product ? product.minimum : 0}">
            </div>
          </div>
          <div class="actions">
            <button type="button" data-close>Batal</button>
            <button class="primary">Simpan</button>
          </div>
        </form>
      </div>
    `);
    document.getElementById('modalForm').addEventListener('submit', saveProductForm);
    return;
  }

  const productId = id ?? db.products[0]?.id;
  const record = type === 'purchase' ? db.purchases.find((item) => item.id === id) : type === 'transfer' ? db.transfers.find((item) => item.id === id) : db.issues.find((item) => item.id === id);

  editingTransaction = record ? { type, id: record.id } : null;

  const title = type === 'purchase' ? 'Catat pembelian' : type === 'transfer' ? 'Transfer ke etalase' : 'Pengeluaran customer';
  const existing = record || {};

  const commonFields = `
    <div class="field full">
      <label>Produk</label>
      <select name="productId">${getOptions()}</select>
    </div>
    <div class="field">
      <label>Jumlah unit</label>
      <input name="qty" type="number" min="1" required value="${existing.qty || ''}">
    </div>
    <div class="field"><label>Tanggal</label><input name="date" type="date" required value="${existing.date || new Date().toISOString().slice(0, 10)}"></div>
  `;

  const extraFields = type === 'purchase'
    ? `<div class="field"><label>Harga beli satuan (IDR)</label><input name="price" type="number" min="0" required value="${existing.price || 0}"></div>`
    : type === 'issue'
      ? `
          <div class="field"><label>Mata uang</label><select name="currency">${currencyOptions(existing.currency || 'USD')}</select></div>
          <div class="field manual-currency-field" ${existing.currency && !currencies.includes(existing.currency) ? '' : 'hidden'}><label>Kode mata uang manual</label><input name="manualCurrency" maxlength="10" value="${existing.currency && !currencies.includes(existing.currency) ? sanitizeText(existing.currency) : ''}" placeholder="Contoh: IDR"></div>
          <div class="field"><label>Jumlah valas</label><input name="amount" type="number" required value="${existing.amount || 0}"></div>
          <div class="field"><label>Kurs saat itu</label><input name="rate" type="number" required value="${existing.rate || 0}"></div>
        `
      : '';

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-bg">
      <form class="modal" id="transactionForm" data-kind="${type}" data-id="${id ?? ''}">
        <h2>${title}</h2>
        <div class="fields">
          ${commonFields}
          ${extraFields}
        </div>
        <div class="actions">
          <button type="button" data-close>Batal</button>
          <button class="primary">Simpan</button>
        </div>
      </form>
    </div>
  `);

  const form = document.getElementById('transactionForm');
  if (form) {
    const select = form.querySelector('select[name="productId"]');
    if (select && (record || productId)) {
      select.value = String(record ? record.productId : productId);
    }
    const currencySelect = form.querySelector('select[name="currency"]');
    const manualCurrencyField = form.querySelector('.manual-currency-field');
    const toggleManualCurrency = () => {
      if (!currencySelect || !manualCurrencyField) return;
      manualCurrencyField.hidden = currencySelect.value !== '__manual__';
      const manualCurrencyInput = manualCurrencyField.querySelector('input');
      if (manualCurrencyInput) manualCurrencyInput.required = currencySelect.value === '__manual__';
    };
    currencySelect?.addEventListener('change', toggleManualCurrency);
    toggleManualCurrency();
    form.addEventListener('submit', saveTransactionForm);
  }
}

function saveProductForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const name = String(formData.get('name') || '').trim();
  const sku = String(formData.get('sku') || '').trim();
  const minimum = Number(formData.get('minimum') || 0);

  if (!name || !sku) return;

  const existing = db.products.find((product) => product.sku.toLowerCase() === sku.toLowerCase() && String(product.id) !== String(editingProductId));
  if (existing) {
    alert('SKU sudah digunakan');
    return;
  }

  if (editingProductId) {
    const product = productById(editingProductId);
    if (product) {
      product.name = name;
      product.sku = sku;
      product.minimum = minimum;
    }
  } else {
    db.products.push({ id: Date.now(), name, sku, minimum });
  }

  form.closest('.modal-bg')?.remove();
  editingProductId = null;
  save();
  render();
}

function saveTransactionForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const type = form.dataset.kind;
  const id = form.dataset.id || null;
  const productId = Number(formData.get('productId'));
  const qty = Number(formData.get('qty') || 0);
  const date = String(formData.get('date') || new Date().toISOString().slice(0, 10));

  if (!productId || !qty) return;

  if (type === 'purchase') {
    const price = Number(formData.get('price') || 0);
    const payload = {
      id: id || `purchase-${Date.now()}`,
      productId,
      qty,
      remaining: qty,
      date,
      batch: `BT-${date.replace(/-/g, '').slice(2)}-${String(db.purchases.length + 1).padStart(2, '0')}`,
      price
    };

    if (id) {
      const existing = db.purchases.find((item) => item.id === id);
      if (existing) Object.assign(existing, payload);
    } else {
      db.purchases.push(payload);
    }
  } else if (type === 'transfer') {
    const payload = {
      id: id || `transfer-${Date.now()}`,
      productId,
      qty,
      date
    };

    if (id) {
      const existing = db.transfers.find((item) => item.id === id);
      if (existing) Object.assign(existing, payload);
    } else {
      db.transfers.push(payload);
    }
  } else if (type === 'issue') {
    const selectedCurrency = String(formData.get('currency') || 'USD');
    const currency = selectedCurrency === '__manual__'
      ? String(formData.get('manualCurrency') || '').trim().toUpperCase()
      : selectedCurrency;
    if (!currency) return;

    const payload = {
      id: id || `issue-${Date.now()}`,
      productId,
      qty,
      date,
      currency,
      amount: Number(formData.get('amount') || 0),
      rate: Number(formData.get('rate') || 0)
    };

    if (id) {
      const existing = db.issues.find((item) => item.id === id);
      if (existing) Object.assign(existing, payload);
    } else {
      db.issues.push(payload);
    }
  }

  form.closest('.modal-bg')?.remove();
  editingTransaction = null;
  save();
  render();
}

function deleteTransaction(type, id) {
  const key = type === 'purchase' ? 'purchases' : type === 'transfer' ? 'transfers' : 'issues';
  db[key] = db[key].filter((item) => item.id !== id);
  save();
  render();
}

function render() {
  renderNav();
  if (view === 'dashboard') return renderDashboard();
  if (view === 'products') return renderTable('products');
  if (view === 'purchases') return renderTable('purchases');
  if (view === 'transfers') return renderTable('transfers');
  if (view === 'issues') return renderTable('issues');
  if (view === 'movement') return renderMovement();
  renderDashboard();
}

async function save() {
  try {
    if (typeof fetch === 'function') {
      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(db)
      });
    }
  } catch (error) {
    console.warn('Gagal menyimpan data:', error);
  }
}

async function initApp() {
  try {
    if (typeof fetch === 'function') {
      const response = await fetch(API_URL);
      if (response && response.ok) {
        const remoteData = await response.json();
        if (remoteData && Array.isArray(remoteData.products) && remoteData.products.length) {
          db = remoteData;
        } else {
          db = JSON.parse(JSON.stringify(seed));
        }
      }
    }
  } catch (error) {
    console.warn('Gagal memuat data dari Google Drive, memakai seed default:', error);
    db = JSON.parse(JSON.stringify(seed));
  }

  render();
}

document.addEventListener('click', (event) => {
  const closeButton = event.target.closest('[data-close]');
  if (closeButton) {
    closeButton.closest('.modal-bg')?.remove();
    return;
  }

  const downloadButton = event.target.closest('[data-download]');
  if (downloadButton) {
    if (downloadButton.dataset.download === 'movement') exportMovementExcel();
    if (downloadButton.dataset.download === 'issue') exportIssueExcel();
    return;
  }

  const viewButton = event.target.closest('[data-v]');
  if (viewButton) {
    view = viewButton.dataset.v;
    render();
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    modal(actionButton.dataset.action);
    return;
  }

  const editButton = event.target.closest('[data-edit]');
  if (editButton) {
    if (editButton.dataset.transaction) {
      modal(editButton.dataset.transaction, editButton.dataset.edit);
    } else {
      modal('product', editButton.dataset.edit);
    }
    return;
  }

  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) {
    deleteTransaction(deleteButton.dataset.transaction, deleteButton.dataset.delete);
  }
});

initApp();

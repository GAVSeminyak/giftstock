import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
	collection,
	doc,
	getFirestore,
	onSnapshot,
	query,
	serverTimestamp,
	setDoc,
	where
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
	apiKey: 'AIzaSyASIDsnskB16bZwdtyJclVVVCDOuxd_pSw',
	authDomain: 'giftstock-36431.firebaseapp.com',
	projectId: 'giftstock-36431',
	storageBucket: 'giftstock-36431.firebasestorage.app',
	messagingSenderId: '1065898944190',
	appId: '1:1065898944190:web:ff842a426d8b94acf260ef'
};

const COMMISSION_PER_TRANSACTION = 12000;
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const app = document.querySelector('#app');
const dateInput = document.querySelector('#report-date');
const idr = new Intl.NumberFormat('id-ID', {
	style: 'currency',
	currency: 'IDR',
	maximumFractionDigits: 0
});
const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

let inventory = null;
let inventoryError = '';
let ratesError = '';
let savedRates = {};
let draftRates = {};
let dirtyRates = new Set();
let reportDate = localDate();
let stopRates = null;
let savingCurrencies = new Set();
let toastTimer;

dateInput.value = reportDate;

function localDate() {
	const today = new Date();
	return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	})[character]);
}

function asNumber(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function simulateIssueCosts(data) {
	const costs = new Map();
	const lots = new Map();
	const events = [];
	const pushEvent = (type, record, index, priority) => {
		events.push({
			type,
			record,
			priority,
			index,
			productId: String(record.productId),
			date: String(record.date || ''),
			order: Number(String(record.id || '').match(/\d{10,}/)?.[0]) || index
		});
	};

	(data.purchases || []).forEach((record, index) => pushEvent('purchase', record, index, 0));
	(data.transfers || []).forEach((record, index) => pushEvent('transfer', record, index, 1));
	(data.issues || []).forEach((record, index) => pushEvent('issue', record, index, 2));
	events.sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority || a.order - b.order || a.index - b.index);

	function queue(productId, location) {
		if (!lots.has(productId)) lots.set(productId, { warehouse: [], display: [] });
		return lots.get(productId)[location];
	}

	function take(productId, location, requested) {
		const source = queue(productId, location);
		let remaining = Math.max(0, asNumber(requested));
		let cost = 0;
		let incomplete = false;
		const moved = [];

		for (const lot of source) {
			if (remaining <= 0) break;
			const quantity = Math.min(remaining, lot.quantity);
			if (!quantity) continue;
			lot.quantity -= quantity;
			remaining -= quantity;
			if (lot.priceKnown) cost += quantity * lot.price;
			else incomplete = true;
			moved.push({ quantity, price: lot.price, priceKnown: lot.priceKnown });
		}

		if (remaining > 0) {
			incomplete = true;
			moved.push({ quantity: remaining, price: 0, priceKnown: false });
		}
		return { cost, incomplete, moved };
	}

	events.forEach(event => {
		const record = event.record;
		if (event.type === 'purchase') {
			const price = Number(record.price);
			queue(event.productId, 'warehouse').push({
				quantity: Math.max(0, asNumber(record.qty)),
				price: Number.isFinite(price) && price >= 0 ? price : 0,
				priceKnown: Number.isFinite(price) && price >= 0
			});
			return;
		}

		if (event.type === 'transfer') {
			const moved = take(event.productId, 'warehouse', record.qty).moved;
			queue(event.productId, 'display').push(...moved);
			return;
		}

		const moved = take(event.productId, 'display', record.qty);
		const key = String(record.id ?? `${record.date || 'unknown'}-${event.productId}-${event.index}`);
		costs.set(key, moved);
	});

	return costs;
}

function currentIssues() {
	const products = new Map((inventory?.products || []).map(product => [String(product.id), product]));
	const issues = (inventory?.issues || [])
		.map((record, index) => ({
			...record,
			key: String(record.id ?? `${record.date || 'unknown'}-${record.productId}-${index}`),
			currency: String(record.currency || 'LAINNYA').trim().toUpperCase(),
			productName: products.get(String(record.productId))?.name || 'Produk tidak ditemukan'
		}))
		.filter(record => record.date === reportDate && asNumber(record.qty) > 0);
	const costs = simulateIssueCosts(inventory || {});

	return issues.map(record => ({
		...record,
		productCost: costs.get(record.key) || { cost: 0, incomplete: true }
	}));
}

function formatRate(value) {
	return value > 0 ? idr.format(value) : '-';
}

function showToast(message, isError = false) {
	const toast = document.querySelector('#toast');
	toast.textContent = message;
	toast.classList.toggle('error', isError);
	toast.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function renderLoading() {
	app.innerHTML = `<section class="notice"><span class="loader" aria-hidden="true"></span><div><h2>Menghubungkan ke Giftstock</h2><p>Memuat transaksi dan harga pembelian terbaru.</p></div></section>`;
}

function renderError(message) {
	app.innerHTML = `<section class="notice notice-error"><div class="notice-mark">!</div><div><h2>Data belum dapat dimuat</h2><p>${escapeHtml(message)}</p><button class="button button-dark" data-retry>Ulangi koneksi</button></div></section>`;
}

function getSummary(issues) {
	const byCurrency = new Map();
	issues.forEach(issue => {
		if (!byCurrency.has(issue.currency)) {
			byCurrency.set(issue.currency, {
				currency: issue.currency,
				count: 0,
				amount: 0,
				buyValue: 0,
				salesValue: 0,
				productCost: 0,
				commission: 0,
				margin: 0,
				incomplete: 0
			});
		}
		const summary = byCurrency.get(issue.currency);
		const amount = Math.max(0, asNumber(issue.amount));
		const buyValue = amount * Math.max(0, asNumber(issue.rate));
		const sellRate = Math.max(0, asNumber(draftRates[issue.currency] ?? savedRates[issue.currency]));
		const salesValue = amount * sellRate;
		const productCost = issue.productCost.cost;
		const commission = COMMISSION_PER_TRANSACTION;

		summary.count += 1;
		summary.amount += amount;
		summary.buyValue += buyValue;
		summary.salesValue += salesValue;
		summary.productCost += productCost;
		summary.commission += commission;
		if (issue.productCost.incomplete) summary.incomplete += 1;
		else summary.margin += salesValue - buyValue - productCost - commission;
	});
	return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

function render() {
	if (inventoryError) return renderError(inventoryError);
	if (!inventory) return renderLoading();

	const issues = currentIssues();
	const summaries = getSummary(issues);
	if (!issues.length) {
		app.innerHTML = `<section class="empty-state"><span class="empty-icon">0</span><h2>Belum ada pengeluaran pada tanggal ini</h2><p>Pilih tanggal lain untuk melihat transaksi yang tercatat.</p></section>`;
		return;
	}

	app.innerHTML = `
		${ratesError ? `<div class="inline-error">Kurs jual gagal dimuat: ${escapeHtml(ratesError)}. Periksa akses Firestore lalu coba muat ulang.</div>` : ''}
		<section class="metric-strip" aria-label="Ringkasan harian">
			<div class="metric"><span>TRANSAKSI HARI INI</span><strong>${issues.length}</strong><small>${summaries.length} mata uang</small></div>
			<div class="metric"><span>TOTAL VALAS</span><strong>${number.format(summaries.reduce((sum, item) => sum + item.amount, 0))}</strong><small>gabungan semua mata uang</small></div>
			<div class="metric"><span>PENERIMAAN KURS JUAL</span><strong data-total-sales>-</strong><small>berdasarkan kurs jual yang diisi</small></div>
			<div class="metric metric-highlight"><span>ESTIMASI MARGIN</span><strong data-total-margin>-</strong><small data-total-margin-note>Menunggu input kurs jual</small></div>
		</section>

		<section class="report-section">
			<div class="section-heading"><div><p class="eyebrow">REKAP HARIAN</p><h2>Kurs jual per mata uang</h2></div><span class="section-date">${escapeHtml(reportDate)}</span></div>
			<div class="table-wrap"><table class="summary-table"><thead><tr>
				<th>MATA UANG</th><th>TRANSAKSI</th><th>TOTAL VALAS</th><th>NILAI KURS BELI</th><th>KURS JUAL</th><th>NILAI KURS JUAL</th><th>ESTIMASI MARGIN</th><th></th>
			</tr></thead><tbody>${summaries.map((item, index) => `
				<tr>
					<td><span class="currency-tag">${escapeHtml(item.currency)}</span></td>
					<td>${item.count}</td>
					<td class="numeric">${number.format(item.amount)} ${escapeHtml(item.currency)}</td>
					<td class="numeric">${formatRate(item.amount ? item.buyValue / item.amount : 0)}</td>
					<td><label class="rate-field"><span class="sr-only">Kurs jual ${escapeHtml(item.currency)}</span><span>Rp</span><input type="number" min="1" step="1" inputmode="numeric" placeholder="Masukkan kurs" value="${escapeHtml(draftRates[item.currency] ?? savedRates[item.currency] ?? '')}" data-sell-rate="${escapeHtml(item.currency)}" aria-label="Kurs jual ${escapeHtml(item.currency)}"></label></td>
					<td class="numeric" data-sales="${index}">-</td>
					<td class="numeric" data-margin="${index}">-</td>
					<td><button class="button button-save" type="button" data-save-rate="${escapeHtml(item.currency)}" ${savingCurrencies.has(item.currency) || ratesError ? 'disabled' : ''}>${savingCurrencies.has(item.currency) ? 'Menyimpan...' : 'Simpan kurs'}</button><small class="save-state" data-rate-state="${index}"></small></td>
				</tr>`).join('')}
			</tbody></table></div>
			<p class="formula-note">Margin per transaksi = (valas x kurs jual) - (valas x kurs beli) - modal produk - komisi Rp 12.000.</p>
		</section>

		<section class="report-section detail-section">
			<div class="section-heading"><div><p class="eyebrow">RINCIAN</p><h2>Transaksi pengeluaran</h2></div><span class="detail-count">${issues.length} baris</span></div>
			<div class="table-wrap"><table class="detail-table"><thead><tr>
				<th>PRODUK</th><th>UNIT</th><th>VALAS</th><th>KURS BELI</th><th>KURS JUAL</th><th>PENERIMAAN</th><th>MODAL PRODUK</th><th>KOMISI</th><th>MARGIN</th>
			</tr></thead><tbody>${issues.map(issue => `
				<tr data-issue="${escapeHtml(issue.key)}">
					<td><strong>${escapeHtml(issue.productName)}</strong><small>${escapeHtml(issue.date)}</small></td>
					<td class="numeric">${number.format(asNumber(issue.qty))}</td>
					<td class="numeric">${number.format(asNumber(issue.amount))} ${escapeHtml(issue.currency)}</td>
					<td class="numeric">${formatRate(asNumber(issue.rate))}</td>
					<td class="numeric" data-issue-rate>-</td>
					<td class="numeric" data-issue-sales>-</td>
					<td class="numeric">${issue.productCost.incomplete ? '<span class="warning-text">Modal belum lengkap</span>' : idr.format(issue.productCost.cost)}</td>
					<td class="numeric">${idr.format(COMMISSION_PER_TRANSACTION)}</td>
					<td class="numeric margin-value" data-issue-margin>-</td>
				</tr>`).join('')}
			</tbody></table></div>
		</section>`;

	updateCalculations(summaries, issues);
}

function updateCalculations(summaries = getSummary(currentIssues()), issues = currentIssues()) {
	let totalSales = 0;
	let totalMargin = 0;
	let incompleteCount = 0;

	summaries.forEach((summary, index) => {
		const rate = Math.max(0, asNumber(draftRates[summary.currency] ?? savedRates[summary.currency]));
		const salesValue = summary.amount * rate;
		totalSales += salesValue;
		if (rate > 0) totalMargin += summary.margin;
		incompleteCount += summary.incomplete;
		const salesCell = document.querySelector(`[data-sales="${index}"]`);
		const marginCell = document.querySelector(`[data-margin="${index}"]`);
		const state = document.querySelector(`[data-rate-state="${index}"]`);
		if (salesCell) salesCell.textContent = rate > 0 ? idr.format(salesValue) : '-';
		if (marginCell) {
			marginCell.textContent = rate > 0 ? idr.format(summary.margin) : '-';
			marginCell.classList.toggle('negative', summary.margin < 0);
		}
		if (state) {
			const isSaved = savedRates[summary.currency] != null && Number(savedRates[summary.currency]) === rate;
			state.textContent = isSaved ? 'Tersimpan' : rate > 0 ? 'Belum disimpan' : '';
			state.classList.toggle('saved', isSaved);
		}
	});

	issues.forEach(issue => {
		const row = document.querySelector(`[data-issue="${CSS.escape(issue.key)}"]`);
		if (!row) return;
		const sellRate = Math.max(0, asNumber(draftRates[issue.currency] ?? savedRates[issue.currency]));
		const salesValue = asNumber(issue.amount) * sellRate;
		const margin = salesValue - asNumber(issue.amount) * asNumber(issue.rate) - issue.productCost.cost - COMMISSION_PER_TRANSACTION;
		row.querySelector('[data-issue-rate]').textContent = formatRate(sellRate);
		row.querySelector('[data-issue-sales]').textContent = sellRate > 0 ? idr.format(salesValue) : '-';
		const marginCell = row.querySelector('[data-issue-margin]');
		marginCell.textContent = issue.productCost.incomplete ? 'Modal belum lengkap' : sellRate > 0 ? idr.format(margin) : '-';
		marginCell.classList.toggle('negative', margin < 0);
	});

	const salesTarget = document.querySelector('[data-total-sales]');
	const marginTarget = document.querySelector('[data-total-margin]');
	const marginNote = document.querySelector('[data-total-margin-note]');
	if (salesTarget) salesTarget.textContent = totalSales ? idr.format(totalSales) : '-';
	if (marginTarget) marginTarget.textContent = summaries.some(item => asNumber(draftRates[item.currency] ?? savedRates[item.currency]) > 0) ? idr.format(totalMargin) : '-';
	if (marginTarget) marginTarget.classList.toggle('negative', totalMargin < 0);
	if (marginNote) marginNote.textContent = incompleteCount ? `${incompleteCount} transaksi belum memiliki modal lengkap` : 'Setelah modal produk dan komisi';
}

async function saveRate(currency) {
	const rate = Number(draftRates[currency]);
	if (!Number.isFinite(rate) || rate <= 0) {
		showToast(`Masukkan kurs jual ${currency} lebih dari 0.`, true);
		return;
	}
	if (ratesError) {
		showToast('Kurs jual tidak dapat disimpan karena koleksi kurs gagal dimuat.', true);
		return;
	}

	savingCurrencies.add(currency);
	render();
	try {
		const documentId = `selling-rate-${reportDate}-${encodeURIComponent(currency)}`;
		await setDoc(doc(db, 'inventory', documentId), {
			recordType: 'selling-rate',
			date: reportDate,
			currency,
			rate,
			updatedAt: serverTimestamp()
		}, { merge: true });
		savedRates[currency] = rate;
		dirtyRates.delete(currency);
		showToast(`Kurs jual ${currency} tersimpan untuk ${reportDate}.`);
	} catch (error) {
		console.error('Gagal menyimpan kurs jual:', error);
		showToast('Kurs gagal disimpan. Periksa izin Firestore dan koneksi internet.', true);
	} finally {
		savingCurrencies.delete(currency);
		render();
	}
}

function subscribeRates() {
	stopRates?.();
	savedRates = {};
	draftRates = {};
	dirtyRates = new Set();
	ratesError = '';
	render();
	const ratesQuery = query(collection(db, 'inventory'), where('recordType', '==', 'selling-rate'));
	stopRates = onSnapshot(ratesQuery, snapshot => {
		const editedRates = Object.fromEntries([...dirtyRates]
			.filter(currency => draftRates[currency] !== undefined)
			.map(currency => [currency, draftRates[currency]]));
		savedRates = {};
		snapshot.forEach(rateDoc => {
			const data = rateDoc.data();
			if (data.date === reportDate && data.currency) savedRates[String(data.currency).toUpperCase()] = asNumber(data.rate);
		});
		draftRates = { ...savedRates, ...editedRates };
		ratesError = '';
		render();
	}, error => {
		console.error('Gagal membaca kurs jual:', error);
		ratesError = error.message || 'Akses Firestore ditolak';
		render();
	});
}

dateInput.addEventListener('change', () => {
	if (!dateInput.value) return;
	reportDate = dateInput.value;
	subscribeRates();
});

app.addEventListener('input', event => {
	const input = event.target.closest('[data-sell-rate]');
	if (!input) return;
	draftRates[input.dataset.sellRate] = input.value;
	dirtyRates.add(input.dataset.sellRate);
	updateCalculations();
});

app.addEventListener('click', event => {
	const saveButton = event.target.closest('[data-save-rate]');
	if (saveButton) return saveRate(saveButton.dataset.saveRate);
	if (event.target.closest('[data-retry]')) {
		inventoryError = '';
		inventory = null;
		stopInventory?.();
		startInventorySubscription();
	}
});

let stopInventory = null;
function startInventorySubscription() {
	stopInventory = onSnapshot(doc(db, 'inventory', 'outlet-seminyak'), snapshot => {
		if (!snapshot.exists()) {
			inventoryError = 'Dokumen inventori outlet-seminyak tidak ditemukan.';
			inventory = null;
		} else {
			inventory = snapshot.data();
			inventoryError = '';
		}
		render();
	}, error => {
		console.error('Gagal membaca inventori Giftstock:', error);
		inventoryError = error.message || 'Periksa koneksi atau izin Firestore.';
		render();
	});
}

subscribeRates();
startInventorySubscription();

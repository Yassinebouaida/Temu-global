const db = new Dexie('TemuBatchDB');
db.version(1).stores({ batches: '++id,name,date,totalCost,totalProfit', orders: '++id,batchId,customerName,phone,city,notes,productDesc,purchasePrice,sellingPrice,deliveryCost,status,autoCode,images,createdAt' });
let profitChart = null;

async function loadBatchesToSelect(selectEl, includeAll = true) {
    const batches = await db.batches.toArray();
    selectEl.innerHTML = '';
    if (includeAll) selectEl.innerHTML += '<option value="">كل الدفعات</option>';
    batches.forEach(b => selectEl.innerHTML += `<option value="${b.id}">${b.name} (${new Date(b.date).toLocaleDateString()})</option>`);
}
function getStatusText(s) { return { pending:'تم الطلب', shipping:'في الشحن', arrived:'وصل', sorted:'تم التفريق', delivered:'تم التسليم', cancelled:'ملغي' }[s] || s; }
function statusOptions(current) {
    const all = ['pending','shipping','arrived','sorted','delivered','cancelled'];
    return all.map(s => `<option value="${s}" ${current===s ? 'selected':''}>${getStatusText(s)}</option>`).join('');
}
function renderMiniImages(imagesBlobs) {
    if(!imagesBlobs?.length) return '';
    return imagesBlobs.map(blob => `<img src="${URL.createObjectURL(blob)}" class="preview-img" style="width:45px;height:45px;">`).join('');
}
async function updateStats() {
    const batches = await db.batches.toArray(), orders = await db.orders.toArray();
    const delivered = orders.filter(o => o.status === 'delivered');
    const totalProfit = orders.reduce((s,o) => s + (o.sellingPrice - o.purchasePrice - (o.deliveryCost||0)), 0);
    document.getElementById('stat-batches').innerText = batches.length;
    document.getElementById('stat-orders').innerText = orders.length;
    document.getElementById('stat-delivered').innerText = delivered.length;
    document.getElementById('stat-profit').innerText = totalProfit.toFixed(2);
    const recent = batches.slice(-3).reverse();
    document.getElementById('recent-batches-list').innerHTML = recent.map(b => `<div class="batch-card">${b.name} - التكلفة: ${b.totalCost||0} د.ل - الربح: ${b.totalProfit||0}</div>`).join('');
}
async function updateMonthlyStats() {
    const orders = await db.orders.toArray();
    const now = new Date(), currentMonth = now.getMonth(), currentYear = now.getFullYear();
    let monthProfit = 0, monthOrders = 0, custCount = {};
    orders.forEach(o => {
        if(o.createdAt) {
            const d = new Date(o.createdAt);
            if(d.getMonth()===currentMonth && d.getFullYear()===currentYear) {
                monthProfit += (o.sellingPrice - o.purchasePrice - (o.deliveryCost||0));
                monthOrders++;
                custCount[o.customerName] = (custCount[o.customerName]||0)+1;
            }
        }
    });
    let top = '-', max=0;
    for(let [n,c] of Object.entries(custCount)) if(c>max) { max=c; top=n; }
    document.getElementById('monthProfit').innerText = monthProfit.toFixed(2);
    document.getElementById('monthOrders').innerText = monthOrders;
    document.getElementById('topCustomer').innerText = top;
}
async function updateProfitChart() {
    const orders = await db.orders.toArray();
    const months = [], profits = [];
    const now = new Date();
    for(let i=5; i>=0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
        months.push(d.toLocaleString('ar',{month:'short'}));
        let p=0;
        orders.forEach(o => {
            if(o.createdAt && new Date(o.createdAt).getMonth()===d.getMonth() && new Date(o.createdAt).getFullYear()===d.getFullYear())
                p += (o.sellingPrice - o.purchasePrice - (o.deliveryCost||0));
        });
        profits.push(p);
    }
    const ctx = document.getElementById('monthlyProfitChart').getContext('2d');
    if(profitChart) profitChart.destroy();
    profitChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: months, datasets: [{ label: 'الربح (دينار)', data: profits, backgroundColor: 'rgba(44,62,102,0.8)', borderRadius: 12 }] },
        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'top' } } }
    });
}
async function renderBatches() {
    const batches = await db.batches.toArray();
    if(!batches.length) { document.getElementById('batches-list').innerHTML = '<p>لا توجد دفعات</p>'; return; }
    let html = '';
    for(let b of batches) {
        const orders = await db.orders.where('batchId').equals(b.id).toArray();
        const totalCost = orders.reduce((s,o)=>s+o.purchasePrice,0);
        const totalProfit = orders.reduce((s,o)=>s+(o.sellingPrice-o.purchasePrice-(o.deliveryCost||0)),0);
        await db.batches.update(b.id, { totalCost, totalProfit });
        html += `<div class="batch-card"><strong>${b.name}</strong> - ${new Date(b.date).toLocaleDateString()}<br>التكلفة: ${totalCost} د.ل | الربح: ${totalProfit} د.ل<br>عدد الطلبات: ${orders.length}<br><button class="small-btn-3d delete-batch" data-id="${b.id}">حذف</button></div>`;
    }
    document.getElementById('batches-list').innerHTML = html;
    document.querySelectorAll('.delete-batch').forEach(btn => btn.addEventListener('click', async (e) => {
        if(confirm('حذف الدفعة سيحذف جميع طلباتها؟')) {
            let id = parseInt(btn.dataset.id);
            await db.orders.where('batchId').equals(id).delete();
            await db.batches.delete(id);
            renderBatches(); loadBatchesToSelect(document.getElementById('orderBatch'),false); loadBatchesToSelect(document.getElementById('filterBatch')); loadBatchesToSelect(document.getElementById('sortingBatchSelect')); updateStats(); updateProfitChart(); updateMonthlyStats();
        }
    }));
}
async function renderOrders(fBatch='', fStatus='', fCustomer='') {
    let orders = await db.orders.toArray();
    if(fBatch) orders = orders.filter(o => o.batchId == fBatch);
    if(fStatus) orders = orders.filter(o => o.status === fStatus);
    if(fCustomer) orders = orders.filter(o => o.customerName.includes(fCustomer));
    if(!orders.length) { document.getElementById('orders-list-container').innerHTML = '<p>لا توجد طلبات</p>'; return; }
    let html = '';
    for(let o of orders) {
        let profit = o.sellingPrice - o.purchasePrice - (o.deliveryCost||0);
        html += `<div class="order-card">
            <div style="display:flex; justify-content:space-between;"><span class="order-code">${o.autoCode}</span><span class="order-status status-${o.status}">${getStatusText(o.status)}</span></div>
            <div><strong>${o.customerName}</strong> - ${o.city||''} - ${o.phone||''}</div>
            <div>المنتج: ${o.productDesc.substring(0,50)}</div>
            <div>الشراء: ${o.purchasePrice} | البيع: ${o.sellingPrice} | التوصيل: ${o.deliveryCost} | الربح: ${profit}</div>
            <div class="order-images-mini">${renderMiniImages(o.images)}</div>
            <div><select class="status-update" data-id="${o.id}">${statusOptions(o.status)}</select>
            <button class="small-btn-3d copy-wa" data-name="${o.customerName}" data-code="${o.autoCode}" data-phone="${o.phone}">نسخ واتساب</button>
            <button class="small-btn-3d delete-order" data-id="${o.id}">حذف</button></div>
        </div>`;
    }
    document.getElementById('orders-list-container').innerHTML = html;
    document.querySelectorAll('.status-update').forEach(sel => sel.addEventListener('change', async (e) => { await db.orders.update(parseInt(sel.dataset.id), { status: sel.value }); renderOrders(fBatch,fStatus,fCustomer); updateStats(); updateProfitChart(); updateMonthlyStats(); }));
    document.querySelectorAll('.delete-order').forEach(btn => btn.addEventListener('click', async (e) => { if(confirm('حذف الطلب؟')) { await db.orders.delete(parseInt(btn.dataset.id)); renderOrders(fBatch,fStatus,fCustomer); updateStats(); renderBatches(); updateProfitChart(); updateMonthlyStats(); } }));
    document.querySelectorAll('.copy-wa').forEach(btn => btn.addEventListener('click', () => { navigator.clipboard.writeText(`السلام عليكم ${btn.dataset.name}، رقم طلبك: ${btn.dataset.code}، تم تجهيز طلبك. للاستفسار: ${btn.dataset.phone}`); alert('تم نسخ الرسالة'); }));
}
async function renderSortingOrders() {
    let batchId = document.getElementById('sortingBatchSelect').value;
    if(!batchId) { document.getElementById('sortingOrdersList').innerHTML = '<p>اختر دفعة</p>'; return; }
    let orders = await db.orders.where('batchId').equals(parseInt(batchId)).toArray();
    if(!orders.length) { document.getElementById('sortingOrdersList').innerHTML = '<p>لا توجد طلبات</p>'; return; }
    let html = '';
    for(let o of orders) {
        let profit = o.sellingPrice - o.purchasePrice - (o.deliveryCost||0);
        html += `<div class="sorting-order-item" style="border-right:4px solid ${o.status==='sorted'?'#28a745':'#2c3e66'}">
            <div><strong>${o.autoCode}</strong> - ${o.customerName} - ${o.city}</div>
            <div>${o.productDesc}</div><div class="order-images-mini">${renderMiniImages(o.images)}</div><div>الربح: ${profit}</div>
            ${o.status !== 'sorted' ? `<button class="btn-primary-3d mark-sorted" data-id="${o.id}">تم التفريق</button>` : '<span style="background:#28a745; padding:4px 12px; border-radius:40px;">تم التفريق ✓</span>'}
        </div>`;
    }
    document.getElementById('sortingOrdersList').innerHTML = html;
    document.querySelectorAll('.mark-sorted').forEach(btn => btn.addEventListener('click', async (e) => { await db.orders.update(parseInt(btn.dataset.id), { status: 'sorted' }); renderSortingOrders(); updateStats(); updateProfitChart(); updateMonthlyStats(); }));
}
document.getElementById('orderForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    let batchId = parseInt(document.getElementById('orderBatch').value);
    if(!batchId) { alert('اختر دفعة'); return; }
    let customerName = document.getElementById('customerName').value;
    let phone = document.getElementById('customerPhone').value;
    let city = document.getElementById('customerCity').value;
    let notes = document.getElementById('customerNotes').value;
    let productDesc = document.getElementById('productDesc').value;
    let purchasePrice = parseFloat(document.getElementById('purchasePrice').value);
    let sellingPrice = parseFloat(document.getElementById('sellingPrice').value);
    let deliveryCost = parseFloat(document.getElementById('deliveryCost').value) || 0;
    let count = await db.orders.where('batchId').equals(batchId).count();
    let autoCode = `B${batchId}-C${count+1}`;
    let files = document.getElementById('orderImages').files;
    let imageBlobs = [];
    for(let i=0; i<Math.min(files.length,5); i++) {
        let blob = await new Promise(resolve => { let r = new FileReader(); r.onload = e => fetch(e.target.result).then(r=>r.blob()).then(resolve); r.readAsDataURL(files[i]); });
        imageBlobs.push(blob);
    }
    await db.orders.add({ batchId, customerName, phone, city, notes, productDesc, purchasePrice, sellingPrice, deliveryCost, status: 'pending', autoCode, images: imageBlobs, createdAt: new Date() });
    alert('تم إضافة الطلب');
    document.getElementById('orderForm').reset();
    document.getElementById('imagePreviewContainer').innerHTML = '';
    renderOrders(); updateStats(); renderBatches(); updateProfitChart(); updateMonthlyStats();
});
document.getElementById('orderImages')?.addEventListener('change', (e) => {
    let preview = document.getElementById('imagePreviewContainer');
    preview.innerHTML = '';
    Array.from(e.target.files).slice(0,5).forEach(f => { let r = new FileReader(); r.onload = ev => { let img = document.createElement('img'); img.src = ev.target.result; img.classList.add('preview-img'); preview.appendChild(img); }; r.readAsDataURL(f); });
});
document.addEventListener('click', (e) => { if(e.target.classList.contains('preview-img')) { document.getElementById('modalImage').src = e.target.src; document.getElementById('imageModal').style.display = 'flex'; } });
document.querySelector('.close-modal')?.addEventListener('click', () => document.getElementById('imageModal').style.display = 'none');
document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
    let pageId = btn.dataset.page + '-page';
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if(pageId === 'batches-page') renderBatches();
    if(pageId === 'orders-page') renderOrders();
    if(pageId === 'sorting-page') renderSortingOrders();
    if(pageId === 'dashboard-page') { updateStats(); updateProfitChart(); updateMonthlyStats(); }
    if(pageId === 'add-order-page') loadBatchesToSelect(document.getElementById('orderBatch'), false);
}));
async function initFilters() {
    await loadBatchesToSelect(document.getElementById('filterBatch'));
    document.getElementById('filterBatch').addEventListener('change', () => renderOrders(document.getElementById('filterBatch').value, document.getElementById('filterStatus').value, document.getElementById('filterCustomer').value));
    document.getElementById('filterStatus').addEventListener('change', () => renderOrders(document.getElementById('filterBatch').value, document.getElementById('filterStatus').value, document.getElementById('filterCustomer').value));
    document.getElementById('filterCustomer').addEventListener('input', () => renderOrders(document.getElementById('filterBatch').value, document.getElementById('filterStatus').value, document.getElementById('filterCustomer').value));
    document.getElementById('clearFilters')?.addEventListener('click', () => { document.getElementById('filterBatch').value = ''; document.getElementById('filterStatus').value = ''; document.getElementById('filterCustomer').value = ''; renderOrders('','',''); });
}
(async function init() {
    await initFilters();
    await loadBatchesToSelect(document.getElementById('orderBatch'), false);
    await loadBatchesToSelect(document.getElementById('sortingBatchSelect'), false);
    document.getElementById('sortingBatchSelect').addEventListener('change', renderSortingOrders);
    document.getElementById('newBatchBtn')?.addEventListener('click', async () => { let name = prompt('اسم الدفعة'); if(name) { await db.batches.add({ name, date: new Date(), totalCost:0, totalProfit:0 }); renderBatches(); loadBatchesToSelect(document.getElementById('orderBatch'),false); loadBatchesToSelect(document.getElementById('filterBatch')); loadBatchesToSelect(document.getElementById('sortingBatchSelect')); updateStats(); } });
    await renderBatches(); await renderOrders(); await updateStats(); await updateProfitChart(); await updateMonthlyStats();
    if(window.matchMedia('(prefers-color-scheme: dark)').matches) document.body.classList.add('dark');
})();

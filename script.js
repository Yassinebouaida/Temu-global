// === التهيئة ===
const db = new Dexie('TemuBatchDB');
db.version(1).stores({
    batches: '++id, name, date, totalCost, totalProfit',
    orders: '++id, batchId, customerName, phone, city, notes, productDesc, purchasePrice, sellingPrice, deliveryCost, status, autoCode, images, createdAt'
});

let profitChart = null;
const imageUrlsMap = new Map();
let currentPage = 1;
const ITEMS_PER_PAGE = 20;
let searchTimeout;

// === أدوات الأمان ===
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// === إدارة الذاكرة ===
function createTrackedObjectURL(blob, orderId) {
    const url = URL.createObjectURL(blob);
    if (!imageUrlsMap.has(orderId)) imageUrlsMap.set(orderId, []);
    imageUrlsMap.get(orderId).push(url);
    return url;
}

function revokeOrderImageUrls(orderId) {
    if (imageUrlsMap.has(orderId)) {
        imageUrlsMap.get(orderId).forEach(url => URL.revokeObjectURL(url));
        imageUrlsMap.delete(orderId);
    }
}

// === الإشعارات ===
function showNotification(message, type = 'success') {
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => {
        notif.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

// === التحميل ===
async function loadBatchesToSelect(selectEl, includeAll = true) {
    try {
        const batches = await db.batches.toArray();
        selectEl.innerHTML = includeAll ? '<option value="">كل الدفعات</option>' : '';
        batches.forEach(b => {
            selectEl.innerHTML += `<option value="${b.id}">${escapeHtml(b.name)} (${new Date(b.date).toLocaleDateString()})</option>`;
        });
    } catch (error) {
        showNotification('خطأ في تحميل الدفعات', 'error');
    }
}

function getStatusText(s) {
    const map = { 
        'pending':'تم الطلب', 'shipping':'في الشحن', 'arrived':'وصل',
        'sorted':'تم التفريق', 'delivered':'تم التسليم', 'cancelled':'ملغي' 
    };
    return map[s] || s;
}

function statusOptions(current) {
    const all = ['pending','shipping','arrived','sorted','delivered','cancelled'];
    return all.map(s => `<option value="${s}" ${current===s?'selected':''}>${getStatusText(s)}</option>`).join('');
}

function renderMiniImages(imagesBlobs, orderId) {
    if (!imagesBlobs?.length) return '';
    revokeOrderImageUrls(orderId);
    return imagesBlobs.map((blob, idx) => {
        const url = createTrackedObjectURL(blob, orderId);
        return `<img src="${url}" class="preview-img" style="width:45px;height:45px;" onclick="openImageModal('${url}')">`;
    }).join('');
}

// === الإحصائيات ===
async function updateStats() {
    try {
        const [batches, orders] = await Promise.all([db.batches.toArray(), db.orders.toArray()]);
        const delivered = orders.filter(o => o.status === 'delivered');
        const totalProfit = orders.reduce((sum, o) => sum + (o.sellingPrice - o.purchasePrice - (o.deliveryCost||0)), 0);
        
        document.getElementById('stat-batches').textContent = batches.length;
        document.getElementById('stat-orders').textContent = orders.length;
        document.getElementById('stat-delivered').textContent = delivered.length;
        document.getElementById('stat-profit').textContent = totalProfit.toFixed(2);
        
        const recent = batches.slice(-3).reverse();
        const container = document.getElementById('recent-batches-list');
        if (container) {
            container.innerHTML = recent.map(b => 
                `<div class="batch-card">${escapeHtml(b.name)} - التكلفة: ${b.totalCost||0} د.ل</div>`
            ).join('');
        }
    } catch (error) {
        console.error('Stats error:', error);
    }
}

async function updateMonthlyStats() {
    try {
        const orders = await db.orders.toArray();
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        let monthProfit = 0, monthOrders = 0;
        const customerCount = {};
        
        orders.forEach(o => {
            if (!o.createdAt) return;
            const d = new Date(o.createdAt);
            if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
                monthProfit += (o.sellingPrice - o.purchasePrice - (o.deliveryCost||0));
                monthOrders++;
                customerCount[o.customerName] = (customerCount[o.customerName]||0) + 1;
            }
        });
        
        let topCustomer = Object.entries(customerCount).sort((a,b) => b[1]-a[1])[0]?.[0] || '-';
        
        document.getElementById('monthProfit').textContent = monthProfit.toFixed(2);
        document.getElementById('monthOrders').textContent = monthOrders;
        document.getElementById('topCustomer').textContent = escapeHtml(topCustomer);
    } catch (error) {
        console.error('Monthly stats error:', error);
    }
}

async function updateProfitChart() {
    try {
        const orders = await db.orders.toArray();
        const months = [], profits = [];
        const now = new Date();
        
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push(d.toLocaleString('ar', {month:'short'}));
            let profit = 0;
            orders.forEach(o => {
                if (!o.createdAt) return;
                const od = new Date(o.createdAt);
                if (od.getMonth() === d.getMonth() && od.getFullYear() === d.getFullYear()) {
                    profit += (o.sellingPrice - o.purchasePrice - (o.deliveryCost||0));
                }
            });
            profits.push(profit);
        }
        
        const ctx = document.getElementById('monthlyProfitChart').getContext('2d');
        if (profitChart) {
            profitChart.data.labels = months;
            profitChart.data.datasets[0].data = profits;
            profitChart.update('none');
        } else {
            profitChart = new Chart(ctx, {
                type: 'bar',
                data: { labels: months, datasets: [{ 
                    label: 'الربح', data: profits, 
                    backgroundColor: 'rgba(44,62,102,0.8)', borderRadius: 12 
                }]},
                options: { responsive: true, maintainAspectRatio: true }
            });
        }
    } catch (error) {
        console.error('Chart error:', error);
    }
}

// === الدفعات ===
async function renderBatches() {
    try {
        const batches = await db.batches.toArray();
        const container = document.getElementById('batches-list');
        if (!container) return;
        
        if (!batches.length) {
            container.innerHTML = '<p>لا توجد دفعات</p>';
            return;
        }
        
        let html = '';
        for (const b of batches) {
            const orders = await db.orders.where('batchId').equals(b.id).toArray();
            const totalCost = orders.reduce((s,o) => s + o.purchasePrice, 0);
            const totalProfit = orders.reduce((s,o) => s + (o.sellingPrice - o.purchasePrice - (o.deliveryCost||0)), 0);
            await db.batches.update(b.id, { totalCost, totalProfit });
            
            html += `<div class="batch-card">
                <div><strong>${escapeHtml(b.name)}</strong> - ${new Date(b.date).toLocaleDateString()}</div>
                <div>التكلفة: ${totalCost} د.ل | الربح: ${totalProfit} د.ل | الطلبات: ${orders.length}</div>
                <button class="small-btn-3d delete-batch" data-id="${b.id}" style="background:#dc3545;color:white;margin-top:8px;">حذف</button>
            </div>`;
        }
        container.innerHTML = html;
        
        document.querySelectorAll('.delete-batch').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.dataset.id);
                if (!confirm('حذف الدفعة سيحذف جميع طلباتها؟')) return;
                
                try {
                    const orders = await db.orders.where('batchId').equals(id).toArray();
                    orders.forEach(o => revokeOrderImageUrls(o.id));
                    await db.orders.where('batchId').equals(id).delete();
                    await db.batches.delete(id);
                    showNotification('تم حذف الدفعة');
                    renderBatches();
                    loadBatchesToSelect(document.getElementById('orderBatch'), false);
                    loadBatchesToSelect(document.getElementById('filterBatch'));
                    updateStats();
                } catch (error) {
                    showNotification('خطأ في الحذف', 'error');
                }
            });
        });
    } catch (error) {
        showNotification('خطأ في تحميل الدفعات', 'error');
    }
}

// === الطلبات مع Pagination ===
async function renderOrders(filterBatch='', filterStatus='', filterCustomer='', page=1) {
    try {
        currentPage = page;
        let orders = await db.orders.toArray();
        
        if (filterBatch) orders = orders.filter(o => o.batchId == filterBatch);
        if (filterStatus) orders = orders.filter(o => o.status === filterStatus);
        if (filterCustomer) orders = orders.filter(o => o.customerName.toLowerCase().includes(filterCustomer.toLowerCase()));
        
        const totalItems = orders.length;
        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
        const start = (page - 1) * ITEMS_PER_PAGE;
        const paginated = orders.slice(start, start + ITEMS_PER_PAGE);
        
        const container = document.getElementById('orders-list-container');
        if (!container) return;
        
        if (!orders.length) {
            container.innerHTML = '<p>لا توجد طلبات</p>';
            return;
        }
        
        let html = '';
        for (const o of paginated) {
            const batch = await db.batches.get(o.batchId);
            const profit = o.sellingPrice - o.purchasePrice - (o.deliveryCost||0);
            const hasImages = o.images?.length > 0;
            
            html += `<div class="order-card" data-id="${o.id}">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <span class="order-code">${escapeHtml(o.autoCode)}</span>
                    <span class="order-status status-${o.status}">${getStatusText(o.status)}</span>
                </div>
                <div><strong>${escapeHtml(o.customerName)}</strong> - ${escapeHtml(o.city||'')} - ${escapeHtml(o.phone||'')}</div>
                <div>المنتج: ${escapeHtml(o.productDesc?.substring(0,50)||'')}...</div>
                <div>الربح: ${profit.toFixed(2)} د.ل</div>
                <div class="order-images-mini">${renderMiniImages(o.images, o.id)}</div>
                <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;">
                    <select class="status-update small-btn-3d" data-id="${o.id}" style="border:1px solid var(--primary);">
                        ${statusOptions(o.status)}
                    </select>
                    <button class="small-btn-3d copy-wa" data-name="${escapeHtml(o.customerName)}" data-code="${escapeHtml(o.autoCode)}" data-phone="${escapeHtml(o.phone||'')}" style="background:#17a2b8;color:white;">
                        <i class="fas fa-copy"></i> واتساب
                    </button>
                    <button class="small-btn-3d add-images-btn" data-id="${o.id}" style="background:#28a745;color:white;">
                        <i class="fas fa-camera"></i> ${hasImages ? 'إضافة صور' : 'أضف صور'}
                    </button>
                    <button class="small-btn-3d delete-order" data-id="${o.id}" style="background:#dc3545;color:white;">
                        <i class="fas fa-trash"></i> حذف
                    </button>
                </div>
            </div>`;
        }
        
        if (totalPages > 1) {
            html += `<div class="pagination">
                ${page > 1 ? `<button class="btn-secondary-3d" onclick="renderOrders('${filterBatch}','${filterStatus}','${filterCustomer}',${page-1})">السابق</button>` : ''}
                <span>صفحة ${page} من ${totalPages}</span>
                ${page < totalPages ? `<button class="btn-secondary-3d" onclick="renderOrders('${filterBatch}','${filterStatus}','${filterCustomer}',${page+1})">التالي</button>` : ''}
            </div>`;
        }
        
        container.innerHTML = html;
        
        document.querySelectorAll('.status-update').forEach(sel => {
            sel.addEventListener('change', async () => {
                try {
                    await db.orders.update(parseInt(sel.dataset.id), {status: sel.value});
                    showNotification('تم تحديث الحالة');
                    renderOrders(filterBatch, filterStatus, filterCustomer, currentPage);
                    updateStats();
                } catch (error) {
                    showNotification('خطأ في التحديث', 'error');
                }
            });
        });
        
        document.querySelectorAll('.copy-wa').forEach(btn => {
            btn.addEventListener('click', () => {
                const msg = `السلام عليكم ${btn.dataset.name}، رقم طلبك: ${btn.dataset.code}`;
                navigator.clipboard.writeText(msg).then(() => showNotification('تم النسخ'));
            });
        });
        
        document.querySelectorAll('.delete-order').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.dataset.id);
                if (!confirm('حذف الطلب؟')) return;
                try {
                    revokeOrderImageUrls(id);
                    await db.orders.delete(id);
                    showNotification('تم الحذف');
                    renderOrders(filterBatch, filterStatus, filterCustomer, currentPage);
                    updateStats();
                } catch (error) {
                    showNotification('خطأ في الحذف', 'error');
                }
            });
        });
        
        document.querySelectorAll('.add-images-btn').forEach(btn => {
            btn.addEventListener('click', () => openAddImagesModal(parseInt(btn.dataset.id)));
        });
        
    } catch (error) {
        showNotification('خطأ في تحميل الطلبات', 'error');
    }
}

// === إضافة صور للطلب الموجود ===
function openAddImagesModal(orderId) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="background:var(--card-bg);padding:24px;border-radius:24px;max-width:90%;width:400px;position:relative;">
            <span class="close-modal" onclick="this.closest('.modal').remove()" style="position:absolute;top:15px;left:20px;font-size:28px;cursor:pointer;">&times;</span>
            <h3><i class="fas fa-camera"></i> إضافة صور للطلب</h3>
            <div class="form-group">
                <label>اختر الصور (حتى 5، 2MB للصورة):</label>
                <input type="file" id="additionalImages" accept="image/*" multiple>
                <div id="additionalImagesPreview" class="image-preview-grid"></div>
            </div>
            <div style="display:flex;gap:10px;margin-top:20px;">
                <button class="btn-primary-3d" onclick="saveAdditionalImages(${orderId})" style="flex:1;">حفظ</button>
                <button class="btn-secondary-3d" onclick="this.closest('.modal').remove()" style="flex:1;">إلغاء</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('additionalImages').addEventListener('change', (e) => {
        const preview = document.getElementById('additionalImagesPreview');
        preview.innerHTML = '';
        Array.from(e.target.files).slice(0,5).forEach(file => {
            if (file.size > 2 * 1024 * 1024) {
                showNotification('الصورة كبيرة جداً (الحد 2MB)', 'error');
                return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = document.createElement('img');
                img.src = ev.target.result;
                img.className = 'preview-img';
                preview.appendChild(img);
            };
            reader.readAsDataURL(file);
        });
    });
}

async function saveAdditionalImages(orderId) {
    const input = document.getElementById('additionalImages');
    if (!input.files?.length) {
        showNotification('اختر صوراً أولاً', 'error');
        return;
    }
    
    try {
        const order = await db.orders.get(orderId);
        if (!order) throw new Error('Order not found');
        
        const existing = order.images || [];
        const remaining = 5 - existing.length;
        
        if (remaining <= 0) {
            showNotification('الحد الأقصى 5 صور', 'error');
            return;
        }
        
        const newBlobs = [];
        for (const file of Array.from(input.files).slice(0, remaining)) {
            if (file.size > 2 * 1024 * 1024) continue;
            const blob = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = (e) => fetch(e.target.result).then(r => r.blob()).then(resolve);
                reader.readAsDataURL(file);
            });
            newBlobs.push(blob);
        }
        
        await db.orders.update(orderId, {images: [...existing, ...newBlobs]});
        showNotification(`تم إضافة ${newBlobs.length} صورة`);
        document.querySelector('.modal').remove();
        renderOrders();
    } catch (error) {
        showNotification('خطأ في الحفظ', 'error');
    }
}

// === التفريق ===
async function renderSortingOrders() {
    try {
        const batchId = document.getElementById('sortingBatchSelect').value;
        if (!batchId) {
            document.getElementById('sortingOrdersList').innerHTML = '<p>اختر دفعة أولاً</p>';
            return;
        }
        
        const orders = await db.orders.where('batchId').equals(parseInt(batchId)).toArray();
        const container = document.getElementById('sortingOrdersList');
        
        if (!orders.length) {
            container.innerHTML = '<p>لا توجد طلبات</p>';
            return;
        }
        
        container.innerHTML = orders.map(o => {
            const profit = o.sellingPrice - o.purchasePrice - (o.deliveryCost||0);
            return `<div class="sorting-order-item" style="border-right:4px solid ${o.status==='sorted'?'#28a745':'#2c3e66'};">
                <div><strong>${escapeHtml(o.autoCode)}</strong> - ${escapeHtml(o.customerName)}</div>
                <div>الربح: ${profit.toFixed(2)} د.ل</div>
                <div class="order-images-mini">${renderMiniImages(o.images, o.id)}</div>
                ${o.status !== 'sorted' 
                    ? `<button class="btn-primary-3d mark-sorted" data-id="${o.id}" style="margin-top:8px;">تم التفريق</button>`
                    : '<span style="background:#28a745;color:white;padding:4px 12px;border-radius:40px;">تم التفريق ✓</span>'}
            </div>`;
        }).join('');
        
        document.querySelectorAll('.mark-sorted').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await db.orders.update(parseInt(btn.dataset.id), {status: 'sorted'});
                    showNotification('تم التحديث');
                    renderSortingOrders();
                    updateStats();
                } catch (error) {
                    showNotification('خطأ', 'error');
                }
            });
        });
    } catch (error) {
        showNotification('خطأ في التفريق', 'error');
    }
}

// === نموذج الطلب ===
document.getElementById('orderForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const batchId = parseInt(document.getElementById('orderBatch').value);
    if (!batchId) {
        showNotification('اختر دفعة', 'error');
        return;
    }
    
    const customerName = document.getElementById('customerName').value.trim();
    const purchasePrice = parseFloat(document.getElementById('purchasePrice').value);
    const sellingPrice = parseFloat(document.getElementById('sellingPrice').value);
    
    if (!customerName || isNaN(purchasePrice) || isNaN(sellingPrice)) {
        showNotification('املأ الحقول المطلوبة', 'error');
        return;
    }
    
    try {
        const count = await db.orders.where('batchId').equals(batchId).count();
        const autoCode = `B${batchId}-C${count+1}`;
        
        const files = document.getElementById('orderImages').files;
        const images = [];
        for (const file of Array.from(files).slice(0,5)) {
            if (file.size > 2 * 1024 * 1024) continue;
            const blob = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = (e) => fetch(e.target.result).then(r => r.blob()).then(resolve);
                reader.readAsDataURL(file);
            });
            images.push(blob);
        }
        
        await db.orders.add({
            batchId, customerName, 
            phone: document.getElementById('customerPhone').value.trim(),
            city: document.getElementById('customerCity').value.trim(),
            notes: document.getElementById('customerNotes').value.trim(),
            productDesc: document.getElementById('productDesc').value.trim(),
            purchasePrice, sellingPrice,
            deliveryCost: parseFloat(document.getElementById('deliveryCost').value) || 0,
            status: 'pending', autoCode, images,
            createdAt: new Date()
        });
        
        showNotification('تم إضافة الطلب');
        document.getElementById('orderForm').reset();
        document.getElementById('imagePreviewContainer').innerHTML = '';
        updateStats();
        renderBatches();
    } catch (error) {
        showNotification('خطأ في الإضافة', 'error');
    }
});

// معاينة الصور
document.getElementById('orderImages')?.addEventListener('change', (e) => {
    const preview = document.getElementById('imagePreviewContainer');
    preview.innerHTML = '';
    Array.from(e.target.files).slice(0,5).forEach(file => {
        if (file.size > 2 * 1024 * 1024) {
            showNotification('صورة كبيرة جداً (2MB max)', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = document.createElement('img');
            img.src = ev.target.result;
            img.className = 'preview-img';
            preview.appendChild(img);
        };
        reader.readAsDataURL(file);
    });
});

// تكبير الصورة
window.openImageModal = function(url) {
    const modal = document.getElementById('imageModal');
    document.getElementById('modalImage').src = url;
    modal.style.display = 'flex';
};

document.querySelector('.close-modal')?.addEventListener('click', () => {
    document.getElementById('imageModal').style.display = 'none';
});

// === التنقل ===
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const pageId = btn.dataset.page + '-page';
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(pageId).classList.add('active');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        if (pageId === 'batches-page') renderBatches();
        if (pageId === 'orders-page') renderOrders();
        if (pageId === 'sorting-page') renderSortingOrders();
        if (pageId === 'dashboard-page') { updateStats(); updateProfitChart(); updateMonthlyStats(); }
        if (pageId === 'add-order-page') loadBatchesToSelect(document.getElementById('orderBatch'), false);
    });
});

// === الفلاتر ===
async function initFilters() {
    await loadBatchesToSelect(document.getElementById('filterBatch'));
    
    const applyFilters = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentPage = 1;
            renderOrders(
                document.getElementById('filterBatch').value,
                document.getElementById('filterStatus').value,
                document.getElementById('filterCustomer').value,
                1
            );
        }, 300);
    };
    
    document.getElementById('filterBatch')?.addEventListener('change', applyFilters);
    document.getElementById('filterStatus')?.addEventListener('change', applyFilters);
    document.getElementById('filterCustomer')?.addEventListener('input', applyFilters);
    document.getElementById('clearFilters')?.addEventListener('click', () => {
        document.getElementById('filterBatch').value = '';
        document.getElementById('filterStatus').value = '';
        document.getElementById('filterCustomer').value = '';
        renderOrders('', '', '', 1);
    });
}

// === التهيئة ===
(async function init() {
    try {
        await initFilters();
        await loadBatchesToSelect(document.getElementById('orderBatch'), false);
        await loadBatchesToSelect(document.getElementById('sortingBatchSelect'), false);
        
        document.getElementById('sortingBatchSelect')?.addEventListener('change', renderSortingOrders);
        
        document.getElementById('newBatchBtn')?.addEventListener('click', async () => {
            const name = prompt('اسم الدفعة:')?.trim();
            if (!name) return;
            try {
                await db.batches.add({name, date: new Date(), totalCost: 0, totalProfit: 0});
                showNotification('تم إنشاء الدفعة');
                renderBatches();
                loadBatchesToSelect(document.getElementById('orderBatch'), false);
                loadBatchesToSelect(document.getElementById('filterBatch'));
            } catch (error) {
                showNotification('خطأ', 'error');
            }
        });
        
        await renderBatches();
        await renderOrders();
        await updateStats();
        await updateProfitChart();
        await updateMonthlyStats();
        
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.body.classList.add('dark');
        }
        
    } catch (error) {
        console.error('Init error:', error);
    }
})();

// تحذير قبل المغادرة
let formDirty = false;
document.getElementById('orderForm')?.addEventListener('input', () => formDirty = true);
document.getElementById('orderForm')?.addEventListener('submit', () => formDirty = false);
window.addEventListener('beforeunload', (e) => {
    if (formDirty) {
        e.preventDefault();
        e.returnValue = '';
    }
});

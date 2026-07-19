// 착착 (Chak-Chak) — Quick Preset Switcher with Folders
const extensionName = 'chak-chak';
const settingsKey = 'chak_chak';

const defaultSettings = { enabled: true, favorites: [], folders: {} };

function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[settingsKey]) ctx.extensionSettings[settingsKey] = structuredClone(defaultSettings);
    const s = ctx.extensionSettings[settingsKey];
    if (!s.folders) s.folders = {};
    return s;
}
function saveSettings() { SillyTavern.getContext().saveSettingsDebounced(); }

// ── Color: CSS 변수 읽고 반투명이면 흰색 위에 합성 ──

function parseRGBA(cssColor) {
    const tmp = document.createElement('div');
    tmp.style.backgroundColor = cssColor;
    document.body.appendChild(tmp);
    const c = getComputedStyle(tmp).backgroundColor;
    tmp.remove();
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
}

function compositeOnWhite(cssColor) {
    const c = parseRGBA(cssColor);
    if (!c) return '#f0e8ea';
    if (c.a >= 0.99) return `rgb(${c.r},${c.g},${c.b})`;
    const r = Math.round(c.r * c.a + 255 * (1 - c.a));
    const g = Math.round(c.g * c.a + 255 * (1 - c.a));
    const b = Math.round(c.b * c.a + 255 * (1 - c.a));
    return `rgb(${r},${g},${b})`;
}

function forceOpaque(cssColor) {
    const c = parseRGBA(cssColor);
    if (!c) return '#333';
    return `rgb(${c.r},${c.g},${c.b})`;
}

function readSTVar(varName) {
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const val = getComputedStyle(probe).getPropertyValue(varName).trim();
    probe.remove();
    return val;
}

function getTheme() {
    const bgRaw = readSTVar('--SmartThemeBlurTintColor') || 'rgba(240,232,234,1)';
    const textRaw = readSTVar('--SmartThemeBodyColor') || '#333';
    const borderRaw = readSTVar('--SmartThemeBorderColor') || '#ccc';
    const accentRaw = readSTVar('--SmartThemeQuoteColor') || '#5e8ad4';
    return {
        bg: compositeOnWhite(bgRaw),
        text: forceOpaque(textRaw),
        border: forceOpaque(borderRaw),
        accent: forceOpaque(accentRaw),
    };
}

function applyTheme(el) {
    const t = getTheme();
    el.style.backgroundColor = t.bg;
    el.style.color = t.text;
    el.style.borderColor = t.border;
    el.querySelectorAll('.chak-current-name').forEach(n => n.style.color = t.accent);
    el.querySelectorAll('.chak-divider').forEach(n => n.style.backgroundColor = t.border);
    el.querySelectorAll('.chak-section-label, .chak-folder-header, .chak-panel-title, .chak-panel-close, .chak-folder-add').forEach(n => n.style.color = t.text);
    return t;
}

// ── Preset selector ──

const SELECTOR_MAP = {
    openai: '#settings_preset_openai',
    textgenerationwebui: '#settings_preset_textgenerationwebui',
    novel: '#settings_preset_novel',
    kobold: '#settings_preset',
};
function getMainApi() { return window.main_api ?? document.getElementById('main_api')?.value ?? 'openai'; }
function getPresetSelector() {
    const id = SELECTOR_MAP[getMainApi()];
    if (id) { const el = document.querySelector(id); if (el) return el; }
    for (const id of Object.values(SELECTOR_MAP)) { const el = document.querySelector(id); if (el?.options?.length > 0) return el; }
    return null;
}
function getCurrentPresetName() { const s = getPresetSelector(); return (s && s.selectedIndex >= 0) ? s.options[s.selectedIndex].text : '(없음)'; }
function getPresetList() {
    const s = getPresetSelector();
    return s ? Array.from(s.options).map(o => ({ value: o.value, name: o.text, selected: o.selected })) : [];
}
function switchPreset(value) {
    const s = getPresetSelector(); if (!s) return;
    s.value = value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    renderPresetList(); updateCurrentLabel();
    showToast(s.options[s.selectedIndex]?.text ?? value);
}

function showToast(name) {
    document.querySelector('.chak-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'chak-toast';
    toast.textContent = `착! → ${name}`;
    const t = getTheme();
    toast.style.backgroundColor = t.bg;
    toast.style.color = t.text;
    toast.style.borderColor = t.border;
    document.documentElement.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('chak-toast--visible'));
    setTimeout(() => { toast.classList.remove('chak-toast--visible'); setTimeout(() => toast.remove(), 300); }, 1500);
}

// ── Favorites & Folders ──
function isFavorite(v) { return getSettings().favorites.includes(v); }
function toggleFavorite(v) {
    const s = getSettings(); const i = s.favorites.indexOf(v);
    if (i >= 0) s.favorites.splice(i, 1); else s.favorites.push(v);
    saveSettings(); renderPresetList();
}
function getFolders() { return getSettings().folders; }
function addFolder(name) { const s = getSettings(); if (!s.folders[name]) { s.folders[name] = []; saveSettings(); } }
function removeFolder(name) { delete getSettings().folders[name]; saveSettings(); }
function renameFolder(oldName, newName) {
    const s = getSettings();
    if (s.folders[newName]) return; // 이미 존재하면 무시
    s.folders[newName] = s.folders[oldName] || [];
    delete s.folders[oldName];
    saveSettings();
}
function addToFolder(f, v) { const s = getSettings(); if (!s.folders[f]) s.folders[f] = []; if (!s.folders[f].includes(v)) { s.folders[f].push(v); saveSettings(); } }
function removeFromFolder(f, v) { const s = getSettings(); if (s.folders[f]) { s.folders[f] = s.folders[f].filter(x => x !== v); saveSettings(); } }

// ── UI ──
let panelEl = null, backdropEl = null, fabEl = null;

function buildUI() {
    fabEl = document.createElement('div');
    fabEl.id = 'chak-fab';
    fabEl.innerHTML = '<span class="chak-fab-icon">⚡</span>';
    fabEl.title = '착착 — 프리셋 전환';
    fabEl.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
    if (!injectFab()) document.documentElement.appendChild(fabEl);

    // Backdrop — 투명 클릭 캐쳐 + flexbox 센터링
    backdropEl = document.createElement('div');
    backdropEl.id = 'chak-backdrop';
    backdropEl.classList.add('chak-backdrop--hidden');
    backdropEl.addEventListener('click', (e) => { if (e.target === backdropEl) closePanel(); });

    panelEl = document.createElement('div');
    panelEl.id = 'chak-panel';
    panelEl.innerHTML = `
        <div class="chak-panel-header">
            <span class="chak-panel-title">착착 ⚡</span>
            <div class="chak-header-actions">
                <span class="chak-folder-add" title="새 폴더">📁+</span>
                <span class="chak-panel-close" title="닫기">✕</span>
            </div>
        </div>
        <div class="chak-current">현재: <strong class="chak-current-name"></strong></div>
        <div class="chak-divider"></div>
        <div class="chak-list-section">
            <div class="chak-list chak-list--folders"></div>
            <div class="chak-list chak-list--favorites"></div>
            <div class="chak-section-label">전체 프리셋</div>
            <div class="chak-list chak-list--all"></div>
        </div>`;
    panelEl.querySelector('.chak-panel-close').addEventListener('click', closePanel);
    panelEl.querySelector('.chak-folder-add').addEventListener('click', () => {
        const n = prompt('폴더 이름:'); if (n?.trim()) { addFolder(n.trim()); renderPresetList(); }
    });

    backdropEl.appendChild(panelEl);
    document.documentElement.appendChild(backdropEl);

    document.addEventListener('click', (e) => {
        if (!panelEl.contains(e.target) && !fabEl.contains(e.target) && !backdropEl.contains(e.target))
            if (!backdropEl.classList.contains('chak-backdrop--hidden')) closePanel();
    });
}

function injectFab() {
    for (const sel of ['#leftSendForm', '#rightSendForm', '#send_form .panelControlBar', '#send_form']) {
        const c = document.querySelector(sel); if (c) { c.appendChild(fabEl); return true; }
    }
    return false;
}

function togglePanel() { backdropEl.classList.contains('chak-backdrop--hidden') ? openPanel() : closePanel(); }
function openPanel() {
    renderPresetList(); updateCurrentLabel(); applyTheme(panelEl);
    backdropEl.classList.remove('chak-backdrop--hidden');
    fabEl.classList.add('chak-fab--active');
}
function closePanel() { backdropEl.classList.add('chak-backdrop--hidden'); fabEl.classList.remove('chak-fab--active'); }
function updateCurrentLabel() {
    const l = panelEl.querySelector('.chak-current-name');
    if (l) { l.textContent = getCurrentPresetName(); l.style.color = getTheme().accent; }
}

function renderPresetList() {
    const presets = getPresetList(), settings = getSettings(), t = getTheme();
    const foldersC = panelEl.querySelector('.chak-list--folders');
    const favC = panelEl.querySelector('.chak-list--favorites');
    const allC = panelEl.querySelector('.chak-list--all');

    foldersC.innerHTML = '';
    for (const [fname, members] of Object.entries(getFolders())) {
        const fe = document.createElement('div'); fe.className = 'chak-folder';
        const hd = document.createElement('div'); hd.className = 'chak-folder-header'; hd.style.color = t.text;
        hd.innerHTML = `<span class="chak-folder-name">📁 ${fname}</span><span class="chak-folder-actions"><span class="chak-folder-rename" title="이름 변경">✏️</span><span class="chak-folder-del" title="폴더 삭제">✕</span></span>`;
        hd.querySelector('.chak-folder-del').addEventListener('click', (e) => {
            e.stopPropagation(); if (confirm(`"${fname}" 삭제?`)) { removeFolder(fname); renderPresetList(); }
        });
        hd.querySelector('.chak-folder-rename').addEventListener('click', (e) => {
            e.stopPropagation();
            const newName = prompt('새 폴더 이름:', fname);
            if (newName && newName.trim() && newName.trim() !== fname) { renameFolder(fname, newName.trim()); renderPresetList(); }
        });
        const ct = document.createElement('div'); ct.className = 'chak-folder-content';
        let open = true;
        hd.addEventListener('click', (e) => { if (e.target === hd || e.target.classList.contains('chak-folder-name')) { open = !open; ct.style.display = open ? '' : 'none'; } });
        presets.filter(p => members.includes(p.value)).forEach(p => ct.appendChild(createItem(p, t, false, fname)));
        fe.appendChild(hd); fe.appendChild(ct); foldersC.appendChild(fe);
    }

    favC.innerHTML = '';
    const favs = presets.filter(p => settings.favorites.includes(p.value));
    if (favs.length) {
        const lb = document.createElement('div'); lb.className = 'chak-section-label'; lb.textContent = '⭐ 즐겨찾기'; lb.style.color = t.text;
        favC.appendChild(lb);
        favs.forEach(p => favC.appendChild(createItem(p, t, true, null)));
    }

    allC.innerHTML = '';
    presets.forEach(p => allC.appendChild(createItem(p, t, false, null)));
}

function createItem(preset, t, isFav, folder) {
    const item = document.createElement('div');
    item.className = 'chak-item' + (preset.selected ? ' chak-item--active' : '');
    const nm = document.createElement('span'); nm.className = 'chak-item-name';
    nm.textContent = preset.name; nm.style.color = preset.selected ? t.accent : t.text;
    const acts = document.createElement('span'); acts.className = 'chak-item-actions';

    const star = document.createElement('span');
    star.className = 'chak-item-star' + (isFavorite(preset.value) ? ' chak-item-star--on' : '');
    star.textContent = isFavorite(preset.value) ? '★' : '☆';
    star.style.color = isFavorite(preset.value) ? '#f0c040' : t.text;
    star.addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(preset.value); });
    acts.appendChild(star);

    if (!folder && Object.keys(getFolders()).length > 0) {
        const fb = document.createElement('span'); fb.className = 'chak-item-folder-btn';
        fb.textContent = '📁'; fb.title = '폴더에 추가';
        fb.addEventListener('click', (e) => {
            e.stopPropagation();
            showFolderPicker(fb, preset.value, t);
        });
        acts.appendChild(fb);
    }
    if (folder) {
        const rb = document.createElement('span'); rb.className = 'chak-item-folder-btn';
        rb.textContent = '✕'; rb.title = '폴더에서 제거';
        rb.addEventListener('click', (e) => { e.stopPropagation(); removeFromFolder(folder, preset.value); renderPresetList(); });
        acts.appendChild(rb);
    }

    item.appendChild(nm); item.appendChild(acts);
    item.addEventListener('click', () => switchPreset(preset.value));
    return item;
}

function showFolderPicker(anchorEl, presetValue, t) {
    // Remove any existing picker
    document.querySelector('.chak-folder-picker')?.remove();

    const picker = document.createElement('div');
    picker.className = 'chak-folder-picker';
    picker.style.backgroundColor = t.bg;
    picker.style.borderColor = t.border;
    picker.style.color = t.text;

    const names = Object.keys(getFolders());
    names.forEach(name => {
        const opt = document.createElement('div');
        opt.className = 'chak-folder-picker-item';
        opt.textContent = `📁 ${name}`;
        opt.style.color = t.text;
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            addToFolder(name, presetValue);
            picker.remove();
            renderPresetList();
        });
        picker.appendChild(opt);
    });

    // Position: CSS handles centering
    panelEl.appendChild(picker);

    // Close on outside click
    const closePicker = (e) => {
        if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', closePicker, true); }
    };
    setTimeout(() => document.addEventListener('click', closePicker, true), 0);
}

// ── Settings ──
function buildSettingsUI() {
    const html = `<div class="chak-settings"><div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header"><b>착착 ⚡ Chak-Chak</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content"><label class="checkbox_label"><input type="checkbox" id="chak_enabled" /><span>활성화</span></label>
        <p class="chak-settings-desc">채팅 옆 ⚡ 버튼으로 프리셋을 빠르게 전환합니다.</p></div></div></div>`;
    document.getElementById('extensions_settings2').insertAdjacentHTML('beforeend', html);
    const cb = document.getElementById('chak_enabled');
    cb.checked = getSettings().enabled;
    cb.addEventListener('change', () => { getSettings().enabled = cb.checked; saveSettings(); updateVisibility(); });
}
function updateVisibility() { if (fabEl) fabEl.style.display = getSettings().enabled ? '' : 'none'; if (!getSettings().enabled) closePanel(); }

(function init() {
    buildSettingsUI(); buildUI(); updateVisibility();
    const obs = new MutationObserver(() => { if (!backdropEl.classList.contains('chak-backdrop--hidden')) { renderPresetList(); updateCurrentLabel(); } });
    for (const id of Object.values(SELECTOR_MAP)) { const el = document.querySelector(id); if (el) obs.observe(el, { childList: true, attributes: true }); }
})();

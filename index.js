// 착착 (Chak-Chak) — Quick Preset Switcher with Folders
const extensionName = 'chak-chak';
const settingsKey = 'chak_chak';

let _lastUserSelectTouch = 0;
let _lastTouchSource = 'none';
let _lastDecision = null;

const defaultTopbar = { enabled: true, showProfile: true, showPreset: true, icons: true, presetRatio: 1.3 };
const defaultSettings = { enabled: true, favorites: [], folders: {}, folderOpenState: {}, recentPresets: [], recentOpen: true, showFab: true, topbar: structuredClone(defaultTopbar) };

function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[settingsKey]) ctx.extensionSettings[settingsKey] = structuredClone(defaultSettings);
    const s = ctx.extensionSettings[settingsKey];
    if (!s.folders) s.folders = {};
    if (!s.folderOpenState) s.folderOpenState = {};
    if (!s.recentPresets) s.recentPresets = [];
    if (s.recentOpen === undefined) s.recentOpen = true;
    if (s.showFab === undefined) s.showFab = true;
    if (!s.topbar) s.topbar = structuredClone(defaultTopbar);
    delete s.topbar.autoSaveProfile;
    delete s.autoSaveProfile;
    for (const [k, v] of Object.entries(defaultTopbar)) {
        if (s.topbar[k] === undefined) s.topbar[k] = v;
    }
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

let _themeCache = null;
function getTheme(forceRefresh) {
    if (_themeCache && !forceRefresh) return _themeCache;
    const bgRaw = readSTVar('--SmartThemeBlurTintColor') || 'rgba(240,232,234,1)';
    const textRaw = readSTVar('--SmartThemeBodyColor') || '#333';
    const borderRaw = readSTVar('--SmartThemeBorderColor') || '#ccc';
    const accentRaw = readSTVar('--SmartThemeQuoteColor') || '#5e8ad4';
    _themeCache = {
        bg: compositeOnWhite(bgRaw),
        text: forceOpaque(textRaw),
        border: forceOpaque(borderRaw),
        accent: forceOpaque(accentRaw),
    };
    return _themeCache;
}

function applyTheme(el, refresh) {
    const t = getTheme(refresh);
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
    _suppressChangeToast = Date.now();
    _lastUserSelectTouch = Date.now();
    _lastTouchSource = 'chak-panel';
    s.value = value;
    if (typeof $ !== 'undefined') {
        $(s).trigger('change');
    } else {
        s.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (_skipAutoSaveOnce) {
        _skipAutoSaveOnce = false;
    } else {
        setTimeout(() => {
            const saveBtn = document.getElementById('update_connection_profile');
            if (saveBtn) saveBtn.click();
        }, 300);
    }
    renderPresetList(); updateCurrentLabel();
    const name = s.options[s.selectedIndex]?.text ?? value;
    showToast(name);
    setTimeout(() => { _lastPresetName = getCurrentPresetName(); }, 600);
    refreshBar();
}

// ── Connection profiles ──

function getProfileSelector() { return document.getElementById('connection_profiles'); }

function getProfileList() {
    const s = getProfileSelector();
    if (!s) return [];
    return Array.from(s.options)
        .filter(o => o.value !== '' && o.textContent.trim() !== '')
        .map(o => ({ value: o.value, name: o.textContent.trim(), selected: o.selected }));
}

function getCurrentProfileName() {
    const s = getProfileSelector();
    if (!s || s.selectedIndex < 0) return '(없음)';
    const txt = s.options[s.selectedIndex]?.textContent?.trim();
    return txt || '(없음)';
}

let _profileSwitchUntil = 0;
let _skipAutoSaveOnce = false;

// connectionManager에 저장된 프로필 객체 (option.value = profile.id)
function getProfileRecord(key) {
    try {
        const list = SillyTavern.getContext().extensionSettings?.connectionManager?.profiles;
        if (!Array.isArray(list)) return null;
        return list.find(p => p?.id === key) || list.find(p => p?.name === key) || null;
    } catch (e) { return null; }
}

// 'cc' = Chat Completion, 'tc' = Text Completion (connection-manager 기준)
function getCurrentMode() { return getMainApi() === 'openai' ? 'cc' : 'tc'; }

// 프로필이 실제로 프리셋을 들고 있는지 + 왜 없는지
function inspectProfilePreset(key) {
    const rec = getProfileRecord(key);
    if (!rec) return { ok: false, reason: '프로필을 찾을 수 없어요' };
    if (Array.isArray(rec.exclude) && rec.exclude.includes('preset'))
        return { ok: false, reason: '이 프로필은 프리셋을 저장하지 않도록 설정돼 있어요', rec };
    const name = typeof rec.preset === 'string' ? rec.preset.trim() : '';
    if (!name || name === '<None>' || name === '<Empty>')
        return { ok: false, reason: '이 프로필에 저장된 프리셋이 없어요', rec };
    if (rec.mode && rec.mode !== getCurrentMode())
        return { ok: false, reason: `다른 API 계열(${rec.mode}) 프로필이라 프리셋만 가져올 수 없어요`, rec, name };
    return { ok: true, name, rec };
}

function getProfilePresetName(key) {
    const rec = getProfileRecord(key);
    if (!rec) return null;
    if (Array.isArray(rec.exclude) && rec.exclude.includes('preset')) return null;
    const n = typeof rec.preset === 'string' ? rec.preset.trim() : '';
    return (!n || n === '<None>' || n === '<Empty>') ? null : n;
}

// 프로필의 프리셋만 빌려온다 — #connection_profiles 선택은 절대 건드리지 않음
async function applyProfilePreset(key) {
    const info = inspectProfilePreset(key);
    if (!info.ok) { showToast(info.reason, true); return; }

    _suppressChangeToast = Date.now();
    _lastUserSelectTouch = Date.now();
    _lastTouchSource = 'chak-profile-borrow';
    _profileSwitchUntil = Date.now() + 3000;

    try {
        // ST가 프로필을 적용할 때 쓰는 것과 같은 경로 (정확 일치 → 퍼지 매칭)
        const cmd = SillyTavern.getContext()?.SlashCommandParser?.commands?.['preset'];
        if (cmd) {
            const applied = await cmd.callback({}, info.name);
            showToast(applied || info.name);
        } else {
            const hit = getPresetList().find(p => p.name.trim() === info.name);
            if (!hit) { showToast(`프리셋 "${info.name}" 을(를) 못 찾음`, true); return; }
            _skipAutoSaveOnce = true;
            switchPreset(hit.value);
            return;
        }
    } catch (e) {
        console.error('[착착] 프리셋 적용 실패', e);
        showToast('프리셋 적용 실패 (콘솔 확인)', true);
        return;
    }

    [200, 700, 1500].forEach(ms => setTimeout(() => {
        refreshBar(); updateCurrentLabel();
        _lastPresetName = getCurrentPresetName();
    }, ms));
}

// ── Favorites & Folders ──
function isFolderOpen(name) {
    const s = getSettings();
    if (s.folderOpenState[name] === undefined) {
        s.folderOpenState[name] = true;
        saveSettings();
    }
    return s.folderOpenState[name];
}
function setFolderOpen(name, open) {
    getSettings().folderOpenState[name] = open;
    saveSettings();
}

function isFavorite(v) { return getSettings().favorites.includes(v); }
function toggleFavorite(v) {
    const s = getSettings(); const i = s.favorites.indexOf(v);
    if (i >= 0) s.favorites.splice(i, 1); else s.favorites.push(v);
    saveSettings(); renderPresetList();
}
function getFolders() { return getSettings().folders; }
function addFolder(name) { const s = getSettings(); if (!s.folders[name]) { s.folders[name] = []; saveSettings(); } }
function removeFolder(name) { delete getSettings().folders[name]; saveSettings(); }
function getPresetFolder(value) {
    const folders = getFolders();
    for (const [fname, members] of Object.entries(folders)) {
        if (members.includes(value)) return fname;
    }
    return null;
}
function renameFolder(oldName, newName) {
    const s = getSettings();
    if (s.folders[newName]) return;
    // 순서 유지하면서 키 변경
    const entries = Object.entries(s.folders);
    s.folders = {};
    for (const [k, v] of entries) {
        s.folders[k === oldName ? newName : k] = v;
    }
    // 열림 상태도 이전
    if (s.folderOpenState?.[oldName] !== undefined) {
        if (!s.folderOpenState) s.folderOpenState = {};
        s.folderOpenState[newName] = s.folderOpenState[oldName];
        delete s.folderOpenState[oldName];
    }
    saveSettings();
}
function moveFolderUp(name) {
    const s = getSettings();
    const keys = Object.keys(s.folders);
    const idx = keys.indexOf(name);
    if (idx <= 0) return;
    [keys[idx - 1], keys[idx]] = [keys[idx], keys[idx - 1]];
    const newFolders = {};
    keys.forEach(k => newFolders[k] = s.folders[k]);
    s.folders = newFolders;
    saveSettings();
}
function moveFolderDown(name) {
    const s = getSettings();
    const keys = Object.keys(s.folders);
    const idx = keys.indexOf(name);
    if (idx < 0 || idx >= keys.length - 1) return;
    [keys[idx], keys[idx + 1]] = [keys[idx + 1], keys[idx]];
    const newFolders = {};
    keys.forEach(k => newFolders[k] = s.folders[k]);
    s.folders = newFolders;
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
        <div class="chak-bar">
            <div class="chak-chip chak-chip--profile">
                <span class="chak-chip-icon">🔌</span>
                <span class="chak-chip-label">—</span>
                <span class="chak-chip-caret">▾</span>
            </div>
            <div class="chak-chip chak-chip--preset">
                <span class="chak-chip-icon">🎚</span>
                <span class="chak-chip-label">—</span>
                <span class="chak-chip-caret">▾</span>
            </div>
        </div>
        <div class="chak-current">현재: <strong class="chak-current-name"></strong></div>
        <div class="chak-search-wrap">
            <input type="text" class="chak-search" placeholder="🔍 프리셋 검색..." />
        </div>
        <div class="chak-divider"></div>
        <div class="chak-list-section">
            <div class="chak-list chak-list--favorites"></div>
            <div class="chak-list chak-list--folders"></div>
            <div class="chak-section-label">전체 프리셋</div>
            <div class="chak-list chak-list--all"></div>
        </div>`;
    panelEl.querySelector('.chak-panel-close').addEventListener('click', closePanel);
    panelEl.querySelector('.chak-search').addEventListener('input', (e) => {
        renderPresetList(e.target.value.trim().toLowerCase(), panelEl);
    });
    panelEl.querySelector('.chak-folder-add').addEventListener('click', () => {
        const n = prompt('폴더 이름:'); if (n?.trim()) { addFolder(n.trim()); renderPresetList(); }
    });
    panelEl.querySelector('.chak-chip--profile').addEventListener('click', (e) => {
        e.stopPropagation(); toggleProfileDropdown();
    });
    panelEl.querySelector('.chak-chip--preset').addEventListener('click', (e) => {
        e.stopPropagation();
        closeDropdown();
        const si = panelEl.querySelector('.chak-search');
        if (si) { si.focus(); si.select(); }
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
    const searchInput = panelEl.querySelector('.chak-search');
    if (searchInput) searchInput.value = '';
    renderPresetList(undefined, panelEl); updateCurrentLabel(); applyTheme(panelEl, true); refreshBar();
    backdropEl.classList.remove('chak-backdrop--hidden');
    fabEl.classList.add('chak-fab--active');
}
function closePanel() { closeDropdown(); backdropEl.classList.add('chak-backdrop--hidden'); fabEl.classList.remove('chak-fab--active'); }
function updateCurrentLabel() {
    const l = panelEl.querySelector('.chak-current-name');
    if (l) { l.textContent = getCurrentPresetName(); l.style.color = getTheme().accent; }
}

let _renderRoot = null;

function renderPresetList(searchQuery, root) {
    root = root || _renderRoot || panelEl;
    if (!root) return;
    _renderRoot = root;
    let presets = getPresetList();
    const settings = getSettings(), t = getTheme();
    const foldersC = root.querySelector('.chak-list--folders');
    const favC = root.querySelector('.chak-list--favorites');
    const allC = root.querySelector('.chak-list--all');
    const allLabel = root.querySelector('.chak-list-section > .chak-section-label');
    if (!foldersC || !favC || !allC) return;

    // 검색 필터
    if (searchQuery) {
        presets = presets.filter(p => p.name.toLowerCase().includes(searchQuery));
    }

    // ── 즐겨찾기 ──
    favC.innerHTML = '';
    if (!searchQuery) {
        const favs = presets.filter(p => settings.favorites.includes(p.value));
        if (favs.length) {
            const lb = document.createElement('div'); lb.className = 'chak-section-label'; lb.textContent = '⭐ 즐겨찾기'; lb.style.color = t.text;
            favC.appendChild(lb);
            favs.forEach(p => favC.appendChild(createItem(p, t, true, getPresetFolder(p.value))));
        }
    }

    // ── 폴더 ──
    foldersC.innerHTML = '';
    if (!searchQuery) {
        for (const [fname, members] of Object.entries(getFolders())) {
            const fe = document.createElement('div'); fe.className = 'chak-folder';
            const hd = document.createElement('div'); hd.className = 'chak-folder-header'; hd.style.color = t.text;
            hd.innerHTML = `<span class="chak-folder-name">📁 ${fname}</span><span class="chak-folder-actions"><span class="chak-folder-move-up" title="위로">▲</span><span class="chak-folder-move-down" title="아래로">▼</span><span class="chak-folder-rename" title="이름 변경">✏️</span><span class="chak-folder-del" title="폴더 삭제">✕</span></span>`;
            hd.querySelector('.chak-folder-del').addEventListener('click', (e) => {
                e.stopPropagation(); if (confirm(`"${fname}" 삭제?`)) { removeFolder(fname); renderPresetList(); }
            });
            hd.querySelector('.chak-folder-move-up').addEventListener('click', (e) => {
                e.stopPropagation(); moveFolderUp(fname); renderPresetList();
            });
            hd.querySelector('.chak-folder-move-down').addEventListener('click', (e) => {
                e.stopPropagation(); moveFolderDown(fname); renderPresetList();
            });
            hd.querySelector('.chak-folder-rename').addEventListener('click', (e) => {
                e.stopPropagation();
                const newName = prompt('새 폴더 이름:', fname);
                if (newName && newName.trim() && newName.trim() !== fname) { renameFolder(fname, newName.trim()); renderPresetList(); }
            });
            const ct = document.createElement('div'); ct.className = 'chak-folder-content';
            ct.style.display = isFolderOpen(fname) ? '' : 'none';
            hd.addEventListener('click', (e) => { if (e.target === hd || e.target.classList.contains('chak-folder-name')) { setFolderOpen(fname, !isFolderOpen(fname)); ct.style.display = isFolderOpen(fname) ? '' : 'none'; } });
            presets.filter(p => members.includes(p.value)).forEach(p => ct.appendChild(createItem(p, t, false, fname)));
            fe.appendChild(hd); fe.appendChild(ct); foldersC.appendChild(fe);
        }
    }

    // ── 전체 (검색 시: 결과 전체, 비검색 시: 폴더 미분류만) ──
    allC.innerHTML = '';
    if (searchQuery) {
        if (allLabel) allLabel.textContent = `🔍 검색 결과 (${presets.length})`;
        presets.forEach(p => allC.appendChild(createItem(p, t, false, null)));
    } else {
        if (allLabel) allLabel.textContent = '전체 프리셋';
        const inFolder = new Set(Object.values(getFolders()).flat());
        presets.filter(p => !inFolder.has(p.value)).forEach(p => allC.appendChild(createItem(p, t, false, null)));
    }
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

    const otherFolders = Object.keys(getFolders()).filter(f => f !== folder);
    if (otherFolders.length > 0) {
        const fb = document.createElement('span'); fb.className = 'chak-item-folder-btn';
        fb.textContent = '📁'; fb.title = folder ? '다른 폴더로 이동' : '폴더에 추가';
        fb.addEventListener('click', (e) => {
            e.stopPropagation();
            showFolderPicker(fb, preset.value, t, folder);
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
    item.addEventListener('click', () => { switchPreset(preset.value); closeDropdown(); });
    return item;
}

function showFolderPicker(anchorEl, presetValue, t, currentFolder) {
    // Remove any existing picker
    document.querySelector('.chak-folder-picker')?.remove();

    const picker = document.createElement('div');
    picker.className = 'chak-folder-picker';
    picker.style.backgroundColor = t.bg;
    picker.style.borderColor = t.border;
    picker.style.color = t.text;

    const names = Object.keys(getFolders()).filter(n => n !== currentFolder);
    names.forEach(name => {
        const opt = document.createElement('div');
        opt.className = 'chak-folder-picker-item';
        opt.textContent = `📁 ${name}`;
        opt.style.color = t.text;
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentFolder) removeFromFolder(currentFolder, presetValue);
            addToFolder(name, presetValue);
            picker.remove();
            renderPresetList();
        });
        picker.appendChild(opt);
    });

    // Position: CSS handles centering
    (_renderRoot || panelEl).appendChild(picker);

    // Close on outside click
    const closePicker = (e) => {
        if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', closePicker, true); }
    };
    setTimeout(() => document.addEventListener('click', closePicker, true), 0);
}

// ── 패널 상단 프로필/프리셋 줄 ──
let dropdownEl = null, _ddOpen = false;

function refreshBar() {
    if (!panelEl) return;
    const tb = getSettings().topbar;
    const t = getTheme();
    const bar = panelEl.querySelector('.chak-bar');
    if (!bar) return;

    bar.style.display = tb.enabled ? '' : 'none';
    if (!tb.enabled) { closeDropdown(); return; }

    const pc = bar.querySelector('.chak-chip--profile');
    const sc = bar.querySelector('.chak-chip--preset');
    pc.style.display = tb.showProfile ? '' : 'none';
    sc.style.display = tb.showPreset ? '' : 'none';
    sc.style.flexGrow = String(tb.presetRatio);

    for (const chip of [pc, sc]) {
        chip.style.borderColor = t.border;
        chip.style.color = t.text;
        chip.querySelector('.chak-chip-icon').style.display = tb.icons ? '' : 'none';
    }
    pc.querySelector('.chak-chip-label').textContent = getCurrentProfileName();
    sc.querySelector('.chak-chip-label').textContent = getCurrentPresetName();
    pc.querySelector('.chak-chip-caret').textContent = _ddOpen ? '▴' : '▾';

    pc.classList.toggle('chak-chip--open', _ddOpen);
    if (_ddOpen) { pc.style.borderColor = t.accent; pc.style.color = t.accent; }
}

function toggleProfileDropdown() {
    _ddOpen ? closeDropdown() : openProfileDropdown();
}

function closeDropdown() {
    _ddOpen = false;
    if (dropdownEl) dropdownEl.remove();
    dropdownEl = null;
    refreshBar();
}

function openProfileDropdown() {
    if (!panelEl) return;
    closeDropdown();
    const t = getTheme();

    dropdownEl = document.createElement('div');
    dropdownEl.className = 'chak-dd';
    dropdownEl.style.backgroundColor = t.bg;
    dropdownEl.style.color = t.text;
    dropdownEl.style.borderColor = t.border;
    dropdownEl.addEventListener('click', (e) => e.stopPropagation());

    const profiles = getProfileList();
    if (!profiles.length) {
        const empty = document.createElement('div');
        empty.className = 'chak-dd-empty';
        empty.textContent = '연결 프로필이 없습니다';
        empty.style.color = t.text;
        dropdownEl.appendChild(empty);
    }
    profiles.forEach(p => {
        const item = document.createElement('div');
        item.className = 'chak-item' + (p.selected ? ' chak-item--active' : '');
        const nm = document.createElement('span');
        nm.className = 'chak-item-name';
        nm.textContent = p.name;
        nm.style.color = p.selected ? t.accent : t.text;
        item.appendChild(nm);

        const tag = document.createElement('span');
        tag.className = 'chak-dd-tag';
        const info = inspectProfilePreset(p.value);
        tag.textContent = info.ok ? info.name : '—';
        tag.style.color = t.text;
        if (!info.ok) item.classList.add('chak-item--muted');
        item.appendChild(tag);

        item.title = info.ok
            ? `프리셋 "${info.name}" 만 적용 (ST 연결 프로필은 그대로)`
            : info.reason;
        item.addEventListener('click', () => { applyProfilePreset(p.value); closeDropdown(); });
        dropdownEl.appendChild(item);
    });

    const bar = panelEl.querySelector('.chak-bar');
    const chip = bar.querySelector('.chak-chip--profile');
    panelEl.appendChild(dropdownEl);
    dropdownEl.style.top = (bar.offsetTop + bar.offsetHeight + 2) + 'px';
    dropdownEl.style.left = chip.offsetLeft + 'px';
    dropdownEl.style.width = Math.max(chip.offsetWidth, 150) + 'px';
    dropdownEl.style.maxHeight = Math.max(140, panelEl.clientHeight - bar.offsetTop - bar.offsetHeight - 16) + 'px';

    _ddOpen = true;
    refreshBar();
}

// ── Settings ──
function buildSettingsUI() {
    const html = `<div class="chak-settings"><div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header"><b>착착 ⚡ Chak-Chak</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content">
        <label class="checkbox_label"><input type="checkbox" id="chak_enabled" /><span>활성화</span></label>
        <label class="checkbox_label"><input type="checkbox" id="chak_show_fab" /><span>입력창 ⚡ 버튼 표시</span></label>
        <hr class="chak-settings-hr" />
        <label class="checkbox_label"><input type="checkbox" id="chak_tb_enabled" /><span>프로필/프리셋 줄 표시</span></label>
        <p class="chak-settings-desc">착착 패널의 "현재:" 바로 위에 [연결 프로필][프리셋] 한 줄을 띄웁니다.</p>
        <div id="chak_tb_opts">
            <label class="checkbox_label"><input type="checkbox" id="chak_tb_profile" /><span>연결 프로필 칩</span></label>
            <label class="checkbox_label"><input type="checkbox" id="chak_tb_preset" /><span>프리셋 칩</span></label>
            <label class="checkbox_label"><input type="checkbox" id="chak_tb_icons" /><span>아이콘 표시</span></label>
            <label class="chak-settings-range"><span>프리셋 칩 너비</span>
                <input type="range" id="chak_tb_ratio" min="0.6" max="2.5" step="0.1" />
            </label>
        </div>
        </div></div></div>`;
    document.getElementById('extensions_settings2').insertAdjacentHTML('beforeend', html);

    const s = getSettings();
    const bind = (id, get, set) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') el.checked = get(); else el.value = get();
        el.addEventListener('change', () => {
            set(el.type === 'checkbox' ? el.checked : parseFloat(el.value));
            saveSettings(); updateVisibility();
        });
        if (el.type === 'range') el.addEventListener('input', () => { set(parseFloat(el.value)); refreshBar(); });
    };

    bind('chak_enabled', () => s.enabled, v => s.enabled = v);
    bind('chak_show_fab', () => s.showFab, v => s.showFab = v);
    bind('chak_tb_enabled', () => s.topbar.enabled, v => s.topbar.enabled = v);
    bind('chak_tb_profile', () => s.topbar.showProfile, v => s.topbar.showProfile = v);
    bind('chak_tb_preset', () => s.topbar.showPreset, v => s.topbar.showPreset = v);
    bind('chak_tb_icons', () => s.topbar.icons, v => s.topbar.icons = v);
    bind('chak_tb_ratio', () => s.topbar.presetRatio, v => s.topbar.presetRatio = v);
}

function updateVisibility() {
    const s = getSettings();
    if (fabEl) fabEl.style.display = (s.enabled && s.showFab) ? '' : 'none';
    if (!s.enabled) { closePanel(); closeDropdown(); }
    const opts = document.getElementById('chak_tb_opts');
    if (opts) opts.style.display = s.topbar.enabled ? '' : 'none';
    refreshBar();
}

let _lastPresetName = null;
let _suppressChangeToast = 0;

function checkPresetChanged() {
    if (Date.now() < _profileSwitchUntil) { _lastPresetName = getCurrentPresetName(); return; }
    if (Date.now() - _suppressChangeToast < 1500) return;
    const name = getCurrentPresetName();
    if (!name || name === '(없음)') return;
    if (_lastPresetName === null) { _lastPresetName = name; return; }
    if (name !== _lastPresetName) {
        const gap = Date.now() - _lastUserSelectTouch;
        const userDriven = gap < 1500;
        _lastDecision = {
            from: _lastPresetName, to: name,
            gapMs: gap, source: _lastTouchSource,
            toastShown: !userDriven, at: new Date().toLocaleTimeString(),
        };
        _lastPresetName = name;
        if (!userDriven) showToast(name, true);
        if (!backdropEl.classList.contains('chak-backdrop--hidden')) {
            const q = panelEl.querySelector('.chak-search')?.value?.trim().toLowerCase();
            renderPresetList(q || undefined, panelEl); updateCurrentLabel();
        }
        refreshBar();
    }
}

function watchPresetChanges() {
    for (const id of Object.values(SELECTOR_MAP)) {
        const el = document.querySelector(id);
        if (!el) continue;
        // 진짜 사용자 조작만 기록 (isTrusted=false는 스크립트가 만든 가짜 이벤트)
        const mark = (e) => {
            if (!e || e.isTrusted) {
                _lastUserSelectTouch = Date.now();
                _lastTouchSource = e ? e.type : 'manual';
            }
        };
        el.addEventListener('pointerdown', mark);
        el.addEventListener('mousedown', mark);
        el.addEventListener('touchstart', mark, { passive: true });
        el.addEventListener('keydown', mark);

        el.addEventListener('change', () => {
            setTimeout(checkPresetChanged, 50);
        });
    }
    setInterval(checkPresetChanged, 300);
}

// 디버그용 — 콘솔에서 실행
window.chakTest = () => showToast('테스트 프리셋', true);
window.chakProfiles = () => getProfileList().map(p => {
    const i = inspectProfilePreset(p.value);
    return { name: p.name, id: p.value, stActive: p.selected, mode: i.rec?.mode,
             preset: i.ok ? i.name : null, why: i.ok ? 'ok' : i.reason };
});
window.chakTopbar = () => ({
    enabled: getSettings().topbar.enabled,
    dropdownOpen: _ddOpen,
    profileSelectFound: !!getProfileSelector(),
    profiles: getProfileList().map(p => p.name),
    currentProfile: getCurrentProfileName(),
    currentPreset: getCurrentPresetName(),
});
window.chakStatus = () => ({
    lastPresetName: _lastPresetName,
    currentName: getCurrentPresetName(),
    msSinceUserTouch: Date.now() - _lastUserSelectTouch,
    lastTouchSource: _lastTouchSource,
    lastDecision: _lastDecision,
});

function watchProfileChanges() {
    const attach = () => {
        const el = getProfileSelector();
        if (!el || el.dataset.chakWatched) return !!el;
        el.dataset.chakWatched = '1';
        el.addEventListener('change', () => {
            _profileSwitchUntil = Date.now() + 5000;
            [100, 600, 1500, 2500].forEach(ms => setTimeout(refreshBar, ms));
        });
        new MutationObserver(() => refreshBar()).observe(el, { childList: true, subtree: true });
        return true;
    };
    if (!attach()) {
        let tries = 0;
        const iv = setInterval(() => { if (attach() || ++tries > 40) clearInterval(iv); }, 500);
    }
}

(function init() {
    const chatEl = document.getElementById('chat');
    if (chatEl && chatEl.style.paddingTop) chatEl.style.paddingTop = '';
    buildSettingsUI(); buildUI(); updateVisibility();
    watchProfileChanges();
    setTimeout(() => { getTheme(true); refreshBar(); }, 1200);

    _lastPresetName = null;
    setTimeout(() => { _lastPresetName = getCurrentPresetName(); }, 1500);
    watchPresetChanges();

    const obs = new MutationObserver(() => {
        if (!backdropEl.classList.contains('chak-backdrop--hidden')) {
            const q = panelEl.querySelector('.chak-search')?.value?.trim().toLowerCase();
            renderPresetList(q || undefined, panelEl); updateCurrentLabel();
        }
        refreshBar();
    });
    for (const id of Object.values(SELECTOR_MAP)) {
        const el = document.querySelector(id);
        if (el) obs.observe(el, { childList: true, attributes: true });
    }
})();

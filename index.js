// 착착 (Chak-Chak) — Quick Preset Switcher with Folders
const extensionName = 'chak-chak';
const settingsKey = 'chak_chak';

const defaultSettings = {
    enabled: true,
    favorites: [],
    folders: {},  // { folderName: [presetValue, ...] }
};

function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[settingsKey]) {
        ctx.extensionSettings[settingsKey] = structuredClone(defaultSettings);
    }
    const s = ctx.extensionSettings[settingsKey];
    if (!s.folders) s.folders = {};
    return s;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// ── Theme colors — read from real ST elements ──

function grabColor(selectors, prop, fallback) {
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const v = getComputedStyle(el)[prop];
        if (v && v !== 'transparent' && v !== 'rgba(0, 0, 0, 0)') return v;
    }
    return fallback;
}

function getTheme() {
    const bg = grabColor(
        ['#chat .mes:last-child .mes_block', '.mes_block', '#chat', 'body'],
        'backgroundColor', '#f5eef0'
    );
    const text = grabColor(
        ['.mes_text', '#chat', 'body'],
        'color', '#333'
    );
    const border = grabColor(
        ['.mes:last-child', '.mes', '#chat'],
        'borderColor', '#d5c5c8'
    );
    const accent = getComputedStyle(document.body).getPropertyValue('--SmartThemeQuoteColor').trim() || '#5e8ad4';
    return { bg, text, border, accent };
}

function inlineTheme(el) {
    const t = getTheme();
    el.style.backgroundColor = t.bg;
    el.style.color = t.text;
    el.style.borderColor = t.border;
    el.dataset.accent = t.accent;
    // Also set on children that need accent
    el.querySelectorAll('.chak-current-name').forEach(n => n.style.color = t.accent);
    el.querySelectorAll('.chak-item--active .chak-item-name').forEach(n => n.style.color = t.accent);
    el.querySelectorAll('.chak-divider').forEach(n => n.style.backgroundColor = t.border);
    el.querySelectorAll('.chak-section-label').forEach(n => n.style.color = t.text);
    el.querySelectorAll('.chak-item-name').forEach(n => {
        if (!n.closest('.chak-item--active')) n.style.color = t.text;
    });
    el.querySelectorAll('.chak-panel-title, .chak-panel-close, .chak-current').forEach(n => n.style.color = t.text);
}

// ── Preset selector detection ──

const SELECTOR_MAP = {
    openai: '#settings_preset_openai',
    textgenerationwebui: '#settings_preset_textgenerationwebui',
    novel: '#settings_preset_novel',
    kobold: '#settings_preset',
};

function getMainApi() {
    return window.main_api ?? document.getElementById('main_api')?.value ?? 'openai';
}

function getPresetSelector() {
    const api = getMainApi();
    const id = SELECTOR_MAP[api];
    if (id) { const el = document.querySelector(id); if (el) return el; }
    for (const id of Object.values(SELECTOR_MAP)) {
        const el = document.querySelector(id);
        if (el && el.options.length > 0) return el;
    }
    return null;
}

function getCurrentPresetName() {
    const sel = getPresetSelector();
    if (!sel || sel.selectedIndex < 0) return '(없음)';
    return sel.options[sel.selectedIndex].text;
}

function getPresetList() {
    const sel = getPresetSelector();
    if (!sel) return [];
    return Array.from(sel.options).map(opt => ({
        value: opt.value,
        name: opt.text,
        selected: opt.selected,
    }));
}

function switchPreset(value) {
    const sel = getPresetSelector();
    if (!sel) return;
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    renderPresetList();
    updateCurrentLabel();
    showToast(sel.options[sel.selectedIndex]?.text ?? value);
}

function showToast(presetName) {
    const existing = document.querySelector('.chak-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'chak-toast';
    toast.textContent = `착! → ${presetName}`;
    const t = getTheme();
    toast.style.backgroundColor = t.bg;
    toast.style.color = t.text;
    toast.style.borderColor = t.border;
    document.documentElement.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('chak-toast--visible'));
    setTimeout(() => {
        toast.classList.remove('chak-toast--visible');
        setTimeout(() => toast.remove(), 300);
    }, 1500);
}

// ── Favorites & Folders ──

function isFavorite(v) { return getSettings().favorites.includes(v); }

function toggleFavorite(v) {
    const s = getSettings();
    const i = s.favorites.indexOf(v);
    if (i >= 0) s.favorites.splice(i, 1); else s.favorites.push(v);
    saveSettings();
    renderPresetList();
}

function getFolders() { return getSettings().folders; }

function addFolder(name) {
    const s = getSettings();
    if (!s.folders[name]) { s.folders[name] = []; saveSettings(); }
}

function removeFolder(name) {
    const s = getSettings();
    delete s.folders[name];
    saveSettings();
}

function addToFolder(folder, presetValue) {
    const s = getSettings();
    if (!s.folders[folder]) s.folders[folder] = [];
    if (!s.folders[folder].includes(presetValue)) {
        s.folders[folder].push(presetValue);
        saveSettings();
    }
}

function removeFromFolder(folder, presetValue) {
    const s = getSettings();
    if (!s.folders[folder]) return;
    s.folders[folder] = s.folders[folder].filter(v => v !== presetValue);
    saveSettings();
}

function getPresetFolder(presetValue) {
    const folders = getFolders();
    for (const [name, list] of Object.entries(folders)) {
        if (list.includes(presetValue)) return name;
    }
    return null;
}

// ── UI ──

let panelEl = null;
let backdropEl = null;
let fabEl = null;

function buildUI() {
    // FAB
    fabEl = document.createElement('div');
    fabEl.id = 'chak-fab';
    fabEl.innerHTML = `<span class="chak-fab-icon">⚡</span>`;
    fabEl.title = '착착 — 프리셋 전환';
    fabEl.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });

    const injected = injectFab();
    if (!injected) document.documentElement.appendChild(fabEl);

    // Backdrop (for mobile centering — flexbox, no transform)
    backdropEl = document.createElement('div');
    backdropEl.id = 'chak-backdrop';
    backdropEl.classList.add('chak-backdrop--hidden');
    backdropEl.addEventListener('click', (e) => {
        if (e.target === backdropEl) closePanel();
    });

    // Panel
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
        <div class="chak-current">
            현재: <strong class="chak-current-name"></strong>
        </div>
        <div class="chak-divider"></div>
        <div class="chak-list-section">
            <div class="chak-list chak-list--folders"></div>
            <div class="chak-list chak-list--favorites"></div>
            <div class="chak-section-label">전체 프리셋</div>
            <div class="chak-list chak-list--all"></div>
        </div>
    `;

    panelEl.querySelector('.chak-panel-close').addEventListener('click', closePanel);
    panelEl.querySelector('.chak-folder-add').addEventListener('click', () => {
        const name = prompt('폴더 이름:');
        if (name && name.trim()) { addFolder(name.trim()); renderPresetList(); }
    });

    backdropEl.appendChild(panelEl);
    document.documentElement.appendChild(backdropEl);

    // Desktop: close on outside click
    document.addEventListener('click', (e) => {
        if (!panelEl.contains(e.target) && !fabEl.contains(e.target) && !backdropEl.contains(e.target)) {
            if (!backdropEl.classList.contains('chak-backdrop--hidden')) closePanel();
        }
    });
}

function injectFab() {
    const targets = ['#leftSendForm', '#rightSendForm', '#send_form .panelControlBar', '#send_form'];
    for (const sel of targets) {
        const c = document.querySelector(sel);
        if (c) { c.appendChild(fabEl); return true; }
    }
    return false;
}

function togglePanel() {
    if (backdropEl.classList.contains('chak-backdrop--hidden')) openPanel();
    else closePanel();
}

function openPanel() {
    renderPresetList();
    updateCurrentLabel();
    inlineTheme(panelEl);
    backdropEl.classList.remove('chak-backdrop--hidden');
    fabEl.classList.add('chak-fab--active');
}

function closePanel() {
    backdropEl.classList.add('chak-backdrop--hidden');
    fabEl.classList.remove('chak-fab--active');
}

function updateCurrentLabel() {
    const l = panelEl.querySelector('.chak-current-name');
    if (l) { l.textContent = getCurrentPresetName(); l.style.color = getTheme().accent; }
}

function renderPresetList() {
    const presets = getPresetList();
    const settings = getSettings();
    const foldersContainer = panelEl.querySelector('.chak-list--folders');
    const favContainer = panelEl.querySelector('.chak-list--favorites');
    const allContainer = panelEl.querySelector('.chak-list--all');
    const t = getTheme();

    // Folders
    foldersContainer.innerHTML = '';
    const folders = getFolders();
    for (const [folderName, members] of Object.entries(folders)) {
        const folderEl = document.createElement('div');
        folderEl.className = 'chak-folder';

        const header = document.createElement('div');
        header.className = 'chak-folder-header';
        header.innerHTML = `<span class="chak-folder-name">📁 ${folderName}</span><span class="chak-folder-del" title="폴더 삭제">✕</span>`;
        header.style.color = t.text;
        header.querySelector('.chak-folder-del').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`"${folderName}" 폴더를 삭제할까요?`)) { removeFolder(folderName); renderPresetList(); }
        });

        let open = true;
        header.addEventListener('click', () => {
            open = !open;
            content.style.display = open ? '' : 'none';
        });

        const content = document.createElement('div');
        content.className = 'chak-folder-content';

        const folderPresets = presets.filter(p => members.includes(p.value));
        folderPresets.forEach(p => content.appendChild(createPresetItem(p, false, folderName)));

        folderEl.appendChild(header);
        folderEl.appendChild(content);
        foldersContainer.appendChild(folderEl);
    }

    // Favorites
    const favorites = presets.filter(p => settings.favorites.includes(p.value));
    favContainer.innerHTML = '';
    if (favorites.length > 0) {
        const label = document.createElement('div');
        label.className = 'chak-section-label';
        label.textContent = '⭐ 즐겨찾기';
        label.style.color = t.text;
        favContainer.appendChild(label);
        favorites.forEach(p => favContainer.appendChild(createPresetItem(p, true, null)));
    }

    // All presets
    allContainer.innerHTML = '';
    presets.forEach(p => allContainer.appendChild(createPresetItem(p, false, null)));
}

function createPresetItem(preset, isFavSection, folderName) {
    const t = getTheme();
    const item = document.createElement('div');
    item.className = 'chak-item' + (preset.selected ? ' chak-item--active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'chak-item-name';
    nameSpan.textContent = preset.name;
    nameSpan.style.color = preset.selected ? t.accent : t.text;

    const actions = document.createElement('span');
    actions.className = 'chak-item-actions';

    // Star
    const starBtn = document.createElement('span');
    starBtn.className = 'chak-item-star' + (isFavorite(preset.value) ? ' chak-item-star--on' : '');
    starBtn.textContent = isFavorite(preset.value) ? '★' : '☆';
    starBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(preset.value); });
    actions.appendChild(starBtn);

    // Folder assign (only in "all" section)
    if (!isFavSection && !folderName) {
        const folderNames = Object.keys(getFolders());
        if (folderNames.length > 0) {
            const folderBtn = document.createElement('span');
            folderBtn.className = 'chak-item-folder-btn';
            folderBtn.textContent = '📁';
            folderBtn.title = '폴더에 추가';
            folderBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const choice = prompt(`폴더 선택:\n${folderNames.join(', ')}`);
                if (choice && folderNames.includes(choice.trim())) {
                    addToFolder(choice.trim(), preset.value);
                    renderPresetList();
                }
            });
            actions.appendChild(folderBtn);
        }
    }

    // Remove from folder
    if (folderName) {
        const removeBtn = document.createElement('span');
        removeBtn.className = 'chak-item-folder-btn';
        removeBtn.textContent = '✕';
        removeBtn.title = '폴더에서 제거';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFromFolder(folderName, preset.value);
            renderPresetList();
        });
        actions.appendChild(removeBtn);
    }

    item.appendChild(nameSpan);
    item.appendChild(actions);
    item.addEventListener('click', () => switchPreset(preset.value));
    return item;
}

// ── Extension settings panel ──

function buildSettingsUI() {
    const html = `
        <div class="chak-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>착착 ⚡ Chak-Chak</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label class="checkbox_label">
                        <input type="checkbox" id="chak_enabled" />
                        <span>활성화</span>
                    </label>
                    <p class="chak-settings-desc">채팅 옆 ⚡ 버튼으로 프리셋을 빠르게 전환합니다.</p>
                </div>
            </div>
        </div>
    `;
    document.getElementById('extensions_settings2').insertAdjacentHTML('beforeend', html);
    const cb = document.getElementById('chak_enabled');
    cb.checked = getSettings().enabled;
    cb.addEventListener('change', () => { getSettings().enabled = cb.checked; saveSettings(); updateVisibility(); });
}

function updateVisibility() {
    const show = getSettings().enabled;
    if (fabEl) fabEl.style.display = show ? '' : 'none';
    if (!show) closePanel();
}

// ── Init ──
(function init() {
    buildSettingsUI();
    buildUI();
    updateVisibility();

    const observer = new MutationObserver(() => {
        if (panelEl && !backdropEl.classList.contains('chak-backdrop--hidden')) {
            renderPresetList();
            updateCurrentLabel();
        }
    });
    for (const id of Object.values(SELECTOR_MAP)) {
        const el = document.querySelector(id);
        if (el) observer.observe(el, { childList: true, attributes: true, attributeFilter: ['value'] });
    }
})();

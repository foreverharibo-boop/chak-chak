// 착착 (Chak-Chak) — Quick Preset Switcher
// 채팅 옆 플로팅 패널로 프리셋을 원탭 전환

const extensionName = 'chak-chak';
const settingsKey = 'chak_chak';

const defaultSettings = {
    enabled: true,
    favorites: [],
};

function getSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings[settingsKey]) {
        context.extensionSettings[settingsKey] = structuredClone(defaultSettings);
    }
    return context.extensionSettings[settingsKey];
}

function saveSettings() {
    const context = SillyTavern.getContext();
    context.saveSettingsDebounced();
}

// ── ST theme color helpers ──

function getSTColor(varName, fallback) {
    const val = getComputedStyle(document.body).getPropertyValue(varName).trim();
    return val || fallback;
}

function applyThemeToPanel() {
    if (!panelEl) return;
    const bg = getSTColor('--SmartThemeBlurTintColor', '#2a2a3e');
    const textColor = getSTColor('--SmartThemeBodyColor', '#ccc');
    const borderColor = getSTColor('--SmartThemeBorderColor', '#555');
    const quoteColor = getSTColor('--SmartThemeQuoteColor', '#5e8ad4');

    panelEl.style.setProperty('--chak-bg', bg);
    panelEl.style.setProperty('--chak-text', textColor);
    panelEl.style.setProperty('--chak-border', borderColor);
    panelEl.style.setProperty('--chak-accent', quoteColor);
}

function applyThemeToToast(toast) {
    const bg = getSTColor('--SmartThemeBlurTintColor', '#2a2a3e');
    const textColor = getSTColor('--SmartThemeBodyColor', '#ccc');
    const borderColor = getSTColor('--SmartThemeBorderColor', '#555');
    toast.style.setProperty('--chak-bg', bg);
    toast.style.setProperty('--chak-text', textColor);
    toast.style.setProperty('--chak-border', borderColor);
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
    const selectorId = SELECTOR_MAP[api];
    if (selectorId) {
        const el = document.querySelector(selectorId);
        if (el) return el;
    }
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
    applyThemeToToast(toast);
    document.documentElement.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('chak-toast--visible'));
    setTimeout(() => {
        toast.classList.remove('chak-toast--visible');
        setTimeout(() => toast.remove(), 300);
    }, 1500);
}

// ── Favorites ──

function isFavorite(presetValue) {
    return getSettings().favorites.includes(presetValue);
}

function toggleFavorite(presetValue) {
    const settings = getSettings();
    const idx = settings.favorites.indexOf(presetValue);
    if (idx >= 0) {
        settings.favorites.splice(idx, 1);
    } else {
        settings.favorites.push(presetValue);
    }
    saveSettings();
    renderPresetList();
}

// ── UI ──

let panelEl = null;
let fabEl = null;

function buildUI() {
    // FAB
    fabEl = document.createElement('div');
    fabEl.id = 'chak-fab';
    fabEl.innerHTML = `<span class="chak-fab-icon">⚡</span>`;
    fabEl.title = '착착 — 프리셋 전환';
    fabEl.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePanel();
    });

    // Try to inject FAB into ST's input toolbar (LEFT side)
    const injected = injectFab();
    if (!injected) {
        document.documentElement.appendChild(fabEl);
    }

    // Panel — on <html> to avoid MovingUI, colors applied via JS
    panelEl = document.createElement('div');
    panelEl.id = 'chak-panel';
    panelEl.classList.add('chak-panel--hidden');
    panelEl.innerHTML = `
        <div class="chak-panel-header">
            <span class="chak-panel-title">착착 ⚡</span>
            <span class="chak-panel-close" title="닫기">✕</span>
        </div>
        <div class="chak-current">
            현재: <strong class="chak-current-name"></strong>
        </div>
        <div class="chak-divider"></div>
        <div class="chak-list-section">
            <div class="chak-section-label">⭐ 즐겨찾기</div>
            <div class="chak-list chak-list--favorites"></div>
            <div class="chak-section-label">전체 프리셋</div>
            <div class="chak-list chak-list--all"></div>
        </div>
    `;

    panelEl.querySelector('.chak-panel-close').addEventListener('click', togglePanel);
    document.documentElement.appendChild(panelEl);

    // Close panel on outside click
    document.addEventListener('click', (e) => {
        if (!panelEl.contains(e.target) && !fabEl.contains(e.target)) {
            if (!panelEl.classList.contains('chak-panel--hidden')) {
                closePanel();
            }
        }
    });
}

function injectFab() {
    // Try LEFT side containers first, then right, then general
    const targets = [
        '#leftSendForm',
        '#rightSendForm',
        '#send_form .panelControlBar',
        '#form_sheld .panelControlBar',
        '#send_form',
    ];

    for (const selector of targets) {
        const container = document.querySelector(selector);
        if (container) {
            // Prepend to left, append to right
            if (selector === '#leftSendForm') {
                container.appendChild(fabEl);
            } else {
                container.appendChild(fabEl);
            }
            return true;
        }
    }
    return false;
}

function togglePanel() {
    if (panelEl.classList.contains('chak-panel--hidden')) {
        openPanel();
    } else {
        closePanel();
    }
}

function openPanel() {
    applyThemeToPanel();
    renderPresetList();
    updateCurrentLabel();

    // Position panel near FAB
    const fabRect = fabEl.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;

    if (!isMobile) {
        panelEl.style.bottom = (window.innerHeight - fabRect.top + 4) + 'px';
        // Align to left side of FAB
        const leftPos = fabRect.left;
        if (leftPos + 240 > window.innerWidth) {
            panelEl.style.left = 'auto';
            panelEl.style.right = '8px';
        } else {
            panelEl.style.left = leftPos + 'px';
            panelEl.style.right = 'auto';
        }
    }

    panelEl.classList.remove('chak-panel--hidden');
    fabEl.classList.add('chak-fab--active');
}

function closePanel() {
    panelEl.classList.add('chak-panel--hidden');
    fabEl.classList.remove('chak-fab--active');
}

function updateCurrentLabel() {
    const label = panelEl.querySelector('.chak-current-name');
    if (label) label.textContent = getCurrentPresetName();
}

function renderPresetList() {
    const presets = getPresetList();
    const settings = getSettings();
    const favContainer = panelEl.querySelector('.chak-list--favorites');
    const allContainer = panelEl.querySelector('.chak-list--all');

    const favorites = presets.filter(p => settings.favorites.includes(p.value));

    if (favorites.length === 0) {
        favContainer.innerHTML = '';
    } else {
        favContainer.innerHTML = '';
        favorites.forEach(p => favContainer.appendChild(createPresetItem(p, true)));
    }

    allContainer.innerHTML = '';
    presets.forEach(p => allContainer.appendChild(createPresetItem(p, false)));
}

function createPresetItem(preset, isFavSection) {
    const item = document.createElement('div');
    item.className = 'chak-item' + (preset.selected ? ' chak-item--active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'chak-item-name';
    nameSpan.textContent = preset.name;

    const starBtn = document.createElement('span');
    starBtn.className = 'chak-item-star' + (isFavorite(preset.value) ? ' chak-item-star--on' : '');
    starBtn.textContent = isFavorite(preset.value) ? '★' : '☆';
    starBtn.title = isFavorite(preset.value) ? '즐겨찾기 해제' : '즐겨찾기 추가';
    starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(preset.value);
    });

    item.appendChild(nameSpan);
    item.appendChild(starBtn);
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

    const checkbox = document.getElementById('chak_enabled');
    checkbox.checked = getSettings().enabled;
    checkbox.addEventListener('change', () => {
        getSettings().enabled = checkbox.checked;
        saveSettings();
        updateVisibility();
    });
}

function updateVisibility() {
    const show = getSettings().enabled;
    if (fabEl) fabEl.style.display = show ? '' : 'none';
    if (!show && panelEl) closePanel();
}

// ── Init ──

(function init() {
    buildSettingsUI();
    buildUI();
    updateVisibility();

    const observer = new MutationObserver(() => {
        if (panelEl && !panelEl.classList.contains('chak-panel--hidden')) {
            renderPresetList();
            updateCurrentLabel();
        }
    });

    for (const id of Object.values(SELECTOR_MAP)) {
        const el = document.querySelector(id);
        if (el) {
            observer.observe(el, { childList: true, attributes: true, attributeFilter: ['value'] });
        }
    }
})();

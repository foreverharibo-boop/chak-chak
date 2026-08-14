// 착착 (Chak-Chak) — Quick Preset Switcher with Folders
const extensionName = 'chak-chak';
const EXT_VERSION = '1.6.10';
const settingsKey = 'chak_chak';

let _lastUserSelectTouch = 0;
let _lastTouchSource = 'none';
let _lastDecision = null;
const WARN_COLOR = '#e0a030';

const defaultTopbar = { enabled: true, showProfile: true, showPreset: true, icons: true, presetRatio: 1.3 };
const defaultSettings = { enabled: true, favorites: [], folders: {}, folderOpenState: {}, recentPresets: [], recentOpen: true, showFab: true, activeProfileId: null, savePresetToSelectedProfile: true, driftWarn: true, driftDelaySec: 3, topbar: structuredClone(defaultTopbar) };

function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[settingsKey]) ctx.extensionSettings[settingsKey] = structuredClone(defaultSettings);
    const s = ctx.extensionSettings[settingsKey];
    if (!s.folders) s.folders = {};
    if (!s.folderOpenState) s.folderOpenState = {};
    if (!s.recentPresets) s.recentPresets = [];
    if (s.recentOpen === undefined) s.recentOpen = true;
    if (s.showFab === undefined) s.showFab = true;
    if (s.activeProfileId === undefined) s.activeProfileId = null;
    if (s.savePresetToSelectedProfile === undefined) s.savePresetToSelectedProfile = true;
    if (s.driftWarn === undefined) s.driftWarn = true;
    if (s.driftDelaySec === undefined) s.driftDelaySec = 3;
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
function getMainApi() {
    try {
        const m = SillyTavern.getContext()?.mainApi;
        if (m) return m;
    } catch (e) { /* noop */ }
    return window.main_api ?? document.getElementById('main_api')?.value ?? 'openai';
}
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
function switchPreset(value, options = {}) {
    const source = options.source || 'preset-list';
    const s = getPresetSelector();
    if (!s) { dlog('switchPreset: 프리셋 select 없음! api=', getMainApi()); return; }
    dlog('switchPreset:', value);
    _suppressChangeToast = Date.now();
    _lastUserSelectTouch = Date.now();
    _lastTouchSource = 'chak-panel';
    try {
        s.value = value;
        if (typeof $ !== 'undefined') {
            $(s).trigger('change');
        } else {
            s.dispatchEvent(new Event('change', { bubbles: true }));
        }
    } catch (e) {
        dlog('❌ trigger 중 예외:', e?.message);
    }
    dlog('  trigger 후 현재:', `"${getCurrentPresetName()}"`);

    let profileSave = null;
    let nativeProfileSaveQueued = false;
    if (_skipAutoSaveOnce) {
        _skipAutoSaveOnce = false;
        dlog('프로필 프리셋 저장 건너뜀: 프로필에 저장된 프리셋 불러오기 중');
    } else if (source === 'profile-save') {
        profileSave = savePresetToActiveProfile(getCurrentPresetName());
    } else if (source === 'current-preset') {
        nativeProfileSaveQueued = queueCurrentProfileUpdate();
    } else if (getSettings().savePresetToSelectedProfile) {
        profileSave = savePresetToActiveProfile(getCurrentPresetName());
    } else {
        nativeProfileSaveQueued = queueCurrentProfileUpdate();
    }
    // 클릭 이벤트가 document까지 전파되기 전에 누른 항목을 지우면
    // 바깥 클릭으로 오인되어 패널이 닫힌다. 이벤트가 끝난 뒤 목록을 갱신한다.
    setTimeout(() => {
        try { renderPresetList(); updateCurrentLabel(); refreshBar(); }
        catch (e) { dlog('❌ 목록 갱신 중 예외:', e?.message); }
    }, 0);
    try {
        const name = s.options[s.selectedIndex]?.text ?? value;
        // ST의 change 처리와 현재 클릭 이벤트가 모두 끝난 뒤 독립적으로 표시한다.
        setTimeout(() => {
            if (source === 'profile-load') {
                const profileName = options.profileName || getActiveProfileName();
                showToast(`🔌 ${profileName} 연결 프로필의 "${name}" 적용됨`);
            } else if (nativeProfileSaveQueued) {
                // 현재 연결 프로필 모드는 SillyTavern 원본 저장 버튼이
                // 자체 성공 토스트를 띄우므로 착착 토스트를 겹쳐 띄우지 않는다.
                dlog('현재 연결 프로필 저장: SillyTavern 원본 토스트 대기 중');
            } else if (profileSave?.ok) {
                showNativeProfileSaveToast(profileSave);
            } else {
                showToast(`🎚 현재 프리셋이 "${name}"으로 변경됨`);
            }
        }, 40);
    } catch (e) { dlog('❌ showToast 예외:', e?.message); }
    setTimeout(() => {
        _lastPresetName = getCurrentPresetName();
        _userPreset = _lastPresetName;
        clearDrift(); refreshBar();
    }, 600);
    try { refreshBar(); } catch (e) { dlog('❌ refreshBar 예외:', e?.message); }
    dlog('switchPreset 끝:', `"${getCurrentPresetName()}"`);
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

// 착착에서 마지막으로 고른 프로필 (없으면 ST 활성 프로필)
function getActiveProfileId() {
    const saved = getSettings().activeProfileId;
    if (saved && getProfileRecord(saved)) return saved;
    const sel = getProfileSelector();
    const v = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].value : '';
    return v || null;
}

function getActiveProfileName() {
    const id = getActiveProfileId();
    const rec = id ? getProfileRecord(id) : null;
    return rec?.name || getCurrentProfileName();
}

function setActiveProfileId(id) {
    getSettings().activeProfileId = id;
    saveSettings();
}

function getCurrentProfileName() {
    const s = getProfileSelector();
    if (!s || s.selectedIndex < 0) return '(없음)';
    const txt = s.options[s.selectedIndex]?.textContent?.trim();
    return txt || '(없음)';
}

function getCurrentProfileId() {
    try {
        const selected = SillyTavern.getContext().extensionSettings?.connectionManager?.selectedProfile;
        if (selected && getProfileRecord(selected)) return selected;
    } catch (e) { /* noop */ }
    const s = getProfileSelector();
    const value = s && s.selectedIndex >= 0 ? s.options[s.selectedIndex]?.value : '';
    return value || null;
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

// 착착 상단에서 고른 프로필에 프리셋 이름만 저장한다.
// ST의 업데이트 버튼은 #connection_profiles에서 선택된 프로필 전체를 갱신하므로,
// 착착의 activeProfileId와 ST 선택값이 다르면 엉뚱한 프로필을 바꿀 수 있다.
function savePresetToProfile(profileId, presetName, targetLabel) {
    const rec = profileId ? getProfileRecord(profileId) : null;
    if (!rec) {
        dlog('프로필 프리셋 저장 안 함:', targetLabel, '연결 프로필 없음');
        return { ok: false, reason: 'no-profile' };
    }
    if (Array.isArray(rec.exclude) && rec.exclude.includes('preset')) {
        dlog('프로필 프리셋 저장 안 함:', `"${rec.name}"`, '프리셋 저장 제외 상태');
        return { ok: false, reason: 'preset-excluded', profileName: rec.name };
    }

    const name = String(presetName ?? '').trim();
    if (!name || name === '(없음)') {
        dlog('프로필 프리셋 저장 실패:', `"${rec.name}"`, '유효한 프리셋 이름 없음');
        return { ok: false, reason: 'invalid-preset', profileName: rec.name };
    }

    const before = typeof rec.preset === 'string' ? rec.preset : '';
    rec.preset = name;
    saveSettings();

    const saved = getProfileRecord(profileId)?.preset;
    const ok = normName(saved) === normName(name);
    dlog(
        ok ? '프로필 프리셋 저장 완료:' : '프로필 프리셋 저장 실패:',
        `"${rec.name}"`,
        `"${before || '(없음)'}" → "${name}"`,
    );
    return { ok, profileName: rec.name, presetName: name, before };
}

function savePresetToActiveProfile(presetName) {
    return savePresetToProfile(getActiveProfileId(), presetName, '상단에서 선택한');
}

// 하단의 "현재 프리셋 변경"은 예전 착착 동작을 그대로 사용한다.
// 프리셋 change 처리가 끝난 뒤 SillyTavern 연결 프로필의 원본 업데이트 버튼을
// 실제로 눌러 API/모델/키/프리셋을 저장하고 원본 성공 토스트까지 띄운다.
function queueCurrentProfileUpdate() {
    const profileId = getCurrentProfileId();
    const profile = profileId ? getProfileRecord(profileId) : null;
    dlog('현재 연결 프로필 원본 저장 예약:', profile?.name || profileId || '(없음)');

    setTimeout(() => {
        const saveBtn = document.getElementById('update_connection_profile');
        if (!saveBtn) {
            dlog('❌ 현재 연결 프로필 저장 실패: #update_connection_profile 없음');
            showToast('SillyTavern 연결 프로필 저장 버튼을 찾지 못했어요', true);
            return;
        }
        dlog('현재 연결 프로필 원본 저장 버튼 클릭:', profile?.name || profileId || '(없음)');
        saveBtn.click();
    }, 300);

    return true;
}

// 상단에서 따로 고른 프로필은 현재 연결 프로필과 다를 수 있으므로
// ST 업데이트 버튼을 누르지 않고 프리셋만 저장한다. 저장 알림은
// 하단 원본 저장과 같은 SillyTavern toastr 레이어로 표시한다.
function showNativeProfileSaveToast(result) {
    const message = `${result.profileName} 연결 프로필에 "${result.presetName}" 프리셋 저장됨`;
    try {
        if (globalThis.toastr?.success) {
            globalThis.toastr.success(message, '', { timeOut: 1500 });
            dlog('SillyTavern 기본 저장 토스트 표시:', message);
            return;
        }
    } catch (e) {
        dlog('❌ SillyTavern 기본 저장 토스트 실패:', e?.message);
    }
    showToast(`💾 ${message}`);
}

// 프리셋 이름이 지금 API의 프리셋 목록에 실제로 있는지 (ST findPreset 과 같은 방식: option 텍스트 비교)
// 이모지 variation selector / ZWJ / 공백 차이를 흡수한 비교
function normName(x) {
    return String(x ?? '')
        .normalize('NFC')
        .replace(/[\uFE0E\uFE0F\u200D]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function findPresetByName(name) {
    const want = normName(name);
    if (!want) return null;
    const list = getPresetList();
    return list.find(p => normName(p.name) === want) || null;
}

// 정규화 완전일치가 실패했을 때의 느슨한 매칭
function findPresetLoose(name) {
    const want = normName(name);
    if (!want) return null;
    const list = getPresetList();
    return list.find(p => normName(p.name).startsWith(want))
        || list.find(p => want.startsWith(normName(p.name)))
        || list.find(p => normName(p.name).includes(want))
        || null;
}

// 프로필이 프리셋 이름을 들고 있는지만 본다
function inspectProfilePreset(key) {
    const rec = getProfileRecord(key);
    if (!rec) return { ok: false, reason: '프로필을 찾을 수 없어요' };
    if (Array.isArray(rec.exclude) && rec.exclude.includes('preset'))
        return { ok: false, reason: '프리셋을 저장하지 않는 프로필', rec };
    const name = typeof rec.preset === 'string' ? rec.preset.trim() : '';
    if (!name || name === '<None>' || name === '<Empty>')
        return { ok: false, reason: '저장된 프리셋 없음', rec };
    return { ok: true, name, rec, exact: !!findPresetByName(name) };
}

function getProfilePresetName(key) {
    const i = inspectProfilePreset(key);
    return i.ok ? i.name : null;
}

// 프로필의 프리셋만 빌려온다 — #connection_profiles 선택은 절대 건드리지 않음
async function applyProfilePreset(key) {
    const info = inspectProfilePreset(key);
    if (!info.ok) { showToast(info.reason, true); return; }

    const before = getCurrentPresetName();
    if (normName(before) === normName(info.name)) {
        dlog('이미 적용 중:', `"${before}"`);
        showToast(`🔌 ${info.rec?.name || getActiveProfileName()} 연결 프로필의 "${before}" 이미 적용 중`);
        return;
    }

    const hit = findPresetByName(info.name) || findPresetLoose(info.name);
    dlog('빌리기:', `"${info.name}"`, '옵션매칭:', hit ? `"${hit.name}"` : '실패', '이전:', `"${before}"`);

    _skipAutoSaveOnce = true;   // 활성 프로필에 덮어쓰지 않기
    _profileSwitchUntil = Date.now() + 3000;

    if (hit) {
        setTimeout(async () => {
            const now = getCurrentPresetName();
            dlog('적용확인:', `현재 "${now}"`, now === hit.name ? 'OK' : '불일치!');
            if (now === hit.name) return;
            // select 직접 변경이 안 먹는 환경 → ST /preset 으로 1회 재시도
            try {
                const cmd = SillyTavern.getContext()?.SlashCommandParser?.commands?.['preset'];
                if (cmd) {
                    _suppressChangeToast = Date.now();
                    _lastUserSelectTouch = Date.now();
                    await cmd.callback({}, info.name);
                    const now2 = getCurrentPresetName();
                    dlog('재시도(/preset):', `현재 "${now2}"`, now2 === hit.name ? 'OK' : '실패');
                    if (now2 !== hit.name) showToast(`"${info.name}" 적용 실패 — 진단 로그 확인`, true);
                    else { showToast(`🔌 ${info.rec?.name || getActiveProfileName()} 연결 프로필의 "${now2}" 적용됨`); refreshBar(); updateCurrentLabel(); }
                }
            } catch (e) { dlog('재시도 에러:', e?.message); }
        }, 350);
        switchPreset(hit.value, { source: 'profile-load', profileName: info.rec?.name });
        return;
    }

    // 목록에서 못 찾으면 ST 의 퍼지 매칭에 맡겨본다
    try {
        const cmd = SillyTavern.getContext()?.SlashCommandParser?.commands?.['preset'];
        if (!cmd) { showToast(`프리셋 "${info.name}" 을(를) 못 찾음`, true); _skipAutoSaveOnce = false; return; }
        _suppressChangeToast = Date.now();
        _lastUserSelectTouch = Date.now();
        await cmd.callback({}, info.name);
    } catch (e) {
        console.error('[착착] 프리셋 적용 실패', e);
        showToast('프리셋 적용 실패 (콘솔 확인)', true);
        _skipAutoSaveOnce = false;
        return;
    }
    _skipAutoSaveOnce = false;

    const after = getCurrentPresetName();
    if (normName(after) !== normName(before)) showToast(`🔌 ${info.rec?.name || getActiveProfileName()} 연결 프로필의 "${after}" 적용됨`);
    else showToast(`"${info.name}" 을(를) 적용하지 못했어요`, true);

    [200, 700, 1500].forEach(ms => setTimeout(() => {
        _lastPresetName = getCurrentPresetName();
        _userPreset = _lastPresetName;
        clearDrift(); refreshBar(); updateCurrentLabel();
    }, ms));
}

function showToast(name, persistent, action) {
    dlog('토스트 표시:', name);
    document.querySelector('#chak-toast-live')?.remove();
    const toast = document.createElement('div');
    toast.id = 'chak-toast-live';
    toast.className = 'chak-toast' + (persistent ? ' chak-toast--warn' : '');
    const label = persistent ? `⚠️ ${name}` : `착! → ${name}`;

    const text = document.createElement('span');
    text.className = 'chak-toast-text';
    text.textContent = label;
    toast.appendChild(text);

    const t = getTheme();
    toast.style.backgroundColor = t.bg;
    toast.style.color = persistent ? WARN_COLOR : t.text;
    toast.style.borderColor = persistent ? WARN_COLOR : t.border;

    const dismiss = () => {
        toast.style.removeProperty('opacity');
        toast.style.removeProperty('transform');
        toast.classList.remove('chak-toast--visible');
        setTimeout(() => toast.remove(), 300);
    };

    if (action) {
        const btn = document.createElement('span');
        btn.className = 'chak-toast-action';
        btn.textContent = action.label;
        btn.style.borderColor = WARN_COLOR;
        btn.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); action.onClick(); });
        toast.appendChild(btn);
    }
    if (persistent) {
        const close = document.createElement('span');
        close.className = 'chak-toast-close';
        close.textContent = '✕';
        toast.appendChild(close);
    }
    toast.addEventListener('click', dismiss);

    // 테마/확장 CSS와 패널 stacking context에 가려지지 않는 독립 레이어.
    const host = document.body || document.documentElement;
    host.appendChild(toast);
    toast.style.setProperty('display', 'flex', 'important');
    toast.style.setProperty('position', 'fixed', 'important');
    toast.style.setProperty('left', '50%', 'important');
    toast.style.setProperty('bottom', '80px', 'important');
    toast.style.setProperty('z-index', '2147483647', 'important');
    toast.style.setProperty('visibility', 'visible', 'important');
    toast.style.setProperty('background-color', t.bg, 'important');
    toast.style.setProperty('color', persistent ? WARN_COLOR : t.text, 'important');
    toast.style.setProperty('border', `1px solid ${persistent ? WARN_COLOR : t.border}`, 'important');
    toast.style.setProperty('max-width', 'calc(100vw - 32px)', 'important');

    requestAnimationFrame(() => {
        toast.classList.add('chak-toast--visible');
        toast.style.setProperty('opacity', '1', 'important');
        toast.style.setProperty('transform', 'translateX(-50%) translateY(0)', 'important');
    });
    if (!persistent) setTimeout(dismiss, 2500);
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
            <label class="chak-profile-save-toggle" title="프리셋 저장 대상 선택">
                <input type="checkbox" class="chak-profile-save-checkbox" aria-label="상단 선택 프로필에 저장할지 선택" />
            </label>
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
    const profileSaveCheck = panelEl.querySelector('.chak-profile-save-checkbox');
    profileSaveCheck.checked = getSettings().savePresetToSelectedProfile;
    profileSaveCheck.addEventListener('click', (e) => e.stopPropagation());
    profileSaveCheck.addEventListener('change', (e) => {
        e.stopPropagation();
        const enabled = profileSaveCheck.checked;
        getSettings().savePresetToSelectedProfile = enabled;
        saveSettings();
        dlog('선택 프로필 프리셋 자동 저장:', enabled ? '켜짐' : '꺼짐');
        refreshBar();
        showToast(enabled
            ? '☑ 상단 선택 프로필에 저장'
            : '☐ 현재 연결 프로필에 저장');
    });
    // 드롭다운이 닫힌 직후의 잔여/합성 클릭이 패널 아래 요소를 누르는 것을 차단
    panelEl.addEventListener('click', (e) => {
        if (Date.now() >= _clickShieldUntil) return;
        if (e.target.closest('.chak-bar') || e.target.closest('.chak-dd')) return;
        dlog('유령클릭 차단:', e.target.className || e.target.tagName);
        e.stopPropagation(); e.preventDefault();
    }, true);

    backdropEl.appendChild(panelEl);
    document.documentElement.appendChild(backdropEl);

    document.addEventListener('click', (e) => {
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const startedInside = path.includes(panelEl) || path.includes(fabEl) || path.includes(backdropEl);
        if (!startedInside && !panelEl.contains(e.target) && !fabEl.contains(e.target) && !backdropEl.contains(e.target))
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
    item.addEventListener('click', (e) => {
        // 목록 재렌더 뒤 document의 바깥 클릭 판정으로 넘어가지 않게 한다.
        e.preventDefault();
        e.stopPropagation();
        dlog('프리셋 탭(패널):', preset.name);
        const saveToProfile = getSettings().savePresetToSelectedProfile;
        switchPreset(preset.value, { source: saveToProfile ? 'profile-save' : 'current-preset' });
        if (saveToProfile) {
            closeDropdown();
        } else {
            closePanel();
        }
    });
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
let _clickShieldUntil = 0;

// ── 진단 로그 (설정 > 진단 로그 보기) ──
const _diag = [];
window.addEventListener('error', (e) => {
    dlog('❌ JS에러:', e.message, '@', (e.filename || '').split('/').pop() + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
    dlog('❌ 프라미스 거부:', e.reason?.message || String(e.reason));
});
function dlog(...args) {
    const line = new Date().toLocaleTimeString() + '  ' + args.map(a => {
        if (a === undefined) return 'undefined';
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
        return String(a);
    }).join(' ');
    _diag.push(line);
    if (_diag.length > 40) _diag.shift();
    console.debug('[착착]', ...args);
}

function showDiagLog() {
    document.getElementById('chak-diag')?.remove();
    const t = getTheme(true);
    const box = document.createElement('div');
    box.id = 'chak-diag';
    box.style.backgroundColor = t.bg;
    box.style.color = t.text;
    box.style.borderColor = t.border;

    const head = document.createElement('div');
    head.className = 'chak-diag-head';
    head.textContent = `착착 v${EXT_VERSION} 진단 로그 (최근 ${_diag.length}건)`;
    box.appendChild(head);

    const body = document.createElement('textarea');
    body.className = 'chak-diag-body';
    body.readOnly = true;
    body.value = _diag.length ? _diag.join('\n') : '(아직 기록 없음 — 프로필/프리셋을 한번 눌러보고 다시 열어줘)';
    box.appendChild(body);

    const row = document.createElement('div');
    row.className = 'chak-diag-row';
    const copyBtn = document.createElement('div');
    copyBtn.className = 'chak-diag-btn';
    copyBtn.textContent = '복사';
    copyBtn.addEventListener('click', () => {
        body.select();
        try { navigator.clipboard?.writeText(body.value); } catch (e) { document.execCommand('copy'); }
        copyBtn.textContent = '복사됨!';
    });
    const closeBtn = document.createElement('div');
    closeBtn.className = 'chak-diag-btn';
    closeBtn.textContent = '닫기';
    closeBtn.addEventListener('click', () => box.remove());
    row.appendChild(copyBtn); row.appendChild(closeBtn);
    box.appendChild(row);

    document.documentElement.appendChild(box);
}

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
    const saveToggle = bar.querySelector('.chak-profile-save-toggle');
    const saveCheck = bar.querySelector('.chak-profile-save-checkbox');
    saveToggle.style.display = tb.showProfile ? '' : 'none';
    saveCheck.checked = getSettings().savePresetToSelectedProfile;
    saveToggle.title = saveCheck.checked
        ? '체크됨 — 상단에서 선택한 연결 프로필에 프리셋을 저장합니다'
        : '체크 해제 — 현재 실제 연결 프로필에 프리셋을 저장합니다';
    pc.style.display = tb.showProfile ? '' : 'none';
    sc.style.display = tb.showPreset ? '' : 'none';
    sc.style.flexGrow = String(tb.presetRatio);

    for (const chip of [pc, sc]) {
        chip.style.borderColor = t.border;
        chip.style.color = t.text;
        chip.querySelector('.chak-chip-icon').style.display = tb.icons ? '' : 'none';
    }
    pc.querySelector('.chak-chip-label').textContent = getActiveProfileName();
    const cur = getCurrentPresetName();
    const drift = getSettings().driftWarn && isDrifted();
    sc.querySelector('.chak-chip-label').textContent = (drift ? '⚠ ' : '') + cur;
    sc.classList.toggle('chak-chip--warn', !!drift);
    if (drift) { sc.style.borderColor = WARN_COLOR; sc.style.color = WARN_COLOR; }
    sc.title = drift ? `원래 고른 프리셋: ${_userPreset} — 눌러서 검색, 토스트의 되돌리기로 복구` : '';
    pc.querySelector('.chak-chip-caret').textContent = _ddOpen ? '▴' : '▾';

    pc.classList.toggle('chak-chip--open', _ddOpen);
    if (_ddOpen) { pc.style.borderColor = t.accent; pc.style.color = t.accent; }
}

function toggleProfileDropdown() {
    _ddOpen ? closeDropdown() : openProfileDropdown();
}

function closeDropdown() {
    if (_ddOpen) _clickShieldUntil = Date.now() + 400;
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
    const curPreset = getCurrentPresetName();
    const activeId = getActiveProfileId();
    profiles.forEach(p => {
        const info = inspectProfilePreset(p.value);
        const isCurrent = p.value === activeId;              // 착착에서 고른 것
        const applied = info.ok && normName(info.name) === normName(curPreset);

        const item = document.createElement('div');
        item.className = 'chak-prof'
            + (isCurrent ? ' chak-prof--active' : '')
            + (info.ok ? '' : ' chak-prof--off');

        const head = document.createElement('div');
        head.className = 'chak-prof-head';

        const nm = document.createElement('div');
        nm.className = 'chak-prof-name';
        nm.textContent = (isCurrent ? '\u2713 ' : '') + p.name;
        nm.style.color = isCurrent ? t.accent : t.text;
        head.appendChild(nm);

        if (p.selected) {
            const badge = document.createElement('span');
            badge.className = 'chak-prof-badge';
            badge.textContent = 'ST';
            badge.title = 'ST 에서 활성인 연결 프로필';
            badge.style.borderColor = t.border;
            head.appendChild(badge);
        }
        item.appendChild(head);

        const sub = document.createElement('div');
        sub.className = 'chak-prof-sub';
        if (info.ok) {
            sub.textContent = info.name + (isCurrent && !applied ? '  · 적용 안 됨' : '');
            sub.style.color = (isCurrent && !applied) ? WARN_COLOR : t.text;
        } else {
            sub.textContent = info.reason;
            sub.style.color = WARN_COLOR;
        }
        item.appendChild(sub);

        item.title = info.ok
            ? `프리셋 "${info.name}" 적용 (ST 연결 프로필은 그대로)`
            : info.reason;

        const onPick = (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            dlog('프로필 탭:', p.name, info.ok ? `→ "${info.name}"` : `불가(${info.reason})`);
            item.classList.add('chak-prof--flash');
            if (!info.ok) {
                sub.style.whiteSpace = 'normal';
                sub.style.opacity = '1';
                return;
            }
            setActiveProfileId(p.value);
            refreshBar();
            applyProfilePreset(p.value);
            closeDropdown();
        };
        item.addEventListener('click', onPick);

        dropdownEl.appendChild(item);
    });

    const bar = panelEl.querySelector('.chak-bar');
    const chip = bar.querySelector('.chak-chip--profile');
    panelEl.appendChild(dropdownEl);
    dropdownEl.style.top = (bar.offsetTop + bar.offsetHeight + 2) + 'px';
    dropdownEl.style.left = chip.offsetLeft + 'px';
    dropdownEl.style.width = Math.min(panelEl.clientWidth - 20, Math.max(chip.offsetWidth, 220)) + 'px';
    dropdownEl.style.maxHeight = Math.max(140, panelEl.clientHeight - bar.offsetTop - bar.offsetHeight - 16) + 'px';

    _ddOpen = true;
    refreshBar();
}

// ── Settings ──
function buildSettingsUI() {
    const html = `<div class="chak-settings"><div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header"><b>착착 ⚡ Chak-Chak</b><span class="chak-ver">v${EXT_VERSION}</span>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content">
        <label class="checkbox_label"><input type="checkbox" id="chak_enabled" /><span>활성화</span></label>
        <label class="checkbox_label"><input type="checkbox" id="chak_show_fab" /><span>입력창 ⚡ 버튼 표시</span></label>
        <label class="checkbox_label"><input type="checkbox" id="chak_drift" /><span>프리셋 이탈 경고</span></label>
        <p class="chak-settings-desc">다른 확장이 프리셋을 바꿔놓고 안 되돌리면 경고 + 되돌리기 버튼을 띄웁니다.</p>
        <label class="chak-settings-range"><span>경고까지 대기</span>
            <input type="range" id="chak_drift_delay" min="1" max="30" step="1" />
            <span id="chak_drift_delay_out"></span>
        </label>
        <div class="menu_button" id="chak_diag_btn" style="margin: 6px 0;">🔍 진단 로그 보기</div>
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
    bind('chak_drift', () => s.driftWarn, v => { s.driftWarn = v; clearDrift(); });
    bind('chak_drift_delay', () => s.driftDelaySec, v => { s.driftDelaySec = v; clearDrift(); });
    const dOut = document.getElementById('chak_drift_delay_out');
    const dRange = document.getElementById('chak_drift_delay');
    const syncOut = () => { if (dOut && dRange) dOut.textContent = dRange.value + '초'; };
    syncOut(); dRange?.addEventListener('input', syncOut);
    bind('chak_tb_enabled', () => s.topbar.enabled, v => s.topbar.enabled = v);
    bind('chak_tb_profile', () => s.topbar.showProfile, v => s.topbar.showProfile = v);
    bind('chak_tb_preset', () => s.topbar.showPreset, v => s.topbar.showPreset = v);
    bind('chak_tb_icons', () => s.topbar.icons, v => s.topbar.icons = v);
    bind('chak_tb_ratio', () => s.topbar.presetRatio, v => s.topbar.presetRatio = v);
    document.getElementById('chak_diag_btn')?.addEventListener('click', showDiagLog);
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
let _userPreset = null;     // 사용자가 마지막으로 '의도한' 프리셋
let _driftSince = 0;
let _driftWarned = false;

function clearDrift() { _driftSince = 0; _driftWarned = false; }
function isDrifted() { return !!(_userPreset && getCurrentPresetName() !== _userPreset); }

function checkPresetChanged() {
    const name = getCurrentPresetName();
    if (!name || name === '(없음)') return;

    if (_lastPresetName === null) { _lastPresetName = name; _userPreset = name; return; }

    if (name !== _lastPresetName) {
        const gap = Date.now() - _lastUserSelectTouch;
        const userDriven = gap < 1500;
        _lastDecision = {
            from: _lastPresetName, to: name,
            gapMs: gap, source: _lastTouchSource,
            userDriven, at: new Date().toLocaleTimeString(),
        };
        _lastPresetName = name;
        if (userDriven) { _userPreset = name; clearDrift(); }
        if (backdropEl && !backdropEl.classList.contains('chak-backdrop--hidden')) {
            const q = panelEl.querySelector('.chak-search')?.value?.trim().toLowerCase();
            renderPresetList(q || undefined, panelEl); updateCurrentLabel();
        }
        refreshBar();
    }

    // ── 이탈 감지: 내가 고른 프리셋과 다른 상태가 계속되면 경고 ──
    const s = getSettings();
    if (!s.driftWarn) { clearDrift(); return; }
    if (Date.now() < _profileSwitchUntil) return;
    if (!_userPreset) { _userPreset = name; return; }

    if (name !== _userPreset) {
        if (!_driftSince) { _driftSince = Date.now(); refreshBar(); }
        else if (!_driftWarned && Date.now() - _driftSince >= (s.driftDelaySec * 1000)) {
            _driftWarned = true;
            showDriftToast(name);
            refreshBar();
        }
    } else if (_driftSince) {
        clearDrift(); refreshBar();
    }
}

function showDriftToast(current) {
    const target = _userPreset;
    showToast(`프리셋이 "${current}" 인 채예요 (원래: ${target})`, true, {
        label: '되돌리기',
        onClick: () => {
            const hit = getPresetList().find(p => p.name === target)
                || getPresetList().find(p => p.name.trim() === String(target).trim());
            if (hit) { switchPreset(hit.value); }
            else showToast(`"${target}" 을(를) 못 찾음`, true);
        },
    });
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

        el.addEventListener('change', () => setTimeout(checkPresetChanged, 50));
        // ST 내부(presetManager.selectPreset)는 jQuery .trigger('change') 를 쓰는데
        // 그건 native addEventListener 로는 안 잡힌다
        if (typeof $ !== 'undefined') $(el).on('change', () => setTimeout(checkPresetChanged, 50));
    }
    setInterval(checkPresetChanged, 300);
}

// 디버그용 — 콘솔에서 실행
window.chakTest = () => showToast('테스트 경고입니다', true, { label: '되돌리기', onClick: () => console.log('[착착] 되돌리기 눌림') });
window.chakDrift = () => ({
    watching: getSettings().driftWarn,
    userPreset: _userPreset,
    current: getCurrentPresetName(),
    drifted: isDrifted(),
    driftForMs: _driftSince ? Date.now() - _driftSince : 0,
    warned: _driftWarned,
    lastChange: _lastDecision,
});
window.chakProfiles = () => getProfileList().map(p => {
    const i = inspectProfilePreset(p.value);
    const hit = i.ok ? (findPresetByName(i.name) || findPresetLoose(i.name)) : null;
    return {
        name: p.name, id: p.value, stActive: p.selected,
        preset: i.ok ? i.name : null,
        why: i.ok ? 'ok' : i.reason,
        matchedOption: hit ? hit.name : null,
        matchedValue: hit ? hit.value : null,
    };
});
window.chakPresets = () => getPresetList().map(p => ({ name: p.name, value: p.value, selected: p.selected }));
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

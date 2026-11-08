import { getContext, extension_settings } from "../../../extensions.js";
import {
    eventSource,
    event_types,
    getRequestHeaders,
    selectCharacterById,
    openCharacterChat,
    doNewChat,
} from "../../../../script.js";

const EXT_NAME = "st-chat-vault";

const defaultSettings = {
    enableFab: true,
    themeMode: "inherit", // inherit | dark | light
    gridCols: 2,          // 2 | 3
    fabPos: { top: "68%", left: "calc(100% - 56px)", dock: "right" },
    notes: {},
    pinned: [],
    chatCounts: {},
    customExtUrls: {},
    ghToken: "",
    ghRepo: "",
    ghBranch: "main",
};

const fullTextIndex = new Map();
let isIndexing = false;
let currentView = "grid"; // grid | detail | search | backup
let selectedCharId = null;
let currentFilter = "recent";

// 备份中心缓存数据（用于二级精细勾选）
let backupCatalog = {
    characters: [],   // { avatar, name, world, chatsCount, checked }
    worlds: [],       // { name, isBoundToChar, checked }
    themes: [],       // { name, data, checked }
    includeCustomCss: true,
    presets: [],      // { name, data, checked }
    extensions: [],   // { id, displayName, url, checked }
    includeChatsWithChar: true,
    includeBoundWorldWithChar: true,
};

/* =========================================================
   0. 动态吸取酒馆美化包样式 + 极简现代 UI 样式表
   ========================================================= */
function syncTavernBeauty() {
    const root = document.documentElement;
    const bodyStyle = getComputedStyle(document.body);
    const rootStyle = getComputedStyle(root);

    const sampleDrawer =
        document.querySelector(".drawer-content") ||
        document.querySelector("#sheld") ||
        document.querySelector("#top-settings-holder") ||
        document.body;
    const drawerStyle = getComputedStyle(sampleDrawer);

    let bg =
        rootStyle.getPropertyValue("--SmartThemeBlurTintColor").trim() ||
        drawerStyle.backgroundColor;
    if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
        bg = bodyStyle.backgroundColor || "rgba(24, 25, 32, 0.9)";
    }

    const bgImage =
        drawerStyle.backgroundImage && drawerStyle.backgroundImage !== "none"
            ? drawerStyle.backgroundImage
            : "none";

    const textColor =
        rootStyle.getPropertyValue("--SmartThemeBodyColor").trim() ||
        drawerStyle.color ||
        bodyStyle.color ||
        "#f3f4f6";

    const emColor =
        rootStyle.getPropertyValue("--SmartThemeEmColor").trim() ||
        textColor;

    const quoteColor =
        rootStyle.getPropertyValue("--SmartThemeQuoteColor").trim() ||
        "#6366f1";

    const borderColor =
        rootStyle.getPropertyValue("--SmartThemeBorderColor").trim() ||
        drawerStyle.borderColor ||
        "rgba(160, 160, 175, 0.22)";

    const blurStrength =
        rootStyle.getPropertyValue("--SmartThemeBlurStrength").trim() ||
        "16px";

    const fontFamily =
        rootStyle.getPropertyValue("--mainFontFamily").trim() ||
        bodyStyle.fontFamily ||
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

    root.style.setProperty("--cv-inherit-bg", bg);
    root.style.setProperty("--cv-inherit-bg-img", bgImage);
    root.style.setProperty("--cv-inherit-text", textColor);
    root.style.setProperty("--cv-inherit-em", emColor);
    root.style.setProperty("--cv-inherit-accent", quoteColor);
    root.style.setProperty("--cv-inherit-border", borderColor);
    root.style.setProperty("--cv-inherit-blur", blurStrength);
    root.style.setProperty("--cv-inherit-font", fontFamily);
}

function injectMasterStyles() {
    syncTavernBeauty();
    if (document.getElementById("cv-master-styles")) return;
    const styleEl = document.createElement("style");
    styleEl.id = "cv-master-styles";
    styleEl.textContent = `
      #cv-modal-overlay, #cv-quick-sheet, #cv-fab {
        --cv-bg: var(--cv-inherit-bg, rgba(24, 25, 32, 0.92));
        --cv-bg-img: var(--cv-inherit-bg-img, none);
        --cv-blur: var(--cv-inherit-blur, 16px);
        --cv-text: var(--cv-inherit-text, #f3f4f6);
        --cv-em: var(--cv-inherit-em, #ffffff);
        --cv-accent: var(--cv-inherit-accent, #6366f1);
        --cv-border: var(--cv-inherit-border, rgba(160, 160, 175, 0.2));
        --cv-card-bg: color-mix(in srgb, var(--cv-text) 6%, transparent);
        --cv-card-hover: color-mix(in srgb, var(--cv-text) 10%, transparent);
        --cv-font: var(--cv-inherit-font, sans-serif);
      }

      .cv-theme-dark {
        --cv-bg: rgba(17, 18, 24, 0.96) !important;
        --cv-bg-img: none !important;
        --cv-text: #e5e7eb !important;
        --cv-em: #ffffff !important;
        --cv-accent: #6366f1 !important;
        --cv-border: rgba(255, 255, 255, 0.12) !important;
        --cv-card-bg: rgba(255, 255, 255, 0.05) !important;
      }

      .cv-theme-light {
        --cv-bg: rgba(250, 251, 254, 0.96) !important;
        --cv-bg-img: none !important;
        --cv-text: #1f2937 !important;
        --cv-em: #111827 !important;
        --cv-accent: #4f46e5 !important;
        --cv-border: rgba(0, 0, 0, 0.1) !important;
        --cv-card-bg: rgba(0, 0, 0, 0.04) !important;
      }

      #cv-fab {
        position: fixed !important;
        z-index: 2147483640 !important;
        width: 44px !important;
        height: 44px !important;
        border-radius: 14px !important;
        background-color: var(--cv-bg) !important;
        background-image: var(--cv-bg-img) !important;
        backdrop-filter: blur(var(--cv-blur)) !important;
        -webkit-backdrop-filter: blur(var(--cv-blur)) !important;
        border: 1px solid var(--cv-border) !important;
        color: var(--cv-text) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 17px !important;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28) !important;
        touch-action: none !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        cursor: pointer !important;
        transition: opacity 0.3s ease, transform 0.2s ease;
      }
      #cv-fab.cv-idle { opacity: 0.38 !important; }
      #cv-fab.cv-idle.cv-dock-left { transform: translateX(-10px); }
      #cv-fab.cv-idle.cv-dock-right { transform: translateX(10px); }

      #cv-modal-overlay, #cv-quick-sheet {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483645 !important;
        background: rgba(0, 0, 0, 0.44) !important;
        display: flex !important;
        align-items: flex-end !important;
        justify-content: center !important;
        font-family: var(--cv-font) !important;
        color: var(--cv-text) !important;
      }
      @media (min-width: 768px) {
        #cv-modal-overlay { align-items: center !important; }
      }

      .cv-modal-container {
        width: 100% !important;
        max-width: 660px !important;
        height: 88vh !important;
        background-color: var(--cv-bg) !important;
        background-image: var(--cv-bg-img) !important;
        backdrop-filter: blur(var(--cv-blur)) !important;
        -webkit-backdrop-filter: blur(var(--cv-blur)) !important;
        border: 1px solid var(--cv-border) !important;
        border-radius: 20px 20px 0 0 !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.35) !important;
        color: var(--cv-text) !important;
      }
      @media (min-width: 768px) {
        .cv-modal-container {
          height: 84vh !important;
          border-radius: 18px !important;
        }
      }

      .cv-quick-box {
        width: 100% !important;
        max-width: 500px !important;
        max-height: 70vh !important;
        background-color: var(--cv-bg) !important;
        background-image: var(--cv-bg-img) !important;
        backdrop-filter: blur(var(--cv-blur)) !important;
        -webkit-backdrop-filter: blur(var(--cv-blur)) !important;
        border-top: 1px solid var(--cv-border) !important;
        border-radius: 20px 20px 0 0 !important;
        padding: 18px 16px !important;
        color: var(--cv-text) !important;
        overflow-y: auto !important;
      }
      .cv-quick-item {
        padding: 11px 14px;
        border-radius: 12px;
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        margin-bottom: 8px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
      }

      .cv-header {
        padding: 14px 16px 10px;
        border-bottom: 1px solid var(--cv-border);
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex-shrink: 0;
      }
      .cv-top-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .cv-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--cv-em);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .cv-search-wrap {
        display: flex;
        align-items: center;
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        border-radius: 10px;
        padding: 3px 12px;
        gap: 8px;
      }
      .cv-search-wrap input {
        flex: 1;
        background: transparent !important;
        border: none !important;
        color: var(--cv-text) !important;
        font-family: var(--cv-font) !important;
        font-size: 13.5px !important;
        outline: none !important;
        padding: 6px 0 !important;
      }
      .cv-search-wrap input::placeholder {
        color: var(--cv-text) !important;
        opacity: 0.48 !important;
      }

      .cv-filter-row {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding-bottom: 2px;
        scrollbar-width: none;
      }
      .cv-filter-row::-webkit-scrollbar { display: none; }
      .cv-pill {
        padding: 5px 11px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        color: var(--cv-text);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.15s ease;
      }
      .cv-pill.active {
        background: var(--cv-accent) !important;
        color: #fff !important;
        border-color: var(--cv-accent) !important;
      }

      .cv-body {
        flex: 1;
        overflow-y: auto;
        padding: 14px 16px 32px;
        -webkit-overflow-scrolling: touch;
      }

      .cv-pinned-bar { margin-bottom: 16px; }
      .cv-section-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--cv-em);
        opacity: 0.75;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .cv-pinned-list {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 4px;
      }
      .cv-pin-chip {
        flex-shrink: 0;
        max-width: 210px;
        padding: 8px 12px;
        border-radius: 10px;
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        cursor: pointer;
        font-size: 12px;
      }
      .cv-pin-chip-title {
        font-weight: 600;
        color: var(--cv-em);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cv-pin-chip-sub {
        opacity: 0.65;
        font-size: 11px;
        margin-top: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .cv-char-grid { display: grid; gap: 12px; }
      .cv-char-grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cv-char-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .cv-char-card {
        position: relative;
        aspect-ratio: 3 / 4.1;
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid var(--cv-border);
        background: var(--cv-card-bg);
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
        transition: transform 0.15s ease;
      }
      .cv-char-card:active { transform: scale(0.97); }
      .cv-char-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .cv-char-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(15, 16, 22, 0.68);
        backdrop-filter: blur(6px);
        color: #fff;
        font-size: 11px;
        font-weight: 500;
        padding: 2px 8px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.15);
      }
      .cv-char-footer {
        position: absolute;
        left: 0; right: 0; bottom: 0;
        padding: 24px 10px 9px;
        background: linear-gradient(to top, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.45) 65%, transparent 100%);
        color: #fff;
      }
      .cv-char-name { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cv-char-time { font-size: 11px; opacity: 0.75; margin-top: 2px; }

      .cv-detail-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--cv-border);
      }
      .cv-detail-avatar {
        width: 44px;
        height: 44px;
        border-radius: 10px;
        object-fit: cover;
        border: 1px solid var(--cv-border);
      }
      .cv-slot-card {
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        border-radius: 12px;
        padding: 12px 14px;
        margin-bottom: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .cv-slot-card.current-slot { border-color: var(--cv-accent); }
      .cv-slot-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; cursor: pointer; }
      .cv-slot-title { font-weight: 600; font-size: 13.5px; color: var(--cv-em); word-break: break-all; }
      .cv-slot-note-tag {
        display: inline-block;
        background: var(--cv-accent);
        color: #fff;
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 5px;
        margin-right: 6px;
        font-weight: 500;
      }
      .cv-slot-meta { font-size: 11.5px; opacity: 0.68; display: flex; flex-wrap: wrap; gap: 12px; }
      .cv-slot-preview {
        font-size: 12.5px;
        opacity: 0.88;
        background: color-mix(in srgb, var(--cv-text) 4%, transparent);
        border: 1px solid var(--cv-border);
        padding: 8px 10px;
        border-radius: 8px;
        cursor: pointer;
        line-height: 1.45;
      }
      .cv-slot-actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; padding-top: 6px; border-top: 1px solid var(--cv-border); }
      .cv-btn-sm {
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 11.5px;
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        color: var(--cv-text);
        cursor: pointer;
      }
      .cv-btn-sm.primary { background: var(--cv-accent); color: #fff; border-color: transparent; }
      .cv-btn-sm.danger { color: #ef4444; }

      .cv-search-hit {
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        border-radius: 10px;
        padding: 10px 12px;
        margin-bottom: 8px;
        cursor: pointer;
      }
      .cv-hit-header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; margin-bottom: 4px; color: var(--cv-em); font-weight: 600; }
      .cv-hit-snippet { font-size: 12.5px; line-height: 1.45; word-break: break-word; opacity: 0.9; }
      .cv-highlight-kw { background: rgba(250, 204, 21, 0.85); color: #000; font-weight: 600; padding: 0 3px; border-radius: 3px; }

      /* 五维折叠备份卡片设计 */
      .cv-acc-card {
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        border-radius: 12px;
        margin-bottom: 10px;
        overflow: hidden;
      }
      .cv-acc-header {
        padding: 12px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        cursor: pointer;
        user-select: none;
      }
      .cv-acc-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
      }
      .cv-acc-title {
        font-size: 13.5px;
        font-weight: 600;
        color: var(--cv-em);
      }
      .cv-acc-sub {
        font-size: 11.5px;
        opacity: 0.65;
        margin-top: 2px;
      }
      .cv-acc-badge {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--cv-text) 8%, transparent);
        border: 1px solid var(--cv-border);
        white-space: nowrap;
      }
      .cv-acc-body {
        display: none;
        padding: 10px 14px 14px;
        border-top: 1px solid var(--cv-border);
        background: color-mix(in srgb, var(--cv-text) 2%, transparent);
      }
      .cv-acc-card.open .cv-acc-body { display: block; }
      .cv-acc-card.open .cv-acc-arrow { transform: rotate(180deg); }
      .cv-acc-arrow { transition: transform 0.2s ease; opacity: 0.65; font-size: 12px; }

      .cv-sub-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px dashed var(--cv-border);
        font-size: 11.5px;
      }
      .cv-sub-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(145px, 1fr));
        gap: 6px;
        max-height: 220px;
        overflow-y: auto;
        padding-right: 2px;
      }
      .cv-sub-item {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid var(--cv-border);
        background: var(--cv-card-bg);
        font-size: 12px;
        cursor: pointer;
        min-width: 0;
      }
      .cv-sub-item span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cv-ext-row {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid var(--cv-border);
        background: var(--cv-card-bg);
        margin-bottom: 6px;
      }
      .cv-input-field {
        width: 100%;
        padding: 7px 10px;
        border-radius: 7px;
        border: 1px solid var(--cv-border);
        background: color-mix(in srgb, var(--cv-text) 4%, transparent);
        color: var(--cv-text);
        font-size: 12px;
        outline: none;
      }
      .cv-action-row {
        display: flex;
        gap: 8px;
        margin-top: 10px;
        flex-wrap: wrap;
      }
      .cv-btn-block {
        flex: 1;
        min-width: 135px;
        padding: 9px 12px;
        border-radius: 8px;
        border: 1px solid var(--cv-border);
        background: var(--cv-card-bg);
        color: var(--cv-text);
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .cv-btn-block.primary {
        background: var(--cv-accent);
        color: #fff;
        border-color: transparent;
      }

      @keyframes cvFlashMessage {
        0%, 100% { box-shadow: none; }
        25%, 75% { box-shadow: 0 0 0 2px var(--cv-accent), 0 0 14px var(--cv-accent); }
      }
      .cv-target-message-flash { animation: cvFlashMessage 2.4s ease-in-out; border-radius: 8px; }
    `;
    document.head.appendChild(styleEl);
}

/* =========================================================
   1. 基础工具函数
   ========================================================= */
function getSettings() {
    extension_settings[EXT_NAME] = extension_settings[EXT_NAME] || {};
    Object.assign(extension_settings[EXT_NAME], {
        ...defaultSettings,
        ...extension_settings[EXT_NAME],
    });
    extension_settings[EXT_NAME].customExtUrls = extension_settings[EXT_NAME].customExtUrls || {};
    return extension_settings[EXT_NAME];
}

function saveSettings() {
    try {
        const ctx = getContext();
        if (ctx && typeof ctx.saveSettingsDebounced === "function") {
            ctx.saveSettingsDebounced();
        }
    } catch (e) {}
}

function stripFileExt(fileName = "") {
    return String(fileName || "").replace(/\.jsonl$/i, "");
}

function getSlotKey(avatar, fileName) {
    return `${avatar}::${stripFileExt(fileName)}`;
}

function escapeHtml(str = "") {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function getSafeAvatarUrl(avatarFile) {
    if (!avatarFile || avatarFile === "none") return "/img/ai4.png";
    return `/thumbnail?type=avatar&file=${encodeURIComponent(avatarFile)}`;
}

function getThemeLabel(mode) {
    if (mode === "dark") return "深色";
    if (mode === "light") return "浅色";
    return "跟随美化";
}

function syncFabToggleUI() {
    const settings = getSettings();
    $("#cv_enable_fab").prop("checked", settings.enableFab);
    $("#cv_theme_mode").val(settings.themeMode);
    $("#cv-toggle-fab-inline").text(settings.enableFab ? "隐藏悬浮球" : "开启悬浮球");
    $("#cv-cycle-theme-inline").text(getThemeLabel(settings.themeMode));
}

function applyThemeClass($el) {
    syncTavernBeauty();
    const mode = getSettings().themeMode;
    $el.removeClass("cv-theme-dark cv-theme-light");
    if (mode === "dark") $el.addClass("cv-theme-dark");
    if (mode === "light") $el.addClass("cv-theme-light");
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function base64ToBlob(dataUrl) {
    const arr = dataUrl.split(",");
    const mime = arr[0].match(/:(.*?);/)?.[1] || "image/png";
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], { type: mime });
}

/* =========================================================
   2. 后端 API 封装
   ========================================================= */
async function fetchCharacterChats(avatarUrl) {
    try {
        const res = await fetch("/api/characters/chats", {
            method: "POST",
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatarUrl }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : Object.values(data || {});
        getSettings().chatCounts[avatarUrl] = list.length;
        saveSettings();
        return list;
    } catch (e) {
        return [];
    }
}

async function fetchRawChatArray(charName, avatarUrl, fileName) {
    try {
        const cleanName = stripFileExt(fileName);
        const res = await fetch("/api/chats/get", {
            method: "POST",
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ch_name: charName,
                file_name: cleanName,
                avatar_url: avatarUrl,
            }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (e) {
        return [];
    }
}

async function fetchChatMessages(charName, avatarUrl, fileName) {
    const data = await fetchRawChatArray(charName, avatarUrl, fileName);
    return data.filter((m) => m && typeof m.mes === "string");
}

async function deleteChatFile(avatarUrl, fileName) {
    const withExt = fileName.endsWith(".jsonl") ? fileName : `${fileName}.jsonl`;
    const res = await fetch("/api/chats/delete", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({ chatfile: withExt, avatar_url: avatarUrl }),
    });
    return res.ok;
}

async function renameChatFile(avatarUrl, oldFileName, newFileName) {
    const oldWithExt = oldFileName.endsWith(".jsonl") ? oldFileName : `${oldFileName}.jsonl`;
    const newWithExt = newFileName.endsWith(".jsonl") ? newFileName : `${newFileName}.jsonl`;
    const res = await fetch("/api/chats/rename", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({
            avatar_url: avatarUrl,
            original_file: oldWithExt,
            renamed_file: newWithExt,
        }),
    });
    return res.ok;
}

async function cloneChatFile(charName, avatarUrl, fileName) {
    try {
        const cleanName = stripFileExt(fileName);
        const rawChatArray = await fetchRawChatArray(charName, avatarUrl, cleanName);
        if (!rawChatArray.length) return false;
        const newFileName = `${cleanName}_backup_${new Date().toTimeString().slice(0, 5).replace(":", "")}`;
        const saveRes = await fetch("/api/chats/save", {
            method: "POST",
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ch_name: charName,
                file_name: newFileName,
                chat: rawChatArray,
                avatar_url: avatarUrl,
            }),
        });
        return saveRes.ok;
    } catch (e) {
        return false;
    }
}

/* =========================================================
   3. 跨角色切档 + 楼层定位
   ========================================================= */
async function switchAndLocate(chid, fileName, targetMesId = null) {
    const ctx = getContext();
    const cleanFile = stripFileExt(fileName);

    $("#cv-modal-overlay, #cv-quick-sheet").remove();
    if (window.toastr) toastr.info(`正在切换档位：${cleanFile}`);

    if (String(ctx.characterId) !== String(chid)) {
        await selectCharacterById(String(chid));
        await new Promise((r) => setTimeout(r, 380));
    }

    const currentChatFile = stripFileExt(ctx.characters?.[chid]?.chat || "");
    if (currentChatFile !== cleanFile) {
        await openCharacterChat(cleanFile);
        await new Promise((r) => setTimeout(r, 450));
    }

    if (targetMesId !== null && targetMesId !== undefined) {
        scrollToMessageFloor(targetMesId);
    }
}

function scrollToMessageFloor(mesId) {
    let attempts = 0;
    const timer = setInterval(() => {
        attempts++;
        const $msg = $(`#chat .mes[mesid="${mesId}"]`);
        if ($msg.length) {
            clearInterval(timer);
            $msg[0].scrollIntoView({ behavior: "smooth", block: "center" });
            $msg.addClass("cv-target-message-flash");
            setTimeout(() => $msg.removeClass("cv-target-message-flash"), 2600);
        } else if (attempts >= 12) {
            clearInterval(timer);
            if (window.toastr) toastr.warning(`已进入档位，目标在第 #${mesId} 楼`);
        }
    }, 250);
}

/* =========================================================
   4. 极简悬浮球
   ========================================================= */
function initFloatingBall() {
    injectMasterStyles();
    const oldFab = document.getElementById("cv-fab");
    if (oldFab) oldFab.remove();

    const settings = getSettings();
    syncFabToggleUI();

    if (!settings.enableFab) return;

    const fabEl = document.createElement("div");
    fabEl.id = "cv-fab";
    fabEl.innerHTML = `<i class="fa-solid fa-layer-group"></i>`;
    fabEl.style.top = settings.fabPos.top || "68%";
    fabEl.style.left = settings.fabPos.left || "calc(100% - 56px)";
    fabEl.className = settings.fabPos.dock === "left" ? "cv-dock-left" : "cv-dock-right";
    if (settings.themeMode === "dark") fabEl.classList.add("cv-theme-dark");
    if (settings.themeMode === "light") fabEl.classList.add("cv-theme-light");

    document.body.appendChild(fabEl);

    let idleTimer = null;
    const resetIdle = () => {
        fabEl.classList.remove("cv-idle");
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => fabEl.classList.add("cv-idle"), 3200);
    };
    resetIdle();

    let isDown = false;
    let hasMoved = false;
    let longPressed = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let lpTimer = null;

    fabEl.addEventListener("pointerdown", (e) => {
        resetIdle();
        isDown = true;
        hasMoved = false;
        longPressed = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = fabEl.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;

        try { fabEl.setPointerCapture(e.pointerId); } catch (_) {}

        clearTimeout(lpTimer);
        lpTimer = setTimeout(() => {
            if (isDown && !hasMoved) {
                longPressed = true;
                isDown = false;
                openQuickSwitchSheet();
            }
        }, 600);
    });

    fabEl.addEventListener("pointermove", (e) => {
        if (!isDown) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
            hasMoved = true;
            clearTimeout(lpTimer);
            const newLeft = Math.max(6, Math.min(window.innerWidth - 50, startLeft + dx));
            const newTop = Math.max(10, Math.min(window.innerHeight - 54, startTop + dy));
            fabEl.style.transition = "none";
            fabEl.style.left = `${newLeft}px`;
            fabEl.style.top = `${newTop}px`;
        }
    });

    fabEl.addEventListener("pointerup", (e) => {
        clearTimeout(lpTimer);
        if (!isDown) return;
        isDown = false;
        try { fabEl.releasePointerCapture(e.pointerId); } catch (_) {}
        fabEl.style.transition = "opacity 0.3s ease, transform 0.2s ease";

        if (hasMoved) {
            const rect = fabEl.getBoundingClientRect();
            const isLeft = rect.left + rect.width / 2 < window.innerWidth / 2;
            const dockLeft = isLeft ? "8px" : `${window.innerWidth - 52}px`;
            const dockSide = isLeft ? "left" : "right";

            fabEl.classList.remove("cv-dock-left", "cv-dock-right");
            fabEl.classList.add(`cv-dock-${dockSide}`);
            fabEl.style.left = dockLeft;
            fabEl.style.top = `${rect.top}px`;

            settings.fabPos = { top: `${rect.top}px`, left: dockLeft, dock: dockSide };
            saveSettings();
        } else if (!longPressed) {
            openMainModal();
        }
        resetIdle();
    });
}

/* =========================================================
   5. 长按悬浮球：快捷切档菜单
   ========================================================= */
async function openQuickSwitchSheet() {
    injectMasterStyles();
    $("#cv-quick-sheet").remove();
    const ctx = getContext();
    const chid = ctx.characterId;
    const char = ctx.characters?.[chid];

    const $sheet = $(`
        <div id="cv-quick-sheet">
          <div class="cv-quick-box">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <b>快捷切档 ${char ? `· ${escapeHtml(char.name)}` : ""}</b>
              <span class="cv-pill" id="cv-quick-open-full">进入主面板</span>
            </div>
            <div id="cv-quick-list">正在读取档位...</div>
          </div>
        </div>
    `);

    applyThemeClass($sheet);
    $("body").append($sheet);
    $sheet.on("click", (e) => {
        if (e.target.id === "cv-quick-sheet") $sheet.remove();
    });
    $("#cv-quick-open-full").on("click", () => {
        $sheet.remove();
        openMainModal();
    });

    if (chid === undefined || !char) {
        $("#cv-quick-list").html(`<div style="opacity:0.7;padding:10px 0;">当前未选中角色，请点击右上角进入主面板。</div>`);
        return;
    }

    const chats = await fetchCharacterChats(char.avatar);
    if (!chats.length) {
        $("#cv-quick-list").html(`<div>暂无历史档位</div>`);
        return;
    }

    const currentFile = stripFileExt(char.chat || "");
    const settings = getSettings();
    const html = chats.slice(0, 8).map((c) => {
        const fName = stripFileExt(c.file_name);
        const note = settings.notes[getSlotKey(char.avatar, fName)] || "";
        const isCur = fName === currentFile;
        return `
            <div class="cv-quick-item" data-file="${escapeHtml(fName)}">
              <div style="min-width:0;flex:1;">
                <div style="font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${note ? `<span class="cv-slot-note-tag">${escapeHtml(note)}</span>` : ""}
                  ${escapeHtml(fName)}
                </div>
                <div style="font-size:11px;opacity:0.68;margin-top:2px;">${c.chat_items || "?"} 楼 · ${escapeHtml(c.last_mes || "")}</div>
              </div>
              <span class="cv-pill ${isCur ? "active" : ""}">${isCur ? "当前" : "切换"}</span>
            </div>
        `;
    }).join("");

    $("#cv-quick-list").html(html);
    $("#cv-quick-list .cv-quick-item").on("click", function () {
        switchAndLocate(chid, $(this).data("file"));
    });
}

/* =========================================================
   6. 主面板渲染与视图导航
   ========================================================= */
async function openMainModal() {
    try {
        injectMasterStyles();
        const existing = document.getElementById("cv-modal-overlay");
        if (existing) existing.remove();

        const settings = getSettings();
        currentView = "grid";
        selectedCharId = null;

        const $modal = $(`
            <div id="cv-modal-overlay">
              <div class="cv-modal-container">
                <div class="cv-header">
                  <div class="cv-top-bar">
                    <div class="cv-title">
                      <i class="fa-solid fa-layer-group"></i>
                      <span>存档管家</span>
                      <span id="cv-sub-status" style="font-size:11px;opacity:0.65;font-weight:normal;"></span>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                      <span class="cv-pill" id="cv-open-backup-view"><i class="fa-solid fa-cloud-arrow-up"></i> 备份与同步</span>
                      <span class="cv-pill" id="cv-cycle-theme-inline">${getThemeLabel(settings.themeMode)}</span>
                      <span class="cv-pill" id="cv-toggle-cols">${settings.gridCols} 列</span>
                      <span class="cv-pill" id="cv-close-modal"><i class="fa-solid fa-xmark"></i></span>
                    </div>
                  </div>

                  <div class="cv-search-wrap" id="cv-search-bar-wrap">
                    <i class="fa-solid fa-magnifying-glass" style="opacity:0.55;font-size:13px;"></i>
                    <input type="text" id="cv-search-input" placeholder="搜索角色名、档位备注、或历史对话内容..." />
                    <span id="cv-search-clear" style="cursor:pointer;opacity:0.6;display:none;padding:0 4px;"><i class="fa-solid fa-xmark"></i></span>
                  </div>

                  <div class="cv-filter-row" id="cv-filter-bar">
                    <span class="cv-pill active" data-filter="recent">最近游玩</span>
                    <span class="cv-pill" data-filter="count">档位最多</span>
                    <span class="cv-pill" data-filter="multi">仅多档位</span>
                    <span class="cv-pill" id="cv-build-index-pill">建立全文索引</span>
                    <span class="cv-pill" id="cv-clean-empty-btn">清理空档</span>
                    <span class="cv-pill" id="cv-toggle-fab-inline">${settings.enableFab ? "隐藏悬浮球" : "开启悬浮球"}</span>
                  </div>
                </div>

                <div class="cv-body" id="cv-body-content">
                  <div style="text-align:center;padding:30px;opacity:0.65;">正在加载...</div>
                </div>
              </div>
            </div>
        `);

        applyThemeClass($modal);
        document.body.appendChild($modal[0]);

        $modal.on("click", (e) => {
            if (e.target.id === "cv-modal-overlay") $modal.remove();
        });
        $("#cv-close-modal").on("click", () => $modal.remove());

        $("#cv-open-backup-view").on("click", () => {
            if (currentView === "backup") {
                $("#cv-open-backup-view").removeClass("active");
                renderCharacterGrid();
            } else {
                $("#cv-open-backup-view").addClass("active");
                renderBackupCenterView();
            }
        });

        $("#cv-cycle-theme-inline").on("click", () => {
            const order = ["inherit", "dark", "light"];
            const nextIdx = (order.indexOf(settings.themeMode) + 1) % order.length;
            settings.themeMode = order[nextIdx];
            saveSettings();
            applyThemeClass($modal);
            initFloatingBall();
            syncFabToggleUI();
        });

        $("#cv-toggle-fab-inline").on("click", () => {
            settings.enableFab = !settings.enableFab;
            saveSettings();
            initFloatingBall();
            if (window.toastr) {
                toastr.info(settings.enableFab ? "已开启悬浮球" : "已隐藏悬浮球，可通过左下角魔杖菜单重新打开");
            }
        });

        $("#cv-toggle-cols").on("click", function () {
            settings.gridCols = settings.gridCols === 2 ? 3 : 2;
            saveSettings();
            $(this).text(`${settings.gridCols} 列`);
            $(".cv-char-grid").removeClass("cols-2 cols-3").addClass(`cols-${settings.gridCols}`);
        });

        $("#cv-filter-bar .cv-pill[data-filter]").on("click", function () {
            $("#cv-filter-bar .cv-pill[data-filter]").removeClass("active");
            $(this).addClass("active");
            currentFilter = $(this).data("filter");
            if (currentView === "grid") renderCharacterGrid();
        });

        $("#cv-build-index-pill").on("click", () => buildFullTextIndex(true));
        $("#cv-clean-empty-btn").on("click", () => runEmptySlotCleaner());

        let searchDebounce = null;
        $("#cv-search-input").on("input", function () {
            const kw = $(this).val().trim();
            $("#cv-search-clear").toggle(Boolean(kw));
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                if (!kw) renderCharacterGrid();
                else renderSearchResults(kw);
            }, 180);
        });

        $("#cv-search-clear").on("click", () => {
            $("#cv-search-input").val("").trigger("input");
        });

        renderCharacterGrid();
        refreshAllCharCountsBackground();
    } catch (err) {
        console.error("[ChatVault] openMainModal error:", err);
    }
}

window.cvOpenModal = openMainModal;
window.cvRebuildIndex = () => buildFullTextIndex(true);

/* =========================================================
   7. 一级视图：角色海报墙
   ========================================================= */
function renderCharacterGrid() {
    try {
        currentView = "grid";
        $("#cv-open-backup-view").removeClass("active");
        $("#cv-search-bar-wrap, #cv-filter-bar").show();

        const ctx = getContext();
        const chars = ctx?.characters || [];
        const settings = getSettings();
        const $body = $("#cv-body-content");

        if (!chars.length) {
            $body.html(`<div style="text-align:center;padding:40px 0;opacity:0.65;">暂无角色卡</div>`);
            return;
        }

        let pinnedHtml = "";
        if (Array.isArray(settings.pinned) && settings.pinned.length > 0) {
            const chips = settings.pinned.map((p) => {
                const note = settings.notes[getSlotKey(p.avatar, p.fileName)] || p.fileName;
                return `
                    <div class="cv-pin-chip" data-chid="${p.chid}" data-file="${escapeHtml(p.fileName)}">
                      <div class="cv-pin-chip-title">${escapeHtml(note)}</div>
                      <div class="cv-pin-chip-sub">${escapeHtml(p.charName)} · ${escapeHtml(p.fileName)}</div>
                    </div>
                `;
            }).join("");
            pinnedHtml = `
                <div class="cv-pinned-bar">
                  <div class="cv-section-label"><i class="fa-solid fa-thumbtack"></i> 常用置顶档位</div>
                  <div class="cv-pinned-list">${chips}</div>
                </div>
            `;
        }

        let list = chars.map((c, idx) => ({
            chid: idx,
            name: c?.name || "未命名",
            avatar: c?.avatar || "",
            date_last_chat: c?.date_last_chat || 0,
            count: settings.chatCounts[c?.avatar] ?? 1,
        }));

        if (currentFilter === "multi") {
            list = list.filter((item) => item.count > 1);
        }

        if (currentFilter === "count") {
            list.sort((a, b) => b.count - a.count || b.date_last_chat - a.date_last_chat);
        } else {
            list.sort((a, b) => b.date_last_chat - a.date_last_chat);
        }

        const cardsHtml = list.map((item) => {
            const thumb = getSafeAvatarUrl(item.avatar);
            const timeStr = item.date_last_chat
                ? new Date(item.date_last_chat).toLocaleDateString()
                : "未游玩";
            return `
                <div class="cv-char-card" data-chid="${item.chid}" data-avatar="${escapeHtml(item.avatar)}">
                  <img src="${thumb}" loading="lazy" onerror="this.src='/img/ai4.png'" alt="${escapeHtml(item.name)}" />
                  <div class="cv-char-badge" id="cv-badge-${item.chid}">${item.count} 档</div>
                  <div class="cv-char-footer">
                    <div class="cv-char-name">${escapeHtml(item.name)}</div>
                    <div class="cv-char-time">${timeStr}</div>
                  </div>
                </div>
            `;
        }).join("");

        $body.html(`
            ${pinnedHtml}
            <div class="cv-char-grid cols-${settings.gridCols}">
              ${cardsHtml}
            </div>
        `);

        $body.find(".cv-pin-chip").on("click", function () {
            switchAndLocate($(this).data("chid"), $(this).data("file"));
        });

        $body.find(".cv-char-card").on("click", function () {
            renderCharacterSlots(Number($(this).data("chid")));
        });
    } catch (err) {
        $("#cv-body-content").html(`<div style="padding:20px;color:#ef4444;">加载角色列表失败：${escapeHtml(err.message)}</div>`);
    }
}

async function refreshAllCharCountsBackground() {
    const ctx = getContext();
    const chars = ctx?.characters || [];
    const settings = getSettings();

    for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (!c?.avatar) continue;
        if (settings.chatCounts[c.avatar] === undefined) {
            const chats = await fetchCharacterChats(c.avatar);
            $(`#cv-badge-${i}`).text(`${chats.length} 档`);
        }
    }
}

/* =========================================================
   8. 二级视图：角色档位详情
   ========================================================= */
async function renderCharacterSlots(chid) {
    currentView = "detail";
    selectedCharId = chid;
    $("#cv-filter-bar").hide();

    const ctx = getContext();
    const char = ctx?.characters?.[chid];
    if (!char) return;

    const $body = $("#cv-body-content");
    const thumb = getSafeAvatarUrl(char.avatar);

    $body.html(`
        <div class="cv-detail-header">
          <span class="cv-pill" id="cv-back-grid"><i class="fa-solid fa-arrow-left"></i> 返回</span>
          <img class="cv-detail-avatar" src="${thumb}" onerror="this.src='/img/ai4.png'" />
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(char.name)}</div>
            <div style="font-size:12px;opacity:0.68;" id="cv-detail-sub">正在读取聊天档位...</div>
          </div>
          <span class="cv-btn-sm primary" id="cv-new-chat-btn"><i class="fa-solid fa-plus"></i> 新建档位</span>
        </div>
        <div id="cv-slot-list"></div>
    `);

    $("#cv-back-grid").on("click", () => renderCharacterGrid());
    $("#cv-new-chat-btn").on("click", async () => {
        $("#cv-modal-overlay").remove();
        if (String(ctx.characterId) !== String(chid)) {
            await selectCharacterById(String(chid));
            await new Promise((r) => setTimeout(r, 350));
        }
        await doNewChat({ deleteCurrentChat: false });
        if (window.toastr) toastr.success("已开启新档位");
    });

    const chats = await fetchCharacterChats(char.avatar);
    $("#cv-detail-sub").text(`共 ${chats.length} 个存档槽（点击卡片直接切换）`);

    if (!chats.length) {
        $("#cv-slot-list").html(`<div style="text-align:center;padding:30px;opacity:0.65;">暂无聊天档位</div>`);
        return;
    }

    const currentChatFile = stripFileExt(char.chat || "");
    const settings = getSettings();

    const slotsHtml = chats.map((c) => {
        const fName = stripFileExt(c.file_name);
        const slotKey = getSlotKey(char.avatar, fName);
        const note = settings.notes[slotKey] || "";
        const isCurrent = fName === currentChatFile && String(ctx.characterId) === String(chid);
        const isPinned = settings.pinned.some((p) => p.avatar === char.avatar && p.fileName === fName);
        const isBranch = /branch|分支/i.test(fName);
        const previewText = c.mes || "点击加载此档位...";
        const floorCount = c.chat_items ?? "?";
        const fileSize = c.file_size || "";
        const lastTime = c.last_mes || "";

        return `
            <div class="cv-slot-card ${isCurrent ? "current-slot" : ""}" data-file="${escapeHtml(fName)}">
              <div class="cv-slot-top" data-action="load">
                <div>
                  ${note ? `<span class="cv-slot-note-tag">${escapeHtml(note)}</span>` : ""}
                  ${isBranch ? `<span class="cv-slot-note-tag" style="background:#10b981;">分支</span>` : ""}
                  <span class="cv-slot-title">${escapeHtml(fName)}</span>
                </div>
                <span class="cv-pill ${isCurrent ? "active" : ""}">${isCurrent ? "当前档位" : "加载"}</span>
              </div>

              <div class="cv-slot-meta">
                <span>${floorCount} 楼</span>
                ${lastTime ? `<span>${escapeHtml(lastTime)}</span>` : ""}
                ${fileSize ? `<span>${escapeHtml(fileSize)}</span>` : ""}
              </div>

              <div class="cv-slot-preview" data-action="load">
                ${escapeHtml(previewText)}
              </div>

              <div class="cv-slot-actions">
                <span class="cv-btn-sm" data-action="pin">${isPinned ? "取消置顶" : "置顶"}</span>
                <span class="cv-btn-sm" data-action="note">备注</span>
                <span class="cv-btn-sm" data-action="rename">改名</span>
                <span class="cv-btn-sm" data-action="clone">克隆</span>
                <span class="cv-btn-sm danger" data-action="delete">删除</span>
              </div>
            </div>
        `;
    }).join("");

    $("#cv-slot-list").html(slotsHtml);

    $("#cv-slot-list .cv-slot-card").on("click", async function (e) {
        const $target = $(e.target).closest("[data-action]");
        if (!$target.length) return;

        const action = $target.data("action");
        const fName = $(this).data("file");
        const slotKey = getSlotKey(char.avatar, fName);

        if (action === "load") {
            switchAndLocate(chid, fName);
        } else if (action === "note") {
            const oldNote = settings.notes[slotKey] || "";
            const newNote = prompt("设置档位备注标签（留空则清除）：", oldNote);
            if (newNote !== null) {
                if (newNote.trim()) settings.notes[slotKey] = newNote.trim();
                else delete settings.notes[slotKey];
                saveSettings();
                renderCharacterSlots(chid);
            }
        } else if (action === "pin") {
            const idx = settings.pinned.findIndex((p) => p.avatar === char.avatar && p.fileName === fName);
            if (idx >= 0) {
                settings.pinned.splice(idx, 1);
            } else {
                settings.pinned.unshift({ chid, avatar: char.avatar, charName: char.name, fileName: fName });
            }
            saveSettings();
            renderCharacterSlots(chid);
        } else if (action === "rename") {
            const newName = prompt("输入新的档位文件名：", fName);
            if (newName && newName.trim() && newName.trim() !== fName) {
                const ok = await renameChatFile(char.avatar, fName, newName.trim());
                if (ok) renderCharacterSlots(chid);
                else if (window.toastr) toastr.error("重命名失败");
            }
        } else if (action === "clone") {
            const ok = await cloneChatFile(char.name, char.avatar, fName);
            if (ok) {
                if (window.toastr) toastr.success("已克隆备份档位");
                renderCharacterSlots(chid);
            }
        } else if (action === "delete") {
            if (confirm(`确定要删除档位「${fName}」吗？`)) {
                const ok = await deleteChatFile(char.avatar, fName);
                if (ok) renderCharacterSlots(chid);
            }
        }
    });
}

/* =========================================================
   9. 五大模块精细化勾选备份中心（自动读取 Git 地址 + 角色绑定世界书联动）
   ========================================================= */

// 深度扫描已安装插件的真实 Git 仓库地址 (/api/extensions/version)
async function scanExtensionsWithRealGitUrl() {
    const settings = getSettings();
    const extMap = new Map();

    // 1. 先从 /api/extensions/discover 获取酒馆识别到的所有扩展
    try {
        const res = await fetch("/api/extensions/discover");
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
                for (const item of data) {
                    if (item.type && item.type !== "third-party" && !String(item.name).includes("third-party")) {
                        continue; // 跳过内置核心插件，只管用户装的第三方插件
                    }
                    const id = item.name;
                    const displayName = id.replace(/^third-party[\\/]/, "");
                    extMap.set(displayName, {
                        id,
                        displayName,
                        url: settings.customExtUrls[displayName] || settings.customExtUrls[id] || "",
                        checked: true,
                    });
                }
            }
        }
    } catch (_) {}

    // 2. 补充从 DOM script/link 扫描到的 third-party 文件夹
    document.querySelectorAll('script[src*="third-party/"], link[href*="third-party/"]').forEach((el) => {
        const src = el.src || el.href || "";
        const m = src.match(/third-party\/([^/?#]+)/);
        if (m && m[1] && !extMap.has(m[1])) {
            const folder = m[1];
            extMap.set(folder, {
                id: `third-party/${folder}`,
                displayName: folder,
                url: settings.customExtUrls[folder] || "",
                checked: true,
            });
        }
    });

    // 3. 逐个调用 /api/extensions/version 提取底层真实的 Git remoteUrl + manifest.homePage
    const list = Array.from(extMap.values());
    await Promise.all(
        list.map(async (ext) => {
            if (ext.url) return;

            // 方式 A：请求酒馆后端的 Git 版本接口获取真实的安装克隆地址 (remoteUrl)
            for (const globalFlag of [false, true]) {
                try {
                    const vRes = await fetch("/api/extensions/version", {
                        method: "POST",
                        headers: getRequestHeaders(),
                        body: JSON.stringify({ extensionName: ext.id, global: globalFlag }),
                    });
                    if (vRes.ok) {
                        const vData = await vRes.json();
                        if (vData.remoteUrl && vData.remoteUrl.startsWith("http")) {
                            ext.url = vData.remoteUrl.replace(/\.git$/i, "");
                            break;
                        }
                    }
                } catch (_) {}
            }

            // 方式 B：如果方式 A 没取到，读取插件目录下的 manifest.json
            if (!ext.url) {
                try {
                    const mRes = await fetch(`/scripts/extensions/third-party/${ext.displayName}/manifest.json`);
                    if (mRes.ok) {
                        const mData = await mRes.json();
                        if (mData.homePage && mData.homePage.includes("github.com") && mData.homePage !== "https://github.com/SillyTavern/SillyTavern") {
                            ext.url = mData.homePage;
                        }
                    }
                } catch (_) {}
            }

            if (ext.url) {
                settings.customExtUrls[ext.displayName] = ext.url;
            }
        })
    );

    saveSettings();
    return list;
}

// 扫描全部 5 大模块资产目录
async function loadFullBackupCatalog() {
    const ctx = getContext();
    const chars = ctx?.characters || [];
    const settings = getSettings();

    // 1. 扫描角色卡及角色绑定的专属世界书
    const boundWorldSet = new Set();
    const charItems = chars.map((c, idx) => {
        const boundWorld = c?.data?.extensions?.world || c?.chat_metadata?.world || "";
        if (boundWorld) boundWorldSet.add(boundWorld);
        return {
            chid: idx,
            name: c?.name || "未命名",
            avatar: c?.avatar || "",
            boundWorld,
            chatsCount: settings.chatCounts[c?.avatar] ?? 1,
            checked: true,
        };
    });

    // 2. 读取后端 /api/settings/get 获取世界书列表、美化主题列表、预设列表
    let worldNames = [];
    let themesList = [];
    let presetsList = [];
    let fullSettingsObj = {};

    try {
        const res = await fetch("/api/settings/get", {
            method: "POST",
            headers: getRequestHeaders(),
            body: JSON.stringify({}),
        });
        if (res.ok) {
            const sData = await res.json();
            worldNames = sData.world_names || [];
            fullSettingsObj = sData.settings ? JSON.parse(sData.settings) : {};

            // 提取美化主题 (Themes)
            if (Array.isArray(sData.themes)) {
                themesList = sData.themes.map((t) => ({
                    name: t.name || String(t),
                    data: t,
                    checked: true,
                }));
            } else if (Array.isArray(fullSettingsObj.themes)) {
                themesList = fullSettingsObj.themes.map((t) => ({
                    name: t.name || String(t),
                    data: t,
                    checked: true,
                }));
            }
            // 把当前正在使用的 power_user.theme 也作为默认选中项保障
            const activeThemeName = fullSettingsObj?.theme || fullSettingsObj?.power_user?.theme;
            if (activeThemeName && !themesList.some((t) => t.name === activeThemeName)) {
                themesList.unshift({
                    name: `${activeThemeName} (当前使用)`,
                    data: { name: activeThemeName, power_user: fullSettingsObj.power_user },
                    checked: true,
                });
            }

            // 提取对话预设 (OpenAI / Chat Completion Presets 等)
            if (sData.openai_setting_names && typeof sData.openai_setting_names === "object") {
                const names = Array.isArray(sData.openai_setting_names)
                    ? sData.openai_setting_names
                    : Object.keys(sData.openai_setting_names);
                presetsList = names.map((n, i) => ({
                    name: n,
                    data: sData.openai_settings?.[i] || sData.openai_settings?.[n] || null,
                    checked: true,
                }));
            }
        }
    } catch (_) {}

    const worldItems = worldNames.map((wName) => ({
        name: wName,
        isBound: boundWorldSet.has(wName),
        checked: true,
    }));

    // 3. 扫描第三方插件及 Git 地址
    const extItems = await scanExtensionsWithRealGitUrl();

    backupCatalog = {
        characters: charItems,
        worlds: worldItems,
        themes: themesList,
        includeCustomCss: true,
        presets: presetsList,
        extensions: extItems,
        includeChatsWithChar: true,
        includeBoundWorldWithChar: true,
        rawSettingsSnapshot: fullSettingsObj,
    };
}

async function renderBackupCenterView() {
    currentView = "backup";
    $("#cv-search-bar-wrap, #cv-filter-bar").hide();
    const settings = getSettings();
    const $body = $("#cv-body-content");

    $body.html(`
        <div class="cv-detail-header">
          <span class="cv-pill" id="cv-backup-back"><i class="fa-solid fa-arrow-left"></i> 返回海报墙</span>
          <div style="font-weight:600;font-size:15px;">模块化备份与云同步</div>
        </div>
        <div style="text-align:center;padding:30px;opacity:0.7;">
          <i class="fa-solid fa-spinner fa-spin"></i> 正在扫描角色、世界书、美化主题、预设与插件 Git 地址...
        </div>
    `);

    $("#cv-backup-back").on("click", () => renderCharacterGrid());

    await loadFullBackupCatalog();

    // 组装 5 大可折叠精细勾选卡片
    const charGridHtml = backupCatalog.characters.map((c, idx) => `
        <label class="cv-sub-item" title="${escapeHtml(c.name)}${c.boundWorld ? ` (绑定世界书: ${c.boundWorld})` : ""}">
          <input type="checkbox" class="cv-item-cb" data-cat="characters" data-idx="${idx}" ${c.checked ? "checked" : ""} />
          <span>${escapeHtml(c.name)}</span>
          ${c.boundWorld ? `<i class="fa-solid fa-book-atlas" style="font-size:10px;opacity:0.65;margin-left:auto;" title="含专属世界书"></i>` : ""}
        </label>
    `).join("");

    const worldGridHtml = backupCatalog.worlds.length
        ? backupCatalog.worlds.map((w, idx) => `
            <label class="cv-sub-item" title="${escapeHtml(w.name)}">
              <input type="checkbox" class="cv-item-cb" data-cat="worlds" data-idx="${idx}" ${w.checked ? "checked" : ""} />
              <span>${escapeHtml(w.name)}</span>
              ${w.isBound ? `<span style="font-size:10px;opacity:0.6;margin-left:auto;">角色关联</span>` : ""}
            </label>
          `).join("")
        : `<div style="opacity:0.6;font-size:12px;">暂无独立世界书</div>`;

    const themeGridHtml = `
        <label class="cv-sub-item" style="grid-column:1 / -1;border-color:var(--cv-accent);">
          <input type="checkbox" id="cv-cb-custom-css" ${backupCatalog.includeCustomCss ? "checked" : ""} />
          <span><b>全局自定义美化 CSS 与界面参数</b> (power_user / custom_css)</span>
        </label>
        ${backupCatalog.themes.map((t, idx) => `
          <label class="cv-sub-item" title="${escapeHtml(t.name)}">
            <input type="checkbox" class="cv-item-cb" data-cat="themes" data-idx="${idx}" ${t.checked ? "checked" : ""} />
            <span>${escapeHtml(t.name)}</span>
          </label>
        `).join("")}
    `;

    const presetGridHtml = backupCatalog.presets.length
        ? backupCatalog.presets.map((p, idx) => `
            <label class="cv-sub-item" title="${escapeHtml(p.name)}">
              <input type="checkbox" class="cv-item-cb" data-cat="presets" data-idx="${idx}" ${p.checked ? "checked" : ""} />
              <span>${escapeHtml(p.name)}</span>
            </label>
          `).join("")
        : `<div style="opacity:0.6;font-size:12px;">将默认导出当前全局采样与对话预设参数</div>`;

    const extRowsHtml = backupCatalog.extensions.length
        ? backupCatalog.extensions.map((ext, idx) => `
            <div class="cv-ext-row">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <label style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:12.5px;cursor:pointer;">
                  <input type="checkbox" class="cv-item-cb" data-cat="extensions" data-idx="${idx}" ${ext.checked ? "checked" : ""} />
                  <span>${escapeHtml(ext.displayName)}</span>
                </label>
                <span style="font-size:11px;opacity:0.65;">${ext.url ? "已识别 Git 地址" : "未检测到远程地址"}</span>
              </div>
              <input type="text" class="cv-input-field cv-ext-url-input" data-idx="${idx}" data-extname="${escapeHtml(ext.displayName)}" placeholder="GitHub 仓库地址 (如 https://github.com/作者/插件名)" value="${escapeHtml(ext.url)}" />
            </div>
          `).join("")
        : `<div style="opacity:0.6;font-size:12px;">未检测到第三方插件</div>`;

    $body.html(`
        <div class="cv-detail-header">
          <span class="cv-pill" id="cv-backup-back"><i class="fa-solid fa-arrow-left"></i> 返回海报墙</span>
          <div style="font-weight:600;font-size:15px;">模块化备份与云同步</div>
        </div>

        <div style="font-size:12px;opacity:0.72;margin-bottom:10px;">
          点击下方任意分类卡片可展开并精细勾选要导出的具体项目：
        </div>

        <!-- 1. 角色卡与关联世界书/聊天档位 -->
        <div class="cv-acc-card open" data-section="characters">
          <div class="cv-acc-header">
            <div class="cv-acc-left">
              <input type="checkbox" class="cv-master-cb" data-cat="characters" checked />
              <div>
                <div class="cv-acc-title">角色卡与聊天档位</div>
                <div class="cv-acc-sub">支持按角色勾选，角色绑定的专属世界书与历史记录自动跟随导出</div>
              </div>
            </div>
            <span class="cv-acc-badge" id="cv-count-characters">${backupCatalog.characters.length}/${backupCatalog.characters.length}</span>
            <i class="fa-solid fa-chevron-down cv-acc-arrow"></i>
          </div>
          <div class="cv-acc-body">
            <div class="cv-sub-toolbar">
              <div style="display:flex;gap:12px;flex-wrap:wrap;">
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                  <input type="checkbox" id="cv-opt-char-chats" checked /> 附带角色聊天记录与备注
                </label>
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                  <input type="checkbox" id="cv-opt-char-world" checked /> 角色自带世界书自动跟随导出
                </label>
              </div>
              <div style="display:flex;gap:6px;">
                <span class="cv-pill cv-batch-btn" data-cat="characters" data-val="1" style="padding:2px 8px;font-size:11px;">全选</span>
                <span class="cv-pill cv-batch-btn" data-cat="characters" data-val="0" style="padding:2px 8px;font-size:11px;">全不选</span>
              </div>
            </div>
            <div class="cv-sub-grid">${charGridHtml}</div>
          </div>
        </div>

        <!-- 2. 世界书 -->
        <div class="cv-acc-card" data-section="worlds">
          <div class="cv-acc-header">
            <div class="cv-acc-left">
              <input type="checkbox" class="cv-master-cb" data-cat="worlds" checked />
              <div>
                <div class="cv-acc-title">世界书 (World Info)</div>
                <div class="cv-acc-sub">可单独勾选需要导出的全局或独立世界书</div>
              </div>
            </div>
            <span class="cv-acc-badge" id="cv-count-worlds">${backupCatalog.worlds.length}/${backupCatalog.worlds.length}</span>
            <i class="fa-solid fa-chevron-down cv-acc-arrow"></i>
          </div>
          <div class="cv-acc-body">
            <div class="cv-sub-toolbar">
              <span>选择要导出的世界书文件：</span>
              <div style="display:flex;gap:6px;">
                <span class="cv-pill cv-batch-btn" data-cat="worlds" data-val="1" style="padding:2px 8px;font-size:11px;">全选</span>
                <span class="cv-pill cv-batch-btn" data-cat="worlds" data-val="0" style="padding:2px 8px;font-size:11px;">全不选</span>
              </div>
            </div>
            <div class="cv-sub-grid">${worldGridHtml}</div>
          </div>
        </div>

        <!-- 3. 美化主题 (独立模块) -->
        <div class="cv-acc-card" data-section="themes">
          <div class="cv-acc-header">
            <div class="cv-acc-left">
              <input type="checkbox" class="cv-master-cb" data-cat="themes" checked />
              <div>
                <div class="cv-acc-title">美化主题与自定义 CSS</div>
                <div class="cv-acc-sub">包含第三方美化配色方案、毛玻璃参数与自定义 CSS 代码</div>
              </div>
            </div>
            <span class="cv-acc-badge" id="cv-count-themes">${backupCatalog.themes.length + 1}/${backupCatalog.themes.length + 1}</span>
            <i class="fa-solid fa-chevron-down cv-acc-arrow"></i>
          </div>
          <div class="cv-acc-body">
            <div class="cv-sub-toolbar">
              <span>勾选美化项：</span>
              <div style="display:flex;gap:6px;">
                <span class="cv-pill cv-batch-btn" data-cat="themes" data-val="1" style="padding:2px 8px;font-size:11px;">全选</span>
                <span class="cv-pill cv-batch-btn" data-cat="themes" data-val="0" style="padding:2px 8px;font-size:11px;">全不选</span>
              </div>
            </div>
            <div class="cv-sub-grid">${themeGridHtml}</div>
          </div>
        </div>

        <!-- 4. 对话预设 (独立模块) -->
        <div class="cv-acc-card" data-section="presets">
          <div class="cv-acc-header">
            <div class="cv-acc-left">
              <input type="checkbox" class="cv-master-cb" data-cat="presets" checked />
              <div>
                <div class="cv-acc-title">对话预设 (Presets)</div>
                <div class="cv-acc-sub">独立于美化之外的提示词预设、破限条目与采样参数</div>
              </div>
            </div>
            <span class="cv-acc-badge" id="cv-count-presets">${backupCatalog.presets.length}/${backupCatalog.presets.length}</span>
            <i class="fa-solid fa-chevron-down cv-acc-arrow"></i>
          </div>
          <div class="cv-acc-body">
            <div class="cv-sub-toolbar">
              <span>勾选要导出的预设配置：</span>
              <div style="display:flex;gap:6px;">
                <span class="cv-pill cv-batch-btn" data-cat="presets" data-val="1" style="padding:2px 8px;font-size:11px;">全选</span>
                <span class="cv-pill cv-batch-btn" data-cat="presets" data-val="0" style="padding:2px 8px;font-size:11px;">全不选</span>
              </div>
            </div>
            <div class="cv-sub-grid">${presetGridHtml}</div>
          </div>
        </div>

        <!-- 5. 第三方插件清单与配置 -->
        <div class="cv-acc-card open" data-section="extensions">
          <div class="cv-acc-header">
            <div class="cv-acc-left">
              <input type="checkbox" class="cv-master-cb" data-cat="extensions" checked />
              <div>
                <div class="cv-acc-title">第三方插件与配置</div>
                <div class="cv-acc-sub">已自动读取底层 Git 安装地址，恢复时可自动重新下载所选插件</div>
              </div>
            </div>
            <span class="cv-acc-badge" id="cv-count-extensions">${backupCatalog.extensions.length}/${backupCatalog.extensions.length}</span>
            <i class="fa-solid fa-chevron-down cv-acc-arrow"></i>
          </div>
          <div class="cv-acc-body">
            <div class="cv-sub-toolbar">
              <span>勾选要导出的插件（可核对或修改 GitHub 链接）：</span>
              <div style="display:flex;gap:6px;">
                <span class="cv-pill cv-batch-btn" data-cat="extensions" data-val="1" style="padding:2px 8px;font-size:11px;">全选</span>
                <span class="cv-pill cv-batch-btn" data-cat="extensions" data-val="0" style="padding:2px 8px;font-size:11px;">全不选</span>
              </div>
            </div>
            <div style="max-height:240px;overflow-y:auto;">${extRowsHtml}</div>
          </div>
        </div>

        <!-- 本地导出/恢复 与 GitHub 云同步操作区 -->
        <div class="cv-acc-card" style="padding:14px;">
          <div style="font-weight:600;font-size:13.5px;margin-bottom:8px;color:var(--cv-em);">执行备份或恢复</div>
          <div class="cv-action-row">
            <button type="button" class="cv-btn-block primary" id="cv-export-local-btn">
              <i class="fa-solid fa-download"></i> 导出已勾选数据到本地
            </button>
            <button type="button" class="cv-btn-block" id="cv-import-local-btn">
              <i class="fa-solid fa-upload"></i> 从本地备份文件恢复
            </button>
            <input type="file" id="cv-import-file-input" accept=".json" style="display:none;" />
          </div>

          <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--cv-border);">
            <div style="font-weight:600;font-size:13px;margin-bottom:8px;">GitHub 私有仓库云同步</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
              <input type="password" class="cv-input-field" id="cv-gh-token" placeholder="GitHub Token (ghp_...)" value="${escapeHtml(settings.ghToken)}" />
              <input type="text" class="cv-input-field" id="cv-gh-repo" placeholder="用户名/私有仓库名" value="${escapeHtml(settings.ghRepo)}" />
            </div>
            <div class="cv-action-row">
              <button type="button" class="cv-btn-block primary" id="cv-cloud-upload-btn">
                <i class="fa-solid fa-cloud-arrow-up"></i> 上传至 GitHub 云端
              </button>
              <button type="button" class="cv-btn-block" id="cv-cloud-restore-btn">
                <i class="fa-solid fa-cloud-arrow-down"></i> 从 GitHub 云端恢复
              </button>
            </div>
          </div>
        </div>

        <div id="cv-backup-progress" style="font-size:12.5px;text-align:center;padding:8px;color:var(--cv-accent);font-weight:500;"></div>
    `);

    $("#cv-backup-back").on("click", () => renderCharacterGrid());

    // 刷新各分类选中计数徽章
    const updateBadges = () => {
        ["characters", "worlds", "presets", "extensions"].forEach((cat) => {
            const arr = backupCatalog[cat] || [];
            const checkedCount = arr.filter((x) => x.checked).length;
            $(`#cv-count-${cat}`).text(`${checkedCount}/${arr.length}`);
            $(`.cv-master-cb[data-cat="${cat}"]`).prop("checked", checkedCount > 0);
        });
        const themeChecked = backupCatalog.themes.filter((x) => x.checked).length + (backupCatalog.includeCustomCss ? 1 : 0);
        const themeTotal = backupCatalog.themes.length + 1;
        $(`#cv-count-themes`).text(`${themeChecked}/${themeTotal}`);
        $(`.cv-master-cb[data-cat="themes"]`).prop("checked", themeChecked > 0);
    };

    // 手风琴折叠切换（点击复选框本身不触发折叠）
    $body.find(".cv-acc-header").on("click", function (e) {
        if ($(e.target).is("input")) return;
        $(this).closest(".cv-acc-card").toggleClass("open");
    });

    // 主分类复选框一键全选/取消
    $body.find(".cv-master-cb").on("change", function () {
        const cat = $(this).data("cat");
        const val = $(this).prop("checked");
        if (cat === "themes") {
            backupCatalog.includeCustomCss = val;
            $("#cv-cb-custom-css").prop("checked", val);
        }
        (backupCatalog[cat] || []).forEach((item) => { item.checked = val; });
        $body.find(`.cv-item-cb[data-cat="${cat}"]`).prop("checked", val);
        updateBadges();
    });

    // 分类内【全选 / 全不选】小按钮
    $body.find(".cv-batch-btn").on("click", function () {
        const cat = $(this).data("cat");
        const val = Boolean(Number($(this).data("val")));
        if (cat === "themes") {
            backupCatalog.includeCustomCss = val;
            $("#cv-cb-custom-css").prop("checked", val);
        }
        (backupCatalog[cat] || []).forEach((item) => { item.checked = val; });
        $body.find(`.cv-item-cb[data-cat="${cat}"]`).prop("checked", val);
        updateBadges();
    });

    // 单个子项勾选变动
    $body.find(".cv-item-cb").on("change", function () {
        const cat = $(this).data("cat");
        const idx = Number($(this).data("idx"));
        if (backupCatalog[cat]?.[idx]) {
            backupCatalog[cat][idx].checked = $(this).prop("checked");
        }
        updateBadges();
    });

    $("#cv-cb-custom-css").on("change", function () {
        backupCatalog.includeCustomCss = $(this).prop("checked");
        updateBadges();
    });

    $("#cv-opt-char-chats").on("change", function () {
        backupCatalog.includeChatsWithChar = $(this).prop("checked");
    });

    $("#cv-opt-char-world").on("change", function () {
        backupCatalog.includeBoundWorldWithChar = $(this).prop("checked");
    });

    // 插件 URL 手动修改实时同步到 backupCatalog 与 settings
    $body.find(".cv-ext-url-input").on("input change", function () {
        const idx = Number($(this).data("idx"));
        const name = $(this).data("extname");
        const val = $(this).val().trim();
        if (backupCatalog.extensions[idx]) {
            backupCatalog.extensions[idx].url = val;
        }
        settings.customExtUrls[name] = val;
        saveSettings();
    });

    // 保存 GitHub 配置
    $("#cv-gh-token, #cv-gh-repo").on("change", function () {
        settings.ghToken = $("#cv-gh-token").val().trim();
        settings.ghRepo = $("#cv-gh-repo").val().trim();
        saveSettings();
    });

    // 绑定导出与恢复事件
    $("#cv-export-local-btn").on("click", async () => {
        try {
            const pack = await buildSelectiveBackupPackage((msg) => $("#cv-backup-progress").text(msg));
            const blob = new Blob([JSON.stringify(pack)], { type: "application/json;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `ST_Backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            $("#cv-backup-progress").text("导出完成！备份文件已开始下载。");
        } catch (err) {
            $("#cv-backup-progress").text("导出失败：" + err.message);
        }
    });

    $("#cv-import-local-btn").on("click", () => $("#cv-import-file-input").trigger("click"));
    $("#cv-import-file-input").on("change", async function (e) {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const pack = JSON.parse(text);
            await restoreFromBackupPackage(pack, (msg) => $("#cv-backup-progress").text(msg));
        } catch (err) {
            $("#cv-backup-progress").text("恢复失败：" + err.message);
        }
    });

    $("#cv-cloud-upload-btn").on("click", async () => {
        try {
            await uploadBackupToGitHub((msg) => $("#cv-backup-progress").text(msg));
        } catch (err) {
            $("#cv-backup-progress").text("云端上传失败：" + err.message);
        }
    });

    $("#cv-cloud-restore-btn").on("click", async () => {
        try {
            await restoreBackupFromGitHub((msg) => $("#cv-backup-progress").text(msg));
        } catch (err) {
            $("#cv-backup-progress").text("云端恢复失败：" + err.message);
        }
    });
}

// 按用户精细勾选的子项构建备份包
async function buildSelectiveBackupPackage(onProgress) {
    const settings = getSettings();
    const pack = {
        version: "1.0.0",
        timestamp: Date.now(),
        modules: {},
    };

    const selectedChars = backupCatalog.characters.filter((c) => c.checked);
    const autoBoundWorldNames = new Set();

    // 1. 打包选中的角色卡 + 聊天记录 + 关联世界书标记
    if (selectedChars.length > 0) {
        const charDataList = [];
        for (let i = 0; i < selectedChars.length; i++) {
            const c = selectedChars[i];
            onProgress(`正在打包角色 (${i + 1}/${selectedChars.length}): ${c.name}...`);

            if (backupCatalog.includeBoundWorldWithChar && c.boundWorld) {
                autoBoundWorldNames.add(c.boundWorld);
            }

            let pngBase64 = null;
            try {
                const imgRes = await fetch(`/characters/${encodeURIComponent(c.avatar)}`);
                if (imgRes.ok) {
                    const blob = await imgRes.blob();
                    pngBase64 = await blobToBase64(blob);
                }
            } catch (_) {}

            const chatFiles = [];
            if (backupCatalog.includeChatsWithChar) {
                const chatMetas = await fetchCharacterChats(c.avatar);
                for (const meta of chatMetas) {
                    const fName = stripFileExt(meta.file_name);
                    const rawChat = await fetchRawChatArray(c.name, c.avatar, fName);
                    if (rawChat.length) {
                        chatFiles.push({ fileName: fName, chat: rawChat });
                    }
                }
            }

            charDataList.push({
                name: c.name,
                avatar: c.avatar,
                boundWorld: c.boundWorld,
                pngBase64,
                chats: chatFiles,
            });
        }

        pack.modules.charactersAndChats = {
            characters: charDataList,
            vaultNotes: settings.notes,
            vaultPinned: settings.pinned,
        };
    }

    // 2. 打包世界书（用户手动勾选的世界书 + 角色自动带出的关联世界书）
    const targetWorldNames = new Set([
        ...backupCatalog.worlds.filter((w) => w.checked).map((w) => w.name),
        ...autoBoundWorldNames,
    ]);

    if (targetWorldNames.size > 0) {
        onProgress(`正在打包 ${targetWorldNames.size} 本世界书...`);
        const worldsData = [];
        for (const wName of targetWorldNames) {
            try {
                const wRes = await fetch("/api/worldinfo/get", {
                    method: "POST",
                    headers: getRequestHeaders(),
                    body: JSON.stringify({ name: wName }),
                });
                if (wRes.ok) {
                    const wContent = await wRes.json();
                    worldsData.push({ name: wName, data: wContent });
                }
            } catch (_) {}
        }
        pack.modules.worlds = worldsData;
    }

    // 3. 打包美化主题 (独立模块)
    const selectedThemes = backupCatalog.themes.filter((t) => t.checked);
    if (selectedThemes.length > 0 || backupCatalog.includeCustomCss) {
        onProgress("正在打包美化主题与 CSS...");
        const raw = backupCatalog.rawSettingsSnapshot || {};
        pack.modules.themes = {
            includeCustomCss: backupCatalog.includeCustomCss,
            activeTheme: raw.theme,
            customCss: raw.power_user?.custom_css || raw.custom_css || "",
            powerUserStyle: raw.power_user || {},
            themeItems: selectedThemes.map((t) => t.data),
        };
    }

    // 4. 打包对话预设 (独立模块)
    const selectedPresets = backupCatalog.presets.filter((p) => p.checked);
    if (selectedPresets.length > 0) {
        onProgress("正在打包对话预设...");
        const raw = backupCatalog.rawSettingsSnapshot || {};
        pack.modules.presets = {
            items: selectedPresets,
            oaiSettings: raw.oai_settings || {},
        };
    }

    // 5. 打包选中的第三方插件清单与配置
    const selectedExts = backupCatalog.extensions.filter((e) => e.checked);
    if (selectedExts.length > 0) {
        onProgress("正在打包插件下载清单与配置...");
        const filteredExtSettings = {};
        for (const ext of selectedExts) {
            if (extension_settings[ext.displayName]) {
                filteredExtSettings[ext.displayName] = extension_settings[ext.displayName];
            }
            if (extension_settings[ext.id]) {
                filteredExtSettings[ext.id] = extension_settings[ext.id];
            }
        }
        pack.modules.extensions = {
            installList: selectedExts.map((e) => ({
                name: e.id,
                displayName: e.displayName,
                url: e.url,
            })),
            extensionSettings: filteredExtSettings,
            customExtUrls: settings.customExtUrls,
        };
    }

    return pack;
}

// 从备份包恢复
async function restoreFromBackupPackage(pack, onProgress) {
    if (!pack || !pack.modules) throw new Error("无效的备份文件格式");
    const mods = pack.modules;

    if (!confirm("即将根据备份包恢复数据，确定继续吗？")) return;

    // 1. 自动重装第三方插件
    if (mods.extensions) {
        const list = (mods.extensions.installList || []).filter((e) => e.url && e.url.startsWith("http"));
        for (let i = 0; i < list.length; i++) {
            const ext = list[i];
            if (ext.displayName === EXT_NAME || ext.name.includes(EXT_NAME)) continue;
            onProgress(`正在从 GitHub 自动安装插件 (${i + 1}/${list.length}): ${ext.displayName}...`);
            try {
                await fetch("/api/extensions/install", {
                    method: "POST",
                    headers: getRequestHeaders(),
                    body: JSON.stringify({ url: ext.url }),
                });
            } catch (_) {}
        }
        if (mods.extensions.extensionSettings) {
            Object.assign(extension_settings, mods.extensions.extensionSettings);
            saveSettings();
        }
    }

    // 2. 恢复世界书（含角色自带世界书）
    if (Array.isArray(mods.worlds)) {
        for (let i = 0; i < mods.worlds.length; i++) {
            const w = mods.worlds[i];
            onProgress(`正在恢复世界书 (${i + 1}/${mods.worlds.length}): ${w.name}...`);
            try {
                await fetch("/api/worldinfo/edit", {
                    method: "POST",
                    headers: getRequestHeaders(),
                    body: JSON.stringify({ name: w.name, data: w.data }),
                });
            } catch (_) {}
        }
    }

    // 3. 恢复角色卡与聊天档位
    if (mods.charactersAndChats) {
        const settings = getSettings();
        if (mods.charactersAndChats.vaultNotes) {
            Object.assign(settings.notes, mods.charactersAndChats.vaultNotes);
        }
        if (Array.isArray(mods.charactersAndChats.vaultPinned)) {
            settings.pinned = mods.charactersAndChats.vaultPinned;
        }
        saveSettings();

        const chars = mods.charactersAndChats.characters || [];
        for (let i = 0; i < chars.length; i++) {
            const c = chars[i];
            onProgress(`正在恢复角色 (${i + 1}/${chars.length}): ${c.name}...`);

            if (c.pngBase64) {
                try {
                    const blob = base64ToBlob(c.pngBase64);
                    const formData = new FormData();
                    formData.append("avatar", blob, c.avatar || `${c.name}.png`);
                    formData.append("file_type", "png");
                    const headers = getRequestHeaders();
                    delete headers["Content-Type"];
                    await fetch("/api/characters/import", {
                        method: "POST",
                        headers,
                        body: formData,
                    });
                } catch (_) {}
            }

            if (Array.isArray(c.chats)) {
                for (const slot of c.chats) {
                    try {
                        await fetch("/api/chats/save", {
                            method: "POST",
                            headers: getRequestHeaders(),
                            body: JSON.stringify({
                                ch_name: c.name,
                                file_name: slot.fileName,
                                chat: slot.chat,
                                avatar_url: c.avatar,
                            }),
                        });
                    } catch (_) {}
                }
            }
        }
    }

    // 4. 恢复独立的美化主题与对话预设
    if (mods.themes || mods.presets || mods.themesAndPresets) {
        onProgress("正在恢复美化主题与预设参数...");
        try {
            const res = await fetch("/api/settings/get", {
                method: "POST",
                headers: getRequestHeaders(),
                body: JSON.stringify({}),
            });
            if (res.ok) {
                const sData = await res.json();
                const currentSettings = sData.settings ? JSON.parse(sData.settings) : {};

                if (mods.themes) {
                    if (mods.themes.activeTheme) currentSettings.theme = mods.themes.activeTheme;
                    if (mods.themes.includeCustomCss && mods.themes.powerUserStyle) {
                        currentSettings.power_user = {
                            ...(currentSettings.power_user || {}),
                            ...mods.themes.powerUserStyle,
                        };
                    }
                    // 逐个保存主题文件
                    if (Array.isArray(mods.themes.themeItems)) {
                        for (const t of mods.themes.themeItems) {
                            if (t && t.name) {
                                await fetch("/api/themes/save", {
                                    method: "POST",
                                    headers: getRequestHeaders(),
                                    body: JSON.stringify(t),
                                }).catch(() => {});
                            }
                        }
                    }
                }

                if (mods.presets) {
                    if (mods.presets.oaiSettings) {
                        currentSettings.oai_settings = {
                            ...(currentSettings.oai_settings || {}),
                            ...mods.presets.oaiSettings,
                        };
                    }
                    if (Array.isArray(mods.presets.items)) {
                        for (const p of mods.presets.items) {
                            if (p && p.name && p.data) {
                                await fetch("/api/presets/save", {
                                    method: "POST",
                                    headers: getRequestHeaders(),
                                    body: JSON.stringify({ name: p.name, preset: p.data, apiId: "openai" }),
                                }).catch(() => {});
                            }
                        }
                    }
                }

                // 兼容旧版全量 settingsJson
                if (mods.themesAndPresets?.settingsJson) {
                    Object.assign(currentSettings, mods.themesAndPresets.settingsJson);
                }

                await fetch("/api/settings/save", {
                    method: "POST",
                    headers: getRequestHeaders(),
                    body: JSON.stringify(currentSettings),
                });
            }
        } catch (_) {}
    }

    onProgress("全部所选数据已恢复完毕！即将刷新页面生效...");
    if (window.toastr) toastr.success("恢复成功！即将刷新页面...");
    setTimeout(() => location.reload(), 1800);
}

async function uploadBackupToGitHub(onProgress) {
    const settings = getSettings();
    const token = $("#cv-gh-token").val()?.trim() || settings.ghToken;
    const repo = $("#cv-gh-repo").val()?.trim() || settings.ghRepo;
    if (!token || !repo) throw new Error("请先填写 GitHub Token 和仓库名");

    settings.ghToken = token;
    settings.ghRepo = repo;
    saveSettings();

    const pack = await buildSelectiveBackupPackage(onProgress);
    onProgress("正在上传至 GitHub 私有仓库...");

    const contentBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(pack))));
    const filePath = "st_vault_backup.json";
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;

    let sha = undefined;
    const getRes = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
    });
    if (getRes.ok) {
        const existing = await getRes.json();
        sha = existing.sha;
    }

    const putRes = await fetch(apiUrl, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            message: `Selective Backup via Chat Vault (${new Date().toISOString()})`,
            content: contentBase64,
            sha,
        }),
    });

    if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        throw new Error(errData.message || `HTTP ${putRes.status}`);
    }

    onProgress("云端同步成功！所选数据已上传至 GitHub 仓库。");
    if (window.toastr) toastr.success("GitHub 云端备份成功");
}

async function restoreBackupFromGitHub(onProgress) {
    const settings = getSettings();
    const token = $("#cv-gh-token").val()?.trim() || settings.ghToken;
    const repo = $("#cv-gh-repo").val()?.trim() || settings.ghRepo;
    if (!token || !repo) throw new Error("请先填写 GitHub Token 和仓库名");

    onProgress("正在从 GitHub 云端拉取备份包...");
    const apiUrl = `https://api.github.com/repos/${repo}/contents/st_vault_backup.json`;
    const res = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3.raw" },
    });

    if (!res.ok) throw new Error(`拉取失败 (HTTP ${res.status})`);
    const text = await res.text();
    const pack = JSON.parse(text);
    await restoreFromBackupPackage(pack, onProgress);
}

/* =========================================================
   10. 全局搜索与跨档位全文定位
   ========================================================= */
async function buildFullTextIndex(showToast = true) {
    if (isIndexing) return;
    isIndexing = true;
    const ctx = getContext();
    const chars = ctx?.characters || [];

    if (showToast && window.toastr) toastr.info("正在建立聊天全文索引...");
    $("#cv-sub-status").text("正在建立索引...");

    for (let chid = 0; chid < chars.length; chid++) {
        const c = chars[chid];
        if (!c?.avatar) continue;
        const chats = await fetchCharacterChats(c.avatar);

        for (const chatMeta of chats) {
            const fName = stripFileExt(chatMeta.file_name);
            const key = getSlotKey(c.avatar, fName);
            if (fullTextIndex.has(key)) continue;

            const rawMsgs = await fetchChatMessages(c.name, c.avatar, fName);
            const slimMsgs = rawMsgs.map((m, idx) => ({
                mesid: idx,
                name: m.name || "",
                text: String(m.mes || ""),
            }));

            fullTextIndex.set(key, {
                chid,
                avatar: c.avatar,
                charName: c.name,
                fileName: fName,
                messages: slimMsgs,
            });
        }
    }

    isIndexing = false;
    $("#cv-sub-status").text(`已索引 ${fullTextIndex.size} 档`);
    if (showToast && window.toastr) toastr.success(`全文索引完成，共收录 ${fullTextIndex.size} 个档位`);

    const currentKw = $("#cv-search-input").val()?.trim();
    if (currentKw) renderSearchResults(currentKw);
}

function highlightKeyword(text, kw) {
    const safeText = escapeHtml(text);
    const safeKw = escapeHtml(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return safeText.replace(new RegExp(`(${safeKw})`, "gi"), `<span class="cv-highlight-kw">$1</span>`);
}

async function renderSearchResults(keyword) {
    currentView = "search";
    $("#cv-filter-bar").hide();
    const ctx = getContext();
    const chars = ctx?.characters || [];
    const settings = getSettings();
    const kwLower = keyword.toLowerCase();
    const $body = $("#cv-body-content");

    const matchedChars = chars
        .map((c, idx) => ({ chid: idx, char: c }))
        .filter(({ char }) => char?.name?.toLowerCase().includes(kwLower));

    const messageHits = [];

    if (ctx.characterId !== undefined && ctx.chat?.length) {
        const curChar = chars[ctx.characterId];
        if (curChar) {
            const curFile = stripFileExt(curChar.chat || "当前档位");
            const curKey = getSlotKey(curChar.avatar, curFile);
            fullTextIndex.set(curKey, {
                chid: Number(ctx.characterId),
                avatar: curChar.avatar,
                charName: curChar.name,
                fileName: curFile,
                messages: ctx.chat.map((m, i) => ({
                    mesid: i,
                    name: m.name || "",
                    text: String(m.mes || ""),
                })),
            });
        }
    }

    for (const [, entry] of fullTextIndex.entries()) {
        const note = settings.notes[getSlotKey(entry.avatar, entry.fileName)] || "";
        if (entry.fileName.toLowerCase().includes(kwLower) || note.toLowerCase().includes(kwLower)) {
            messageHits.push({
                chid: entry.chid,
                charName: entry.charName,
                fileName: entry.fileName,
                mesid: 0,
                snippet: `[档位/备注匹配] ${note ? `${note} · ` : ""}${entry.fileName}`,
            });
        }

        for (const msg of entry.messages) {
            const pos = msg.text.toLowerCase().indexOf(kwLower);
            if (pos !== -1) {
                const start = Math.max(0, pos - 24);
                const end = Math.min(msg.text.length, pos + keyword.length + 36);
                const snippet = (start > 0 ? "..." : "") + msg.text.slice(start, end) + (end < msg.text.length ? "..." : "");
                messageHits.push({
                    chid: entry.chid,
                    charName: entry.charName,
                    fileName: entry.fileName,
                    mesid: msg.mesid,
                    speaker: msg.name,
                    snippet,
                });
                if (messageHits.length >= 60) break;
            }
        }
        if (messageHits.length >= 60) break;
    }

    let html = "";
    if (matchedChars.length > 0) {
        html += `<div class="cv-section-label">匹配的角色 (${matchedChars.length})</div>`;
        html += `<div class="cv-pinned-list" style="margin-bottom:14px;">`;
        for (const { chid, char } of matchedChars) {
            html += `
                <div class="cv-pin-chip cv-search-char-hit" data-chid="${chid}">
                  <div class="cv-pin-chip-title">${highlightKeyword(char.name, keyword)}</div>
                  <div class="cv-pin-chip-sub">点击查看档位</div>
                </div>
            `;
        }
        html += `</div>`;
    }

    html += `
        <div class="cv-section-label" style="justify-content:space-between;">
          <span>匹配的聊天楼层 (${messageHits.length}${messageHits.length >= 60 ? "+" : ""})</span>
          <span class="cv-pill" id="cv-search-index-now" style="font-size:11px;">扫描全部历史档位</span>
        </div>
    `;

    if (messageHits.length === 0) {
        html += `
            <div style="text-align:center;padding:28px 14px;opacity:0.8;">
              <div style="margin-bottom:10px;">未在已缓存档位中找到「<b>${escapeHtml(keyword)}</b>」</div>
              <button type="button" id="cv-deep-scan-btn" class="cv-pill active" style="padding:8px 16px;">
                扫描所有角色的历史档位
              </button>
            </div>
        `;
    } else {
        html += messageHits.map((hit) => `
            <div class="cv-search-hit" data-chid="${hit.chid}" data-file="${escapeHtml(hit.fileName)}" data-mesid="${hit.mesid}">
              <div class="cv-hit-header">
                <span>${escapeHtml(hit.charName)} · ${escapeHtml(hit.fileName)}</span>
                <span class="cv-pill active" style="padding:2px 8px;font-size:11px;">#${hit.mesid} 楼</span>
              </div>
              <div class="cv-hit-snippet">
                ${hit.speaker ? `<b>${escapeHtml(hit.speaker)}:</b> ` : ""}
                ${highlightKeyword(hit.snippet, keyword)}
              </div>
            </div>
        `).join("");
    }

    $body.html(html);

    $body.find(".cv-search-char-hit").on("click", function () {
        renderCharacterSlots(Number($(this).data("chid")));
    });
    $("#cv-search-index-now, #cv-deep-scan-btn").on("click", () => buildFullTextIndex(true));
    $body.find(".cv-search-hit").on("click", function () {
        switchAndLocate(Number($(this).data("chid")), $(this).data("file"), Number($(this).data("mesid")));
    });
}

/* =========================================================
   11. 清理只有 1 楼的空档位
   ========================================================= */
async function runEmptySlotCleaner() {
    const ctx = getContext();
    const chars = ctx?.characters || [];
    const settings = getSettings();

    const targetChids = currentView === "detail" && selectedCharId !== null
        ? [selectedCharId]
        : chars.map((_, idx) => idx);

    if (window.toastr) toastr.info("正在扫描只有 1 楼的空档位...");
    const emptyList = [];

    for (const chid of targetChids) {
        const c = chars[chid];
        if (!c?.avatar) continue;
        const chats = await fetchCharacterChats(c.avatar);
        if (chats.length <= 1) continue;

        const currentFile = stripFileExt(c.chat || "");
        for (const slot of chats) {
            const fName = stripFileExt(slot.file_name);
            const key = getSlotKey(c.avatar, fName);
            const hasNote = Boolean(settings.notes[key]);
            const isPinned = settings.pinned.some((p) => p.avatar === c.avatar && p.fileName === fName);

            if ((slot.chat_items !== undefined && slot.chat_items <= 1) && fName !== currentFile && !hasNote && !isPinned) {
                emptyList.push({ chid, charName: c.name, avatar: c.avatar, fileName: fName });
            }
        }
    }

    if (!emptyList.length) {
        if (window.toastr) toastr.success("没有发现多余的 1 楼空档位");
        return;
    }

    const previewNames = emptyList.slice(0, 6).map((e) => `[${e.charName}] ${e.fileName}`).join("\n");
    if (!confirm(`共扫描到 ${emptyList.length} 个只有 1 楼且未备注的空档位：\n\n${previewNames}\n\n确定要清理吗？`)) return;

    let delCount = 0;
    for (const item of emptyList) {
        if (await deleteChatFile(item.avatar, item.fileName)) delCount++;
    }

    if (window.toastr) toastr.success(`已清理 ${delCount} 个空档位`);
    if (currentView === "detail" && selectedCharId !== null) renderCharacterSlots(selectedCharId);
    else renderCharacterGrid();
}

/* =========================================================
   12. 插件启动入口
   ========================================================= */
jQuery(() => {
    injectMasterStyles();
    const settings = getSettings();

    $(".chat-vault-settings").remove();

    const inlineSettingsHtml = `
      <div class="chat-vault-settings">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>存档管家</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content">
            <div style="margin:10px 0;">
              <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="cv_enable_fab" />
                <span>开启悬浮球（支持长按快捷切档与贴边吸附）</span>
              </label>
            </div>
            <div style="margin:10px 0;display:flex;flex-direction:column;gap:4px;">
              <label for="cv_theme_mode">界面外观模式：</label>
              <select id="cv_theme_mode" class="text_pole">
                <option value="inherit">跟随酒馆美化主题（默认推荐）</option>
                <option value="dark">深色毛玻璃</option>
                <option value="light">浅色毛玻璃</option>
              </select>
            </div>
            <div style="margin:10px 0;display:flex;flex-direction:column;gap:4px;">
              <label for="cv_grid_cols">角色海报列数：</label>
              <select id="cv_grid_cols" class="text_pole">
                <option value="2">每行 2 列</option>
                <option value="3">每行 3 列</option>
              </select>
            </div>
            <div style="display:flex;gap:10px;margin-top:12px;width:100%;">
              <button type="button" onclick="window.cvOpenModal && window.cvOpenModal()" style="flex:1;white-space:nowrap;padding:9px 12px;border-radius:8px;border:1px solid var(--cv-border,rgba(255,255,255,0.2));background:var(--cv-accent,#6366f1);color:#fff;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
                <i class="fa-solid fa-layer-group"></i> 打开存档管家
              </button>
              <button type="button" onclick="window.cvRebuildIndex && window.cvRebuildIndex()" style="flex:1;white-space:nowrap;padding:9px 12px;border-radius:8px;border:1px solid var(--cv-border,rgba(255,255,255,0.2));background:rgba(128,128,140,0.2);color:var(--cv-text,#fff);font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
                <i class="fa-solid fa-rotate"></i> 刷新全文索引
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    $("#extensions_settings").append(inlineSettingsHtml);

    $("#cv_enable_fab").prop("checked", settings.enableFab).on("change", function () {
        settings.enableFab = $(this).prop("checked");
        saveSettings();
        initFloatingBall();
    });

    $("#cv_theme_mode").val(settings.themeMode).on("change", function () {
        settings.themeMode = $(this).val();
        saveSettings();
        initFloatingBall();
        const $modal = $("#cv-modal-overlay");
        if ($modal.length) applyThemeClass($modal);
    });

    $("#cv_grid_cols").val(String(settings.gridCols)).on("change", function () {
        settings.gridCols = Number($(this).val());
        saveSettings();
    });

    $("#cv-wand-entry").remove();
    const $wandItem = $(`
        <div id="cv-wand-entry" onclick="window.cvOpenModal && window.cvOpenModal()" class="list-group-item flex-container flexGap5 interactable">
          <i class="fa-solid fa-layer-group"></i>
          <span>存档管家</span>
        </div>
    `);
    $("#extensionsMenu").append($wandItem);

    initFloatingBall();

    eventSource.on(event_types.CHAT_CHANGED, () => {
        const ctx = getContext();
        if (ctx?.characterId !== undefined && ctx.characters?.[ctx.characterId]) {
            ctx.characters[ctx.characterId].date_last_chat = Date.now();
        }
    });
});

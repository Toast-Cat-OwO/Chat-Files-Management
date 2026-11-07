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
    fabPos: { top: "68%", left: "calc(100% - 58px)", dock: "right" },
    notes: {},
    pinned: [],
    chatCounts: {},
};

const fullTextIndex = new Map();
let isIndexing = false;
let currentView = "grid";
let selectedCharId = null;
let currentFilter = "recent";

/* =========================================================
   0. 强制内嵌注入 CSS 样式（彻底解决 style.css 没加载或透明隐形问题）
   ========================================================= */
function injectMasterStyles() {
    if (document.getElementById("cv-master-styles")) return;
    const styleEl = document.createElement("style");
    styleEl.id = "cv-master-styles";
    styleEl.textContent = `
      :root {
        --cv-bg: rgba(22, 24, 32, 0.94);
        --cv-blur: var(--SmartThemeBlurStrength, 16px);
        --cv-text: var(--SmartThemeBodyColor, #f3f4f6);
        --cv-em: var(--SmartThemeEmColor, #ffb86c);
        --cv-accent: var(--SmartThemeQuoteColor, #7aa2f7);
        --cv-border: var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.18));
        --cv-card-bg: rgba(128, 128, 145, 0.18);
        --cv-font: var(--mainFontFamily, -apple-system, BlinkMacSystemFont, sans-serif);
      }
      .cv-theme-dark {
        --cv-bg: rgba(16, 17, 23, 0.96) !important;
        --cv-text: #f3f4f6 !important;
        --cv-em: #fbbf24 !important;
        --cv-accent: #60a5fa !important;
        --cv-border: rgba(255, 255, 255, 0.15) !important;
        --cv-card-bg: rgba(255, 255, 255, 0.08) !important;
      }
      .cv-theme-light {
        --cv-bg: rgba(246, 247, 251, 0.96) !important;
        --cv-text: #1f2937 !important;
        --cv-em: #d97706 !important;
        --cv-accent: #2563eb !important;
        --cv-border: rgba(0, 0, 0, 0.15) !important;
        --cv-card-bg: rgba(0, 0, 0, 0.06) !important;
      }
      #cv-fab {
        position: fixed !important;
        z-index: 2147483640 !important;
        width: 48px !important;
        height: 48px !important;
        border-radius: 50% !important;
        background: rgba(24, 26, 36, 0.92) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        border: 2px solid var(--cv-accent) !important;
        color: #fff !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 22px !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55) !important;
        touch-action: none !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        cursor: pointer !important;
        transition: opacity 0.3s ease, transform 0.2s ease;
      }
      #cv-fab.cv-idle { opacity: 0.42 !important; }
      #cv-fab.cv-idle.cv-dock-left { transform: translateX(-12px); }
      #cv-fab.cv-idle.cv-dock-right { transform: translateX(12px); }

      #cv-modal-overlay, #cv-quick-sheet {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483645 !important;
        background: rgba(0, 0, 0, 0.65) !important;
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
        max-width: 680px !important;
        height: 88vh !important;
        background: var(--cv-bg) !important;
        backdrop-filter: blur(var(--cv-blur)) !important;
        -webkit-backdrop-filter: blur(var(--cv-blur)) !important;
        border-top: 1.5px solid var(--cv-border) !important;
        border-radius: 22px 22px 0 0 !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.6) !important;
      }
      .cv-quick-box {
        width: 100% !important;
        max-width: 520px !important;
        max-height: 72vh !important;
        background: var(--cv-bg) !important;
        backdrop-filter: blur(var(--cv-blur)) !important;
        -webkit-backdrop-filter: blur(var(--cv-blur)) !important;
        border-top: 1.5px solid var(--cv-border) !important;
        border-radius: 20px 20px 0 0 !important;
        padding: 16px !important;
        color: var(--cv-text) !important;
        overflow-y: auto !important;
      }
      .cv-quick-item {
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        margin-bottom: 8px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
      }
      .cv-header {
        padding: 12px 14px 8px;
        border-bottom: 1px solid var(--cv-border);
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex-shrink: 0;
      }
      .cv-top-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .cv-title {
        font-size: 16px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .cv-search-wrap {
        display: flex;
        align-items: center;
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        border-radius: 12px;
        padding: 4px 10px;
        gap: 6px;
      }
      .cv-search-wrap input {
        flex: 1;
        background: transparent !important;
        border: none !important;
        color: var(--cv-text) !important;
        font-size: 14px !important;
        outline: none !important;
        padding: 6px 0 !important;
      }
      .cv-filter-row {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding-bottom: 4px;
        scrollbar-width: none;
      }
      .cv-filter-row::-webkit-scrollbar { display: none; }
      .cv-pill {
        padding: 5px 11px;
        border-radius: 999px;
        font-size: 12px;
        white-space: nowrap;
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        color: var(--cv-text);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .cv-pill.active {
        background: var(--cv-accent) !important;
        color: #fff !important;
        border-color: transparent !important;
        font-weight: 600;
      }
      .cv-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px 14px 32px;
        -webkit-overflow-scrolling: touch;
      }
      .cv-pinned-bar { margin-bottom: 14px; }
      .cv-section-label {
        font-size: 12px;
        opacity: 0.8;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .cv-pinned-list {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 4px;
      }
      .cv-pin-chip {
        flex-shrink: 0;
        max-width: 200px;
        padding: 7px 10px;
        border-radius: 12px;
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-accent);
        cursor: pointer;
        font-size: 12px;
      }
      .cv-pin-chip-title {
        font-weight: 700;
        color: var(--cv-em);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cv-pin-chip-sub {
        opacity: 0.8;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cv-char-grid { display: grid; gap: 12px; }
      .cv-char-grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cv-char-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .cv-char-card {
        position: relative;
        aspect-ratio: 3 / 4.2;
        border-radius: 14px;
        overflow: hidden;
        border: 1px solid var(--cv-border);
        background: #222533;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
      }
      .cv-char-card img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .cv-char-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(0, 0, 0, 0.72);
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.2);
      }
      .cv-char-footer {
        position: absolute;
        left: 0; right: 0; bottom: 0;
        padding: 22px 10px 8px;
        background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 65%, transparent 100%);
        color: #fff;
      }
      .cv-char-name {
        font-size: 14px;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cv-char-time { font-size: 11px; opacity: 0.8; margin-top: 2px; }
      .cv-detail-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--cv-border);
      }
      .cv-detail-avatar {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        object-fit: cover;
        border: 1px solid var(--cv-accent);
      }
      .cv-slot-card {
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        border-radius: 14px;
        padding: 12px;
        margin-bottom: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .cv-slot-card.current-slot {
        border: 1.5px solid var(--cv-accent);
      }
      .cv-slot-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
        cursor: pointer;
      }
      .cv-slot-title { font-weight: 700; font-size: 14px; word-break: break-all; }
      .cv-slot-note-tag {
        display: inline-block;
        background: var(--cv-accent);
        color: #fff;
        font-size: 11px;
        padding: 2px 7px;
        border-radius: 6px;
        margin-right: 6px;
        font-weight: 600;
      }
      .cv-slot-meta { font-size: 11px; opacity: 0.78; display: flex; flex-wrap: wrap; gap: 8px; }
      .cv-slot-preview {
        font-size: 12.5px;
        opacity: 0.9;
        background: rgba(0, 0, 0, 0.25);
        padding: 8px 10px;
        border-radius: 8px;
        cursor: pointer;
      }
      .cv-slot-actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
        flex-wrap: wrap;
        padding-top: 6px;
        border-top: 1px dashed var(--cv-border);
      }
      .cv-btn-sm {
        padding: 5px 10px;
        border-radius: 8px;
        font-size: 12px;
        background: rgba(128, 128, 140, 0.22);
        border: 1px solid var(--cv-border);
        color: var(--cv-text);
        cursor: pointer;
      }
      .cv-btn-sm.primary { background: var(--cv-accent); color: #fff; border-color: transparent; }
      .cv-btn-sm.danger { color: #f87171; }
      .cv-search-hit {
        background: var(--cv-card-bg);
        border: 1px solid var(--cv-border);
        border-radius: 12px;
        padding: 10px 12px;
        margin-bottom: 8px;
        cursor: pointer;
      }
      .cv-hit-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12px;
        margin-bottom: 4px;
        color: var(--cv-em);
        font-weight: 600;
      }
      .cv-hit-snippet { font-size: 13px; line-height: 1.45; word-break: break-word; }
      .cv-highlight-kw { background: #facc15; color: #000; font-weight: 700; padding: 0 3px; border-radius: 3px; }
      @keyframes cvFlashMessage {
        0%, 100% { box-shadow: none; }
        25%, 75% { box-shadow: 0 0 0 3px var(--cv-accent), 0 0 18px var(--cv-accent); }
      }
      .cv-target-message-flash { animation: cvFlashMessage 2.4s ease-in-out; border-radius: 10px; }
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

function syncFabToggleUI() {
    const enabled = getSettings().enableFab;
    $("#cv_enable_fab").prop("checked", enabled);
    $("#cv-toggle-fab-inline").html(enabled ? "👁️ 隐藏球" : "🟢 开启球");
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

async function fetchChatMessages(charName, avatarUrl, fileName) {
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
        return Array.isArray(data) ? data.filter((m) => m && typeof m.mes === "string") : [];
    } catch (e) {
        return [];
    }
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
        const res = await fetch("/api/chats/get", {
            method: "POST",
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ch_name: charName,
                file_name: cleanName,
                avatar_url: avatarUrl,
            }),
        });
        if (!res.ok) return false;
        const rawChatArray = await res.json();
        const newFileName = `${cleanName}_备份_${new Date().toTimeString().slice(0, 5).replace(":", "")}`;
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
    if (window.toastr) toastr.info(`正在切换至档位：${cleanFile}...`);

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
            if (window.toastr) toastr.warning(`已进入档位，目标在第 #${mesId} 楼（如楼层较早请向上滑动加载）`);
        }
    }, 250);
}

/* =========================================================
   4. 手机/电脑全兼容悬浮球（PointerEvent 统一驱动，零冲突）
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
    fabEl.innerHTML = "🗂️";
    fabEl.style.top = settings.fabPos.top || "68%";
    fabEl.style.left = settings.fabPos.left || "calc(100% - 58px)";
    fabEl.className = settings.fabPos.dock === "left" ? "cv-dock-left" : "cv-dock-right";

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
        }, 620);
    });

    fabEl.addEventListener("pointermove", (e) => {
        if (!isDown) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
            hasMoved = true;
            clearTimeout(lpTimer);
            const newLeft = Math.max(6, Math.min(window.innerWidth - 54, startLeft + dx));
            const newTop = Math.max(10, Math.min(window.innerHeight - 56, startTop + dy));
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
            const dockLeft = isLeft ? "8px" : `${window.innerWidth - 56}px`;
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
              <b>⚡ 快捷切档 ${char ? `- ${escapeHtml(char.name)}` : ""}</b>
              <span class="cv-pill" id="cv-quick-open-full">打开完整管家 ➔</span>
            </div>
            <div id="cv-quick-list">正在读取档位...</div>
          </div>
        </div>
    `);

    $("body").append($sheet);
    $sheet.on("click", (e) => {
        if (e.target.id === "cv-quick-sheet") $sheet.remove();
    });
    $("#cv-quick-open-full").on("click", () => {
        $sheet.remove();
        openMainModal();
    });

    if (chid === undefined || !char) {
        $("#cv-quick-list").html(`<div style="opacity:0.7;padding:10px 0;">当前未选中角色，请点击右上角打开完整管家。</div>`);
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
                <div style="font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${note ? `<span class="cv-slot-note-tag">${escapeHtml(note)}</span>` : ""}
                  ${escapeHtml(fName)}
                </div>
                <div style="font-size:11px;opacity:0.75;">💬 ${c.chat_items || "?"} 楼 · ${escapeHtml(c.last_mes || "")}</div>
              </div>
              <span class="cv-pill ${isCur ? "active" : ""}">${isCur ? "当前档位" : "切换"}</span>
            </div>
        `;
    }).join("");

    $("#cv-quick-list").html(html);
    $("#cv-quick-list .cv-quick-item").on("click", function () {
        switchAndLocate(chid, $(this).data("file"));
    });
}

/* =========================================================
   6. 主弹窗渲染与视图切换（强制顶层显示）
   ========================================================= */
function applyThemeClass($el) {
    const mode = getSettings().themeMode;
    $el.removeClass("cv-theme-dark cv-theme-light");
    if (mode === "dark") $el.addClass("cv-theme-dark");
    if (mode === "light") $el.addClass("cv-theme-light");
}

async function openMainModal() {
    try {
        injectMasterStyles();
        const existing = document.getElementById("cv-modal-overlay");
        if (existing) existing.remove();

        const settings = getSettings();
        currentView = "grid";

        const $modal = $(`
            <div id="cv-modal-overlay">
              <div class="cv-modal-container">
                <div class="cv-header">
                  <div class="cv-top-bar">
                    <div class="cv-title">
                      <span>🗂️ 存档管家</span>
                      <span id="cv-sub-status" style="font-size:11px;opacity:0.7;font-weight:normal;"></span>
                    </div>
                    <div style="display:flex;gap:5px;flex-wrap:wrap;">
                      <span class="cv-pill" id="cv-toggle-fab-inline">${settings.enableFab ? "👁️ 隐藏球" : "🟢 开启球"}</span>
                      <span class="cv-pill" id="cv-toggle-cols">📱 ${settings.gridCols}列</span>
                      <span class="cv-pill" id="cv-clean-empty-btn">🧹 清废档</span>
                      <span class="cv-pill" id="cv-close-modal">✕</span>
                    </div>
                  </div>

                  <div class="cv-search-wrap">
                    <i class="fa-solid fa-magnifying-glass" style="opacity:0.7;"></i>
                    <input type="text" id="cv-search-input" placeholder="搜角色名、档位备注、或聊天对话台词..." />
                    <span id="cv-search-clear" style="cursor:pointer;opacity:0.7;display:none;padding:0 6px;">✕</span>
                  </div>

                  <div class="cv-filter-row" id="cv-filter-bar">
                    <span class="cv-pill active" data-filter="recent">🕒 最近游玩</span>
                    <span class="cv-pill" data-filter="count">🔥 档位最多</span>
                    <span class="cv-pill" data-filter="multi">📚 仅多档位角色</span>
                    <span class="cv-pill" id="cv-build-index-pill">⚡ 建立全文索引</span>
                  </div>
                </div>

                <div class="cv-body" id="cv-body-content">
                  <div style="text-align:center;padding:30px;opacity:0.7;">正在加载角色列表...</div>
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

        $("#cv-toggle-fab-inline").on("click", () => {
            settings.enableFab = !settings.enableFab;
            saveSettings();
            initFloatingBall();
            if (window.toastr) {
                if (!settings.enableFab) toastr.info("悬浮球已隐藏！可在扩展设置中重新开启。");
                else toastr.success("悬浮球已开启！");
            }
        });

        $("#cv-toggle-cols").on("click", function () {
            settings.gridCols = settings.gridCols === 2 ? 3 : 2;
            saveSettings();
            $(this).text(`📱 ${settings.gridCols}列`);
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
        alert("打开存档管家出错：" + err.message);
    }
}

// 暴露全局函数，确保 HTML 内联 onclick 100% 触发
window.cvOpenModal = openMainModal;
window.cvRebuildIndex = () => buildFullTextIndex(true);

/* =========================================================
   7. 一级视图：角色美化海报墙
   ========================================================= */
function renderCharacterGrid() {
    try {
        currentView = "grid";
        $("#cv-filter-bar").show();
        const ctx = getContext();
        const chars = ctx?.characters || [];
        const settings = getSettings();
        const $body = $("#cv-body-content");

        if (!chars.length) {
            $body.html(`<div style="text-align:center;padding:40px 0;opacity:0.7;">酒馆中还没有角色卡哦</div>`);
            return;
        }

        let pinnedHtml = "";
        if (Array.isArray(settings.pinned) && settings.pinned.length > 0) {
            const chips = settings.pinned.map((p) => {
                const note = settings.notes[getSlotKey(p.avatar, p.fileName)] || p.fileName;
                return `
                    <div class="cv-pin-chip" data-chid="${p.chid}" data-file="${escapeHtml(p.fileName)}">
                      <div class="cv-pin-chip-title">📌 ${escapeHtml(note)}</div>
                      <div class="cv-pin-chip-sub">${escapeHtml(p.charName)} · ${escapeHtml(p.fileName)}</div>
                    </div>
                `;
            }).join("");
            pinnedHtml = `
                <div class="cv-pinned-bar">
                  <div class="cv-section-label">📌 置顶常用档位（点击直达）</div>
                  <div class="cv-pinned-list">${chips}</div>
                </div>
            `;
        }

        let list = chars.map((c, idx) => ({
            chid: idx,
            name: c?.name || "未命名角色",
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
                  <div class="cv-char-badge" id="cv-badge-${item.chid}">💬 ${item.count} 档</div>
                  <div class="cv-char-footer">
                    <div class="cv-char-name">${escapeHtml(item.name)}</div>
                    <div class="cv-char-time">🕒 ${timeStr}</div>
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
        $("#cv-body-content").html(`<div style="padding:20px;color:#f87171;">渲染角色列表出错：${escapeHtml(err.message)}</div>`);
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
            $(`#cv-badge-${i}`).text(`💬 ${chats.length} 档`);
        }
    }
}

/* =========================================================
   8. 二级视图：单个角色的档位详情
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
          <span class="cv-pill" id="cv-back-grid">⬅ 返回</span>
          <img class="cv-detail-avatar" src="${thumb}" onerror="this.src='/img/ai4.png'" />
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(char.name)}</div>
            <div style="font-size:12px;opacity:0.75;" id="cv-detail-sub">正在读取聊天档位...</div>
          </div>
          <span class="cv-btn-sm primary" id="cv-new-chat-btn">➕ 新档位</span>
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
        if (window.toastr) toastr.success("已为该角色开启新档位！");
    });

    const chats = await fetchCharacterChats(char.avatar);
    $("#cv-detail-sub").text(`共 ${chats.length} 个档位（点卡片直接切换）`);

    if (!chats.length) {
        $("#cv-slot-list").html(`<div style="text-align:center;padding:30px;opacity:0.7;">暂无聊天档位</div>`);
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
        const previewText = c.mes || "（点击加载此档位...）";
        const floorCount = c.chat_items ?? "?";
        const fileSize = c.file_size || "";
        const lastTime = c.last_mes || "";

        return `
            <div class="cv-slot-card ${isCurrent ? "current-slot" : ""}" data-file="${escapeHtml(fName)}">
              <div class="cv-slot-top" data-action="load">
                <div>
                  ${note ? `<span class="cv-slot-note-tag">🏷️ ${escapeHtml(note)}</span>` : ""}
                  ${isBranch ? `<span class="cv-slot-note-tag" style="background:#10b981;">🌿 分支</span>` : ""}
                  <span class="cv-slot-title">${escapeHtml(fName)}</span>
                </div>
                <span class="cv-pill ${isCurrent ? "active" : ""}">${isCurrent ? "当前使用" : "加载"}</span>
              </div>

              <div class="cv-slot-meta">
                <span>🏢 共 <b>${floorCount}</b> 楼</span>
                ${lastTime ? `<span>🕒 ${escapeHtml(lastTime)}</span>` : ""}
                ${fileSize ? `<span>📦 ${escapeHtml(fileSize)}</span>` : ""}
              </div>

              <div class="cv-slot-preview" data-action="load">
                💬 最后一句：${escapeHtml(previewText)}
              </div>

              <div class="cv-slot-actions">
                <span class="cv-btn-sm" data-action="pin">${isPinned ? "🌟 已置顶" : "📌 置顶"}</span>
                <span class="cv-btn-sm" data-action="note">✏️ 备注</span>
                <span class="cv-btn-sm" data-action="rename">🔤 改名</span>
                <span class="cv-btn-sm" data-action="clone">📋 克隆</span>
                <span class="cv-btn-sm danger" data-action="delete">🗑️ 删除</span>
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
            const newNote = prompt("为该档位设置剧情备注/标签（留空则清除）：", oldNote);
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
                if (window.toastr) toastr.info("已取消置顶");
            } else {
                settings.pinned.unshift({ chid, avatar: char.avatar, charName: char.name, fileName: fName });
                if (window.toastr) toastr.success("已置顶到首页常用栏！");
            }
            saveSettings();
            renderCharacterSlots(chid);
        } else if (action === "rename") {
            const newName = prompt("请输入新的档位文件名：", fName);
            if (newName && newName.trim() && newName.trim() !== fName) {
                const ok = await renameChatFile(char.avatar, fName, newName.trim());
                if (ok) {
                    if (window.toastr) toastr.success("重命名成功！");
                    renderCharacterSlots(chid);
                } else if (window.toastr) toastr.error("重命名失败");
            }
        } else if (action === "clone") {
            if (window.toastr) toastr.info("正在克隆档位...");
            const ok = await cloneChatFile(char.name, char.avatar, fName);
            if (ok) {
                if (window.toastr) toastr.success("已克隆出新备份档位！");
                renderCharacterSlots(chid);
            } else if (window.toastr) toastr.error("克隆失败");
        } else if (action === "delete") {
            if (confirm(`确定要永久删除档位【${fName}】吗？`)) {
                const ok = await deleteChatFile(char.avatar, fName);
                if (ok) {
                    if (window.toastr) toastr.success("已删除该档位");
                    renderCharacterSlots(chid);
                } else if (window.toastr) toastr.error("删除失败");
            }
        }
    });
}

/* =========================================================
   9. 全局搜索与跨档位全文索引定位
   ========================================================= */
async function buildFullTextIndex(showToast = true) {
    if (isIndexing) return;
    isIndexing = true;
    const ctx = getContext();
    const chars = ctx?.characters || [];

    if (showToast && window.toastr) toastr.info("正在后台建立聊天全文索引，请稍候...");
    $("#cv-sub-status").text("（正在建索引...）");

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
    $("#cv-sub-status").text(`（已索引 ${fullTextIndex.size} 档）`);
    if (showToast && window.toastr) toastr.success(`全文索引完成！共收录 ${fullTextIndex.size} 个档位记录。`);

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
                snippet: `【档位名/备注匹配】${note ? `[${note}] ` : ""}${entry.fileName}`,
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
        html += `<div class="cv-section-label">👤 匹配的角色 (${matchedChars.length})</div>`;
        html += `<div class="cv-pinned-list" style="margin-bottom:14px;">`;
        for (const { chid, char } of matchedChars) {
            html += `
                <div class="cv-pin-chip cv-search-char-hit" data-chid="${chid}">
                  <div class="cv-pin-chip-title">${highlightKeyword(char.name, keyword)}</div>
                  <div class="cv-pin-chip-sub">点击查看全部档位 ➔</div>
                </div>
            `;
        }
        html += `</div>`;
    }

    html += `
        <div class="cv-section-label" style="justify-content:space-between;">
          <span>💬 匹配的聊天楼层 (${messageHits.length}${messageHits.length >= 60 ? "+" : ""})</span>
          <span class="cv-pill" id="cv-search-index-now" style="font-size:11px;">🔄 扫描全部档位</span>
        </div>
    `;

    if (messageHits.length === 0) {
        html += `
            <div style="text-align:center;padding:28px 14px;opacity:0.8;">
              <div style="margin-bottom:10px;">未在已缓存档位中找到“<b>${escapeHtml(keyword)}</b>”</div>
              <button type="button" id="cv-deep-scan-btn" style="padding:10px 18px;border-radius:10px;border:1px solid var(--cv-accent);background:var(--cv-card-bg);color:var(--cv-text);cursor:pointer;">
                🔍 点击深度扫描所有角色的历史档位
              </button>
            </div>
        `;
    } else {
        html += messageHits.map((hit) => `
            <div class="cv-search-hit" data-chid="${hit.chid}" data-file="${escapeHtml(hit.fileName)}" data-mesid="${hit.mesid}">
              <div class="cv-hit-header">
                <span>👤 ${escapeHtml(hit.charName)} · 📁 ${escapeHtml(hit.fileName)}</span>
                <span class="cv-pill active" style="padding:2px 8px;font-size:11px;">直达 #${hit.mesid} 楼</span>
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
   10. 一键清理只有 1 楼的空档位
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
        if (window.toastr) toastr.success("非常干净！没有发现多余的 1 楼废档。");
        return;
    }

    const previewNames = emptyList.slice(0, 6).map((e) => `[${e.charName}] ${e.fileName}`).join("\n");
    if (!confirm(`共扫描到 ${emptyList.length} 个只有开场白(1楼)的空档位：\n\n${previewNames}\n\n确定要一键清理吗？`)) return;

    let delCount = 0;
    for (const item of emptyList) {
        if (await deleteChatFile(item.avatar, item.fileName)) delCount++;
    }

    if (window.toastr) toastr.success(`清理完成！共删除 ${delCount} 个空档位。`);
    if (currentView === "detail" && selectedCharId !== null) renderCharacterSlots(selectedCharId);
    else renderCharacterGrid();
}

/* =========================================================
   11. 插件启动入口
   ========================================================= */
jQuery(() => {
    injectMasterStyles();
    const settings = getSettings();

    $(".chat-vault-settings").remove();

    const inlineSettingsHtml = `
      <div class="chat-vault-settings">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>🗂️ 存档管家 (Chat Vault)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content">
            <div style="margin:10px 0;">
              <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="cv_enable_fab" />
                <span>开启桌面悬浮球（长按快捷切档 / 拖拽贴边）</span>
              </label>
            </div>
            <div style="margin:10px 0;display:flex;flex-direction:column;gap:4px;">
              <label for="cv_theme_mode">界面主题风格：</label>
              <select id="cv_theme_mode" class="text_pole">
                <option value="inherit">🔗 跟随酒馆美化主题（默认推荐）</option>
                <option value="dark">🌙 纯粹暗黑毛玻璃</option>
                <option value="light">☀️ 纯粹浅色毛玻璃</option>
              </select>
            </div>
            <div style="margin:10px 0;display:flex;flex-direction:column;gap:4px;">
              <label for="cv_grid_cols">手机海报墙默认列数：</label>
              <select id="cv_grid_cols" class="text_pole">
                <option value="2">一行 2 个（立绘更清晰）</option>
                <option value="3">一行 3 个（紧凑浏览）</option>
              </select>
            </div>
            <div style="display:flex;gap:10px;margin-top:12px;width:100%;">
              <button type="button" onclick="window.cvOpenModal && window.cvOpenModal()" style="flex:1;white-space:nowrap;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.2);background:var(--SmartThemeQuoteColor,#7aa2f7);color:#fff;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
                <i class="fa-solid fa-folder-open"></i> 立即打开存档管家
              </button>
              <button type="button" onclick="window.cvRebuildIndex && window.cvRebuildIndex()" style="flex:1;white-space:nowrap;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.2);background:rgba(128,128,140,0.25);color:var(--SmartThemeBodyColor,#fff);font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
                <i class="fa-solid fa-rotate"></i> 刷新全文搜索索引
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
    });

    $("#cv_grid_cols").val(String(settings.gridCols)).on("change", function () {
        settings.gridCols = Number($(this).val());
        saveSettings();
    });

    // 魔杖扩展菜单入口
    $("#cv-wand-entry").remove();
    const $wandItem = $(`
        <div id="cv-wand-entry" onclick="window.cvOpenModal && window.cvOpenModal()" class="list-group-item flex-container flexGap5 interactable">
          <i class="fa-solid fa-folder-tree"></i>
          <span>存档管家 (Chat Vault)</span>
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

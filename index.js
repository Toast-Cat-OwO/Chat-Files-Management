import { getContext, extension_settings } from "../../../extensions.js";
import {
    eventSource,
    event_types,
    getRequestHeaders,
    selectCharacterById,
    openCharacterChat,
    getThumbnailUrl,
    doNewChat,
} from "../../../../script.js";

const EXT_NAME = "st-chat-vault";

const defaultSettings = {
    enableFab: true,
    themeMode: "inherit", // inherit | dark | light
    gridCols: 2,          // 2 | 3
    fabPos: { top: "70%", left: "calc(100% - 54px)", dock: "right" },
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
   1. 初始化与设置存储
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
    getContext().saveSettingsDebounced();
}

function stripFileExt(fileName = "") {
    return String(fileName).replace(/\.jsonl$/i, "");
}

function getSlotKey(avatar, fileName) {
    return `${avatar}::${stripFileExt(fileName)}`;
}

function escapeHtml(str = "") {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
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
        console.error("[ChatVault] 获取角色档位失败:", e);
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
    toastr.info(`正在切换至档位：${cleanFile}...`);

    if (String(ctx.characterId) !== String(chid)) {
        await selectCharacterById(String(chid));
        await new Promise((r) => setTimeout(r, 350));
    }

    const currentChatFile = stripFileExt(ctx.characters[chid]?.chat || "");
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
            toastr.warning(`已进入档位，目标在第 #${mesId} 楼（如楼层较早请向上滑动加载）`);
        }
    }, 250);
}

/* =========================================================
   4. 手机触屏特化悬浮球 (解决手机点击无响应 Bug)
   ========================================================= */
function initFloatingBall() {
    $("#cv-fab").remove();
    const settings = getSettings();
    syncFabToggleUI();

    if (!settings.enableFab) return;

    const $fab = $(`<div id="cv-fab" title="单击打开存档管家 / 长按快捷切档">🗂️</div>`);
    $fab.css({
        top: settings.fabPos.top || "70%",
        left: settings.fabPos.left || "calc(100% - 54px)",
    });
    $fab.addClass(settings.fabPos.dock === "left" ? "cv-dock-left" : "cv-dock-right");

    $("body").append($fab);

    let idleTimer = null;
    const resetIdle = () => {
        $fab.removeClass("cv-idle");
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => $fab.addClass("cv-idle"), 3200);
    };
    resetIdle();

    const fabEl = $fab[0];
    let isDragging = false;
    let pointerDown = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    let longPressTimer = null;
    let longPressTriggered = false;
    let lastTouchTime = 0;

    const handleStart = (clientX, clientY) => {
        resetIdle();
        pointerDown = true;
        isDragging = false;
        longPressTriggered = false;
        startX = clientX;
        startY = clientY;
        const rect = fabEl.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
            if (pointerDown && !isDragging) {
                longPressTriggered = true;
                pointerDown = false;
                openQuickSwitchSheet();
            }
        }, 600);
    };

    const handleMove = (clientX, clientY, ev) => {
        if (!pointerDown) return;
        const dx = clientX - startX;
        const dy = clientY - startY;
        // 手机手指触控容差设为 14px，防止轻微手抖导致点击失效
        if (Math.abs(dx) > 14 || Math.abs(dy) > 14) {
            isDragging = true;
            clearTimeout(longPressTimer);
            if (ev && ev.cancelable) ev.preventDefault();

            const newLeft = Math.max(6, Math.min(window.innerWidth - 52, initialLeft + dx));
            const newTop = Math.max(10, Math.min(window.innerHeight - 56, initialTop + dy));
            $fab.css({ left: `${newLeft}px`, top: `${newTop}px`, transition: "none" });
        }
    };

    const handleEnd = () => {
        if (!pointerDown) return;
        pointerDown = false;
        clearTimeout(longPressTimer);
        $fab.css({ transition: "opacity 0.35s ease, transform 0.25s ease" });

        if (isDragging) {
            const rect = fabEl.getBoundingClientRect();
            const isLeft = rect.left + rect.width / 2 < window.innerWidth / 2;
            const dockLeft = isLeft ? "8px" : `${window.innerWidth - 54}px`;
            const dockSide = isLeft ? "left" : "right";

            $fab.removeClass("cv-dock-left cv-dock-right").addClass(`cv-dock-${dockSide}`);
            $fab.css({ left: dockLeft, top: `${rect.top}px` });

            settings.fabPos = { top: `${rect.top}px`, left: dockLeft, dock: dockSide };
            saveSettings();
        } else if (!longPressTriggered) {
            openMainModal();
        }
        resetIdle();
    };

    // 针对手机 Touch 事件独立监听，并用 lastTouchTime 屏蔽手机后续模拟的 Mouse 事件
    fabEl.addEventListener("touchstart", (e) => {
        lastTouchTime = Date.now();
        const t = e.touches[0];
        handleStart(t.clientX, t.clientY);
    }, { passive: true });

    fabEl.addEventListener("touchmove", (e) => {
        lastTouchTime = Date.now();
        const t = e.touches[0];
        handleMove(t.clientX, t.clientY, e);
    }, { passive: false });

    fabEl.addEventListener("touchend", (e) => {
        lastTouchTime = Date.now();
        if (e.cancelable) e.preventDefault();
        handleEnd();
    }, { passive: false });

    // 针对电脑端鼠标事件（如果刚刚触发过 touch，则忽略）
    fabEl.addEventListener("mousedown", (e) => {
        if (Date.now() - lastTouchTime < 800 || e.button !== 0) return;
        handleStart(e.clientX, e.clientY);
        const onMouseMove = (me) => handleMove(me.clientX, me.clientY, me);
        const onMouseUp = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            handleEnd();
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    });
}

/* =========================================================
   5. 长按悬浮球：快捷切档菜单
   ========================================================= */
async function openQuickSwitchSheet() {
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
        const fName = $(this).data("file");
        switchAndLocate(chid, fName);
    });
}

/* =========================================================
   6. 主弹窗渲染与视图切换（内置悬浮球一键隐藏开关）
   ========================================================= */
function applyThemeClass($el) {
    const mode = getSettings().themeMode;
    $el.removeClass("cv-theme-dark cv-theme-light");
    if (mode === "dark") $el.addClass("cv-theme-dark");
    if (mode === "light") $el.addClass("cv-theme-light");
}

async function openMainModal() {
    $("#cv-modal-overlay").remove();
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
                  <span class="cv-pill" id="cv-toggle-fab-inline" title="开启或隐藏桌面悬浮球">${settings.enableFab ? "👁️ 隐藏球" : "🟢 开启球"}</span>
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

            <div class="cv-body" id="cv-body-content"></div>
          </div>
        </div>
    `);

    applyThemeClass($modal);
    $("body").append($modal);

    $modal.on("click", (e) => {
        if (e.target.id === "cv-modal-overlay") $modal.remove();
    });
    $("#cv-close-modal").on("click", () => $modal.remove());

    // 弹窗内直接开关悬浮球
    $("#cv-toggle-fab-inline").on("click", () => {
        settings.enableFab = !settings.enableFab;
        saveSettings();
        initFloatingBall();
        if (!settings.enableFab) {
            toastr.info("悬浮球已隐藏！后续可通过左下角【魔杖菜单 ➔ 存档管家】或扩展设置重新开启。");
        } else {
            toastr.success("悬浮球已开启！");
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
}

/* =========================================================
   7. 一级视图：角色美化海报墙
   ========================================================= */
function renderCharacterGrid() {
    currentView = "grid";
    $("#cv-filter-bar").show();
    const ctx = getContext();
    const chars = ctx.characters || [];
    const settings = getSettings();
    const $body = $("#cv-body-content");

    if (!chars.length) {
        $body.html(`<div style="text-align:center;padding:40px 0;opacity:0.7;">酒馆中还没有角色卡哦</div>`);
        return;
    }

    let pinnedHtml = "";
    if (settings.pinned.length > 0) {
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
        name: c.name,
        avatar: c.avatar,
        date_last_chat: c.date_last_chat || 0,
        count: settings.chatCounts[c.avatar] ?? 1,
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
        const thumb = getThumbnailUrl("avatar", item.avatar);
        const timeStr = item.date_last_chat
            ? new Date(item.date_last_chat).toLocaleDateString()
            : "未游玩";
        return `
            <div class="cv-char-card" data-chid="${item.chid}" data-avatar="${escapeHtml(item.avatar)}">
              <img src="${thumb}" loading="lazy" alt="${escapeHtml(item.name)}" />
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
}

async function refreshAllCharCountsBackground() {
    const ctx = getContext();
    const chars = ctx.characters || [];
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
    const char = ctx.characters[chid];
    if (!char) return;

    const $body = $("#cv-body-content");
    const thumb = getThumbnailUrl("avatar", char.avatar);

    $body.html(`
        <div class="cv-detail-header">
          <span class="cv-pill" id="cv-back-grid">⬅ 返回</span>
          <img class="cv-detail-avatar" src="${thumb}" />
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
        toastr.success("已为该角色开启新档位！");
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
                toastr.info("已取消置顶");
            } else {
                settings.pinned.unshift({ chid, avatar: char.avatar, charName: char.name, fileName: fName });
                toastr.success("已置顶到首页常用栏！");
            }
            saveSettings();
            renderCharacterSlots(chid);
        } else if (action === "rename") {
            const newName = prompt("请输入新的档位文件名：", fName);
            if (newName && newName.trim() && newName.trim() !== fName) {
                const ok = await renameChatFile(char.avatar, fName, newName.trim());
                if (ok) {
                    toastr.success("重命名成功！");
                    renderCharacterSlots(chid);
                } else toastr.error("重命名失败");
            }
        } else if (action === "clone") {
            toastr.info("正在克隆档位...");
            const ok = await cloneChatFile(char.name, char.avatar, fName);
            if (ok) {
                toastr.success("已克隆出新备份档位！");
                renderCharacterSlots(chid);
            } else toastr.error("克隆失败");
        } else if (action === "delete") {
            if (confirm(`确定要永久删除档位【${fName}】吗？`)) {
                const ok = await deleteChatFile(char.avatar, fName);
                if (ok) {
                    toastr.success("已删除该档位");
                    renderCharacterSlots(chid);
                } else toastr.error("删除失败");
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
    const chars = ctx.characters || [];

    if (showToast) toastr.info("正在后台建立聊天全文索引，请稍候...");
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
    if (showToast) toastr.success(`全文索引完成！共收录 ${fullTextIndex.size} 个档位记录。`);

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
    const chars = ctx.characters || [];
    const settings = getSettings();
    const kwLower = keyword.toLowerCase();
    const $body = $("#cv-body-content");

    const matchedChars = chars
        .map((c, idx) => ({ chid: idx, char: c }))
        .filter(({ char }) => char.name?.toLowerCase().includes(kwLower));

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
              <div class="menu_button" id="cv-deep-scan-btn" style="display:inline-block;padding:8px 16px;">
                🔍 点击深度扫描所有角色的历史档位
              </div>
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
    const chars = ctx.characters || [];
    const settings = getSettings();

    const targetChids = currentView === "detail" && selectedCharId !== null
        ? [selectedCharId]
        : chars.map((_, idx) => idx);

    toastr.info("正在扫描只有 1 楼的空档位...");
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
        toastr.success("非常干净！没有发现多余的 1 楼废档。");
        return;
    }

    const previewNames = emptyList.slice(0, 6).map((e) => `[${e.charName}] ${e.fileName}`).join("\n");
    if (!confirm(`共扫描到 ${emptyList.length} 个只有开场白(1楼)的空档位：\n\n${previewNames}\n\n确定要一键清理吗？`)) return;

    let delCount = 0;
    for (const item of emptyList) {
        if (await deleteChatFile(item.avatar, item.fileName)) delCount++;
    }

    toastr.success(`清理完成！共删除 ${delCount} 个空档位。`);
    if (currentView === "detail" && selectedCharId !== null) renderCharacterSlots(selectedCharId);
    else renderCharacterGrid();
}

/* =========================================================
   11. 插件启动入口（内嵌设置面板 HTML，彻底告别路径 404）
   ========================================================= */
jQuery(async () => {
    const settings = getSettings();

    // 直接内嵌渲染设置面板，不依赖外部 settings.html 路径
    const inlineSettingsHtml = `
      <div class="chat-vault-settings">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>🗂️ 存档管家 (Chat Vault)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content">
            <div class="cv-setting-row" style="margin:8px 0;">
              <label class="checkbox_label">
                <input type="checkbox" id="cv_enable_fab" />
                <span>开启桌面悬浮球（长按快捷切档 / 拖拽贴边）</span>
              </label>
            </div>
            <div class="cv-setting-row" style="margin:8px 0;">
              <label for="cv_theme_mode">界面主题风格：</label>
              <select id="cv_theme_mode" class="text_pole">
                <option value="inherit">🔗 跟随酒馆美化主题（默认推荐）</option>
                <option value="dark">🌙 纯粹暗黑毛玻璃</option>
                <option value="light">☀️ 纯粹浅色毛玻璃</option>
              </select>
            </div>
            <div class="cv-setting-row" style="margin:8px 0;">
              <label for="cv_grid_cols">手机海报墙默认列数：</label>
              <select id="cv_grid_cols" class="text_pole">
                <option value="2">一行 2 个（立绘更清晰）</option>
                <option value="3">一行 3 个（紧凑浏览）</option>
              </select>
            </div>
            <div class="cv-setting-actions" style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
              <div class="menu_button" id="cv_open_modal_btn">
                <i class="fa-solid fa-folder-open"></i> 立即打开存档管家
              </div>
              <div class="menu_button" id="cv_rebuild_index_btn">
                <i class="fa-solid fa-rotate"></i> 刷新全文搜索索引
              </div>
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

    $("#cv_open_modal_btn").on("click", () => openMainModal());
    $("#cv_rebuild_index_btn").on("click", () => buildFullTextIndex(true));

    // 在左下角魔杖扩展菜单添加固定入口
    if ($("#cv-wand-entry").length === 0) {
        const $wandItem = $(`
            <div id="cv-wand-entry" class="list-group-item flex-container flexGap5 interactable">
              <i class="fa-solid fa-folder-tree"></i>
              <span>存档管家 (Chat Vault)</span>
            </div>
        `);
        $wandItem.on("click", () => openMainModal());
        $("#extensionsMenu").append($wandItem);
    }

    initFloatingBall();

    eventSource.on(event_types.CHAT_CHANGED, () => {
        const ctx = getContext();
        if (ctx.characterId !== undefined && ctx.characters?.[ctx.characterId]) {
            ctx.characters[ctx.characterId].date_last_chat = Date.now();
        }
    });
});

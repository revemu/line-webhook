/* Position Manager (Pure Vanilla JS) */
(function () {
	'use strict';

	var ui = window.ui;
	var http = window.http;
	var esc = ui.escapeHtml;

	var PITCH_COLS = [
		{ posId: 1, code: 'GK', colClass: 'pitch-col-gk', tagClass: 'pos-gk', slots: 1 },
		{ posId: 2, code: 'DF', colClass: 'pitch-col-df', tagClass: 'pos-df', slots: 1 },
		{ posId: 5, code: 'DW', colClass: 'pitch-col-dw', tagClass: 'pos-dw', slots: 2 },
		{ posId: 6, code: 'DM', colClass: 'pitch-col-dm', tagClass: 'pos-dm', slots: 1 },
		{ posId: 3, code: 'MF', colClass: 'pitch-col-mf', tagClass: 'pos-mf', slots: 2 },
		{ posId: 7, code: 'AM', colClass: 'pitch-col-am', tagClass: 'pos-am', slots: 1 },
		{ posId: 4, code: 'CF', colClass: 'pitch-col-cf', tagClass: 'pos-cf', slots: 2 }
	];

	var QUOTA_CHIPS = [
		{ posId: 1, code: 'GK', title: 'Goalkeeper (โควตา 0-1 คน)', fixedMax: '1' },
		{ posId: 2, code: 'DF', title: 'Defender (โควตา 1 คน)', fixedMax: '1' },
		{ posId: 5, code: 'DW', title: 'Wingers (โควตา 2 คน)', fixedMax: '2' },
		{ posId: 6, code: 'DM', title: 'Defensive Midfield (โควตา 0-1 คน)', fixedMax: '1' },
		{ posId: 3, code: 'MF', title: 'Midfielder (โควตา 1-2 คน)', fixedMax: null },
		{ posId: 7, code: 'AM', title: 'Attacking Midfield (โควตา 0-1 คน)', fixedMax: '1' },
		{ posId: 4, code: 'CF', title: 'Center Forward (โควตา 1-2 คน)', fixedMax: null }
	];

	var state = {
		appVersion: window.__APP_VERSION__ || '0.7',
		assetVersion: window.__ASSET_VERSION__ || '',
		newVersionAvailable: false,
		latestServerVersion: '',
		loading: false,
		week: { id: 0, number: 0, date: '' },
		weeks: [],
		positions: [],
		teamColors: [],
		members: [],
		searchQuery: '',
		selectedTeamFilter: null,
		selectedPosFilter: null,
		showPosPicker: false,
		showWeekPicker: false,
		activeMember: null,
		isDarkTheme: true,
		toastMessage: '',
		toastIcon: '✓',
		toastTimer: null,
		base_url: window.location.origin + '/webhook',
		currentUser: null,
		showPasswordModal: false,
		pwdLoading: false,
		pwdMessage: '',
		pwdIsError: false,
		pwdForm: { current_password: '', new_password: '', confirm_password: '' },
		viewMode: 'pitch',
		pitchGridCols: 2,
		isFullscreen: false,
		activePitchTeamId: null,
		pendingChanges: {},
		saving: false,
		draggedPlayer: null,
		swapModePlayer: null,
		showPlayerActionModal: false,
		activeModalPlayer: null,
		showSlotPickerModal: false,
		targetSlotTeamId: null,
		targetSlotPosId: null,
		longPressTimer: null,
		longPressFired: false,
		contextMenu: { visible: false, x: 0, y: 0, player: null },
		pitchPanWrapper: null,
		pitchPanStartX: 0,
		pitchPanScrollLeft: 0
	};

	var appEl = document.getElementById('position-app');
	var headerEl = document.getElementById('posHeaderArea');
	var topNavEl = document.getElementById('posTopNavArea');
	var dateCardEl = document.getElementById('posDateCardArea');
	var saveBarEl = document.getElementById('posSaveBarArea');
	var unassignedEl = document.getElementById('unassignedPanel');
	var multiPitchEl = document.getElementById('multiPitchGrid');
	var listViewCardEl = document.getElementById('listViewCard');
	var listFiltersEl = document.getElementById('listTeamFilters');
	var listCountEl = document.getElementById('listPlayersCount');
	var listLoadingEl = document.getElementById('listLoadingText');
	var listGridEl = document.getElementById('listPlayersGrid');
	var playerSearchEl = document.getElementById('playerSearchInput');
	var modalsEl = document.getElementById('posModalsArea');
	var swapBarEl = document.getElementById('swapFloatingBarArea');
	var toastEl = document.getElementById('posToastArea');
	var fullscreenIconEl = document.getElementById('fullscreenIcon');
	var fullscreenBtnEl = document.getElementById('fullscreenToggle');

	var themeCtrl = ui.initTheme('themeToggle', 'themeIcon', function (isDark) {
		state.isDarkTheme = isDark;
		renderAll();
	});
	state.isDarkTheme = themeCtrl.isDark();

	function unsavedCount() {
		return Object.keys(state.pendingChanges).length;
	}

	function hasUnsavedChanges() {
		return unsavedCount() > 0;
	}

	function getMemberById(id) {
		var numId = parseInt(id, 10);
		return state.members.find(function (m) { return m.id === numId; }) || null;
	}

	function getUnassignedMembers() {
		return state.members.filter(function (m) { return !m.team_id || m.team_id === 0; });
	}

	function getTeamMembers(teamId) {
		return state.members.filter(function (m) { return m.team_id === teamId; });
	}

	function getPlayersInPos(teamId, posId) {
		return state.members.filter(function (m) { return m.team_id === teamId && m.pos_id === posId; });
	}

	function getBenchPlayers(teamId) {
		return state.members.filter(function (m) { return m.team_id === teamId && (!m.pos_id || m.pos_id === 0); });
	}

	function is8PlayerTeam(teamId) {
		var teamMembers = getTeamMembers(teamId);
		if (teamMembers.length >= 8) return true;
		if (teamMembers.length > 0 && teamMembers.length < 8) return false;
		var assigned = state.members.filter(function (m) { return m.team_id > 0; });
		var numTeams = (state.teamColors && state.teamColors.length) || 1;
		return (assigned.length / numTeams) >= 7.5;
	}

	function getPosMin(posId, teamId) {
		var pos = state.positions.find(function (p) { return p.id === posId; });
		if (!pos) return 0;
		if (is8PlayerTeam(teamId) && pos.min_8 !== undefined && pos.min_8 !== null) {
			return Number(pos.min_8);
		}
		return Number(pos.min !== undefined ? pos.min : 0);
	}

	function getPosMax(posId, teamId) {
		var pos = state.positions.find(function (p) { return p.id === posId; });
		if (!pos) return 99;
		if (is8PlayerTeam(teamId) && pos.max_8 !== undefined && pos.max_8 !== null) {
			var max8 = Number(pos.max_8);
			if (max8 === 0 && (posId === 1 || pos.code === 'GK')) return 1;
			return max8;
		}
		return Number(pos.max !== undefined ? pos.max : 99);
	}

	function getSlotStatusClass(teamId, posId) {
		var count = getPlayersInPos(teamId, posId).length;
		var min = getPosMin(posId, teamId);
		var max = getPosMax(posId, teamId);
		if (count < min) return 'under';
		if (count > max) return 'over';
		return 'ok';
	}

	function isTeamFormationValid(teamId) {
		if (!state.positions || state.positions.length === 0) return true;
		for (var i = 0; i < state.positions.length; i++) {
			var pos = state.positions[i];
			var count = getPlayersInPos(teamId, pos.id).length;
			if (count < getPosMin(pos.id, teamId) || count > getPosMax(pos.id, teamId)) return false;
		}
		return true;
	}

	function isPlayerChanged(id) {
		return state.pendingChanges && state.pendingChanges[id] !== undefined;
	}

	function teamHasChanges(teamId) {
		return Object.keys(state.pendingChanges).some(function (id) {
			var m = getMemberById(id);
			return m && (m.team_id === teamId || m._orig_team_id === teamId);
		});
	}

	function recordPlayerChange(player) {
		if (!player) return;
		var isPosSame = (player.pos_id || 0) === (player._orig_pos_id || 0);
		var isTeamSame = (player.team_id || 0) === (player._orig_team_id || 0);
		if (isPosSame && isTeamSame) {
			delete state.pendingChanges[player.id];
		} else {
			state.pendingChanges[player.id] = {
				pos_id: player.pos_id || 0,
				team_id: player.team_id || 0
			};
		}
	}

	function getPosCode(posId) {
		if (!posId || posId === 0) return 'สำรอง';
		var pos = state.positions.find(function (p) { return p.id === posId; });
		return pos ? pos.code : 'สำรอง';
	}

	function getPosName(posId) {
		if (!posId || posId === 0) return 'สำรอง (Bench)';
		var pos = state.positions.find(function (p) { return p.id === posId; });
		return pos ? (pos.code + ' - ' + pos.name) : 'สำรอง';
	}

	function getTeamColorName(teamId) {
		if (!teamId || teamId === 0) return 'ไม่มีทีม';
		var team = state.teamColors.find(function (t) { return t.id === teamId; });
		return team ? team.color : 'ไม่มีทีม';
	}

	function countByPos(posId) {
		if (posId === 0) {
			return state.members.filter(function (m) { return !m.pos_id || m.pos_id === 0; }).length;
		}
		return state.members.filter(function (m) { return m.pos_id === posId; }).length;
	}

	function countByTeam(teamId) {
		if (teamId === 0) {
			return state.members.filter(function (m) { return !m.team_id || m.team_id === 0; }).length;
		}
		return state.members.filter(function (m) { return m.team_id === teamId; }).length;
	}

	function getFilteredMembers() {
		var list = state.members;
		if (state.selectedTeamFilter !== null) {
			if (state.selectedTeamFilter === 0) {
				list = list.filter(function (m) { return !m.team_id || m.team_id === 0; });
			} else {
				list = list.filter(function (m) { return m.team_id === state.selectedTeamFilter; });
			}
		}
		if (state.selectedPosFilter !== null) {
			if (state.selectedPosFilter === 0) {
				list = list.filter(function (m) { return !m.pos_id || m.pos_id === 0; });
			} else {
				list = list.filter(function (m) { return m.pos_id === state.selectedPosFilter; });
			}
		}
		if (state.searchQuery && state.searchQuery.trim() !== '') {
			var q = state.searchQuery.toLowerCase().trim();
			list = list.filter(function (m) {
				return (m.alias && m.alias.toLowerCase().indexOf(q) !== -1) ||
					(m.name && m.name.toLowerCase().indexOf(q) !== -1) ||
					(m.pos_code && m.pos_code.toLowerCase().indexOf(q) !== -1) ||
					(m.pos_name && m.pos_name.toLowerCase().indexOf(q) !== -1);
			});
		}
		return list;
	}

	function getEligibleSlotPlayers() {
		var currentTeamBench = state.members.filter(function (m) {
			return m.team_id === state.targetSlotTeamId && (!m.pos_id || m.pos_id === 0);
		});
		var unassigned = state.members.filter(function (m) { return !m.team_id || m.team_id === 0; });
		var otherPlayers = state.members.filter(function (m) {
			return m.team_id !== state.targetSlotTeamId && m.team_id !== 0;
		});
		return currentTeamBench.concat(unassigned, otherPlayers);
	}

	function showToast(msg, icon) {
		state.toastMessage = msg;
		state.toastIcon = icon || '✓';
		renderToast();
		if (state.toastTimer) clearTimeout(state.toastTimer);
		state.toastTimer = setTimeout(function () {
			state.toastMessage = '';
			renderToast();
		}, 2500);
	}

	function assignPlayerPosition(player, posId) {
		if (!player) return;
		var newPosId = (posId === null || posId === undefined || isNaN(posId)) ? 0 : Number(posId);
		var posMeta = state.positions.find(function (p) { return p.id === newPosId; });
		player.pos_id = newPosId;
		if (posMeta) {
			player.pos_code = posMeta.code;
			player.pos_name = posMeta.name;
			player.pos_icon = posMeta.icon;
		} else {
			player.pos_code = null;
			player.pos_name = null;
			player.pos_icon = null;
		}
		recordPlayerChange(player);
	}

	function swapPlayers(playerA, playerB) {
		if (!playerA || !playerB || playerA.id === playerB.id) return;
		var a = {
			team_id: playerA.team_id || 0,
			team_color: playerA.team_color || '',
			pos_id: playerA.pos_id || 0,
			pos_code: playerA.pos_code,
			pos_name: playerA.pos_name,
			pos_icon: playerA.pos_icon
		};
		playerA.team_id = playerB.team_id || 0;
		playerA.team_color = playerB.team_color || '';
		playerA.pos_id = playerB.pos_id || 0;
		playerA.pos_code = playerB.pos_code;
		playerA.pos_name = playerB.pos_name;
		playerA.pos_icon = playerB.pos_icon;

		playerB.team_id = a.team_id;
		playerB.team_color = a.team_color;
		playerB.pos_id = a.pos_id;
		playerB.pos_code = a.pos_code;
		playerB.pos_name = a.pos_name;
		playerB.pos_icon = a.pos_icon;

		recordPlayerChange(playerA);
		recordPlayerChange(playerB);

		var aLabel = a.team_color ? ('ทีม ' + a.team_color) : 'ไม่มีทีม';
		var bLabel = playerA.team_color ? ('ทีม ' + playerA.team_color) : 'ไม่มีทีม';
		if (a.team_id !== playerA.team_id) {
			showToast('สลับ ' + playerA.alias + ' (' + aLabel + ' ➜ ' + bLabel + ') กับ ' + playerB.alias + ' (' + bLabel + ' ➜ ' + aLabel + ') แล้ว', '⇄');
		} else {
			showToast('สลับตำแหน่ง ' + playerA.alias + ' กับ ' + playerB.alias + ' แล้ว', '⇄');
		}
	}

	function movePlayerToSlot(player, teamId, posId) {
		if (!player) return;
		var targetTeam = state.teamColors.find(function (t) { return t.id === teamId; });
		if (!targetTeam) return;
		var oldTeamColor = player.team_color || 'ไม่มีทีม';
		player.team_id = teamId;
		player.team_color = targetTeam.color;
		assignPlayerPosition(player, posId);
		var pos = state.positions.find(function (p) { return p.id === posId; });
		var posLabel = pos ? pos.code : 'ตำแหน่ง';
		if (oldTeamColor !== targetTeam.color) {
			showToast('ย้าย ' + player.alias + ' (' + oldTeamColor + ' ➜ ' + targetTeam.color + ') เล่น ' + posLabel + ' แล้ว', '✓');
		} else {
			showToast('จัด ' + player.alias + ' ลงตำแหน่ง ' + posLabel + ' แล้ว', '✓');
		}
	}

	function renderHeader() {
		if (!headerEl) return;
		var badgeHtml = '';
		if (state.newVersionAvailable) {
			var verSuffix = (state.latestServerVersion && state.latestServerVersion !== state.appVersion) ? (' v' + esc(state.latestServerVersion)) : '';
			badgeHtml = '<span class="app-version-badge update-available" data-action="reload-app" title="มีเวอร์ชันใหม่ในระบบ แตะเพื่อโหลดเวอร์ชันล่าสุด">' +
				'<span class="update-label-full">🚀 มีอัปเดตใหม่' + verSuffix + ' (แตะเพื่อโหลด)</span>' +
				'<span class="update-label-compact">🚀 อัปเดต' + verSuffix + '</span>' +
				'</span>';
		} else {
			var titleStr = 'เวอร์ชันระบบ: v' + state.appVersion + (state.assetVersion ? ' (' + state.assetVersion + ')' : '');
			badgeHtml = '<span class="app-version-badge" title="' + esc(titleStr) + '">v' + esc(state.appVersion) + '</span>';
		}
		headerEl.innerHTML = '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">' +
			'<h1 style="margin:0;">Position Manager</h1>' + badgeHtml + '</div>';
	}

	function renderTopNav() {
		if (!topNavEl) return;
		var wk = (state.week && (state.week.id || state.week.number)) ? ('?weeknum=' + encodeURIComponent(state.week.id || state.week.number)) : '';
		var userHtml = '';
		if (state.currentUser) {
			var roleBadge = state.currentUser.role === 'root' ? ('👑 ' + state.currentUser.username) : ('👤 ' + state.currentUser.username);
			userHtml = '<div class="user-status-pill">' +
				'<span class="user-role-badge ' + esc(state.currentUser.role) + '">' + esc(roleBadge) + '</span>' +
				'<button type="button" data-action="open-password-modal" class="btn-action-pill" title="เปลี่ยนรหัสผ่าน">🔑 รหัสผ่าน</button>' +
				'<button type="button" data-action="logout" class="btn-logout" title="ออกจากระบบ">ออกจากระบบ</button>' +
				'</div>';
		}
		topNavEl.innerHTML = '<div class="nav-tabs">' +
			'<a href="/webhook/match' + wk + '" class="nav-tab">⚽ Manager</a>' +
			'<a href="/webhook/view' + wk + '" class="nav-tab">📺 Viewer</a>' +
			'<a href="/webhook/position' + wk + '" class="nav-tab active">🛡️ จัดทีม/ตำแหน่ง</a>' +
			'</div>' + userHtml;
	}

	function renderDateCard() {
		if (!dateCardEl) return;
		var chips = '<div class="pos-stat-chip' + (state.selectedPosFilter === null ? ' active' : '') + '" data-action="filter-pos" data-pos-id="all">' +
			'<span>ทั้งหมด</span><span class="pos-stat-count">' + state.members.length + '</span></div>';

		for (var i = 0; i < state.positions.length; i++) {
			var p = state.positions[i];
			var active = state.selectedPosFilter === p.id ? ' active' : '';
			chips += '<div class="pos-stat-chip' + active + '" data-action="filter-pos" data-pos-id="' + esc(p.id) + '">' +
				'<span>' + esc(p.icon) + ' ' + esc(p.code) + '</span>' +
				'<span class="pos-stat-count">' + countByPos(p.id) + '</span></div>';
		}

		chips += '<div class="pos-stat-chip' + (state.selectedPosFilter === 0 ? ' active' : '') + '" data-action="filter-pos" data-pos-id="0">' +
			'<span>⚪ สำรอง</span><span class="pos-stat-count">' + countByPos(0) + '</span></div>';

		dateCardEl.innerHTML = '<div class="week-info-bar">' +
			'<div>' +
			'<div style="font-size:0.72rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">วันที่แข่งขัน</div>' +
			'<div style="font-size:1.1rem;font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:0.4rem;">' +
			'<span>📅 ' + esc(state.week.date) + '</span></div></div>' +
			'<button type="button" class="week-badge-pill" data-action="open-week-picker" title="เปลี่ยนวันแข่งขัน">' +
			'<span>📅 เปลี่ยนวัน</span><span style="font-size:0.7rem;">▼</span></button></div>' +
			'<div style="margin-top:0.75rem;border-top:1px solid var(--border-color);padding-top:0.6rem;">' +
			'<div style="font-size:0.75rem;color:var(--text-muted);font-weight:600;margin-bottom:0.35rem;">สรุปจำนวนตามตำแหน่ง (แตะเพื่อกรอง):</div>' +
			'<div class="pos-stats-container">' + chips + '</div></div>';
	}

	function renderSaveBar() {
		if (!saveBarEl) return;
		var unsaved = hasUnsavedChanges();
		var count = unsavedCount();
		saveBarEl.classList.toggle('has-changes', unsaved);

		var colsCtrl = state.viewMode === 'pitch'
			? '<div class="view-mode-tabs desktop-only-control" style="margin-left:0.35rem;">' +
			  '<button type="button" class="view-mode-btn' + (state.pitchGridCols === 2 ? ' active' : '') + '" data-action="set-cols" data-cols="2" title="แสดง 2 คอลัมน์">🔲 2 คอลัมน์</button>' +
			  '<button type="button" class="view-mode-btn' + (state.pitchGridCols === 1 ? ' active' : '') + '" data-action="set-cols" data-cols="1" title="แสดง 1 คอลัมน์">📑 1 คอลัมน์</button>' +
			  '</div>'
			: '';

		var statusHtml = unsaved
			? '<span class="changes-pulse-badge">● แก้ไข ' + count + ' รายการ</span>'
			: '<span class="saved-status-text" style="font-size:0.78rem;color:var(--text-muted);">✓ บันทึกแล้ว</span>';

		var resetBtn = unsaved
			? '<button type="button" data-action="reset-positions" class="btn-reset-positions" title="ยกเลิกการเปลี่ยนแปลงที่ยังไม่ได้บันทึก">↺ ยกเลิก</button>'
			: '';

		var saveLabel = state.saving ? '⏳ กำลังบันทึก...' : ('💾 บันทึก ' + (unsaved ? '(' + count + ')' : ''));
		var saveDisabled = (!unsaved || state.saving) ? ' disabled' : '';

		saveBarEl.innerHTML = '<div class="save-status-info">' +
			'<div class="view-mode-tabs">' +
			'<button type="button" class="view-mode-btn' + (state.viewMode === 'pitch' ? ' active' : '') + '" data-action="set-view" data-view="pitch">🏟️ ผังสนาม</button>' +
			'<button type="button" class="view-mode-btn' + (state.viewMode === 'list' ? ' active' : '') + '" data-action="set-view" data-view="list">📋 รายชื่อ</button>' +
			'</div>' +
			colsCtrl +
			'<div class="view-mode-tabs desktop-only-control" style="margin-left:0.35rem;">' +
			'<button type="button" class="view-mode-btn btn-fullscreen-toggle' + (state.isFullscreen ? ' active' : '') + '" data-action="toggle-fullscreen" title="' + (state.isFullscreen ? 'ออกจากโหมดเต็มจอ (Esc)' : 'ขยายเต็มหน้าจอ (Full Screen)') + '">' +
			(state.isFullscreen ? '🗗 ออกจากเต็มจอ' : '⛶ ขยายเต็มจอ') +
			'</button></div>' + statusHtml + '</div>' +
			'<div class="save-action-buttons" style="display:flex;align-items:center;gap:0.4rem;">' +
			resetBtn +
			'<button type="button" data-action="save-positions" class="btn-save-positions"' + saveDisabled + '>' + saveLabel + '</button>' +
			'</div>';
	}

	function renderAvatarContent(player, colorName) {
		if (player.picture_url) {
			return '<img src="' + esc(player.picture_url) + '" />';
		}
		var initial = player.alias ? player.alias.charAt(0).toUpperCase() : '?';
		var style = colorName ? (' style="color:' + esc(ui.getContrastColor(colorName)) + '"') : '';
		return '<span class="avatar-letter"' + style + '>' + esc(initial) + '</span>';
	}

	function renderUnassignedPanel() {
		if (!unassignedEl) return;
		unassignedEl.style.display = state.viewMode === 'pitch' ? '' : 'none';
		if (state.viewMode !== 'pitch') return;

		var unassigned = getUnassignedMembers();
		var headerHtml = unassigned.length > 0
			? '<div class="unassigned-panel-header"><div class="unassigned-panel-title">' +
			  '<span>⚪ นอกสนาม / ไม่มีทีม</span>' +
			  '<span style="font-weight:800;color:var(--primary-color);">(' + unassigned.length + ')</span>' +
			  '<span class="unassigned-hint-text">แตะผู้เล่นเพื่อเลือกทีม หรือลากมาวางเพื่อปลดทีม</span>' +
			  '</div></div>'
			: '';

		var cardsHtml = '';
		if (unassigned.length === 0) {
			cardsHtml = '<div class="unassigned-empty-banner"><span>✓ จัดทีมครบทุกคนแล้ว</span>' +
				'<span class="unassigned-empty-sub">(แตะผู้เล่นหรือลากมาวางที่นี่เพื่อปลดทีม)</span></div>';
		} else {
			cardsHtml = unassigned.map(function (p) {
				var cls = 'unassigned-card';
				if (isPlayerChanged(p.id)) cls += ' is-changed';
				if (state.swapModePlayer && state.swapModePlayer.id === p.id) cls += ' is-swap-source';
				var avatar = p.picture_url
					? '<img src="' + esc(p.picture_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />'
					: '<span>' + esc(p.alias ? p.alias.charAt(0).toUpperCase() : '?') + '</span>';
				return '<div class="' + cls + '" draggable="true" data-player-id="' + esc(p.id) + '" title="' + esc((p.alias || '') + ' (แตะ/กดค้างเพื่อเลือกตำแหน่ง/ทีม หรือลากไปวาง)') + '">' +
					'<div class="pitch-player-avatar" style="background:var(--border-color);color:var(--text-main);overflow:hidden;">' + avatar + '</div>' +
					'<span>' + esc(p.alias) + '</span>' +
					(p.rating ? '<span style="font-size:0.7rem;color:var(--text-muted);">⭐ ' + esc(p.rating) + '</span>' : '') +
					(isPlayerChanged(p.id) ? '<span style="color:#f59e0b;font-size:0.7rem;">● แก้ไข</span>' : '') +
					'</div>';
			}).join('');
		}

		unassignedEl.innerHTML = headerHtml +
			'<div class="unassigned-player-grid' + (unassigned.length === 0 ? ' is-empty-pool' : '') + '">' + cardsHtml + '</div>';
	}

	function renderPitchPlayerSlot(player, team, col) {
		var changed = isPlayerChanged(player.id) ? ' is-changed' : '';
		var swapSrc = (state.swapModePlayer && state.swapModePlayer.id === player.id) ? ' is-swap-source' : '';
		return '<div class="pitch-circle-avatar' + changed + swapSrc + '" draggable="true" data-player-id="' + esc(player.id) + '" title="' + esc((player.alias || '') + ' (แตะ/กดค้างเพื่อเลือก หรือลากสลับ)') + '">' +
			renderAvatarContent(player, team.color) +
			'</div>' +
			'<div class="pitch-player-pill" data-player-id="' + esc(player.id) + '">' +
			'<span class="pitch-pos-tag ' + col.tagClass + '">' + col.code + '</span>' +
			'<span class="pitch-pill-name">' + esc(player.alias) + '</span>' +
			'</div>';
	}

	function renderMultiPitch() {
		if (!multiPitchEl) return;
		multiPitchEl.style.display = state.viewMode === 'pitch' ? '' : 'none';
		multiPitchEl.classList.toggle('cols-1', state.pitchGridCols === 1);
		multiPitchEl.classList.toggle('swap-mode-active', !!state.swapModePlayer);
		if (state.viewMode !== 'pitch') return;

		var markingsHtml = '<div class="pitch-markings">' +
			'<div class="pitch-half-line-h"></div><div class="pitch-center-circle-h"></div><div class="pitch-center-spot-h"></div>' +
			'<div class="pitch-penalty-left"></div><div class="pitch-goal-left"></div>' +
			'<div class="pitch-penalty-right"></div><div class="pitch-goal-right"></div>' +
			'<div class="pitch-corner-tl"></div><div class="pitch-corner-tr"></div>' +
			'<div class="pitch-corner-bl"></div><div class="pitch-corner-br"></div></div>';

		var html = state.teamColors.map(function (team) {
			var membersInTeam = getTeamMembers(team.id);
			var isValid = isTeamFormationValid(team.id);
			var hasChanges = teamHasChanges(team.id);
			var teamBg = (team.color || '#ccc').toLowerCase();
			var teamFg = ui.getContrastColor(team.color);
			var teamBd = ui.getBorderColor(team.color, state.isDarkTheme);

			var chipsHtml = QUOTA_CHIPS.map(function (qc) {
				var count = getPlayersInPos(team.id, qc.posId).length;
				var maxStr = qc.fixedMax || (qc.posId === 3 ? (is8PlayerTeam(team.id) ? '2' : '1') : String(getPosMax(qc.posId, team.id)));
				var cls = getSlotStatusClass(team.id, qc.posId);
				return '<span class="quota-chip ' + cls + '" title="' + esc(qc.title) + '">' + qc.code + ':' + count + '/' + maxStr + '</span>';
			}).join('');

			var colsHtml = PITCH_COLS.map(function (col) {
				var players = getPlayersInPos(team.id, col.posId);
				var slotsHtml = '';
				for (var s = 0; s < col.slots; s++) {
					var p = players[s];
					var inner = p
						? renderPitchPlayerSlot(p, team, col)
						: '<div class="pitch-circle-avatar is-empty" data-action="empty-slot" data-team-id="' + esc(team.id) + '" data-pos-id="' + col.posId + '" title="แตะเพื่อเลือกผู้เล่นใส่ตำแหน่งนี้"><span>' + col.code + '</span></div>' +
						  '<div class="pitch-empty-pill" data-action="empty-slot" data-team-id="' + esc(team.id) + '" data-pos-id="' + col.posId + '">+ ว่าง</div>';
					slotsHtml += '<div class="pitch-circle-slot" data-slot-team-id="' + esc(team.id) + '" data-slot-pos-id="' + col.posId + '">' + inner + '</div>';
				}
				var extras = players.slice(col.slots);
				for (var e = 0; e < extras.length; e++) {
					slotsHtml += '<div class="pitch-circle-slot">' + renderPitchPlayerSlot(extras[e], team, col) + '</div>';
				}
				return '<div class="pitch-tactical-col ' + col.colClass + '">' + slotsHtml + '</div>';
			}).join('');

			var bench = getBenchPlayers(team.id);
			var benchCards = bench.length === 0
				? '<div class="bench-empty-hint">ไม่มีตัวสำรองในทีมนี้</div>'
				: bench.map(function (p) {
					var cls = 'pitch-player-card';
					if (isPlayerChanged(p.id)) cls += ' is-changed';
					if (state.swapModePlayer && state.swapModePlayer.id === p.id) cls += ' is-swap-source';
					var avatar = p.picture_url
						? '<img src="' + esc(p.picture_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />'
						: '<span>' + esc(p.alias ? p.alias.charAt(0).toUpperCase() : '?') + '</span>';
					return '<div class="' + cls + '" style="background:var(--card-bg);color:var(--text-main);border-color:var(--border-color);" draggable="true" data-player-id="' + esc(p.id) + '" title="' + esc((p.alias || '') + ' (แตะ/กดค้างเพื่อเลือกตำแหน่ง/ทีม หรือลากสลับ)') + '">' +
						'<div class="pitch-player-avatar" style="background-color:' + esc(teamBg) + ';color:' + esc(teamFg) + ';overflow:hidden;">' + avatar + '</div>' +
						'<span class="pitch-player-name">' + esc(p.alias) + '</span>' +
						'<span style="font-size:0.7rem;color:var(--text-muted);font-weight:600;">⚪ สำรอง</span></div>';
				}).join('');

			return '<div class="team-pitch-card' + (hasChanges ? ' has-changes' : '') + '">' +
				'<div class="team-pitch-header"><div class="team-pitch-title">' +
				'<span class="team-color-chip" style="background-color:' + esc(teamBg) + ';color:' + esc(teamFg) + ';border:1px solid ' + esc(teamBd) + ';">● ' + esc(team.color) + ' (' + membersInTeam.length + ')</span>' +
				'<span class="team-rule-badge">โควตา ' + (is8PlayerTeam(team.id) ? '8' : '7') + ' คน</span>' +
				(isValid
					? '<span class="slot-quota-badge ok" title="ตำแหน่งครบตามขั้นต่ำ">✓ ครบ</span>'
					: '<span class="slot-quota-badge under" title="มีตำแหน่งที่ยังขาดผู้เล่นตามขั้นต่ำ">⚠️ ขาดตำแหน่ง</span>') +
				'<span class="pitch-scroll-hint">↔ เลื่อนสนาม</span></div>' +
				'<div class="team-quota-chips">' + chipsHtml + '</div></div>' +
				'<div class="tactical-pitch-scroll-wrapper"><div class="pitch-field tactical-pitch">' + markingsHtml + colsHtml + '</div></div>' +
				'<div class="bench-container" data-bench-team-id="' + esc(team.id) + '">' +
				'<div class="bench-header"><div class="bench-title"><span>⚪ สำรอง ' + esc(team.color) + '</span><span>(' + bench.length + ')</span></div>' +
				'<span class="bench-hint-text">แตะเพื่อเลือกตำแหน่ง</span></div>' +
				'<div class="bench-grid">' + benchCards + '</div></div></div>';
		}).join('');

		multiPitchEl.innerHTML = html;
	}

	function renderListView() {
		if (!listViewCardEl) return;
		listViewCardEl.style.display = state.viewMode === 'list' ? '' : 'none';
		if (state.viewMode !== 'list') return;

		if (listFiltersEl) {
			var btns = '<button type="button" class="team-filter-btn' + (state.selectedTeamFilter === null ? ' active' : '') + '" data-action="filter-team" data-team-id="all">All Teams (' + state.members.length + ')</button>';
			for (var i = 0; i < state.teamColors.length; i++) {
				var t = state.teamColors[i];
				var isSel = state.selectedTeamFilter === t.id;
				var st = isSel ? (' style="background-color:' + esc((t.color || '#ccc').toLowerCase()) + ';color:' + esc(ui.getContrastColor(t.color)) + ';border-color:' + esc(ui.getBorderColor(t.color, state.isDarkTheme)) + ';"') : '';
				btns += '<button type="button" class="team-filter-btn' + (isSel ? ' active' : '') + '" data-action="filter-team" data-team-id="' + esc(t.id) + '"' + st + '>' + esc(t.color) + ' (' + countByTeam(t.id) + ')</button>';
			}
			btns += '<button type="button" class="team-filter-btn' + (state.selectedTeamFilter === 0 ? ' active' : '') + '" data-action="filter-team" data-team-id="0">Unassigned (' + countByTeam(0) + ')</button>';
			listFiltersEl.innerHTML = btns;
		}

		var filtered = getFilteredMembers();
		if (listCountEl) listCountEl.textContent = 'Players (' + filtered.length + ')';
		if (listLoadingEl) listLoadingEl.style.display = state.loading ? '' : 'none';

		if (!listGridEl) return;
		if (filtered.length === 0) {
			listGridEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No players found matching current filters.</div>';
			return;
		}

		listGridEl.innerHTML = filtered.map(function (m) {
			var avBg = m.team_color ? m.team_color.toLowerCase() : 'var(--background-color)';
			var avFg = m.team_color ? ui.getContrastColor(m.team_color) : 'var(--text-main)';
			var teamBadge = m.team_color
				? '<span class="team-badge-small" style="background-color:' + esc(m.team_color.toLowerCase()) + ';color:' + esc(ui.getContrastColor(m.team_color)) + ';border:1px solid ' + esc(ui.getBorderColor(m.team_color, state.isDarkTheme)) + ';">' + esc(m.team_color) + '</span>'
				: '<span class="team-badge-small" style="background:var(--background-color);color:var(--text-muted);">No Team</span>';
			var sub = (m.name !== m.alias ? esc(m.name) : '') + (m.rating && m.rating > 0 ? ' • Rating: ' + esc(m.rating) : '');
			var posAssigned = m.pos_id && m.pos_id > 0;
			var posLabel = posAssigned ? (esc(m.pos_icon || '⚽') + ' ' + esc(m.pos_code || 'POS')) : '➕ Set Position';
			return '<div class="player-card" draggable="true" data-list-player-id="' + esc(m.id) + '" title="' + esc((m.alias || '') + ' (ลากใส่ผู้เล่นคนอื่นเพื่อสลับทีม/ตำแหน่ง หรือคลิกขวา)') + '">' +
				'<div class="player-left">' +
				'<div class="player-avatar" style="background-color:' + esc(avBg) + ';color:' + esc(avFg) + ';">' + esc(m.alias ? m.alias.charAt(0).toUpperCase() : '?') + '</div>' +
				'<div class="player-meta"><div class="player-name-line">' +
				'<span class="player-name-text">' + esc(m.alias) + '</span>' +
				(isPlayerChanged(m.id) ? '<span style="color:#f59e0b;font-size:0.75rem;font-weight:700;">● แก้ไขแล้ว</span>' : '') +
				teamBadge + '</div><div class="player-subtext">' + sub + '</div></div></div>' +
				'<div><button type="button" class="pos-btn ' + (posAssigned ? 'assigned' : 'empty') + '" data-action="open-pos-picker" data-player-id="' + esc(m.id) + '">' +
				'<span>' + posLabel + '</span><span style="font-size:0.7rem;opacity:0.7;">▼</span></button></div></div>';
		}).join('');
	}

	function renderSwapBar() {
		if (!swapBarEl) return;
		if (!state.swapModePlayer) {
			swapBarEl.innerHTML = '';
			return;
		}
		var sp = state.swapModePlayer;
		var sub = (sp.team_color ? ('ทีม ' + sp.team_color) : 'ไม่มีทีม') + ' - ' + getPosCode(sp.pos_id);
		swapBarEl.innerHTML = '<div class="swap-floating-bar"><div class="swap-bar-content">' +
			'<div class="swap-bar-info"><span class="swap-bar-badge">🔁 โหมดสลับตัว</span>' +
			'<span class="swap-bar-name"><strong>' + esc(sp.alias) + '</strong> <span class="swap-bar-sub">(' + esc(sub) + ')</span></span>' +
			'<span class="swap-bar-hint">👉 แตะที่ผู้เล่นคนอื่นหรือช่องว่างเพื่อสลับทันที</span></div>' +
			'<button type="button" class="swap-bar-cancel-btn" data-action="cancel-swap-mode">✕ ยกเลิก</button></div></div>';
	}

	function renderModals() {
		if (!modalsEl) return;
		var html = '';

		if (state.showPosPicker && state.activeMember) {
			var opts = state.positions.map(function (pos) {
				var sel = state.activeMember && state.activeMember.pos_id == pos.id ? ' selected' : '';
				return '<div class="pos-picker-option' + sel + '" data-action="pick-pos" data-pos-id="' + esc(pos.id) + '">' +
					'<div class="pos-picker-icon">' + esc(pos.icon) + '</div>' +
					'<div class="pos-picker-code">' + esc(pos.code) + '</div>' +
					'<div class="pos-picker-name">' + esc(pos.name) + '</div></div>';
			}).join('');
			html += '<div class="modal-overlay" data-overlay="pos-picker"><div class="modal-content">' +
				'<div class="card-title"><div><div style="font-size:1.1rem;font-weight:700;">Select Position</div>' +
				'<div style="font-size:0.85rem;color:var(--primary-color);font-weight:600;">' + esc(state.activeMember.alias) + '</div></div>' +
				'<span style="cursor:pointer;font-size:1.5rem;line-height:1;" data-action="close-pos-picker">×</span></div>' +
				'<div class="pos-picker-grid">' + opts + '</div>' +
				'<button type="button" class="pos-picker-clear" data-action="pick-pos" data-pos-id="0"><span>⚪</span><span>Clear / Unset Position</span></button>' +
				'</div></div>';
		}

		if (state.showWeekPicker) {
			html += ui.renderWeekPickerModal(state.weeks, state.week && state.week.id);
		}

		if (state.showPasswordModal) {
			html += ui.renderPasswordModal(state.currentUser && state.currentUser.username, state.pwdMessage, state.pwdIsError, state.pwdLoading, state.pwdForm);
		}

		if (state.contextMenu.visible && state.contextMenu.player) {
			var cmP = state.contextMenu.player;
			var posItems = state.positions.map(function (pos) {
				var act = cmP.pos_id == pos.id ? ' active' : '';
				return '<div class="context-menu-item' + act + '" data-action="ctx-pos" data-pos-id="' + esc(pos.id) + '">' +
					'<span>' + esc(pos.icon) + ' ' + esc(pos.code) + '</span>' +
					'<span style="font-size:0.75rem;color:var(--text-muted);">' + esc(pos.name) + '</span></div>';
			}).join('');
			var teamItems = state.teamColors.map(function (t) {
				var act = cmP.team_id == t.id ? ' active' : '';
				return '<div class="context-menu-item' + act + '" data-action="ctx-team" data-team-id="' + esc(t.id) + '">' +
					'<div style="display:flex;align-items:center;gap:0.45rem;">' +
					'<span class="team-dot" style="background-color:' + esc((t.color || '#ccc').toLowerCase()) + ';"></span>' +
					'<span>ทีม ' + esc(t.color) + '</span></div>' +
					'<span style="font-size:0.75rem;color:var(--text-muted);">' + getTeamMembers(t.id).length + ' คน</span></div>';
			}).join('');
			var benchAct = (!cmP.pos_id || cmP.pos_id === 0) ? ' active' : '';
			var unAct = (!cmP.team_id || cmP.team_id === 0) ? ' active' : '';
			html += '<div class="context-menu" style="top:' + state.contextMenu.y + 'px;left:' + state.contextMenu.x + 'px;">' +
				'<div class="context-menu-header"><span>⚙️ เลือกตำแหน่ง</span><span style="font-weight:800;color:var(--primary-color);">' + esc(cmP.alias) + '</span></div>' +
				posItems +
				'<div class="context-menu-divider"></div>' +
				'<div class="context-menu-item' + benchAct + '" data-action="ctx-pos" data-pos-id="0"><span>⚪ ไม่ระบุ / สำรอง</span><span style="font-size:0.75rem;color:var(--text-muted);">Bench</span></div>' +
				'<div class="context-menu-divider"></div>' +
				'<div class="context-menu-header" style="font-size:0.75rem;text-transform:uppercase;color:var(--text-muted);padding:0.35rem 0.85rem;"><span>🔄 ย้ายไปทีม</span>' +
				'<span style="font-weight:600;font-size:0.75rem;color:var(--text-muted);">(ปัจจุบัน: ' + esc(cmP.team_color || '-') + ')</span></div>' +
				teamItems +
				'<div class="context-menu-item' + unAct + '" data-action="ctx-team" data-team-id="0"><div style="display:flex;align-items:center;gap:0.45rem;">' +
				'<span class="team-dot" style="background-color:var(--text-muted);"></span><span>⚪ ปลดออกจากทีม (ไม่มีทีม)</span></div>' +
				'<span style="font-size:0.75rem;color:var(--text-muted);">' + getUnassignedMembers().length + ' คน</span></div></div>';
		}

		if (state.showPlayerActionModal && state.activeModalPlayer) {
			var mp = state.activeModalPlayer;
			var mpAvatar = mp.picture_url
				? '<img src="' + esc(mp.picture_url) + '" />'
				: '<span>' + esc(mp.alias ? mp.alias.charAt(0).toUpperCase() : '?') + '</span>';
			var mpTeamBg = (mp.team_color || '#888').toLowerCase();
			var posBtns = state.positions.map(function (pos) {
				var act = mp.pos_id == pos.id ? ' active' : '';
				return '<button type="button" class="action-pos-btn' + act + '" data-action="modal-pos" data-pos-id="' + esc(pos.id) + '">' +
					'<span class="action-pos-icon">' + esc(pos.icon) + '</span>' +
					'<span class="action-pos-code">' + esc(pos.code) + '</span>' +
					'<span class="action-pos-name">' + esc(pos.name) + '</span></button>';
			}).join('') +
				'<button type="button" class="action-pos-btn' + ((!mp.pos_id || mp.pos_id === 0) ? ' active' : '') + '" data-action="modal-pos" data-pos-id="0">' +
				'<span class="action-pos-icon">⚪</span><span class="action-pos-code">สำรอง</span><span class="action-pos-name">Bench</span></button>';

			var teamBtns = state.teamColors.map(function (t) {
				var act = mp.team_id == t.id ? ' active' : '';
				var tc = (t.color || '#ccc').toLowerCase();
				return '<button type="button" class="action-team-btn' + act + '" style="border-left-color:' + esc(tc) + ';" data-action="modal-team" data-team-id="' + esc(t.id) + '">' +
					'<span class="team-dot" style="background-color:' + esc(tc) + ';"></span>' +
					'<span>ทีม ' + esc(t.color) + '</span>' +
					'<span class="action-team-count">(' + getTeamMembers(t.id).length + ' คน)</span></button>';
			}).join('') +
				'<button type="button" class="action-team-btn' + ((!mp.team_id || mp.team_id === 0) ? ' active' : '') + '" data-action="modal-team" data-team-id="0">' +
				'<span class="team-dot" style="background-color:var(--text-muted);"></span>' +
				'<span>ปลดออกจากทีม (ไม่มีทีม)</span>' +
				'<span class="action-team-count">(' + getUnassignedMembers().length + ' คน)</span></button>';

			html += '<div class="modal-overlay" data-overlay="player-action"><div class="modal-content player-action-modal">' +
				'<div class="action-modal-header"><div class="action-player-profile">' +
				'<div class="action-player-avatar" style="border-color:' + esc(mp.team_color ? mp.team_color.toLowerCase() : 'var(--border-color)') + ';">' + mpAvatar + '</div>' +
				'<div><div class="action-player-name">' + esc(mp.alias) + '</div>' +
				'<div class="action-player-meta">' +
				'<span class="action-badge-team" style="background-color:' + esc(mpTeamBg) + ';color:' + esc(ui.getContrastColor(mp.team_color)) + ';">' + esc(mp.team_color ? ('ทีม ' + mp.team_color) : 'ไม่มีทีม') + '</span>' +
				'<span class="action-badge-pos">' + esc(getPosName(mp.pos_id)) + '</span>' +
				(mp.rating ? '<span class="action-badge-rating">⭐ ' + esc(mp.rating) + '</span>' : '') +
				'</div></div></div>' +
				'<button type="button" class="action-modal-close" data-action="close-player-action">×</button></div>' +
				'<div class="action-section"><button type="button" class="btn-action-swap-mode" data-action="start-swap-mode">' +
				'<span style="font-size:1.25rem;">🔁</span><div><div style="font-weight:700;font-size:0.95rem;">เลือกผู้เล่นเพื่อสลับตำแหน่ง (Swap)</div>' +
				'<div style="font-size:0.75rem;opacity:0.85;">กดปุ่มนี้ แล้วไปแตะผู้เล่นคนอื่นที่ต้องการสลับตัวได้ทันที (ไม่ต้องลาก)</div></div></button></div>' +
				'<div class="action-section"><div class="action-section-title">🎯 เปลี่ยนตำแหน่ง (Position)</div><div class="action-pos-grid">' + posBtns + '</div></div>' +
				'<div class="action-section"><div class="action-section-title">👕 ย้ายไปทีม (Change Team)</div><div class="action-team-grid">' + teamBtns + '</div></div>' +
				'</div></div>';
		}

		if (state.showSlotPickerModal) {
			var elig = getEligibleSlotPlayers();
			var rowsHtml = elig.length === 0
				? '<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">ไม่มีผู้เล่นที่ว่างอยู่</div>'
				: elig.map(function (p) {
					var av = p.picture_url
						? '<img src="' + esc(p.picture_url) + '" style="width:100%;height:100%;object-fit:cover;" />'
						: '<span>' + esc(p.alias ? p.alias.charAt(0).toUpperCase() : '?') + '</span>';
					return '<div class="slot-picker-row" data-action="assign-slot-player" data-player-id="' + esc(p.id) + '">' +
						'<div style="display:flex;align-items:center;gap:0.6rem;">' +
						'<div class="pitch-player-avatar" style="width:32px;height:32px;font-size:0.8rem;overflow:hidden;border-radius:50%;">' + av + '</div>' +
						'<div><div style="font-weight:700;font-size:0.88rem;color:var(--text-main);">' + esc(p.alias) + '</div>' +
						'<div style="font-size:0.72rem;color:var(--text-muted);">' + esc(p.team_color ? ('ทีม ' + p.team_color) : 'ไม่มีทีม') + ' • ' + esc(getPosCode(p.pos_id)) + '</div></div></div>' +
						(p.rating ? '<span style="font-size:0.78rem;color:var(--text-muted);font-weight:600;">⭐ ' + esc(p.rating) + '</span>' : '') +
						'</div>';
				}).join('');

			html += '<div class="modal-overlay" data-overlay="slot-picker"><div class="modal-content" style="max-width:440px;padding:1.25rem;">' +
				'<div class="card-title" style="margin-bottom:0.75rem;"><div>' +
				'<div style="font-size:1.05rem;font-weight:700;">เลือกผู้เล่นใส่ตำแหน่ง ' + esc(getPosCode(state.targetSlotPosId)) + '</div>' +
				'<div style="font-size:0.8rem;color:var(--text-muted);">ทีม ' + esc(getTeamColorName(state.targetSlotTeamId)) + '</div></div>' +
				'<span style="cursor:pointer;font-size:1.5rem;line-height:1;" data-action="close-slot-picker">×</span></div>' +
				'<div style="max-height:55vh;overflow-y:auto;display:flex;flex-direction:column;gap:0.4rem;">' + rowsHtml + '</div>' +
				'</div></div>';
		}

		modalsEl.innerHTML = html;
	}

	function renderToast() {
		if (!toastEl) return;
		if (!state.toastMessage) {
			toastEl.innerHTML = '';
			return;
		}
		toastEl.innerHTML = '<div class="toast-box"><span>' + esc(state.toastIcon) + '</span><span>' + esc(state.toastMessage) + '</span></div>';
	}

	function syncFullscreenUi() {
		if (appEl) appEl.classList.toggle('is-fullscreen', state.isFullscreen);
		if (fullscreenIconEl) fullscreenIconEl.textContent = state.isFullscreen ? '🗗' : '⛶';
		if (fullscreenBtnEl) fullscreenBtnEl.title = state.isFullscreen ? 'ออกจากโหมดเต็มจอ (Esc)' : 'ขยายเต็มหน้าจอ (Full Screen)';
	}

	function renderAll() {
		syncFullscreenUi();
		renderHeader();
		renderTopNav();
		renderDateCard();
		renderSaveBar();
		renderUnassignedPanel();
		renderMultiPitch();
		renderListView();
		renderSwapBar();
		renderModals();
	}

	function fetchPageData(weeknum) {
		state.loading = true;
		renderListView();
		http.get(state.base_url + '/get_info?cmd=get_position_page_data&weeknum=' + encodeURIComponent(weeknum || 0))
			.then(function (res) {
				state.loading = false;
				if (res.data && res.data.success) {
					state.week = res.data.week;
					state.weeks = res.data.weeks || [];
					state.positions = res.data.positions || [];
					state.teamColors = res.data.team_colors || [];
					state.members = (res.data.members || []).map(function (m) {
						return Object.assign({}, m, {
							picture_url: m.picture_url || null,
							_orig_pos_id: m.pos_id || 0,
							_orig_pos_code: m.pos_code || null,
							_orig_pos_name: m.pos_name || null,
							_orig_pos_icon: m.pos_icon || null,
							_orig_team_id: m.team_id || 0,
							_orig_team_color: m.team_color || ''
						});
					});
					state.pendingChanges = {};
					if ((!state.activePitchTeamId || !state.teamColors.some(function (t) { return t.id === state.activePitchTeamId; })) && state.teamColors.length > 0) {
						state.activePitchTeamId = state.teamColors[0].id;
					}
					renderAll();
				} else if (res.data && res.data.error) {
					showToast(res.data.error, '⚠️');
					renderListView();
				}
			})
			.catch(function (err) {
				state.loading = false;
				console.error('Error fetching position page data:', err);
				if (err.response && err.response.status === 403) {
					showToast((err.response.data && err.response.data.error) ? err.response.data.error : 'Access denied', '🔒');
					setTimeout(function () { window.location.href = '/webhook/match'; }, 1200);
					return;
				}
				showToast('Failed to load page data', '❌');
				renderListView();
			});
	}

	function fetchCurrentUser() {
		var urlParams = new URLSearchParams(window.location.search);
		var initialWeek = urlParams.get('weeknum') || urlParams.get('week') || urlParams.get('week_id') || 0;
		http.get('/webhook/auth/me?weeknum=' + encodeURIComponent(initialWeek))
			.then(function (res) {
				if (res.data && res.data.asset_version) {
					if (state.assetVersion && res.data.asset_version !== state.assetVersion) {
						state.newVersionAvailable = true;
						state.latestServerVersion = res.data.app_version || res.data.asset_version;
					} else {
						state.newVersionAvailable = false;
					}
				}
				if (res.data && res.data.authenticated) {
					state.currentUser = res.data.user;
					if (state.currentUser.role !== 'root' && (state.currentUser.role !== 'admin' || (initialWeek > 0 && res.data.is_roster_locked))) {
						window.location.href = '/webhook/match';
						return;
					}
					renderHeader();
					renderTopNav();
					fetchPageData(initialWeek);
				} else {
					window.location.href = '/webhook/login?redirect=' + encodeURIComponent(window.location.pathname);
				}
			})
			.catch(function () {
				window.location.href = '/webhook/login?redirect=' + encodeURIComponent(window.location.pathname);
			});
	}

	function saveAllPositions() {
		var keys = Object.keys(state.pendingChanges);
		if (keys.length === 0) return;
		state.saving = true;
		renderSaveBar();
		var updates = keys.map(function (id) {
			return {
				id: parseInt(id, 10),
				pos_id: state.pendingChanges[id].pos_id,
				team_id: state.pendingChanges[id].team_id
			};
		});
		http.post(state.base_url + '/batch_update_positions', {
			updates: updates,
			week_id: state.week ? (state.week.id || state.week.number) : 0
		})
			.then(function (res) {
				state.saving = false;
				if (res.data && res.data.success) {
					keys.forEach(function (id) {
						var member = getMemberById(id);
						if (member) {
							member._orig_pos_id = member.pos_id;
							member._orig_pos_code = member.pos_code;
							member._orig_pos_name = member.pos_name;
							member._orig_pos_icon = member.pos_icon;
							member._orig_team_id = member.team_id;
							member._orig_team_color = member.team_color;
						}
					});
					state.pendingChanges = {};
					showToast('บันทึกตำแหน่งและทีมสำเร็จ (' + (res.data.count || keys.length) + ' รายการ)', '✓');
				} else {
					showToast((res.data && res.data.error) || 'เกิดข้อผิดพลาดในการบันทึก', '❌');
				}
				renderAll();
			})
			.catch(function (err) {
				state.saving = false;
				var errMsg = (err.response && err.response.data && err.response.data.error)
					? err.response.data.error : 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
				showToast(errMsg, '❌');
				renderSaveBar();
			});
	}

	function resetPositions() {
		var keys = Object.keys(state.pendingChanges);
		if (keys.length === 0) return;
		keys.forEach(function (id) {
			var member = getMemberById(id);
			if (member) {
				member.pos_id = member._orig_pos_id;
				member.pos_code = member._orig_pos_code;
				member.pos_name = member._orig_pos_name;
				member.pos_icon = member._orig_pos_icon;
				member.team_id = member._orig_team_id;
				member.team_color = member._orig_team_color;
			}
		});
		state.pendingChanges = {};
		showToast('ยกเลิกการแก้ไขและคืนค่าเดิมแล้ว', '↺');
		renderAll();
	}

	function toggleFullscreen() {
		var isCur = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || state.isFullscreen);
		if (!isCur) {
			var elem = document.documentElement;
			if (elem.requestFullscreen) {
				elem.requestFullscreen().catch(function () { state.isFullscreen = true; renderAll(); });
			} else if (elem.webkitRequestFullscreen) {
				elem.webkitRequestFullscreen();
			} else {
				state.isFullscreen = true;
				renderAll();
			}
		} else {
			if (document.exitFullscreen) {
				document.exitFullscreen().catch(function () { state.isFullscreen = false; renderAll(); });
			} else if (document.webkitExitFullscreen) {
				document.webkitExitFullscreen();
			} else {
				state.isFullscreen = false;
				renderAll();
			}
		}
	}

	function handlePlayerClick(player) {
		if (!player) return;
		if (state.longPressFired) {
			state.longPressFired = false;
			return;
		}
		if (state.swapModePlayer) {
			if (state.swapModePlayer.id === player.id) {
				state.swapModePlayer = null;
				showToast('ยกเลิกโหมดสลับตัวแล้ว', 'ℹ️');
				renderAll();
				return;
			}
			swapPlayers(state.swapModePlayer, player);
			state.swapModePlayer = null;
			renderAll();
			return;
		}
		state.activeModalPlayer = player;
		state.showPlayerActionModal = true;
		state.contextMenu.visible = false;
		renderModals();
	}

	if (playerSearchEl) {
		playerSearchEl.addEventListener('input', function () {
			state.searchQuery = playerSearchEl.value || '';
			renderListView();
		});
	}

	if (fullscreenBtnEl) {
		fullscreenBtnEl.addEventListener('click', toggleFullscreen);
	}

	var onFsChange = function () {
		state.isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
		syncFullscreenUi();
		renderSaveBar();
	};
	document.addEventListener('fullscreenchange', onFsChange);
	document.addEventListener('webkitfullscreenchange', onFsChange);
	document.addEventListener('mozfullscreenchange', onFsChange);
	document.addEventListener('MSFullscreenChange', onFsChange);

	window.addEventListener('beforeunload', function (e) {
		if (hasUnsavedChanges()) {
			e.preventDefault();
			e.returnValue = '';
		}
	});

	window.addEventListener('keydown', function (e) {
		if (e.key === 'Escape' && state.contextMenu.visible) {
			state.contextMenu.visible = false;
			renderModals();
		}
	});

	document.addEventListener('click', function (e) {
		if (!e.target.closest('.context-menu') && state.contextMenu.visible) {
			state.contextMenu.visible = false;
			renderModals();
		}

		var overlay = e.target.getAttribute ? e.target.getAttribute('data-overlay') : null;
		if (overlay) {
			if (overlay === 'pos-picker') state.showPosPicker = false;
			if (overlay === 'week-picker') state.showWeekPicker = false;
			if (overlay === 'password-modal') state.showPasswordModal = false;
			if (overlay === 'player-action') { state.showPlayerActionModal = false; state.activeModalPlayer = null; }
			if (overlay === 'slot-picker') state.showSlotPickerModal = false;
			renderModals();
			return;
		}

		var actionEl = e.target.closest('[data-action]');
		if (actionEl) {
			var act = actionEl.getAttribute('data-action');
			if (act === 'reload-app') return ui.reloadApp();
			if (act === 'logout') return ui.logout();
			if (act === 'toggle-fullscreen') return toggleFullscreen();
			if (act === 'open-week-picker') { state.showWeekPicker = true; return renderModals(); }
			if (act === 'close-week-picker') { state.showWeekPicker = false; return renderModals(); }
			if (act === 'change-week') {
				var wkId = parseInt(actionEl.getAttribute('data-week-id'), 10);
				if (hasUnsavedChanges() && !confirm('คุณมีรายการแก้ไขตำแหน่งหรือทีมที่ยังไม่ได้บันทึก ต้องการเปลี่ยนสัปดาห์โดยไม่บันทึกหรือไม่?')) return;
				state.showWeekPicker = false;
				if (window.history && window.history.replaceState) {
					window.history.replaceState(null, '', window.location.pathname + (wkId ? '?weeknum=' + wkId : ''));
				}
				renderModals();
				return fetchPageData(wkId);
			}
			if (act === 'open-password-modal') {
				state.pwdForm = { current_password: '', new_password: '', confirm_password: '' };
				state.pwdMessage = '';
				state.pwdIsError = false;
				state.showPasswordModal = true;
				return renderModals();
			}
			if (act === 'close-password-modal') { state.showPasswordModal = false; return renderModals(); }
			if (act === 'filter-pos') {
				var rawPos = actionEl.getAttribute('data-pos-id');
				if (rawPos === 'all') state.selectedPosFilter = null;
				else {
					var pId = parseInt(rawPos, 10);
					state.selectedPosFilter = state.selectedPosFilter === pId ? null : pId;
				}
				renderDateCard();
				return renderListView();
			}
			if (act === 'filter-team') {
				var rawTm = actionEl.getAttribute('data-team-id');
				if (rawTm === 'all') state.selectedTeamFilter = null;
				else {
					var tId = parseInt(rawTm, 10);
					state.selectedTeamFilter = state.selectedTeamFilter === tId ? null : tId;
				}
				return renderListView();
			}
			if (act === 'set-view') { state.viewMode = actionEl.getAttribute('data-view'); return renderAll(); }
			if (act === 'set-cols') { state.pitchGridCols = parseInt(actionEl.getAttribute('data-cols'), 10) || 2; renderSaveBar(); return renderMultiPitch(); }
			if (act === 'save-positions') return saveAllPositions();
			if (act === 'reset-positions') return resetPositions();
			if (act === 'empty-slot') {
				var stId = parseInt(actionEl.getAttribute('data-team-id'), 10);
				var spId = parseInt(actionEl.getAttribute('data-pos-id'), 10);
				if (state.swapModePlayer) {
					movePlayerToSlot(state.swapModePlayer, stId, spId);
					state.swapModePlayer = null;
					return renderAll();
				}
				state.targetSlotTeamId = stId;
				state.targetSlotPosId = spId;
				state.showSlotPickerModal = true;
				return renderModals();
			}
			if (act === 'close-slot-picker') { state.showSlotPickerModal = false; return renderModals(); }
			if (act === 'assign-slot-player') {
				var chosen = getMemberById(actionEl.getAttribute('data-player-id'));
				if (chosen && state.targetSlotTeamId && state.targetSlotPosId) {
					movePlayerToSlot(chosen, state.targetSlotTeamId, state.targetSlotPosId);
					state.showSlotPickerModal = false;
					state.targetSlotTeamId = null;
					state.targetSlotPosId = null;
					return renderAll();
				}
				return;
			}
			if (act === 'open-pos-picker') {
				e.stopPropagation();
				state.activeMember = getMemberById(actionEl.getAttribute('data-player-id'));
				state.showPosPicker = true;
				return renderModals();
			}
			if (act === 'close-pos-picker') { state.showPosPicker = false; return renderModals(); }
			if (act === 'pick-pos') {
				if (state.activeMember) {
					assignPlayerPosition(state.activeMember, parseInt(actionEl.getAttribute('data-pos-id'), 10) || 0);
					state.showPosPicker = false;
					return renderAll();
				}
				return;
			}
			if (act === 'cancel-swap-mode') { state.swapModePlayer = null; showToast('ยกเลิกโหมดสลับตัวแล้ว', 'ℹ️'); return renderAll(); }
			if (act === 'close-player-action') { state.showPlayerActionModal = false; state.activeModalPlayer = null; return renderModals(); }
			if (act === 'start-swap-mode') {
				if (!state.activeModalPlayer) return;
				state.swapModePlayer = state.activeModalPlayer;
				state.showPlayerActionModal = false;
				state.activeModalPlayer = null;
				showToast('เลือก ' + state.swapModePlayer.alias + ' แล้ว แตะที่ผู้เล่นคนอื่นหรือช่องว่างเพื่อสลับ', '🔁');
				return renderAll();
			}
			if (act === 'modal-pos') {
				if (!state.activeModalPlayer) return;
				var mpId = parseInt(actionEl.getAttribute('data-pos-id'), 10) || 0;
				assignPlayerPosition(state.activeModalPlayer, mpId);
				showToast('เปลี่ยนตำแหน่ง ' + state.activeModalPlayer.alias + ' เป็น ' + getPosCode(mpId) + ' แล้ว', '✓');
				state.showPlayerActionModal = false;
				state.activeModalPlayer = null;
				return renderAll();
			}
			if (act === 'modal-team') {
				if (!state.activeModalPlayer) return;
				var pObj = state.activeModalPlayer;
				var oldC = pObj.team_color || 'ไม่มีทีม';
				var mtId = parseInt(actionEl.getAttribute('data-team-id'), 10) || 0;
				if (mtId === 0) {
					pObj.team_id = 0; pObj.team_color = null; pObj.pos_id = 0;
					pObj.pos_code = null; pObj.pos_name = null; pObj.pos_icon = null;
					recordPlayerChange(pObj);
					showToast('ปลด ' + pObj.alias + ' ออกจากทีมเรียบร้อยแล้ว', '✓');
				} else {
					var tm = state.teamColors.find(function (t) { return t.id === mtId; });
					if (tm) {
						pObj.team_id = mtId; pObj.team_color = tm.color;
						recordPlayerChange(pObj);
						showToast('ย้าย ' + pObj.alias + ' (' + oldC + ' ➜ ทีม ' + tm.color + ') เรียบร้อยแล้ว', '✓');
					}
				}
				state.showPlayerActionModal = false;
				state.activeModalPlayer = null;
				return renderAll();
			}
			if (act === 'ctx-pos') {
				if (state.contextMenu.player) assignPlayerPosition(state.contextMenu.player, parseInt(actionEl.getAttribute('data-pos-id'), 10) || 0);
				state.contextMenu.visible = false;
				return renderAll();
			}
			if (act === 'ctx-team') {
				if (state.contextMenu.player) {
					var cp = state.contextMenu.player;
					var ctId = parseInt(actionEl.getAttribute('data-team-id'), 10) || 0;
					var cOld = cp.team_color || 'ไม่มีทีม';
					if (ctId === 0) {
						cp.team_id = 0; cp.team_color = ''; cp.pos_id = 0;
						cp.pos_code = null; cp.pos_name = null; cp.pos_icon = null;
						recordPlayerChange(cp);
						showToast('ปลด ' + cp.alias + ' ออกจากทีม ' + cOld + ' แล้ว', '⚪');
					} else {
						var cTm = state.teamColors.find(function (t) { return t.id === ctId; });
						if (cTm && cp.team_id !== ctId) {
							cp.team_id = ctId; cp.team_color = cTm.color; cp.pos_id = 0;
							cp.pos_code = null; cp.pos_name = null; cp.pos_icon = null;
							recordPlayerChange(cp);
							showToast('ย้าย ' + cp.alias + ' จาก ' + cOld + ' ไปยังทีม ' + cTm.color + ' แล้ว', '✓');
						}
					}
				}
				state.contextMenu.visible = false;
				return renderAll();
			}
		}

		var playerEl = e.target.closest('[data-player-id]');
		if (playerEl && !e.target.closest('.modal-overlay')) {
			var clicked = getMemberById(playerEl.getAttribute('data-player-id'));
			if (clicked) handlePlayerClick(clicked);
		}
	});

	document.addEventListener('submit', function (e) {
		if (!e.target || e.target.id !== 'changePasswordForm') return;
		e.preventDefault();
		var cur = (document.getElementById('pwdCurrentInput') || {}).value || '';
		var nw = (document.getElementById('pwdNewInput') || {}).value || '';
		var cf = (document.getElementById('pwdConfirmInput') || {}).value || '';
		state.pwdForm = { current_password: cur, new_password: nw, confirm_password: cf };
		if (nw !== cf) {
			state.pwdMessage = 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน';
			state.pwdIsError = true;
			return renderModals();
		}
		state.pwdLoading = true;
		state.pwdMessage = '';
		renderModals();
		http.post('/webhook/change_password', state.pwdForm)
			.then(function (res) {
				state.pwdLoading = false;
				if (res.data && res.data.success) {
					state.pwdIsError = false;
					state.pwdMessage = 'เปลี่ยนรหัสผ่านสำเร็จ!';
					renderModals();
					setTimeout(function () { state.showPasswordModal = false; renderModals(); }, 1500);
				} else {
					state.pwdIsError = true;
					state.pwdMessage = (res.data && res.data.error) || 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน';
					renderModals();
				}
			})
			.catch(function (err) {
				state.pwdLoading = false;
				state.pwdIsError = true;
				state.pwdMessage = (err.response && err.response.data && err.response.data.error) ? err.response.data.error : 'เกิดข้อผิดพลาดในการเชื่อมต่อ';
				renderModals();
			});
	});

	document.addEventListener('contextmenu', function (e) {
		var pEl = e.target.closest('[data-player-id], [data-list-player-id]');
		if (!pEl || e.target.closest('.modal-overlay')) {
			if (state.contextMenu.visible) { state.contextMenu.visible = false; renderModals(); }
			return;
		}
		e.preventDefault();
		var id = pEl.getAttribute('data-player-id') || pEl.getAttribute('data-list-player-id');
		var player = getMemberById(id);
		if (!player) return;
		var x = e.clientX, y = e.clientY;
		if (x + 220 > window.innerWidth) x = window.innerWidth - 230;
		if (y + 440 > window.innerHeight) y = window.innerHeight - 450;
		state.contextMenu = { visible: true, x: Math.max(10, x), y: Math.max(10, y), player: player };
		renderModals();
	});

	document.addEventListener('touchstart', function (e) {
		var pEl = e.target.closest('[data-player-id]');
		if (!pEl || e.target.closest('.modal-overlay')) return;
		var player = getMemberById(pEl.getAttribute('data-player-id'));
		if (!player) return;
		state.longPressFired = false;
		if (state.longPressTimer) clearTimeout(state.longPressTimer);
		state.longPressTimer = setTimeout(function () {
			state.longPressFired = true;
			state.activeModalPlayer = player;
			state.showPlayerActionModal = true;
			state.contextMenu.visible = false;
			renderModals();
			if (navigator.vibrate) { try { navigator.vibrate(40); } catch (_) {} }
		}, 380);
	}, { passive: true });

	var cancelTouchTimer = function () {
		if (state.longPressTimer) { clearTimeout(state.longPressTimer); state.longPressTimer = null; }
	};
	document.addEventListener('touchend', cancelTouchTimer, { passive: true });
	document.addEventListener('touchmove', cancelTouchTimer, { passive: true });

	// HTML5 Drag & Drop via classList highlights (never destroy DOM mid-drag)
	document.addEventListener('dragstart', function (e) {
		var pEl = e.target.closest('[data-player-id], [data-list-player-id]');
		if (!pEl) return;
		var id = pEl.getAttribute('data-player-id') || pEl.getAttribute('data-list-player-id');
		var player = getMemberById(id);
		if (!player) return;
		state.draggedPlayer = player;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			try { e.dataTransfer.setData('text/plain', String(player.id)); } catch (_) {}
		}
		pEl.classList.add('is-dragging');
	});

	function clearDragHighlights() {
		document.querySelectorAll('.is-dragging, .drag-over, .is-swap-target').forEach(function (el) {
			el.classList.remove('is-dragging', 'drag-over', 'is-swap-target');
		});
	}

	document.addEventListener('dragend', function () {
		state.draggedPlayer = null;
		clearDragHighlights();
	});

	document.addEventListener('dragover', function (e) {
		if (!state.draggedPlayer) return;
		var targetP = e.target.closest('[data-player-id], [data-list-player-id]');
		var slotEl = e.target.closest('[data-slot-team-id]');
		var benchEl = e.target.closest('[data-bench-team-id]');
		var unEl = e.target.closest('#unassignedPanel');
		if (targetP || slotEl || benchEl || unEl) {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		}
		if (targetP) {
			var tid = parseInt(targetP.getAttribute('data-player-id') || targetP.getAttribute('data-list-player-id'), 10);
			if (tid !== state.draggedPlayer.id) targetP.classList.add('is-swap-target');
		} else if (slotEl) {
			slotEl.classList.add('drag-over');
		} else if (benchEl) {
			benchEl.classList.add('drag-over');
		} else if (unEl) {
			unEl.classList.add('drag-over');
		}
	});

	document.addEventListener('dragleave', function (e) {
		var el = e.target.closest('[data-player-id], [data-list-player-id], [data-slot-team-id], [data-bench-team-id], #unassignedPanel');
		if (el && !el.contains(e.relatedTarget)) {
			el.classList.remove('drag-over', 'is-swap-target');
		}
	});

	document.addEventListener('drop', function (e) {
		clearDragHighlights();
		if (!state.draggedPlayer) return;
		var dragged = state.draggedPlayer;
		state.draggedPlayer = null;

		var targetP = e.target.closest('[data-player-id], [data-list-player-id]');
		if (targetP) {
			e.preventDefault();
			var targetObj = getMemberById(targetP.getAttribute('data-player-id') || targetP.getAttribute('data-list-player-id'));
			if (targetObj && targetObj.id !== dragged.id) {
				swapPlayers(dragged, targetObj);
				renderAll();
			}
			return;
		}

		var slotEl = e.target.closest('[data-slot-team-id]');
		if (slotEl) {
			e.preventDefault();
			movePlayerToSlot(dragged, parseInt(slotEl.getAttribute('data-slot-team-id'), 10), parseInt(slotEl.getAttribute('data-slot-pos-id'), 10));
			renderAll();
			return;
		}

		var benchEl = e.target.closest('[data-bench-team-id]');
		if (benchEl) {
			e.preventDefault();
			var btId = parseInt(benchEl.getAttribute('data-bench-team-id'), 10);
			var tm = state.teamColors.find(function (t) { return t.id === btId; });
			if (tm) {
				var oldId = dragged.team_id || 0;
				var oldColor = dragged.team_color || 'ไม่มีทีม';
				dragged.team_id = btId; dragged.team_color = tm.color; dragged.pos_id = 0;
				dragged.pos_code = null; dragged.pos_name = null; dragged.pos_icon = null;
				recordPlayerChange(dragged);
				showToast(oldId !== btId ? ('ย้าย ' + dragged.alias + ' (' + oldColor + ' ➜ ' + tm.color + ') พักสำรองแล้ว') : ('ย้าย ' + dragged.alias + ' ไปม้านั่งสำรองแล้ว'), oldId !== btId ? '✓' : '⚪');
				renderAll();
			}
			return;
		}

		if (e.target.closest('#unassignedPanel')) {
			e.preventDefault();
			var prevColor = dragged.team_color || 'ไม่มีทีม';
			dragged.team_id = 0; dragged.team_color = ''; dragged.pos_id = 0;
			dragged.pos_code = null; dragged.pos_name = null; dragged.pos_icon = null;
			recordPlayerChange(dragged);
			showToast('ปลด ' + dragged.alias + ' ออกจากทีม (' + prevColor + ' ➜ นอกสนาม) แล้ว', '⚪');
			renderAll();
		}
	});

	// Horizontal mouse-drag panning on pitch scroll wrapper
	document.addEventListener('mousedown', function (e) {
		if (e.button !== 0) return;
		if (e.target.closest('.pitch-circle-avatar, .pitch-player-pill, .pitch-empty-pill')) return;
		var wrapper = e.target.closest('.tactical-pitch-scroll-wrapper');
		if (!wrapper) return;
		state.pitchPanWrapper = wrapper;
		state.pitchPanStartX = e.pageX - wrapper.offsetLeft;
		state.pitchPanScrollLeft = wrapper.scrollLeft;
		wrapper.classList.add('is-panning');
	});

	document.addEventListener('mousemove', function (e) {
		if (!state.pitchPanWrapper) return;
		e.preventDefault();
		var x = e.pageX - state.pitchPanWrapper.offsetLeft;
		state.pitchPanWrapper.scrollLeft = state.pitchPanScrollLeft - (x - state.pitchPanStartX) * 1.4;
	});

	var stopPan = function () {
		if (state.pitchPanWrapper) {
			state.pitchPanWrapper.classList.remove('is-panning');
			state.pitchPanWrapper = null;
		}
	};
	document.addEventListener('mouseup', stopPan);

	renderAll();
	fetchCurrentUser();
})();

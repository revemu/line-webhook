/* Match Center & Live Manager (Pure Vanilla JS) */
(function () {
	'use strict';

	var ui = window.ui;
	var http = window.http;
	var esc = ui.escapeHtml;

	var pathname = window.location.pathname || '';
	var isManagerMode = pathname.indexOf('/match') !== -1 &&
		pathname.indexOf('/view') === -1 &&
		pathname.indexOf('/matches') === -1;

	var POS_RANK = { GK: 1, DF: 2, DW: 3, DM: 4, MF: 5, AM: 6, CF: 7 };

	var state = {
		isManager: isManagerMode,
		showPitch: isManagerMode ? true : (localStorage.getItem('viewer_show_pitch') === '1'),
		appVersion: window.__APP_VERSION__ || '0.7',
		assetVersion: window.__ASSET_VERSION__ || '',
		newVersionAvailable: false,
		latestServerVersion: '',
		currentUser: null,
		sessionExpired: false,
		isDarkTheme: true,
		selectedWeek: 0,
		info: {},
		weeks: [],
		selectedMatchNum: null,
		activePitchTab: 'both',
		isPitchModal: false,
		showClassicForm: false,
		classicStatusId: '0',
		classicIsLoan: false,
		classicMemberId: '',
		classicTeamId: '',
		teamSummaryViewMode: localStorage.getItem('team_summary_view_mode') || 'pitch',
		inlinePitchMatches: {},
		loanAssignments: {},
		loanSearchQuery: '',
		loanFilterTeam: 'all',
		draggedLoanPlayerId: null,
		matchTeamMembersCache: {},
		loadingMatchMembers: false,
		showWeekPicker: false,
		showDeleteModal: false,
		deleteTargetMatch: null,
		confirmDeleteChecked: false,
		deletingMatch: false,
		showPasswordModal: false,
		pwdLoading: false,
		pwdMessage: '',
		pwdIsError: false,
		pwdForm: { current_password: '', new_password: '', confirm_password: '' },
		showAddMatchModal: false,
		addMatchForm: { matchnum: 1, teamaid: '', teambid: '', status: 'in_progress' },
		addingMatch: false,
		addMatchError: '',
		showExtendModal: false,
		extendParam: '30',
		extending: false,
		extendError: '',
		showPlayerPicker: false,
		showLoanTeamPicker: false,
		pickerSearch: '',
		toastMessage: '',
		toastHtml: '',
		toastIcon: '⚽',
		toastAvatar: '',
		toastInitials: '',
		toastTimer: null,
		isRefreshing: false,
		refreshCooldown: 30,
		refreshTimer: null,
		ws: null,
		wsConnected: false,
		wsReconnectTimer: null,
		wsHeartbeatTimer: null,
		wsHandshakeTimer: null,
		wsWeekId: null,
		processedWsEvents: {},
		lastHiddenAt: 0,
		summaryScrollIndex: 0
	};

	var rootEl = document.getElementById('soccer-match');
	var toastEl = document.getElementById('toastArea');
	var headerEl = document.getElementById('updateHeaderArea');
	var topNavEl = document.getElementById('updateTopNavArea');
	var sessionBannerEl = document.getElementById('sessionExpiredBanner');
	var dateCardEl = document.getElementById('dateInfoCard');
	var pitchBackdropEl = document.getElementById('pitchModalBackdrop');
	var rosterLockedEl = document.getElementById('rosterLockedArea');
	var stadiumWrapEl = document.getElementById('stadiumCardWrap');
	var stadiumScoreboardEl = document.getElementById('stadiumScoreboardArea');
	var classicFormEl = document.getElementById('classicGoalFormArea');
	var stadiumPitchEl = document.getElementById('stadiumPitchArea');
	var loanPoolPanelEl = document.getElementById('loanPoolPanel');
	var loanPoolCountEl = document.getElementById('loanPoolCountBadge');
	var loanSearchInputEl = document.getElementById('loanSearchInput');
	var loanFilterChipsEl = document.getElementById('loanFilterChips');
	var loanPlayerGridEl = document.getElementById('loanPlayerGrid');
	var matchTimelineEl = document.getElementById('matchTimelineArea');
	var emptyMatchesEl = document.getElementById('emptyMatchesCard');
	var teamSummaryEl = document.getElementById('teamSummaryCard');
	var standingsEl = document.getElementById('standingsCard');
	var matchListEl = document.getElementById('matchListArea');
	var weekPickerModalEl = document.getElementById('weekPickerModalArea');
	var deleteModalEl = document.getElementById('deleteModalArea');
	var passwordModalEl = document.getElementById('passwordModalArea');
	var addMatchModalEl = document.getElementById('addMatchModalArea');
	var extendModalEl = document.getElementById('extendModalArea');
	var pickerModalEl = document.getElementById('pickerModalArea');

	var themeCtrl = ui.initTheme('themeToggle', 'themeIcon', function (isDark) {
		state.isDarkTheme = isDark;
		renderMainSections();
	});
	state.isDarkTheme = themeCtrl.isDark();

	http.onResponse(
		function (response) {
			if (typeof response.data === 'string' &&
				response.data.indexOf('<!DOCTYPE html>') !== -1 &&
				response.data.indexOf('login') !== -1) {
				state.sessionExpired = true;
				renderSessionBanner();
				return Promise.reject({
					response: {
						status: 401,
						data: {
							success: false,
							session_expired: true,
							error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'
						}
					}
				});
			}
			return response;
		},
		function (err) {
			if (err && err.response && err.response.status === 401 && state.isManager) {
				state.sessionExpired = true;
				renderSessionBanner();
			}
			return Promise.reject(err);
		}
	);

	function showToast(msg, icon, opts) {
		opts = opts || {};
		state.toastMessage = msg || '';
		state.toastHtml = opts.html || '';
		state.toastIcon = icon || '✓';
		state.toastAvatar = opts.avatar || '';
		state.toastInitials = opts.initials || '';
		if (state.toastTimer) clearTimeout(state.toastTimer);
		renderToast();
		state.toastTimer = setTimeout(function () {
			state.toastMessage = '';
			state.toastHtml = '';
			renderToast();
		}, opts.duration || 4000);
	}

	function renderToast() {
		if (!toastEl) return;
		if (!state.toastMessage && !state.toastHtml) {
			toastEl.innerHTML = '';
			return;
		}
		var avatarHtml = '';
		if (state.toastAvatar) {
			avatarHtml = '<img src="' + esc(state.toastAvatar) + '" class="toast-avatar" alt="Player">';
		} else if (state.toastInitials) {
			avatarHtml = '<div class="toast-avatar-fallback">' + esc(state.toastInitials) + '</div>';
		} else {
			avatarHtml = '<span style="font-size: 1.15rem;">' + esc(state.toastIcon) + '</span>';
		}
		var bodyHtml = state.toastHtml ? state.toastHtml : esc(state.toastMessage);
		toastEl.innerHTML = '<div class="match-toast">' + avatarHtml + '<div class="toast-body">' + bodyHtml + '</div></div>';
	}

	function getContrast(color) {
		return ui.getContrastColor(color);
	}

	function getBorder(color) {
		return ui.getBorderColor(color, state.isDarkTheme);
	}

	function teamHex(name) {
		return ui.getTeamColorByName(name);
	}

	function getInitials(p) {
		var label = (p && (p.alias || p.name || p.member_name)) || '?';
		return String(label).trim().charAt(0).toUpperCase() || '?';
	}

	function getDisplayName(p) {
		return (p && (p.alias || p.name || p.member_name)) || 'Unknown';
	}

	function getPosCode(p) {
		return String((p && (p.pos_code || p.position_code || p.position || '')) || '').toUpperCase();
	}

	function getRatingClass(rating) {
		var num = parseFloat(rating);
		if (isNaN(num) || num <= 0 || rating === '-' || rating === null || rating === undefined) return 'rating-none';
		if (num >= 7.0) return 'rating-elite';
		if (num >= 6.0) return 'rating-great';
		if (num >= 5.0) return 'rating-good';
		return 'rating-avg';
	}

	function formatRating(rating) {
		var num = parseFloat(rating);
		return isNaN(num) ? '-' : num.toFixed(1);
	}

	function getMatchesObj() {
		return (state.info && state.info.all_match) || {};
	}

	function getMatchKeys() {
		return Object.keys(getMatchesObj()).sort(function (a, b) {
			return Number(a) - Number(b);
		});
	}

	function getMatchByNum(num) {
		var all = getMatchesObj();
		return all[String(num)] || all[num] || null;
	}

	function getSelectedMatch() {
		if (!state.selectedMatchNum) return null;
		return getMatchByNum(state.selectedMatchNum);
	}

	function getTeamList() {
		var tw = (state.info && state.info.team_week) || {};
		return Object.keys(tw).map(function (k) {
			return tw[k];
		}).sort(function (a, b) {
			return Number(a.teamid) - Number(b.teamid);
		});
	}

	function getMemberById(id) {
		var list = (state.info && state.info.allmembers) || [];
		var tid = Number(id);
		for (var i = 0; i < list.length; i++) {
			if (Number(list[i].id) === tid) return list[i];
		}
		return null;
	}

	function getGoalEventTeamId(ev) {
		return Number((ev && (ev.team_week_id || ev.team_id)) || 0);
	}

	function getGoalEventName(ev) {
		if (!ev) return 'Unknown';
		if (ev.member_name || ev.name || ev.alias) {
			return ev.member_name || ev.name || ev.alias;
		}
		var pl = ev.member_id ? getMemberById(ev.member_id) : null;
		return pl ? getDisplayName(pl) : 'Unknown';
	}

	function getGoalEventColor(ev, match) {
		if (!ev) return '';
		if (ev.color) return ev.color;
		var tid = getGoalEventTeamId(ev);
		if (tid && state.info && state.info.team_week && state.info.team_week[tid]) {
			return state.info.team_week[tid].name || '';
		}
		if (match) {
			if (tid && tid === Number(match.team_a_id)) return match.team_a_color || '';
			if (tid && tid === Number(match.team_b_id)) return match.team_b_color || '';
		}
		var pl = ev.member_id ? getMemberById(ev.member_id) : null;
		return (pl && pl.color) || '';
	}

	function getGoalEventsForPlayer(match, memberId, teamId) {
		var goals = (match && match.goal) || [];
		var mid = Number(memberId);
		var tid = Number(teamId);
		var res = [];
		for (var i = 0; i < goals.length; i++) {
			var g = goals[i];
			var gTid = getGoalEventTeamId(g);
			if (Number(g.member_id) === mid && (!tid || !gTid || gTid === tid)) {
				res.push(g);
			}
		}
		return res;
	}

	function getRegularTeamPlayers(teamId) {
		var members = (state.info && state.info.allmembers) || [];
		var tid = Number(teamId);
		return members.filter(function (m) {
			return Number(m.team_id) === tid;
		}).sort(function (a, b) {
			var ra = POS_RANK[getPosCode(a)] || 99;
			var rb = POS_RANK[getPosCode(b)] || 99;
			if (ra !== rb) return ra - rb;
			return getDisplayName(a).localeCompare(getDisplayName(b));
		});
	}

	function getLoanKey(matchId) {
		return String(matchId || 0);
	}

	function ensureMatchLoansObj(matchId) {
		var k = getLoanKey(matchId);
		if (!state.loanAssignments[k]) state.loanAssignments[k] = {};
		return state.loanAssignments[k];
	}

	function getLoanPlayersForSide(match, teamId) {
		if (!match || !teamId) return [];
		var tid = Number(teamId);
		var regIds = {};
		getRegularTeamPlayers(tid).forEach(function (m) { regIds[Number(m.id)] = true; });
		var seen = {};
		var result = [];

		// 1. From live session loanAssignments
		var manualLoans = state.loanAssignments[getLoanKey(match.id)] || {};
		Object.keys(manualLoans).forEach(function (pidStr) {
			if (Number(manualLoans[pidStr]) === tid) {
				var pid = Number(pidStr);
				if (!regIds[pid] && !seen[pid]) {
					var mObj = getMemberById(pid);
					if (mObj) {
						seen[pid] = true;
						result.push(mObj);
					}
				}
			}
		});

		// 2. Derived from match.goal entries scored/assisted for this team by non-regular members
		var goals = match.goal || [];
		for (var i = 0; i < goals.length; i++) {
			var g = goals[i];
			var gTeamId = getGoalEventTeamId(g);
			var gMid = Number(g.member_id);
			if (gTeamId === tid && !regIds[gMid] && !seen[gMid]) {
				var gName = getGoalEventName(g);
				var m = getMemberById(gMid) || {
					id: gMid,
					alias: gName,
					name: gName,
					picture_url: g.picture_url || '',
					position_code: g.position_code || '',
					color: getGoalEventColor(g, match)
				};
				seen[gMid] = true;
				result.push(m);
			}
		}
		return result;
	}

	function getAvailableLoanPool(match) {
		if (!match) return [];
		var allMembers = (state.info && state.info.allmembers) || [];
		var teamAId = Number(match.team_a_id);
		var teamBId = Number(match.team_b_id);
		var loanedMap = {};
		getLoanPlayersForSide(match, teamAId).forEach(function (p) { loanedMap[Number(p.id)] = true; });
		getLoanPlayersForSide(match, teamBId).forEach(function (p) { loanedMap[Number(p.id)] = true; });

		var q = String(state.loanSearchQuery || '').trim().toLowerCase();
		var filterTeam = state.loanFilterTeam;

		return allMembers.filter(function (m) {
			var mTeamId = Number(m.team_id);
			if (mTeamId === teamAId || mTeamId === teamBId) return false;
			if (loanedMap[Number(m.id)]) return false;
			if (filterTeam !== 'all' && String(mTeamId) !== String(filterTeam)) return false;
			if (q) {
				var hay = (getDisplayName(m) + ' ' + (m.name || '') + ' ' + getPosCode(m) + ' ' + (m.color || '')).toLowerCase();
				if (hay.indexOf(q) === -1) return false;
			}
			return true;
		});
	}

	function getTeamTacticalCol(players, colType) {
		var list = players || [];
		if (colType === 'gk_df') {
			return list.filter(function (p) {
				var c = getPosCode(p);
				return c === 'GK' || c === 'DF' || c === 'DW';
			});
		}
		if (colType === 'mf') {
			return list.filter(function (p) {
				var c = getPosCode(p);
				return c === 'DM' || c === 'MF' || c === 'AM' || !c;
			});
		}
		if (colType === 'fw') {
			return list.filter(function (p) {
				var c = getPosCode(p);
				return c === 'CF';
			});
		}
		return list;
	}

	function getTeamTacticalRows(players) {
		var list = players || [];
		var rows = { fw: [], mf: [], df: [], gk: [] };
		for (var i = 0; i < list.length; i++) {
			var p = list[i];
			var c = getPosCode(p);
			if (c === 'CF') rows.fw.push(p);
			else if (c === 'AM' || c === 'MF' || c === 'DM') rows.mf.push(p);
			else if (c === 'DW' || c === 'DF') rows.df.push(p);
			else if (c === 'GK') rows.gk.push(p);
			else rows.mf.push(p);
		}
		var ordered = [];
		if (rows.fw.length) ordered.push(rows.fw);
		if (rows.mf.length) ordered.push(rows.mf);
		if (rows.df.length) ordered.push(rows.df);
		if (rows.gk.length) ordered.push(rows.gk);
		return ordered;
	}

	function getMatchTeamStatusCounts() {
		var all = getMatchesObj();
		var keys = getMatchKeys();
		var liveCount = 0;
		for (var i = 0; i < keys.length; i++) {
			if (all[keys[i]].is_live) liveCount++;
		}
		return { total: keys.length, liveCount: liveCount };
	}

	function renderHeader() {
		if (!headerEl) return;
		var titleText = state.isManager ? '⚽ Score & Match Manager' : '🏆 Live Match Center';
		var subtitleText = state.isManager ? 'บันทึกประตู แอสซิสต์ และจัดการการแข่งขันแบบ Real-time' : 'ติดตามผลสกอร์ ตารางคะแนน และสถิติผู้เล่นสด';
		var versionPill = state.newVersionAvailable
			? '<span class="app-version-badge update-available" data-action="reload-app" style="cursor:pointer;" title="มีเวอร์ชันใหม่ คลิกเพื่อรีเฟรช">🚀 อัปเดต v' + esc(state.latestServerVersion) + '</span>'
			: '<span class="app-version-badge">v' + esc(state.appVersion) + '</span>';

		var viewerControls = '';
		if (!state.isManager) {
			var hasJumpBtn = state.info && state.info.current_match_num && Number(state.selectedMatchNum) !== Number(state.info.current_match_num);
			if (hasJumpBtn) {
				viewerControls =
					'<div class="viewer-header-actions">' +
					'<button type="button" class="btn-jump-current-pill" data-action="jump-current-match">📍 คู่ปัจจุบัน (Match ' + esc(state.info.current_match_num) + ')</button>' +
					'</div>';
			}
		}

		headerEl.innerHTML =
			'<div class="header-top-block">' +
			'<div class="header-title-row">' +
			'<h1>' + titleText + '</h1>' +
			'<div class="header-badges">' + versionPill + '</div>' +
			'</div>' +
			'<p>' + subtitleText + '</p>' +
			'</div>' +
			viewerControls;
	}

	function renderTopNav() {
		if (!topNavEl) return;
		topNavEl.style.display = 'flex';
		var canPos = state.currentUser && (
			state.currentUser.role === 'root' ||
			(state.currentUser.role === 'admin' && state.info && !state.info.is_roster_locked)
		);

		var tabs = '';
		if (state.currentUser) {
			tabs += '<a href="/webhook/match" class="nav-tab' + (state.isManager ? ' active' : '') + '">⚽ Manager</a>';
		}
		tabs += '<a href="/webhook/view" class="nav-tab' + (!state.isManager ? ' active' : '') + '">📺 Viewer</a>';
		if (canPos) {
			tabs += '<a href="/webhook/position" class="nav-tab">🛡️ จัดทีม/ตำแหน่ง</a>';
		}

		var rightAuth = '';
		if (state.currentUser) {
			var roleCls = state.currentUser.role === 'root' ? 'root' : 'admin';
			var roleIcon = state.currentUser.role === 'root' ? '👑' : '👤';
			var userLabel = state.currentUser.username || state.currentUser.name || 'user';
			rightAuth =
				'<div class="user-status-pill">' +
				'<span class="user-role-badge ' + roleCls + '">' + roleIcon + ' ' + esc(userLabel) + '</span>' +
				'<button type="button" class="btn-action-pill" data-action="open-password-modal" title="เปลี่ยนรหัสผ่าน">🔑</button>' +
				'<button type="button" class="btn-logout" data-action="logout" title="ออกจากระบบ">ออก</button>' +
				'</div>';
		} else {
			rightAuth = '<a href="/webhook/login" class="btn-action-pill">🔐 เข้าสู่ระบบ Admin</a>';
		}

		topNavEl.innerHTML =
			'<div class="nav-tabs">' + tabs + '</div>' +
			'<div style="display:flex;align-items:center;gap:0.5rem;">' + rightAuth + '</div>';
	}

	function renderSessionBanner() {
		if (!sessionBannerEl) return;
		if (state.isManager && state.sessionExpired) {
			sessionBannerEl.innerHTML =
				'<div class="session-expired-banner">' +
				'<span>⚠️ เซสชันผู้ดูแลระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง</span>' +
				'<a href="/webhook/login">เข้าสู่ระบบใหม่</a>' +
				'</div>';
		} else {
			sessionBannerEl.innerHTML = '';
		}
	}

	function renderDateCard() {
		if (!dateCardEl) return;
		var w = state.info && state.info.week;
		if (!w || !w.id) {
			dateCardEl.style.display = 'none';
			dateCardEl.innerHTML = '';
			return;
		}
		dateCardEl.style.display = 'block';
		var matchKeys = getMatchKeys();
		var timeRange = w.time_range ? ' • ⏱️ ' + esc(w.time_range) + ' น.' : '';
		dateCardEl.innerHTML =
			'<div class="info-row">' +
			'<div class="info-item">' +
			'<div class="info-label">WEEK / DATE</div>' +
			'<div class="info-value">📅 Week ' + esc(w.number) + ' • ' + esc(w.date) + timeRange + '</div>' +
			'</div>' +
			'<div class="info-actions" style="display:flex;align-items:center;gap:0.5rem;">' +
			'<span class="week-badge-pill">' + esc(matchKeys.length) + ' Matches</span>' +
			'<button type="button" class="btn-action-pill" data-action="open-week-picker">📅 เปลี่ยนวัน</button>' +
			'</div>' +
			'</div>';
	}

	function renderPitchModalBackdrop() {
		if (!pitchBackdropEl) return;
		var open = !!(state.isManager && state.isPitchModal);
		pitchBackdropEl.className = open ? 'pitch-modal-backdrop' : '';
		if (document.body && document.body.classList) {
			document.body.classList.toggle('pitch-modal-open', open);
		}
	}

	function renderRosterLocked() {
		if (!rosterLockedEl) return;
		var hasMatches = getMatchKeys().length > 0;
		if (!state.info || !state.info.is_roster_locked || !hasMatches) {
			rosterLockedEl.style.display = 'none';
			rosterLockedEl.innerHTML = '';
			return;
		}
		rosterLockedEl.style.display = 'flex';
		var msg = state.info.roster_lock_message || 'ระบบจะทำการสุ่มทีมวันศุกร์ เวลา 20:00 น.';
		var playerCount = ((state.info && state.info.allmembers) || []).length;
		rosterLockedEl.innerHTML =
			'<div class="roster-locked-card">' +
			'<div class="roster-locked-icon">⏳</div>' +
			'<h3 class="roster-locked-title">กำลังรอการสุ่มทีมประจำสัปดาห์</h3>' +
			'<p class="roster-locked-desc">รายชื่อทีมและผังสนามจะเปิดแสดงอัตโนมัติหลังสุ่มทีม</p>' +
			'<div class="roster-locked-badge">' +
			'<span class="roster-pill-time">⏰ ' + esc(msg.replace(/^ระบบจะทำการสุ่มทีม/, 'สุ่มทีม')) + '</span>' +
			'<span class="roster-pill-count">👥 ลงชื่อแล้ว ' + esc(playerCount) + ' คน</span>' +
			'</div>' +
			'</div>';
	}

	function renderScoreBubbles(events) {
		if (!events || !events.length) return '';
		var goals = [];
		var assists = [];
		var ogs = [];
		for (var i = 0; i < events.length; i++) {
			var st = Number(events[i].goal_status);
			if (st === 2) ogs.push(events[i]);
			else if (st === 3) assists.push(events[i]);
			else goals.push(events[i]);
		}
		var rmCls = state.isManager ? ' is-removable' : '';
		var rmX = state.isManager ? '<span class="bubble-remove-x">&times;</span>' : '';
		var html = '<div class="player-score-bubbles">';
		if (goals.length) {
			html += '<button type="button" class="bubble-goal' + rmCls + '" data-action="quick-remove-goal" data-goal-id="' + esc(goals[goals.length - 1].goal_id) + '" title="ลบประตู (-1)"><span>⚽' + goals.length + '</span>' + rmX + '</button>';
		}
		if (assists.length) {
			html += '<button type="button" class="bubble-assist' + rmCls + '" data-action="quick-remove-goal" data-goal-id="' + esc(assists[assists.length - 1].goal_id) + '" title="ลบแอสซิสต์ (-1)"><span>👟' + assists.length + '</span>' + rmX + '</button>';
		}
		if (ogs.length) {
			html += '<button type="button" class="bubble-og' + rmCls + '" data-action="quick-remove-goal" data-goal-id="' + esc(ogs[ogs.length - 1].goal_id) + '" title="ลบ OG (-1)"><span>OG' + ogs.length + '</span>' + rmX + '</button>';
		}
		html += '</div>';
		return html;
	}

	function renderPitchPlayerNode(player, match, teamId, isLoan) {
		var name = getDisplayName(player);
		var pos = getPosCode(player) || 'MF';
		var events = getGoalEventsForPlayer(match, player.id, teamId);
		var teamObj = (state.info && state.info.team_week && state.info.team_week[teamId]) || {};
		var tColor = teamHex(teamObj.name || player.color);
		var avatar = player.picture_url
			? '<img src="' + esc(player.picture_url) + '" alt="' + esc(name) + '">'
			: '<span class="avatar-char">' + esc(getInitials(player)) + '</span>';

		var unloanBtn = isLoan
			? '<button type="button" class="btn-unloan-node" data-action="unloan-player" data-match-id="' + esc(match.id) + '" data-player-id="' + esc(player.id) + '" title="คืนตัวกลับทีมเดิม">✕</button>'
			: '';

		return '<div class="pitch-player-node' + (isLoan ? ' is-loan' : '') + '">' +
			'<div class="pitch-player-avatar-wrap">' +
			unloanBtn +
			'<div class="pitch-player-avatar-circle" style="border-color:' + esc(tColor) + ';">' +
			avatar +
			'</div>' +
			renderScoreBubbles(events) +
			'</div>' +
			'<div class="pitch-name-pill">' +
			'<span class="pitch-pos-label">' + esc(pos) + '</span>' +
			'<span class="pitch-name-text">' + esc(name) + '</span>' +
			'</div>' +
			'<div class="pitch-player-actions">' +
			'<button type="button" class="btn-quick-goal" data-action="quick-goal" data-member-id="' + esc(player.id) + '" data-team-id="' + esc(teamId) + '" data-status="0" title="ยิงประตู (Goal)">⚽</button>' +
			'<button type="button" class="btn-quick-assist" data-action="quick-goal" data-member-id="' + esc(player.id) + '" data-team-id="' + esc(teamId) + '" data-status="3" title="แอสซิสต์ (Assist)">👟</button>' +
			'<button type="button" class="btn-quick-og" data-action="quick-goal" data-member-id="' + esc(player.id) + '" data-team-id="' + esc(teamId) + '" data-status="2" title="ทำเข้าประตูตัวเอง (OG)">OG</button>' +
			'</div>' +
			'</div>';
	}

	function renderHalfPitchNodes(players, match, teamId, isSideB) {
		var col1 = getTeamTacticalCol(players, 'gk_df');
		var col2 = getTeamTacticalCol(players, 'mf');
		var col3 = getTeamTacticalCol(players, 'fw');
		var cols = isSideB ? [col3, col2, col1] : [col1, col2, col3];
		var html = '<div class="pitch-half-formation three-cols">';
		for (var c = 0; c < cols.length; c++) {
			html += '<div class="pitch-form-col col-tactical-half">';
			for (var i = 0; i < cols[c].length; i++) {
				html += renderPitchPlayerNode(cols[c][i], match, teamId, false);
			}
			html += '</div>';
		}
		html += '</div>';
		return html;
	}

	function renderStadiumScoreboard(match) {
		if (!stadiumScoreboardEl || !match) return;
		var keys = getMatchKeys();
		var curIdx = keys.indexOf(String(match.match_num));
		var prevDisabled = curIdx <= 0 ? ' disabled' : '';
		var nextDisabled = curIdx === -1 || curIdx >= keys.length - 1 ? ' disabled' : '';

		var statusClass = match.is_finished ? 'is-ft' : (match.is_live ? 'is-live' : 'is-sched');
		var statusLabel = match.is_finished ? 'FT' : (match.is_live ? 'LIVE' : 'รอแข่ง');

		var colorA = teamHex(match.team_a_color);
		var colorB = teamHex(match.team_b_color);
		var textA = getContrast(match.team_a_color);
		var textB = getContrast(match.team_b_color);
		var borderA = getBorder(match.team_a_color);
		var borderB = getBorder(match.team_b_color);

		var badgeStyleA = 'background:' + esc(colorA) + ';color:' + esc(textA) + ';border:1px solid ' + esc(borderA) + ';' +
			(state.activePitchTab === 'teamA' ? 'outline:2.5px solid #ffffff;outline-offset:2px;box-shadow:0 0 12px rgba(255,255,255,0.45),0 4px 10px rgba(0,0,0,0.35);transform:scale(1.05);' : '') +
			'opacity:' + ((state.activePitchTab === 'both' || state.activePitchTab === 'teamA') ? '1' : '0.55') + ';';
		var badgeStyleB = 'background:' + esc(colorB) + ';color:' + esc(textB) + ';border:1px solid ' + esc(borderB) + ';' +
			(state.activePitchTab === 'teamB' ? 'outline:2.5px solid #ffffff;outline-offset:2px;box-shadow:0 0 12px rgba(255,255,255,0.45),0 4px 10px rgba(0,0,0,0.35);transform:scale(1.05);' : '') +
			'opacity:' + ((state.activePitchTab === 'both' || state.activePitchTab === 'teamB') ? '1' : '0.55') + ';';

		var optionsHtml = '';
		for (var i = 0; i < keys.length; i++) {
			var m = getMatchByNum(keys[i]);
			var sel = Number(m.match_num) === Number(match.match_num) ? ' selected' : '';
			var stTag = m.is_finished ? ' (FT)' : (m.is_scheduled ? ' (รอแข่ง)' : '');
			optionsHtml += '<option value="' + esc(m.match_num) + '"' + sel + '>Match ' + esc(m.match_num) + ' : ' + esc(m.team_a_color) + ' ' + esc(m.team_a_goal) + ' : ' + esc(m.team_b_goal) + ' ' + esc(m.team_b_color) + stTag + '</option>';
		}

		var finishOrReopenBtn = match.is_finished
			? '<button type="button" class="btn-scoreboard-tool btn-reopen-match" data-action="reopen-match" data-match-id="' + esc(match.id) + '" title="กลับมาแข่งขันต่อ / แก้ไขผล">↩️ แข่งต่อ</button>'
			: (match.is_scheduled
				? '<button type="button" class="btn-scoreboard-tool btn-start-match" data-action="start-match" data-match-id="' + esc(match.id) + '" title="เริ่มการแข่งขันนี้">▶️ เริ่มแข่ง</button>'
				: '<button type="button" class="btn-scoreboard-tool btn-finish-match" data-action="finish-match" data-match-id="' + esc(match.id) + '" title="จบแมตช์นี้แล้วขึ้นนัดถัดไป">🏁 จบ Match</button>');

		var maxMatchNum = keys.length ? Number(keys[keys.length - 1]) : 0;
		var canDelete = Number(match.match_num) === maxMatchNum;

		stadiumScoreboardEl.innerHTML =
			(state.isPitchModal ? '<button type="button" class="btn-pitch-modal-close" data-action="toggle-pitch-modal" title="ย่อหน้าต่าง">✕</button>' : '') +
			'<div class="stadium-scoreboard">' +
			'<div class="scoreboard-top-meta" style="display:flex;align-items:center;justify-content:center;gap:0.5rem;flex-wrap:wrap;">' +
			'<span>MATCH ' + esc(match.match_num) + ' / ' + esc(keys.length) + '</span>' +
			'<span class="msd-status ' + statusClass + '">' + statusLabel + '</span>' +
			(state.activePitchTab !== 'both' ? '<span class="scoreboard-dual-toggle" data-action="set-pitch-tab" data-tab="both" style="cursor:pointer;">⚔️ ดูสนามคู่</span>' : '') +
			'<span class="scoreboard-dual-toggle scoreboard-fs-toggle" data-action="toggle-pitch-modal" style="cursor:pointer;">' + (state.isPitchModal ? '🗗 ย่อสนาม' : '🔍 ขยายสนาม') + '</span>' +
			'</div>' +
			'<div class="scoreboard-main-row scoreboard-selector-row">' +
			'<button type="button" class="match-step-btn scoreboard-step-btn" data-action="step-match" data-dir="-1" title="แมตช์ก่อนหน้า"' + prevDisabled + '>◀</button>' +
			'<div class="match-select-wrapper scoreboard-select-wrapper">' +
			'<select id="update-match-select" class="match-select" data-action="select-match-dropdown" title="คลิกเพื่อเปลี่ยนแมตช์">' + optionsHtml + '</select>' +
			'<div class="scoreboard-select-display">' +
			'<div class="scoreboard-team team-a">' +
			'<span class="scoreboard-badge' + (state.activePitchTab === 'teamA' ? ' is-selected' : '') + '" style="' + badgeStyleA + '" data-action="toggle-team-tab" data-side="teamA">' + esc(match.team_a_color) + '</span>' +
			'</div>' +
			'<div class="scoreboard-center">' +
			'<div class="scoreboard-digits">' +
			'<span class="scoreboard-digit-box">' + esc(match.team_a_goal) + '</span>' +
			'<span class="scoreboard-colon">:</span>' +
			'<span class="scoreboard-digit-box">' + esc(match.team_b_goal) + '</span>' +
			'</div>' +
			'</div>' +
			'<div class="scoreboard-team team-b">' +
			'<span class="scoreboard-badge' + (state.activePitchTab === 'teamB' ? ' is-selected' : '') + '" style="' + badgeStyleB + '" data-action="toggle-team-tab" data-side="teamB">' + esc(match.team_b_color) + '</span>' +
			'</div>' +
			'<span class="scoreboard-select-arrow" aria-hidden="true">▼</span>' +
			'</div>' +
			'</div>' +
			'<button type="button" class="match-step-btn scoreboard-step-btn" data-action="step-match" data-dir="1" title="แมตช์ถัดไป"' + nextDisabled + '>▶</button>' +
			'</div>' +
			'<div class="scoreboard-actions-row">' +
			'<div class="scoreboard-actions">' +
			finishOrReopenBtn +
			'<button type="button" class="btn-scoreboard-tool" data-action="open-add-match-modal">➕ สร้าง Match</button>' +
			'<button type="button" class="btn-scoreboard-tool" data-action="open-extend-modal">⏱️ ต่อเวลา</button>' +
			'<button type="button" class="btn-scoreboard-tool" data-action="toggle-classic-form">📋 ' + (state.showClassicForm ? 'ซ่อนฟอร์ม' : 'ฟอร์ม') + '</button>' +
			(canDelete ? '<button type="button" class="btn-scoreboard-tool btn-delete" data-action="open-delete-modal" data-match-num="' + esc(match.match_num) + '">🗑️ Match ' + esc(match.match_num) + '</button>' : '') +
			'</div>' +
			'</div>' +
			'</div>';
	}

	function renderClassicGoalForm(match) {
		if (!classicFormEl) return;
		if (!state.showClassicForm || !match) {
			classicFormEl.innerHTML = '';
			return;
		}
		var playerObj = state.classicMemberId ? getMemberById(state.classicMemberId) : null;
		var playerLabel = playerObj ? (getDisplayName(playerObj) + ' (' + (getPosCode(playerObj) || '-') + ')') : 'เลือกผู้ทำเหตุการณ์...';
		var teamList = getTeamList();
		var loanTeamObj = null;
		for (var i = 0; i < teamList.length; i++) {
			if (String(teamList[i].teamid) === String(state.classicTeamId)) {
				loanTeamObj = teamList[i];
				break;
			}
		}

		classicFormEl.innerHTML =
			'<div id="classic-goal-form" class="classic-goal-form-card">' +
			'<div class="card-title">📋 บันทึกเหตุการณ์แบบละเอียด (Match ' + esc(match.match_num) + ')</div>' +
			'<div class="segmented-control" style="margin-bottom:0.75rem;">' +
			'<button type="button" class="segmented-option' + (state.classicStatusId === '0' ? ' active' : '') + '" data-action="set-classic-status" data-status="0">⚽ ยิงประตู</button>' +
			'<button type="button" class="segmented-option' + (state.classicStatusId === '3' ? ' active' : '') + '" data-action="set-classic-status" data-status="3">👟 แอสซิสต์</button>' +
			'<button type="button" class="segmented-option' + (state.classicStatusId === '2' ? ' active' : '') + '" data-action="set-classic-status" data-status="2">🔴 ทำเข้าประตูตัวเอง (OG)</button>' +
			'</div>' +
			'<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;margin-bottom:0.75rem;flex-wrap:wrap;">' +
			'<button type="button" class="form-control" style="flex:1;min-width:190px;text-align:left;cursor:pointer;" data-action="open-player-picker">👤 ' + esc(playerLabel) + '</button>' +
			'<label class="toggle-switch">' +
			'<input type="checkbox" class="toggle-input" data-action="toggle-classic-loan"' + (state.classicIsLoan ? ' checked' : '') + '>' +
			'<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
			'<span class="toggle-label">🤝 ยืมตัวลงให้ทีมอื่น</span>' +
			'</label>' +
			'</div>' +
			(state.classicIsLoan
				? '<div style="margin-bottom:0.75rem;">' +
				'<button type="button" class="form-control" style="width:100%;text-align:left;cursor:pointer;" data-action="open-loan-team-picker">🏳️ ' +
				(loanTeamObj ? ('ทีมที่ได้เครดิต: ' + esc(loanTeamObj.name)) : 'เลือกทีมที่ได้เครดิต...') +
				'</button></div>'
				: '') +
			'<button type="button" class="add-button" data-action="submit-classic-goal">บันทึกเหตุการณ์</button>' +
			'</div>';
	}

	function renderPitchArea(match) {
		if (!stadiumPitchEl || !match) return;
		var playersA = getRegularTeamPlayers(match.team_a_id);
		var loansA = getLoanPlayersForSide(match, match.team_a_id);
		var playersB = getRegularTeamPlayers(match.team_b_id);
		var loansB = getLoanPlayersForSide(match, match.team_b_id);

		if (state.activePitchTab === 'teamA' || state.activePitchTab === 'teamB') {
			var isSideA = state.activePitchTab === 'teamA';
			var targetTeamId = isSideA ? match.team_a_id : match.team_b_id;
			var targetTeamColor = isSideA ? match.team_a_color : match.team_b_color;
			var activePlayers = (isSideA ? playersA : playersB).slice().sort(function (a, b) {
				var ra = POS_RANK[getPosCode(a)] || 0;
				var rb = POS_RANK[getPosCode(b)] || 0;
				return rb - ra;
			});
			var activeLoans = isSideA ? loansA : loansB;
			var tHex = teamHex(targetTeamColor);
			var tContrast = getContrast(targetTeamColor);

			var gridHtml = '<div class="vp-tactical-grid">';
			for (var i = 0; i < activePlayers.length; i++) {
				var isOddLast = (activePlayers.length % 2 === 1 && i === activePlayers.length - 1);
				gridHtml += '<div class="vp-node-wrap' + (isOddLast ? ' is-last-odd' : '') + '">' + renderPitchPlayerNode(activePlayers[i], match, targetTeamId, false) + '</div>';
			}
			gridHtml += '</div>';

			var loanCardHtml = '';
			if (activeLoans.length > 0) {
				loanCardHtml =
					'<div class="vp-loan-card">' +
					'<div class="vp-loan-header"><span>🤝 ตัวผู้เล่นยืมตัว</span><span class="vp-loan-count">' + esc(activeLoans.length) + '</span></div>' +
					'<div class="vp-loan-players">';
				for (var l = 0; l < activeLoans.length; l++) {
					loanCardHtml += renderPitchPlayerNode(activeLoans[l], match, targetTeamId, true);
				}
				loanCardHtml += '</div></div>';
			}

			stadiumPitchEl.innerHTML =
				'<div class="vertical-pitch-container">' +
				'<div class="vp-header-bar">' +
				'<div class="vp-header-team">' +
				'<span class="vp-team-badge" style="background:' + esc(tHex) + ';color:' + esc(tContrast) + ';">' + esc(targetTeamColor) + '</span>' +
				'<span class="vp-team-count">' + esc(activePlayers.length + activeLoans.length) + ' คน</span>' +
				'</div>' +
				'<span class="vp-attack-direction" style="margin-left:auto;">⬆ ATTACK</span>' +
				'</div>' +
				'<div class="match-pitch-vertical" data-drop-team-id="' + esc(targetTeamId) + '">' +
				'<div class="vp-markings"><div class="vp-half-line"></div><div class="vp-center-circle"></div><div class="vp-center-spot"></div><div class="vp-penalty-top"></div><div class="vp-goal-top"></div><div class="vp-penalty-bottom"></div><div class="vp-goal-bottom"></div><div class="vp-corner-tl"></div><div class="vp-corner-tr"></div><div class="vp-corner-bl"></div><div class="vp-corner-br"></div></div>' +
				gridHtml +
				'</div>' +
				loanCardHtml +
				'</div>';
			return;
		}

		// Horizontal Dual Pitch
		var loansHtmlA = '';
		if (loansA.length) {
			loansHtmlA = '<div class="pitch-half-loan-section"><div class="pitch-half-loan-label">🤝 ยืมตัว (' + esc(loansA.length) + ')</div><div class="pitch-half-loan-players">';
			for (var la = 0; la < loansA.length; la++) loansHtmlA += renderPitchPlayerNode(loansA[la], match, match.team_a_id, true);
			loansHtmlA += '</div></div>';
		}
		var loansHtmlB = '';
		if (loansB.length) {
			loansHtmlB = '<div class="pitch-half-loan-section"><div class="pitch-half-loan-label">🤝 ยืมตัว (' + esc(loansB.length) + ')</div><div class="pitch-half-loan-players">';
			for (var lb = 0; lb < loansB.length; lb++) loansHtmlB += renderPitchPlayerNode(loansB[lb], match, match.team_b_id, true);
			loansHtmlB += '</div></div>';
		}

		stadiumPitchEl.innerHTML =
			'<div class="match-pitch-wrapper">' +
			'<div class="match-pitch">' +
			'<div class="match-pitch-markings"><div class="mp-half-line"></div><div class="mp-center-circle"></div><div class="mp-center-spot"></div><div class="mp-penalty-left"></div><div class="mp-goal-left"></div><div class="mp-penalty-right"></div><div class="mp-goal-right"></div><div class="mp-corner-tl"></div><div class="mp-corner-tr"></div><div class="mp-corner-bl"></div><div class="mp-corner-br"></div></div>' +
			'<div class="pitch-team-half team-a" data-drop-team-id="' + esc(match.team_a_id) + '">' +
			'<div class="pitch-half-header"><span class="pitch-half-badge" style="background:' + esc(teamHex(match.team_a_color)) + ';color:' + esc(getContrast(match.team_a_color)) + ';">' + esc(match.team_a_color) + '</span></div>' +
			renderHalfPitchNodes(playersA, match, match.team_a_id, false) +
			loansHtmlA +
			'</div>' +
			'<div class="pitch-team-half team-b" data-drop-team-id="' + esc(match.team_b_id) + '">' +
			'<div class="pitch-half-header"><span class="pitch-half-badge" style="background:' + esc(teamHex(match.team_b_color)) + ';color:' + esc(getContrast(match.team_b_color)) + ';">' + esc(match.team_b_color) + '</span></div>' +
			renderHalfPitchNodes(playersB, match, match.team_b_id, true) +
			loansHtmlB +
			'</div>' +
			'</div>' +
			'</div>';
	}

	function renderLoanPool(match) {
		if (!loanPoolPanelEl) return;
		if (!match) {
			loanPoolPanelEl.style.display = 'none';
			return;
		}
		loanPoolPanelEl.style.display = 'flex';
		if (loanSearchInputEl && loanSearchInputEl.value !== state.loanSearchQuery) {
			loanSearchInputEl.value = state.loanSearchQuery;
		}

		var teams = getTeamList();
		var otherTeams = teams.filter(function (t) {
			return Number(t.teamid) !== Number(match.team_a_id) && Number(t.teamid) !== Number(match.team_b_id);
		});

		if (loanFilterChipsEl) {
			var chipsHtml = '<button type="button" class="loan-filter-chip' + (state.loanFilterTeam === 'all' ? ' active' : '') + '" data-action="set-loan-filter" data-team="all">ทั้งหมด</button>';
			for (var i = 0; i < otherTeams.length; i++) {
				var ot = otherTeams[i];
				var isAct = String(state.loanFilterTeam) === String(ot.teamid);
				chipsHtml += '<button type="button" class="loan-filter-chip' + (isAct ? ' active' : '') + '" data-action="set-loan-filter" data-team="' + esc(ot.teamid) + '">ทีม ' + esc(ot.name) + '</button>';
			}
			loanFilterChipsEl.innerHTML = chipsHtml;
		}

		var pool = getAvailableLoanPool(match);
		if (loanPoolCountEl) {
			loanPoolCountEl.textContent = pool.length + ' คน';
		}
		if (loanPlayerGridEl) {
			if (!pool.length) {
				loanPlayerGridEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);font-size:0.8rem;padding:0.75rem;">ไม่พบนักเตะที่ว่างให้ยืม</div>';
				return;
			}
			var cards = '';
			var hexA = teamHex(match.team_a_color);
			var txtA = getContrast(match.team_a_color);
			var hexB = teamHex(match.team_b_color);
			var txtB = getContrast(match.team_b_color);
			for (var pIdx = 0; pIdx < pool.length; pIdx++) {
				var pl = pool[pIdx];
				var pName = getDisplayName(pl);
				var avatar = pl.picture_url
					? '<img src="' + esc(pl.picture_url) + '" alt="' + esc(pName) + '">'
					: esc(getInitials(pl));
				cards +=
					'<div class="loan-player-card" draggable="true" data-loan-player-id="' + esc(pl.id) + '">' +
					'<div class="loan-player-info">' +
					'<div class="loan-player-avatar" style="border-color:' + esc(teamHex(pl.color)) + ';">' + avatar + '</div>' +
					'<div style="min-width:0;">' +
					'<div class="loan-player-name">' + esc(pName) + '</div>' +
					'<div class="loan-player-meta"><span>' + esc(getPosCode(pl) || '-') + '</span><span>• ' + esc(pl.color || '-') + '</span></div>' +
					'</div>' +
					'</div>' +
					'<div class="loan-quick-btns">' +
					'<button type="button" class="btn-loan-assign" style="background:' + esc(hexA) + ';color:' + esc(txtA) + ';" data-action="assign-loan" data-player-id="' + esc(pl.id) + '" data-team-id="' + esc(match.team_a_id) + '">ยืม ' + esc(match.team_a_color) + '</button>' +
					'<button type="button" class="btn-loan-assign" style="background:' + esc(hexB) + ';color:' + esc(txtB) + ';" data-action="assign-loan" data-player-id="' + esc(pl.id) + '" data-team-id="' + esc(match.team_b_id) + '">ยืม ' + esc(match.team_b_color) + '</button>' +
					'</div>' +
					'</div>';
			}
			loanPlayerGridEl.innerHTML = cards;
		}
	}

	function groupMatchEventsByPlayer(events, match) {
		var list = events || [];
		var order = [];
		var map = {};
		for (var i = 0; i < list.length; i++) {
			var ev = list[i];
			if (!ev) continue;
			var tid = getGoalEventTeamId(ev);
			var mid = Number(ev.member_id || 0);
			var name = getGoalEventName(ev);
			var key = tid + ':' + (mid || name);
			if (!map[key]) {
				var memberObj = mid ? getMemberById(mid) : null;
				map[key] = {
					member_id: mid,
					team_id: tid,
					name: name,
					color: getGoalEventColor(ev, match),
					picture_url: ev.picture_url || (memberObj && memberObj.picture_url) || '',
					goals: [],
					assists: [],
					ogs: []
				};
				order.push(map[key]);
			}
			var st = Number(ev.goal_status);
			if (st === 2) map[key].ogs.push(ev);
			else if (st === 3) map[key].assists.push(ev);
			else map[key].goals.push(ev);
		}
		// Sort scorers first, then assisters, keeping chronological tie-break
		order.sort(function (a, b) {
			var aScore = a.goals.length + a.ogs.length > 0 ? 0 : 1;
			var bScore = b.goals.length + b.ogs.length > 0 ? 0 : 1;
			if (aScore !== bScore) return aScore - bScore;
			if (b.goals.length !== a.goals.length) return b.goals.length - a.goals.length;
			return b.assists.length - a.assists.length;
		});
		return order;
	}

	function renderGroupedStatTagsHtml(group, allowRemove, chipClass) {
		var html = '';
		function appendTag(arr, icon, cls) {
			if (!arr || !arr.length) return;
			var lastId = arr[arr.length - 1].goal_id;
			var countText = arr.length > 1 ? String(arr.length) : '';
			if (allowRemove) {
				html +=
					'<button type="button" class="' + chipClass + ' ' + cls + ' is-removable" data-action="quick-remove-goal" data-goal-id="' + esc(lastId) + '" title="ลบ (-1)">' +
					'<span>' + icon + countText + '</span>' +
					'<span class="grouped-stat-x">&times;</span>' +
					'</button>';
			} else {
				html += '<span class="' + chipClass + ' ' + cls + '">' + icon + countText + '</span>';
			}
		}
		appendTag(group.goals, '⚽', 'is-goal');
		appendTag(group.ogs, '🔴 OG', 'is-og');
		appendTag(group.assists, '👟', 'is-assist');
		return html;
	}

	function renderMatchTimeline(match) {
		if (!matchTimelineEl) return;
		if (!match || !match.goal || !match.goal.length) {
			matchTimelineEl.innerHTML =
				'<div class="match-timeline-card">' +
				'<div class="match-timeline-header"><span>📝 ไทม์ไลน์เหตุการณ์ (Match ' + esc(match ? match.match_num : '') + ')</span><span style="color:var(--text-muted);font-size:0.78rem;">ยังไม่มีเหตุการณ์</span></div>' +
				'</div>';
			return;
		}
		var evA = [];
		var evB = [];
		for (var i = 0; i < match.goal.length; i++) {
			var g = match.goal[i];
			if (getGoalEventTeamId(g) === Number(match.team_a_id)) evA.push(g);
			else evB.push(g);
		}

		function buildCol(events, colorName) {
			var groups = groupMatchEventsByPlayer(events, match);
			var dotColor = esc(teamHex(colorName));
			var html = '<div class="timeline-team-col"><div class="timeline-team-title"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + dotColor + ';"></span> ' + esc(colorName) + ' (' + esc(events.length) + ')</div>';
			if (!groups.length) {
				html += '<span style="font-size:0.76rem;color:var(--text-muted);">—</span>';
			} else {
				html += '<div class="timeline-player-chips">';
				for (var j = 0; j < groups.length; j++) {
					var grp = groups[j];
					var borderCls = grp.goals.length ? 'has-goal' : (grp.ogs.length ? 'has-og' : 'has-assist');
					html +=
						'<div class="timeline-player-chip ' + borderCls + '">' +
						'<span class="timeline-player-name">' + esc(grp.name) + '</span>' +
						'<span class="timeline-player-stats">' + renderGroupedStatTagsHtml(grp, true, 'timeline-stat-btn') + '</span>' +
						'</div>';
				}
				html += '</div>';
			}
			html += '</div>';
			return html;
		}

		matchTimelineEl.innerHTML =
			'<div class="match-timeline-card">' +
			'<div class="match-timeline-header"><span>📝 เหตุการณ์ (Match ' + esc(match.match_num) + ')</span></div>' +
			'<div class="match-timeline-grid">' +
			buildCol(evA, match.team_a_color) +
			buildCol(evB, match.team_b_color) +
			'</div>' +
			'</div>';
	}

	function renderStadiumSection() {
		if (!stadiumWrapEl) return;
		var match = getSelectedMatch();
		var isVisible = state.isManager && match && !(state.info && state.info.is_roster_locked);
		if (!isVisible) {
			stadiumWrapEl.style.display = 'none';
			renderPitchModalBackdrop();
			return;
		}
		stadiumWrapEl.style.display = 'block';
		stadiumWrapEl.className = 'match-stadium-card' + (state.isPitchModal ? ' pitch-modal-card' : '');
		renderPitchModalBackdrop();
		renderStadiumScoreboard(match);
		renderClassicGoalForm(match);
		renderPitchArea(match);
		renderLoanPool(match);
		renderMatchTimeline(match);
	}

	function renderEmptyMatches() {
		if (!emptyMatchesEl) return;
		var hasMatches = getMatchKeys().length > 0;
		if (hasMatches) {
			emptyMatchesEl.style.display = 'none';
			emptyMatchesEl.innerHTML = '';
			return;
		}
		emptyMatchesEl.style.display = 'block';
		emptyMatchesEl.innerHTML =
			'<div class="card" style="text-align:center;padding:2.25rem 1.25rem;">' +
			'<div style="font-size:2.5rem;margin-bottom:0.5rem;">📅</div>' +
			'<h3 style="margin:0 0 0.4rem 0;">ยังไม่มีตารางการแข่งขันในสัปดาห์นี้</h3>' +
			'<p style="margin:0;color:var(--text-muted);font-size:0.88rem;">กรุณารันคำสั่ง /schedule ในกลุ่ม LINE เพื่อสร้างตารางแข่งและเปิดใช้งาน Score Manager</p>' +
			'</div>';
	}

	function renderTeamSummaryCard() {
		if (!teamSummaryEl) return;
		var keys = getMatchKeys();
		var isLocked = state.info && state.info.is_roster_locked;
		var teams = getTeamList();
		if (state.isManager || isLocked || !keys.length || !teams.length) {
			teamSummaryEl.style.display = 'none';
			teamSummaryEl.innerHTML = '';
			return;
		}

		// Preserve mobile carousel horizontal scroll across WebSocket updates
		var prevGrid = document.getElementById('teamSummaryGrid');
		var prevScrollLeft = prevGrid ? prevGrid.scrollLeft : 0;

		teamSummaryEl.style.display = 'block';
		var leaderStats = (state.info && state.info.leader_stats) || {};
		var mvps = leaderStats.mvps || leaderStats.weekMvps || [];
		var topScorers = leaderStats.top_scorers || leaderStats.weekTopScorers || [];
		var topAssists = leaderStats.top_assists || leaderStats.weekTopAssists || [];
		var totw = leaderStats.totw || [];

		var mvpIdSet = {};
		for (var m = 0; m < mvps.length; m++) {
			mvpIdSet[Number(mvps[m].id)] = true;
		}

		var spotlightHtml = '';
		if (mvps.length || topScorers.length || topAssists.length) {
			spotlightHtml += '<div class="week-leaders-spotlight">';
			if (mvps.length) {
				var mvp = mvps[0];
				spotlightHtml += buildSpotlightItem('mvp-spotlight', '👑 MVP OF THE WEEK', mvp, formatRating(mvp.rating) + ' ⭐');
			}
			if (topScorers.length) {
				var sc = topScorers[0];
				spotlightHtml += buildSpotlightItem('scorer-spotlight', '⚽ TOP SCORER', sc, (sc.goals || 0) + ' ประตู');
			}
			if (topAssists.length) {
				var as = topAssists[0];
				spotlightHtml += buildSpotlightItem('assist-spotlight', '👟 TOP ASSIST', as, (as.assists || 0) + ' แอสซิสต์');
			}
			spotlightHtml += '</div>';
		}

		// Standings lookup by color/team_week_id
		var standings = (state.info && state.info.tableweek) || [];
		var tableMap = {};
		for (var s = 0; s < standings.length; s++) {
			tableMap[Number(standings[s].team_week_id)] = standings[s];
		}

		var isPitchView = state.teamSummaryViewMode === 'pitch';
		var teamFormations = (state.info && state.info.team_formations) || {};
		var colsHtml = '';
		var colCount = 0;

		// Prepend TOTW card if available
		if (totw.length > 0) {
			colCount++;
			colsHtml += buildSummaryColHtml({
				isTotw: true,
				title: '🌟 TEAM OF THE WEEK',
				recordText: 'Best ' + totw.length,
				headerBg: 'linear-gradient(135deg, #b45309, #f59e0b)',
				headerColor: '#ffffff',
				players: totw,
				formation: teamFormations.totw || null,
				isPitchView: isPitchView,
				mvpIdSet: mvpIdSet
			});
		}

		for (var t = 0; t < teams.length; t++) {
			colCount++;
			var team = teams[t];
			var st = tableMap[Number(team.teamid)];
			var recText = st ? (st.w + 'W ' + st.d + 'D ' + st.l + 'L • ' + st.pts + 'pts') : '';
			var roster = getRegularTeamPlayers(team.teamid);
			colsHtml += buildSummaryColHtml({
				isTotw: false,
				title: team.name,
				recordText: recText,
				headerBg: teamHex(team.name),
				headerColor: getContrast(team.name),
				players: roster,
				formation: teamFormations[String(team.teamid)] || null,
				isPitchView: isPitchView,
				mvpIdSet: mvpIdSet
			});
		}

		var carouselHeadingHtml =
			'<div class="team-carousel-heading">' +
			'<span class="team-carousel-heading-title">👕 รายชื่อทีม (' + esc(colCount) + ')</span>' +
			'<span class="team-carousel-heading-hint">👈 ปัดซ้าย-ขวา</span>' +
			'</div>';

		teamSummaryEl.innerHTML =
			'<div class="card-header" style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.85rem;">' +
			'<div class="team-summary-title"><span class="team-summary-title-text">👕 รายชื่อทีม &amp; ฟอร์มผู้เล่น</span>' +
			(state.wsConnected ? '<span class="realtime-live-badge">● LIVE</span>' : '') +
			'</div>' +
			'<div class="team-summary-actions">' +
			'<div class="view-toggle-pill-group">' +
			'<button type="button" class="btn-view-toggle-pill' + (isPitchView ? ' is-active' : '') + '" data-action="set-summary-view" data-mode="pitch">🏟️ สนาม</button>' +
			'<button type="button" class="btn-view-toggle-pill' + (!isPitchView ? ' is-active' : '') + '" data-action="set-summary-view" data-mode="list">📋 รายชื่อ</button>' +
			'</div>' +
			'</div>' +
			'</div>' +
			spotlightHtml +
			carouselHeadingHtml +
			'<div id="teamSummaryGrid" class="team-summary-grid">' + colsHtml + '</div>';

		var newGrid = document.getElementById('teamSummaryGrid');
		if (newGrid && prevScrollLeft > 0) {
			newGrid.scrollLeft = prevScrollLeft;
		}
	}

	function buildSpotlightItem(cls, badgeText, p, scoreText) {
		var pName = getDisplayName(p);
		var pTeamColor = p.teamName || p.team_color || p.color || '-';
		var av = p.picture_url
			? '<img src="' + esc(p.picture_url) + '" alt="' + esc(pName) + '">'
			: esc(getInitials(p));
		return '<div class="leader-spotlight-item ' + cls + '">' +
			'<div class="spotlight-badge">' + badgeText + '</div>' +
			'<div class="spotlight-player">' +
			'<div class="spotlight-avatar" style="border-color:' + esc(teamHex(pTeamColor)) + ';">' + av + '</div>' +
			'<div class="spotlight-info">' +
			'<div class="spotlight-name">' + esc(pName) + '</div>' +
			'<div class="spotlight-team">' + esc(getPosCode(p) || '-') + ' • ' + esc(pTeamColor) + '</div>' +
			'</div>' +
			'<div class="spotlight-score">' + esc(scoreText) + '</div>' +
			'</div>' +
			'</div>';
	}

	function getTopRatedPlayer(players) {
		var bestPlayer = null;
		var bestVal = 0;
		var bestGoals = -1;
		var bestAssists = -1;
		for (var i = 0; i < (players || []).length; i++) {
			var p = players[i];
			if (!p) continue;
			var v = parseFloat(p.rating);
			var g = Number(p.goals || 0);
			var a = Number(p.assists || 0);
			if (!isNaN(v) && v > 0 && (v > bestVal || (v === bestVal && (g > bestGoals || (g === bestGoals && a > bestAssists))))) {
				bestVal = v;
				bestGoals = g;
				bestAssists = a;
				bestPlayer = p;
			}
		}
		return bestPlayer;
	}

	function getPosBadgeClass(posCode) {
		var code = String(posCode || '').toUpperCase();
		if (code === 'GK') return 'pos-gk';
		if (code === 'DF') return 'pos-df';
		if (code === 'DW') return 'pos-dw';
		if (code === 'DM') return 'pos-dm';
		if (code === 'MF') return 'pos-mf';
		if (code === 'AM') return 'pos-am';
		if (code === 'CF') return 'pos-cf';
		return '';
	}

	function buildFallbackFormationRows(players) {
		var buckets = { CF: [], AM: [], MF: [], DM: [], DW: [], DF: [], GK: [] };
		for (var i = 0; i < (players || []).length; i++) {
			var p = players[i];
			var code = getPosCode(p) || 'MF';
			if (!buckets[code]) code = 'MF';
			buckets[code].push({ primary: p, alternate: null });
		}
		var rows = [];
		if (buckets.CF.length) rows.push({ role: 'CF', isFlank: false, slots: buckets.CF });
		if (buckets.AM.length) rows.push({ role: 'AM', isFlank: false, slots: buckets.AM });
		if (buckets.MF.length || (!buckets.CF.length && !buckets.AM.length)) {
			rows.push({ role: 'MF', isFlank: false, slots: buckets.MF.length ? buckets.MF : [{ primary: null, alternate: null }] });
		}
		if (buckets.DM.length) rows.push({ role: 'DM', isFlank: false, slots: buckets.DM });
		if (buckets.DW.length) rows.push({ role: 'DW', isFlank: true, slots: buckets.DW });
		if (buckets.DF.length) rows.push({ role: 'DF', isFlank: false, slots: buckets.DF });
		rows.push({ role: 'GK', isFlank: false, slots: buckets.GK.length ? buckets.GK : [{ primary: null, alternate: null }] });
		return rows;
	}

	function getMiniPitchRatingClass(rating, isMom) {
		if (isMom) return 'rating-mvp';
		var num = parseFloat(rating);
		if (isNaN(num) || num <= 0) return 'rating-none';
		if (num >= 3.0) return 'rating-elite';
		if (num >= 2.0) return 'rating-good';
		return 'rating-avg';
	}

	function renderMiniFormationPlayerNode(pl, posCode, isAlt, isMom, isTotw) {
		if (!pl) {
			return '<div class="pitch-player-node mini-pitch-node">' +
				'<div class="mini-empty-slot">' + esc(posCode || 'GK') + '</div>' +
				'</div>';
		}
		var rVal = formatRating(pl.rating);
		var rCls = getMiniPitchRatingClass(pl.rating, isMom);
		var pName = getDisplayName(pl);
		var pTeamColor = pl.teamName || pl.team_color || pl.color || '';
		var role = String(posCode || getPosCode(pl) || 'MF').toUpperCase();
		var posCls = getPosBadgeClass(role);
		var goals = Number(pl.goals || 0);
		var assists = Number(pl.assists || 0);
		var av = pl.picture_url
			? '<img src="' + esc(pl.picture_url) + '" alt="' + esc(pName) + '">'
			: '<span class="avatar-char">' + esc(getInitials(pl)) + '</span>';

		var ratingBadge = rVal !== '-'
			? '<div class="mini-score-rating ' + rCls + '" title="Live Rating">' +
			'<span class="badge-val">' + esc(rVal) + '</span>' +
			(isMom ? '<span class="badge-icon" style="color:#fde047;">★</span>' : '') +
			'</div>'
			: '';

		var goalBadge = goals > 0
			? '<div class="mini-goal-badge" title="' + esc(goals) + ' ประตู">⚽' + (goals > 1 ? '<span class="mini-stat-count">' + esc(goals) + '</span>' : '') + '</div>'
			: '';
		var assistBadge = assists > 0
			? '<div class="mini-assist-badge" title="' + esc(assists) + ' แอสซิสต์">👟' + (assists > 1 ? '<span class="mini-stat-count">' + esc(assists) + '</span>' : '') + '</div>'
			: '';

		return '<div class="pitch-player-node mini-pitch-node' + (isMom ? ' is-mvp' : '') + (isAlt ? ' is-alt' : '') + '">' +
			'<div class="pitch-player-avatar-wrap">' +
			(isMom ? '<span class="mini-pitch-crown" title="Team MVP">👑</span>' : '') +
			'<div class="pitch-player-avatar-circle" style="border-color:' + esc(teamHex(pTeamColor)) + ';">' +
			av +
			'</div>' +
			ratingBadge +
			goalBadge +
			assistBadge +
			'</div>' +
			'<div class="pitch-name-pill">' +
			'<span class="pitch-pos-label ' + posCls + '">' + esc(role) + '</span>' +
			(isTotw && pTeamColor ? '<span class="totw-team-mini-dot" style="background:' + esc(teamHex(pTeamColor)) + ';" title="ทีม ' + esc(pTeamColor) + '"></span>' : '') +
			'<span class="pitch-name-text">' + esc(pName) + '</span>' +
			'</div>' +
			'</div>';
	}

	function renderTeamMvpFooter(topPlayer, isTotw) {
		var label = isTotw ? 'WEEK MVP' : 'TEAM MVP';
		if (!topPlayer) {
			return '<div class="team-mvp-footer is-na">' +
				'<div class="team-mvp-footer-left">' +
				'<div class="team-mvp-footer-avatar">MVP</div>' +
				'<div><div class="team-mvp-footer-title">' + label + ' <span>• n/a</span></div>' +
				'<div class="team-mvp-footer-stats">รอผลการแข่งขัน</div></div>' +
				'</div>' +
				'<div class="team-mvp-footer-rating" style="border-color:#475569;color:#94a3b8;background:#1e293b;">n/a</div>' +
				'</div>';
		}
		var name = getDisplayName(topPlayer);
		var av = topPlayer.picture_url
			? '<img src="' + esc(topPlayer.picture_url) + '" alt="' + esc(name) + '">'
			: esc(getInitials(topPlayer));
		var goals = Number(topPlayer.goals || 0);
		var assists = Number(topPlayer.assists || 0);
		var ratingText = formatRating(topPlayer.rating);
		return '<div class="team-mvp-footer">' +
			'<div class="team-mvp-footer-left">' +
			'<div class="team-mvp-footer-avatar">' + av + '<span class="mini-pitch-crown" style="top:-10px;font-size:0.78rem;">👑</span></div>' +
			'<div style="min-width:0;">' +
			'<div class="team-mvp-footer-title">' + label + ' <span>• ' + esc(name) + '</span></div>' +
			'<div class="team-mvp-footer-stats"><span>⚽ ' + esc(goals) + '</span><span>👟 ' + esc(assists) + '</span></div>' +
			'</div>' +
			'</div>' +
			'<div class="team-mvp-footer-rating">★ ' + esc(ratingText) + '</div>' +
			'</div>';
	}

	function buildSummaryColHtml(opts) {
		var bodyHtml = '';
		var formationPlayers = [];
		if (opts.formation && Array.isArray(opts.formation.rows)) {
			for (var fr = 0; fr < opts.formation.rows.length; fr++) {
				var sls = opts.formation.rows[fr].slots || [];
				for (var fs = 0; fs < sls.length; fs++) {
					if (sls[fs] && sls[fs].primary) formationPlayers.push(sls[fs].primary);
					if (sls[fs] && sls[fs].alternate) formationPlayers.push(sls[fs].alternate);
				}
			}
		}
		var statPool = formationPlayers.length ? formationPlayers : (opts.players || []);
		var topPlayer = getTopRatedPlayer(statPool);
		var topPlayerId = topPlayer ? Number(topPlayer.id) : null;

		if (!opts.players || !opts.players.length) {
			bodyHtml = '<div class="team-player-empty">ยังไม่มีรายชื่อผู้เล่น</div>';
		} else if (opts.isPitchView) {
			var rows = (opts.formation && Array.isArray(opts.formation.rows) && opts.formation.rows.length)
				? opts.formation.rows
				: buildFallbackFormationRows(opts.players);

			var subbarHtml = opts.formation && opts.formation.formationName
				? '<div class="team-formation-subbar"><span>👥 ' + esc(opts.formation.totalPlayers || opts.players.length) + ' คน</span><span>' + esc(opts.formation.formationName) + '</span></div>'
				: '';

			bodyHtml = subbarHtml +
				'<div class="team-pitch-vertical">' +
				'<div class="tv-pitch-markings">' +
				'<div class="tv-half-line"></div><div class="tv-center-circle"></div><div class="tv-center-spot"></div>' +
				'<div class="tv-penalty-top"></div><div class="tv-goal-top"></div>' +
				'<div class="tv-penalty-bottom"></div><div class="tv-goal-bottom"></div>' +
				'</div>' +
				'<div class="team-pitch-tactical-layout">';

			for (var r = 0; r < rows.length; r++) {
				var rowObj = rows[r];
				var slots = rowObj.slots || [];
				bodyHtml += '<div class="pitch-tactical-row' + (rowObj.isFlank ? ' row-flank' : '') + '">';
				for (var sIdx = 0; sIdx < slots.length; sIdx++) {
					var slot = slots[sIdx] || { primary: null, alternate: null };
					var isPrimaryMom = slot.primary && topPlayerId !== null && Number(slot.primary.id) === topPlayerId;
					var isAltMom = slot.alternate && topPlayerId !== null && Number(slot.alternate.id) === topPlayerId;
					if (slot.primary && slot.alternate) {
						bodyHtml += '<div class="pitch-flank-pair">' +
							renderMiniFormationPlayerNode(slot.primary, rowObj.role, false, isPrimaryMom, opts.isTotw) +
							renderMiniFormationPlayerNode(slot.alternate, rowObj.role, true, isAltMom, opts.isTotw) +
							'</div>';
					} else {
						bodyHtml += renderMiniFormationPlayerNode(slot.primary, rowObj.role, false, isPrimaryMom, opts.isTotw);
					}
				}
				bodyHtml += '</div>';
			}
			bodyHtml += '</div></div>' + renderTeamMvpFooter(topPlayer, opts.isTotw);
		} else {
			bodyHtml = '<div class="team-player-roster">';
			for (var i = 0; i < opts.players.length; i++) {
				var player = opts.players[i];
				var name = getDisplayName(player);
				var ratingCls = getRatingClass(player.rating);
				var ratingText = formatRating(player.rating);
				var pTeamColor = player.teamName || player.team_color || player.color || '';
				var isMvp = (topPlayerId !== null && Number(player.id) === topPlayerId) || (opts.mvpIdSet && opts.mvpIdSet[Number(player.id)]);
				var avatar = player.picture_url
					? '<img src="' + esc(player.picture_url) + '" alt="' + esc(name) + '">'
					: esc(getInitials(player));
				var statTags = '';
				if (opts.isTotw && pTeamColor) {
					statTags += '<span class="player-pos-tag" style="background:' + esc(teamHex(pTeamColor)) + ';color:' + esc(getContrast(pTeamColor)) + ';font-weight:700;">' + esc(pTeamColor) + '</span>';
				}
				if (player.goals > 0) statTags += '<span class="player-stat-tag goal-tag">⚽ ' + esc(player.goals) + '</span>';
				if (player.assists > 0) statTags += '<span class="player-stat-tag assist-tag">👟 ' + esc(player.assists) + '</span>';
				if (player.clean_sheets > 0) statTags += '<span class="player-stat-tag cs-tag">🧤 ' + esc(player.clean_sheets) + '</span>';

				bodyHtml +=
					'<div class="team-player-card">' +
					'<span class="player-card-rank">#' + (i + 1) + '</span>' +
					'<div class="player-card-avatar" style="border-color:' + esc(teamHex(pTeamColor)) + ';">' + avatar + '</div>' +
					'<div class="player-card-details">' +
					'<div class="player-card-name-row">' +
					'<span class="player-card-alias">' + esc(name) + '</span>' +
					(isMvp ? '<span class="badge-team-mvp">👑 MVP</span>' : '') +
					'</div>' +
					'<div class="player-card-sub">' +
					'<span class="player-pos-tag">' + esc(getPosCode(player) || '-') + '</span>' +
					statTags +
					'</div>' +
					'</div>' +
					'<span class="player-card-rating ' + ratingCls + '"><span class="rating-star">⭐</span><span>' + esc(ratingText) + '</span></span>' +
					'</div>';
			}
			bodyHtml += '</div>';
		}

		return '<div class="team-summary-col' + (opts.isTotw ? ' is-totw' : '') + '">' +
			'<div class="team-col-header' + (opts.isTotw ? ' is-totw-header' : '') + '" style="background:' + esc(opts.headerBg) + ';color:' + esc(opts.headerColor) + ';">' +
			'<span class="team-col-name">' + esc(opts.title) + '</span>' +
			'<span class="team-col-record">' + esc(opts.recordText) + '</span>' +
			'</div>' +
			bodyHtml +
			'</div>';
	}

	function collectWeeklyScorersList() {
		var leaderPlayers = (state.info && state.info.leader_stats && Array.isArray(state.info.leader_stats.players))
			? state.info.leader_stats.players
			: null;
		var source = leaderPlayers && leaderPlayers.length
			? leaderPlayers
			: ((state.info && state.info.allmembers) || []);

		var byId = {};
		var list = [];
		for (var i = 0; i < source.length; i++) {
			var p = source[i];
			if (!p || !p.id) continue;
			var goals = Number(p.goals || 0);
			var assists = Number(p.assists || 0);
			var item = {
				id: Number(p.id),
				name: getDisplayName(p),
				color: p.teamName || p.team_color || p.color || '',
				picture_url: p.picture_url || '',
				pos_code: getPosCode(p),
				goals: goals,
				assists: assists
			};
			byId[item.id] = item;
			if (goals > 0 || assists > 0) list.push(item);
		}

		// Fallback: aggregate directly from match.goal if leader_stats/allmembers have zero counts
		if (!list.length) {
			var allMatches = getMatchesObj();
			var keys = getMatchKeys();
			var aggMap = {};
			for (var k = 0; k < keys.length; k++) {
				var m = allMatches[keys[k]];
				var evs = (m && m.goal) || [];
				for (var e = 0; e < evs.length; e++) {
					var ev = evs[e];
					var st = Number(ev.goal_status);
					if (st !== 0 && st !== 1 && st !== 3) continue; // exclude OG (2) from top scorer leaderboard
					var mid = Number(ev.member_id || 0);
					if (!mid) continue;
					if (!aggMap[mid]) {
						var base = byId[mid] || getMemberById(mid);
						aggMap[mid] = {
							id: mid,
							name: base ? (base.name || getDisplayName(base)) : getGoalEventName(ev),
							color: (base && base.color) || getGoalEventColor(ev, m),
							picture_url: (base && base.picture_url) || ev.picture_url || '',
							pos_code: base ? (base.pos_code || getPosCode(base)) : '',
							goals: 0,
							assists: 0
						};
					}
					if (st === 3) aggMap[mid].assists++;
					else aggMap[mid].goals++;
				}
			}
			Object.keys(aggMap).forEach(function (midKey) {
				if (aggMap[midKey].goals > 0 || aggMap[midKey].assists > 0) {
					list.push(aggMap[midKey]);
				}
			});
		}

		list.sort(function (a, b) {
			if (b.goals !== a.goals) return b.goals - a.goals;
			if (b.assists !== a.assists) return b.assists - a.assists;
			return String(a.name || '').localeCompare(String(b.name || ''));
		});
		return list;
	}

	function renderWeeklyScorersSummaryHtml() {
		var list = collectWeeklyScorersList();
		if (!list.length) return '';

		var chipsHtml = '';
		for (var i = 0; i < list.length; i++) {
			var p = list[i];
			var tHex = teamHex(p.color);
			var tContrast = getContrast(p.color);
			var av = p.picture_url
				? '<img src="' + esc(p.picture_url) + '" alt="' + esc(p.name) + '">'
				: '<span>' + esc(String(p.name || '?').trim().charAt(0).toUpperCase()) + '</span>';
			var statsHtml = '';
			if (p.goals > 0) statsHtml += '<span class="scorer-stat-badge is-goal">⚽ ' + esc(p.goals) + '</span>';
			if (p.assists > 0) statsHtml += '<span class="scorer-stat-badge is-assist">👟 ' + esc(p.assists) + '</span>';

			chipsHtml +=
				'<div class="standings-scorer-item">' +
				'<span class="scorer-rank-num">#' + (i + 1) + '</span>' +
				'<div class="scorer-mini-avatar" style="border-color:' + esc(tHex) + ';">' + av + '</div>' +
				'<div class="scorer-mini-meta">' +
				'<span class="scorer-mini-name">' + esc(p.name) + '</span>' +
				(p.color ? '<span class="scorer-team-pill" style="background:' + esc(tHex) + ';color:' + esc(tContrast) + ';">' + esc(p.color) + '</span>' : '') +
				'</div>' +
				'<div class="scorer-mini-stats">' + statsHtml + '</div>' +
				'</div>';
		}

		return '<div class="standings-scorers-section">' +
			'<div class="standings-scorers-header">' +
			'<span>⚽ สรุปคนยิงประตู &amp; แอสซิสต์ประจำสัปดาห์</span>' +
			'<span class="standings-scorers-count">' + esc(list.length) + ' คน</span>' +
			'</div>' +
			'<div class="standings-scorers-grid">' + chipsHtml + '</div>' +
			'</div>';
	}

	function renderStandingsCard() {
		if (!standingsEl) return;
		var table = (state.info && state.info.tableweek) || [];
		var isLocked = state.info && state.info.is_roster_locked;
		if (isLocked || !table.length) {
			standingsEl.style.display = 'none';
			standingsEl.innerHTML = '';
			return;
		}
		standingsEl.style.display = 'block';
		var rowsHtml = '';
		for (var i = 0; i < table.length; i++) {
			var row = table[i];
			var gd = Number(row.G || 0) - Number(row.A || 0);
			var gdText = gd > 0 ? ('+' + gd) : String(gd);
			var colorDot = teamHex(row.color);
			rowsHtml +=
				'<tr>' +
				'<td>' + (i + 1) + '</td>' +
				'<td style="text-align:left;"><span class="team-badge" style="background:' + esc(colorDot) + ';color:' + esc(getContrast(row.color)) + ';">' + esc(row.color) + '</span></td>' +
				'<td>' + esc(row.w) + '</td>' +
				'<td>' + esc(row.d) + '</td>' +
				'<td>' + esc(row.l) + '</td>' +
				'<td>' + esc(gdText) + '</td>' +
				'<td class="table-pts-cell">' + esc(row.pts) + '</td>' +
				'</tr>';
		}
		standingsEl.innerHTML =
			'<div class="card-title">📊 ตารางคะแนนประจำสัปดาห์ (Standings)</div>' +
			'<div class="table-container">' +
			'<table class="table">' +
			'<thead><tr><th>#</th><th style="text-align:left;">ทีม</th><th>W</th><th>D</th><th>L</th><th>GD</th><th class="table-pts">PTS</th></tr></thead>' +
			'<tbody>' + rowsHtml + '</tbody>' +
			'</table>' +
			'</div>' +
			renderWeeklyScorersSummaryHtml();
	}

	function renderGoalEventPillHtml(group, allowRemove) {
		var evColorHex = teamHex(group.color);
		var avatarHtml = group.picture_url
			? '<img src="' + esc(group.picture_url) + '" class="event-pill-avatar" alt="' + esc(group.name) + '" style="border-color:' + esc(evColorHex) + ';">'
			: '<span style="width:7px;height:7px;border-radius:50%;background:' + esc(evColorHex) + ';display:inline-block;flex-shrink:0;"></span>';
		var hasOg = group.ogs.length > 0 && !group.goals.length;
		var onlyAssist = !group.goals.length && !group.ogs.length && group.assists.length > 0;
		return '<span class="event-pill' + (hasOg ? ' og' : (onlyAssist ? ' assist' : '')) + '" style="border-left:3px solid ' + esc(evColorHex) + ';">' +
			avatarHtml +
			'<span class="event-pill-name">' + esc(group.name) + '</span>' +
			'<span class="event-pill-stats">' + renderGroupedStatTagsHtml(group, allowRemove, 'event-stat-badge') + '</span>' +
			'</span>';
	}

	function renderMatchList() {
		if (!matchListEl) return;
		var keys = getMatchKeys();
		if (!keys.length) {
			matchListEl.style.display = 'none';
			matchListEl.innerHTML = '';
			return;
		}
		matchListEl.style.display = 'block';

		var adminToolbar = '';
		if (state.isManager && !(state.info && state.info.is_roster_locked)) {
			adminToolbar =
				'<div class="match-list-toolbar" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.85rem;">' +
				'<span style="font-weight:800;font-size:1rem;">🗓️ รายการแข่งขันทั้งหมด (' + esc(keys.length) + ' Matches)</span>' +
				'<div style="display:flex;gap:0.4rem;flex-wrap:wrap;">' +
				'<button type="button" class="btn-action-pill" data-action="quick-extend" data-param="30">+30 นาที</button>' +
				'<button type="button" class="btn-action-pill" data-action="quick-extend" data-param="60">+60 นาที</button>' +
				'<button type="button" class="btn-action-pill" data-action="open-extend-modal">⏱️ ต่อเวลา</button>' +
				'<button type="button" class="btn-action-pill" data-action="open-add-match-modal">➕ สร้าง Match</button>' +
				'</div>' +
				'</div>';
		}

		var maxNum = Number(keys[keys.length - 1]);
		var cardsHtml = '';
		for (var i = 0; i < keys.length; i++) {
			var m = getMatchByNum(keys[i]);
			var isSelected = Number(state.selectedMatchNum) === Number(m.match_num);
			var isCurrent = state.info && Number(state.info.current_match_num) === Number(m.match_num);
			var badgeHtml = m.is_live
				? '<span class="msd-status is-live">● LIVE</span>'
				: (m.is_finished
					? '<span class="msd-status is-ft">FT</span>'
					: (m.is_locked ? '<span class="msd-status is-sched">🔒 รอแข่ง</span>' : '<span class="msd-status is-sched">รอแข่ง</span>'));

			var curPill = isCurrent ? '<span class="badge-team-mvp" style="margin-left:0.35rem;">CURRENT</span>' : '';
			var scoreHtml = m.is_locked ? 'VS' : (esc(m.team_a_goal) + ' - ' + esc(m.team_b_goal));

			var goalPillsHtml = '';
			if (!m.is_locked && m.goal && m.goal.length) {
				var groupedGoals = groupMatchEventsByPlayer(m.goal, m);
				goalPillsHtml = '<div class="match-events-pills" style="display:flex;flex-wrap:wrap;gap:0.35rem;margin-top:0.55rem;">';
				for (var g = 0; g < groupedGoals.length; g++) {
					goalPillsHtml += renderGoalEventPillHtml(groupedGoals[g], state.isManager);
				}
				goalPillsHtml += '</div>';
			}

			var showInline = Boolean(state.inlinePitchMatches[m.match_num]) && !m.is_locked && !(state.info && state.info.is_roster_locked);
			var inlineHtml = '';
			if (showInline) {
				inlineHtml = renderInlinePitchCard(m);
			}

			var togglePitchBtn = (!m.is_locked && !(state.info && state.info.is_roster_locked))
				? '<button type="button" class="btn-action-pill" data-action="toggle-inline-pitch" data-match-num="' + esc(m.match_num) + '">🏟️ ผังสนาม</button>'
				: '';
			var delBtn = (state.isManager && Number(m.match_num) === maxNum)
				? '<button type="button" class="btn-remove-match" data-action="open-delete-modal" data-match-num="' + esc(m.match_num) + '" title="ลบ Match สุดท้าย">🗑️</button>'
				: '';

			cardsHtml +=
				'<div id="match-card-' + esc(m.match_num) + '" class="match-card' + (isSelected && state.isManager ? ' is-selected' : '') + (m.is_live ? ' is-live' : '') + (m.is_locked ? ' is-locked' : '') + '">' +
				'<div class="match-header-niche" data-action="select-match-card" data-match-num="' + esc(m.match_num) + '" style="cursor:' + (m.is_locked && !state.isManager ? 'default' : 'pointer') + ';">' +
				'<div class="match-meta" style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;justify-content:center;">' +
				'<span>Match ' + esc(m.match_num) + '</span> ' + badgeHtml + curPill + ' ' + togglePitchBtn +
				'</div>' +
				delBtn +
				'<div class="score-board">' +
				'<div class="team-display"><span class="team-badge" style="background:' + esc(teamHex(m.team_a_color)) + ';color:' + esc(getContrast(m.team_a_color)) + ';">' + esc(m.team_a_color) + '</span></div>' +
				'<div class="score-display">' + scoreHtml + '</div>' +
				'<div class="team-display"><span class="team-badge" style="background:' + esc(teamHex(m.team_b_color)) + ';color:' + esc(getContrast(m.team_b_color)) + ';">' + esc(m.team_b_color) + '</span></div>' +
				'</div>' +
				'</div>' +
				goalPillsHtml +
				inlineHtml +
				'</div>';
		}

		matchListEl.innerHTML = adminToolbar + cardsHtml;
	}

	function renderInlinePitchHalfHtml(match, teamId, colorName, isSideB) {
		var regs = getRegularTeamPlayers(teamId);
		var loans = getLoanPlayersForSide(match, teamId);
		var loanIds = {};
		for (var li = 0; li < loans.length; li++) loanIds[Number(loans[li].id)] = true;
		var allPlayers = regs.concat(loans);

		var col1 = getTeamTacticalCol(allPlayers, 'gk_df');
		var col2 = getTeamTacticalCol(allPlayers, 'mf');
		var col3 = getTeamTacticalCol(allPlayers, 'fw');
		var cols = isSideB ? [col3, col2, col1] : [col1, col2, col3];
		var teamHexColor = teamHex(colorName);
		var teamContrast = getContrast(colorName);

		var colsHtml = '';
		for (var c = 0; c < cols.length; c++) {
			colsHtml += '<div class="inline-tactical-col">';
			for (var i = 0; i < cols[c].length; i++) {
				var p = cols[c][i];
				var pName = getDisplayName(p);
				var pos = getPosCode(p) || 'MF';
				var posCls = getPosBadgeClass(pos);
				var isLoan = Boolean(loanIds[Number(p.id)]);
				var events = getGoalEventsForPlayer(match, p.id, teamId);
				var bubblesHtml = renderScoreBubbles(events);
				var avatarHtml = p.picture_url
					? '<img src="' + esc(p.picture_url) + '" alt="' + esc(pName) + '">'
					: '<span class="avatar-char">' + esc(getInitials(p)) + '</span>';

				colsHtml +=
					'<div class="pitch-player-node inline-pitch-node' + (isLoan ? ' is-loan' : '') + '">' +
					'<div class="pitch-player-avatar-wrap">' +
					'<div class="pitch-player-avatar-circle" style="border-color:' + esc(teamHexColor) + ';">' + avatarHtml + '</div>' +
					bubblesHtml +
					(isLoan ? '<span class="inline-loan-chip">ยืม</span>' : '') +
					'</div>' +
					'<div class="pitch-name-pill">' +
					'<span class="pitch-pos-label ' + posCls + '">' + esc(pos) + '</span>' +
					'<span class="pitch-name-text" title="' + esc(pName) + '">' + esc(pName) + '</span>' +
					'</div>' +
					'</div>';
			}
			colsHtml += '</div>';
		}

		return '<div class="inline-pitch-half ' + (isSideB ? 'inline-team-b' : 'inline-team-a') + '">' +
			'<div class="inline-pitch-badge" style="background:' + esc(teamHexColor) + ';color:' + esc(teamContrast) + ';">' + esc(colorName) + ' (' + esc(allPlayers.length) + ')</div>' +
			'<div class="inline-tactical-cols">' + colsHtml + '</div>' +
			'</div>';
	}

	function renderInlineMatchEventsSummary(match) {
		var goals = (match && match.goal) || [];
		if (!goals.length) return '';

		function summarizeSide(teamId, colorName) {
			var sideEvents = [];
			for (var i = 0; i < goals.length; i++) {
				if (getGoalEventTeamId(goals[i]) === Number(teamId)) sideEvents.push(goals[i]);
			}
			var groups = groupMatchEventsByPlayer(sideEvents, match);
			var h = '<div class="inline-events-side">' +
				'<div class="inline-events-team-head"><span class="inline-events-dot" style="background:' + esc(teamHex(colorName)) + ';"></span><span>' + esc(colorName) + '</span></div>';
			if (!groups.length) {
				h += '<div class="inline-events-empty">—</div>';
			} else {
				h += '<div class="inline-events-list">';
				for (var j = 0; j < groups.length; j++) {
					var grp = groups[j];
					var chipCls = grp.goals.length ? ' is-goal' : (grp.ogs.length ? ' is-og' : ' is-assist');
					h += '<span class="inline-event-chip' + chipCls + '"><span>' + esc(grp.name) + '</span>' + renderGroupedStatTagsHtml(grp, false, 'inline-stat-tag') + '</span>';
				}
				h += '</div>';
			}
			h += '</div>';
			return h;
		}

		return '<div class="inline-match-events-summary">' +
			summarizeSide(match.team_a_id, match.team_a_color) +
			summarizeSide(match.team_b_id, match.team_b_color) +
			'</div>';
	}

	function renderInlinePitchCard(match) {
		return '<div class="match-inline-pitch-card">' +
			'<div class="inline-pitch-header">' +
			'<div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">' +
			'<span style="font-weight:800;font-size:0.84rem;">🏟️ ผังนักเตะ Match ' + esc(match.match_num) + '</span>' +
			'<span class="inline-pitch-vs-pill">' + esc(match.team_a_color) + ' ' + esc(match.team_a_goal) + ' - ' + esc(match.team_b_goal) + ' ' + esc(match.team_b_color) + '</span>' +
			'</div>' +
			'<button type="button" class="btn-close-inline-pitch" data-action="toggle-inline-pitch" data-match-num="' + esc(match.match_num) + '">✕ ปิด</button>' +
			'</div>' +
			'<div class="inline-soccer-pitch-wrapper">' +
			'<div class="inline-soccer-pitch">' +
			'<div class="match-pitch-markings">' +
			'<div class="mp-half-line"></div>' +
			'<div class="mp-center-circle"></div>' +
			'<div class="mp-center-spot"></div>' +
			'<div class="mp-penalty-left"></div>' +
			'<div class="mp-goal-left"></div>' +
			'<div class="mp-penalty-right"></div>' +
			'<div class="mp-goal-right"></div>' +
			'</div>' +
			renderInlinePitchHalfHtml(match, match.team_a_id, match.team_a_color, false) +
			renderInlinePitchHalfHtml(match, match.team_b_id, match.team_b_color, true) +
			'</div>' +
			'</div>' +
			renderInlineMatchEventsSummary(match) +
			'</div>';
	}

	function renderWeekPickerModal() {
		if (!weekPickerModalEl) return;
		if (!state.showWeekPicker) {
			weekPickerModalEl.innerHTML = '';
			return;
		}
		var activeId = (state.info && state.info.week && state.info.week.id) || state.selectedWeek;
		weekPickerModalEl.innerHTML = ui.renderWeekPickerModal(state.weeks, activeId);
	}

	function renderDeleteModal() {
		if (!deleteModalEl) return;
		if (!state.showDeleteModal || !state.deleteTargetMatch) {
			deleteModalEl.innerHTML = '';
			return;
		}
		var m = state.deleteTargetMatch;
		deleteModalEl.innerHTML =
			'<div class="modal-overlay" data-overlay="delete-modal">' +
			'<div class="modal-content" style="max-width:440px;padding:1.25rem;">' +
			'<div class="card-title">' +
			'<span>🗑️ ยืนยันการลบ Match ' + esc(m.match_num) + '</span>' +
			'<span style="cursor:pointer;font-size:1.5rem;line-height:1;" data-action="close-delete-modal">&times;</span>' +
			'</div>' +
			'<div style="font-size:0.9rem;line-height:1.5;">' +
			'<p style="margin:0;">คุณกำลังจะลบ <strong>Match ' + esc(m.match_num) + '</strong> (' + esc(m.team_a_color) + ' ' + esc(m.team_a_goal) + '-' + esc(m.team_b_goal) + ' ' + esc(m.team_b_color) + ') พร้อมสถิติประตูทั้งหมดในแมตช์นี้</p>' +
			'<label style="display:flex;align-items:center;gap:0.5rem;margin-top:0.85rem;cursor:pointer;">' +
			'<input type="checkbox" data-action="toggle-confirm-delete"' + (state.confirmDeleteChecked ? ' checked' : '') + '>' +
			'<span>ฉันเข้าใจว่าไม่สามารถกู้คืนข้อมูลแมตช์นี้ได้</span>' +
			'</label>' +
			'</div>' +
			'<div style="display:flex;gap:0.75rem;justify-content:flex-end;align-items:center;margin-top:1.1rem;">' +
			'<button type="button" class="btn-logout" data-action="close-delete-modal">ยกเลิก</button>' +
			'<button type="button" id="confirmDeleteMatchBtn" class="add-button" style="width:auto;background:var(--danger-color);padding:0.45rem 1rem;" data-action="submit-delete-match"' + ((!state.confirmDeleteChecked || state.deletingMatch) ? ' disabled' : '') + '>' +
			(state.deletingMatch ? 'กำลังลบ...' : 'ลบ Match ถาวร') +
			'</button>' +
			'</div>' +
			'</div>' +
			'</div>';
	}

	function renderPasswordModal() {
		if (!passwordModalEl) return;
		if (!state.showPasswordModal || !state.currentUser) {
			passwordModalEl.innerHTML = '';
			return;
		}
		passwordModalEl.innerHTML = ui.renderPasswordModal(
			state.currentUser.username,
			state.pwdMessage,
			state.pwdIsError,
			state.pwdLoading,
			state.pwdForm
		);
	}

	function renderAddMatchModal() {
		if (!addMatchModalEl) return;
		if (!state.showAddMatchModal) {
			addMatchModalEl.innerHTML = '';
			return;
		}
		var teams = getTeamList();
		var optsA = '';
		var optsB = '';
		for (var i = 0; i < teams.length; i++) {
			var t = teams[i];
			optsA += '<option value="' + esc(t.teamid) + '"' + (String(state.addMatchForm.teamaid) === String(t.teamid) ? ' selected' : '') + '>' + esc(t.name) + '</option>';
			optsB += '<option value="' + esc(t.teamid) + '"' + (String(state.addMatchForm.teambid) === String(t.teamid) ? ' selected' : '') + '>' + esc(t.name) + '</option>';
		}
		addMatchModalEl.innerHTML =
			'<div class="modal-overlay" data-overlay="add-match-modal">' +
			'<div class="modal-content" style="max-width:440px;padding:1.25rem;">' +
			'<div class="card-title"><span>➕ สร้าง Match ใหม่</span><span style="cursor:pointer;font-size:1.5rem;line-height:1;" data-action="close-add-match-modal">&times;</span></div>' +
			'<form id="addMatchForm">' +
			'<div style="display:grid;gap:0.75rem;">' +
			'<label style="font-size:0.85rem;font-weight:600;">ลำดับ Match ที่:<input type="number" id="addMatchNumInput" class="form-control" min="1" value="' + esc(state.addMatchForm.matchnum) + '" required style="margin-top:0.25rem;"></label>' +
			'<label style="font-size:0.85rem;font-weight:600;">ทีม A (เจ้าบ้าน):<select id="addMatchTeamAInput" class="form-control" style="margin-top:0.25rem;">' + optsA + '</select></label>' +
			'<label style="font-size:0.85rem;font-weight:600;">ทีม B (ทีมเยือน):<select id="addMatchTeamBInput" class="form-control" style="margin-top:0.25rem;">' + optsB + '</select></label>' +
			'<label style="font-size:0.85rem;font-weight:600;">สถานะเริ่มต้น:<select id="addMatchStatusInput" class="form-control" style="margin-top:0.25rem;">' +
			'<option value="in_progress"' + (state.addMatchForm.status === 'in_progress' ? ' selected' : '') + '>เริ่มแข่งทันที (LIVE)</option>' +
			'<option value="scheduled"' + (state.addMatchForm.status === 'scheduled' ? ' selected' : '') + '>รอแข่ง (Scheduled)</option>' +
			'</select></label>' +
			(state.addMatchError ? '<div style="padding:0.5rem 0.75rem;border-radius:0.5rem;background:rgba(239,68,68,0.1);color:var(--danger-color);font-size:0.82rem;font-weight:600;">⚠️ ' + esc(state.addMatchError) + '</div>' : '') +
			'</div>' +
			'<div style="display:flex;gap:0.75rem;justify-content:flex-end;align-items:center;margin-top:1.1rem;">' +
			'<button type="button" class="btn-logout" data-action="close-add-match-modal">ยกเลิก</button>' +
			'<button type="submit" class="add-button" style="width:auto;padding:0.45rem 1.1rem;"' + (state.addingMatch ? ' disabled' : '') + '>' + (state.addingMatch ? 'กำลังสร้าง...' : 'สร้าง Match') + '</button>' +
			'</div>' +
			'</form>' +
			'</div>' +
			'</div>';
	}

	function renderExtendModal() {
		if (!extendModalEl) return;
		if (!state.showExtendModal) {
			extendModalEl.innerHTML = '';
			return;
		}
		extendModalEl.innerHTML =
			'<div class="modal-overlay" data-overlay="extend-modal">' +
			'<div class="modal-content" style="max-width:420px;padding:1.25rem;">' +
			'<div class="card-title"><span>⏱️ ต่อเวลา / ขยายตารางแข่งขัน</span><span style="cursor:pointer;font-size:1.5rem;line-height:1;" data-action="close-extend-modal">&times;</span></div>' +
			'<form id="extendScheduleForm">' +
			'<div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.75rem;">' +
			'<button type="button" class="btn-action-pill" data-action="set-extend-preset" data-param="30">+30 นาที</button>' +
			'<button type="button" class="btn-action-pill" data-action="set-extend-preset" data-param="60">+60 นาที</button>' +
			'<button type="button" class="btn-action-pill" data-action="set-extend-preset" data-param="1 รอบ">+1 รอบ</button>' +
			'</div>' +
			'<label style="font-size:0.85rem;font-weight:600;display:block;">จำนวนนาที หรือเวลาสิ้นสุด (เช่น 30, 21:00):' +
			'<input type="text" id="extendParamInput" class="form-control" value="' + esc(state.extendParam) + '" placeholder="เช่น 30 หรือ 21:00" required style="margin-top:0.35rem;">' +
			'</label>' +
			(state.extendError ? '<div style="padding:0.5rem 0.75rem;border-radius:0.5rem;background:rgba(239,68,68,0.1);color:var(--danger-color);font-size:0.82rem;font-weight:600;margin-top:0.65rem;">⚠️ ' + esc(state.extendError) + '</div>' : '') +
			'<div style="display:flex;gap:0.75rem;justify-content:flex-end;align-items:center;margin-top:1.1rem;">' +
			'<button type="button" class="btn-logout" data-action="close-extend-modal">ยกเลิก</button>' +
			'<button type="submit" class="add-button" style="width:auto;padding:0.45rem 1.1rem;"' + (state.extending ? ' disabled' : '') + '>' + (state.extending ? 'กำลังบันทึก...' : 'ขยายเวลา') + '</button>' +
			'</div>' +
			'</form>' +
			'</div>' +
			'</div>';
	}

	function renderPickerModal() {
		if (!pickerModalEl) return;
		if (!state.showPlayerPicker && !state.showLoanTeamPicker) {
			pickerModalEl.innerHTML = '';
			return;
		}
		if (state.showPlayerPicker) {
			var members = (state.info && state.info.allmembers) || [];
			var q = state.pickerSearch.trim().toLowerCase();
			var items = '';
			for (var i = 0; i < members.length; i++) {
				var m = members[i];
				var name = getDisplayName(m);
				var hay = (name + ' ' + (m.name || '') + ' ' + (m.color || '') + ' ' + getPosCode(m)).toLowerCase();
				if (q && hay.indexOf(q) === -1) continue;
				items +=
					'<button type="button" class="player-card" data-action="pick-classic-player" data-member-id="' + esc(m.id) + '" style="display:flex;align-items:center;justify-content:space-between;width:100%;cursor:pointer;margin-bottom:0.4rem;">' +
					'<span><strong>' + esc(name) + '</strong> <small style="color:var(--text-muted);">(' + esc(getPosCode(m) || '-') + ')</small></span>' +
					'<span class="msd-team-badge" style="background:' + esc(teamHex(m.color)) + ';color:' + esc(getContrast(m.color)) + ';">' + esc(m.color || '-') + '</span>' +
					'</button>';
			}
			pickerModalEl.innerHTML =
				'<div class="modal-overlay" data-overlay="picker-modal">' +
				'<div class="modal-content" style="max-width:440px;padding:1.25rem;">' +
				'<div class="card-title"><span>👤 เลือกนักเตะ</span><span style="cursor:pointer;font-size:1.5rem;line-height:1;" data-action="close-picker-modal">&times;</span></div>' +
				'<div>' +
				'<input type="text" id="pickerSearchInput" class="form-control" value="' + esc(state.pickerSearch) + '" placeholder="ค้นหาชื่อนักเตะหรือสีทีม..." style="margin-bottom:0.75rem;">' +
				'<div style="max-height:320px;overflow-y:auto;">' + (items || '<div style="text-align:center;color:var(--text-muted);padding:1rem;">ไม่พบรายชื่อ</div>') + '</div>' +
				'</div>' +
				'</div>' +
				'</div>';
			return;
		}
		// Loan Team Picker
		var teams = getTeamList();
		var tHtml = '';
		for (var j = 0; j < teams.length; j++) {
			var tm = teams[j];
			tHtml +=
				'<button type="button" class="team-option" data-action="pick-classic-loan-team" data-team-id="' + esc(tm.teamid) + '" style="display:flex;align-items:center;justify-content:center;width:100%;background:' + esc(teamHex(tm.name)) + ';color:' + esc(getContrast(tm.name)) + ';font-weight:700;cursor:pointer;margin-bottom:0.45rem;border:none;">' +
				'<span>ทีม ' + esc(tm.name) + '</span>' +
				'</button>';
		}
		pickerModalEl.innerHTML =
			'<div class="modal-overlay" data-overlay="picker-modal">' +
			'<div class="modal-content" style="max-width:420px;padding:1.25rem;">' +
			'<div class="card-title"><span>🏳️ เลือกทีมที่ได้เครดิต (Loan)</span><span style="cursor:pointer;font-size:1.5rem;line-height:1;" data-action="close-picker-modal">&times;</span></div>' +
			'<div>' + tHtml + '</div>' +
			'</div>' +
			'</div>';
	}

	function renderMainSections() {
		renderHeader();
		renderTopNav();
		renderSessionBanner();
		renderDateCard();
		renderRosterLocked();
		renderStadiumSection();
		renderEmptyMatches();
		renderTeamSummaryCard();
		renderStandingsCard();
		renderMatchList();
	}

	function checkVersionMismatch(ver) {
		if (ver && state.appVersion && String(ver) !== String(state.appVersion)) {
			state.newVersionAvailable = true;
			state.latestServerVersion = String(ver);
		}
	}

	function fetchCurrentUser() {
		return http.get('/webhook/auth/me?weeknum=' + (state.selectedWeek || 0)).then(function (res) {
			var d = res.data || {};
			if (d.authenticated && d.user) {
				state.currentUser = d.user;
				state.sessionExpired = false;
			} else {
				state.currentUser = null;
			}
			checkVersionMismatch(d.app_version);
			renderHeader();
			renderTopNav();
			renderSessionBanner();
		}).catch(function () {});
	}

	function loadData(preserveMatch) {
		var endpoint = state.isManager
			? '/webhook/get_info?cmd=get_last_matchweek&weeknum=' + (state.selectedWeek || 0)
			: '/webhook/match_view_data?weeknum=' + (state.selectedWeek || 0);

		state.isRefreshing = true;
		renderHeader();

		return http.get(endpoint).then(function (res) {
			var d = res.data || {};
			if (d.error && !d.week) {
				showToast(d.error, '⚠️');
				return;
			}
			state.info = d;
			if (Array.isArray(d.weeks)) state.weeks = d.weeks;
			checkVersionMismatch(d.app_version);

			var keys = getMatchKeys();
			if (!preserveMatch || !state.selectedMatchNum || !getMatchByNum(state.selectedMatchNum)) {
				state.selectedMatchNum = d.current_match_num || (keys.length ? Number(keys[0]) : null);
			}
			var selMatch = getSelectedMatch();
			if (selMatch && !state.isManager && selMatch.is_locked && d.current_match_num) {
				state.selectedMatchNum = d.current_match_num;
			}

			if (d.week && d.week.id) {
				initWebSocket(d.week.id);
			}
			renderMainSections();
		}).catch(function (err) {
			if (err && err.response && err.response.data && err.response.data.error) {
				showToast(err.response.data.error, '⚠️');
			}
		}).finally(function () {
			state.isRefreshing = false;
			renderHeader();
		});
	}

	function postMatchCommand(payload, successMsg, icon) {
		return http.post('/webhook/add_match', payload).then(function (res) {
			var d = res.data || {};
			if (d.error) {
				showToast(d.error, '❌');
				return null;
			}
			if (successMsg) showToast(successMsg, icon || '✓');
			return loadData(true);
		}).catch(function (err) {
			var msg = (err && err.response && err.response.data && err.response.data.error) || (err && err.message) || 'เกิดข้อผิดพลาด';
			showToast(msg, '❌');
		});
	}

	function assignLoanPlayer(playerId, teamId) {
		var match = getSelectedMatch();
		if (!match) return;
		var loans = ensureMatchLoansObj(match.id);
		loans[String(playerId)] = Number(teamId);
		var pl = getMemberById(playerId);
		var tm = (state.info.team_week && state.info.team_week[teamId]) || {};
		showToast('ยืม ' + (pl ? getDisplayName(pl) : 'ผู้เล่น') + ' ลงให้ทีม ' + (tm.name || '') + ' แล้ว', '🤝');
		renderStadiumSection();
	}

	function unloanPlayer(matchId, playerId) {
		var loans = ensureMatchLoansObj(matchId);
		delete loans[String(playerId)];
		renderStadiumSection();
	}

	function startViewerCountdown() {
		if (state.isManager) return;
		if (state.refreshTimer) clearInterval(state.refreshTimer);
		state.refreshCooldown = 30;
		state.refreshTimer = setInterval(function () {
			if (document.hidden) return;
			state.refreshCooldown--;
			if (state.refreshCooldown <= 0) {
				state.refreshCooldown = 30;
				loadData(true);
			} else {
				var cdEl = headerEl && headerEl.querySelector('.refresh-cd-text');
				if (cdEl) cdEl.textContent = state.refreshCooldown + 's';
			}
		}, 1000);
	}

	function closeWebSocket() {
		if (state.wsHandshakeTimer) { clearTimeout(state.wsHandshakeTimer); state.wsHandshakeTimer = null; }
		if (state.wsHeartbeatTimer) { clearInterval(state.wsHeartbeatTimer); state.wsHeartbeatTimer = null; }
		if (state.wsReconnectTimer) { clearTimeout(state.wsReconnectTimer); state.wsReconnectTimer = null; }
		if (state.ws) {
			try { state.ws.onclose = null; state.ws.close(); } catch (e) {}
			state.ws = null;
		}
		state.wsConnected = false;
	}

	function handleWebSocketMessage(rawData) {
		var msg;
		try { msg = JSON.parse(rawData); } catch (e) { return; }
		if (!msg || msg.type === 'pong') return;

		var activeWeekId = state.info && state.info.week && state.info.week.id;
		if (msg.week_id && activeWeekId && Number(msg.week_id) !== Number(activeWeekId)) return;

		var sig = (msg.type || '') + ':' + (msg.match_id || '') + ':' + (msg.match_num || '') + ':' + (msg.message || '');
		var now = Date.now();
		if (state.processedWsEvents[sig] && (now - state.processedWsEvents[sig]) < 8000) return;
		state.processedWsEvents[sig] = now;

		if (msg.type === 'MATCH_FINISHED' && !state.isManager && msg.next_match_num) {
			var nextM = getMatchByNum(msg.next_match_num);
			if (nextM) nextM.is_locked = false;
			state.selectedMatchNum = Number(msg.next_match_num);
		}

		if (msg.message || msg.html) {
			showToast(msg.message || '', '⚡', {
				html: msg.html || '',
				avatar: msg.avatar || '',
				initials: msg.initials || ''
			});
		}

		loadData(true).then(function () {
			if (msg.type === 'MATCH_FINISHED' && !state.isManager && msg.next_match_num) {
				var targetEl = document.getElementById('match-card-' + msg.next_match_num);
				if (targetEl && targetEl.scrollIntoView) {
					targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
				}
			}
		});
	}

	function initWebSocket(weekId) {
		if (!weekId || typeof window.WebSocket === 'undefined') return;
		if (state.ws && state.wsWeekId === weekId && (state.ws.readyState === 0 || state.ws.readyState === 1)) {
			return;
		}
		closeWebSocket();
		state.wsWeekId = weekId;

		var proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
		var url = proto + window.location.host + '/webhook/ws?week_id=' + encodeURIComponent(weekId);

		state.wsHandshakeTimer = setTimeout(function () {
			if (state.ws && state.ws.readyState === 0) {
				try { state.ws.close(); } catch (e) {}
			}
		}, 2500);

		try {
			var ws = new window.WebSocket(url);
			state.ws = ws;
			ws.onopen = function () {
				if (state.wsHandshakeTimer) { clearTimeout(state.wsHandshakeTimer); state.wsHandshakeTimer = null; }
				state.wsConnected = true;
				renderHeader();
				renderTeamSummaryCard();
				state.wsHeartbeatTimer = setInterval(function () {
					if (state.ws && state.ws.readyState === 1) {
						try { state.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
					}
				}, 12000);
			};
			ws.onmessage = function (ev) {
				handleWebSocketMessage(ev.data);
			};
			ws.onclose = function () {
				state.wsConnected = false;
				if (state.wsHeartbeatTimer) { clearInterval(state.wsHeartbeatTimer); state.wsHeartbeatTimer = null; }
				renderHeader();
				state.wsReconnectTimer = setTimeout(function () {
					if (state.wsWeekId) initWebSocket(state.wsWeekId);
				}, 2000);
			};
			ws.onerror = function () {};
		} catch (e) {}
	}

	// Event Listeners (Delegation)
	if (loanSearchInputEl) {
		loanSearchInputEl.addEventListener('input', function () {
			state.loanSearchQuery = loanSearchInputEl.value;
			renderLoanPool(getSelectedMatch());
		});
	}

	document.addEventListener('click', function (e) {
		var overlay = e.target.getAttribute && e.target.getAttribute('data-overlay');
		if (overlay === 'week-picker') { state.showWeekPicker = false; renderWeekPickerModal(); return; }
		if (overlay === 'delete-modal') { state.showDeleteModal = false; renderDeleteModal(); return; }
		if (overlay === 'password-modal') { state.showPasswordModal = false; renderPasswordModal(); return; }
		if (overlay === 'add-match-modal') { state.showAddMatchModal = false; renderAddMatchModal(); return; }
		if (overlay === 'extend-modal') { state.showExtendModal = false; renderExtendModal(); return; }
		if (overlay === 'picker-modal') { state.showPlayerPicker = false; state.showLoanTeamPicker = false; renderPickerModal(); return; }

		if (e.target === pitchBackdropEl) {
			state.isPitchModal = false;
			renderStadiumSection();
			return;
		}

		var actionEl = e.target.closest('[data-action]');
		if (!actionEl) return;
		var action = actionEl.getAttribute('data-action');
		var match = getSelectedMatch();
		var weekId = state.info && state.info.week && state.info.week.id;

		if (action === 'reload-app') {
			ui.reloadApp();
		} else if (action === 'logout') {
			ui.logout();
		} else if (action === 'manual-refresh') {
			state.refreshCooldown = 30;
			loadData(true);
		} else if (action === 'jump-current-match') {
			if (state.info && state.info.current_match_num) {
				state.selectedMatchNum = Number(state.info.current_match_num);
				renderMainSections();
				var mc = document.getElementById('match-card-' + state.selectedMatchNum);
				if (mc && mc.scrollIntoView) mc.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		} else if (action === 'open-week-picker') {
			state.showWeekPicker = true;
			renderWeekPickerModal();
		} else if (action === 'close-week-picker') {
			state.showWeekPicker = false;
			renderWeekPickerModal();
		} else if (action === 'change-week') {
			var wId = parseInt(actionEl.getAttribute('data-week-id'), 10);
			if (!isNaN(wId)) {
				state.selectedWeek = wId;
				state.selectedMatchNum = null;
				state.showWeekPicker = false;
				renderWeekPickerModal();
				loadData(false);
			}
		} else if (action === 'open-password-modal') {
			state.showPasswordModal = true;
			state.pwdMessage = '';
			state.pwdIsError = false;
			state.pwdForm = { current_password: '', new_password: '', confirm_password: '' };
			renderPasswordModal();
		} else if (action === 'close-password-modal') {
			state.showPasswordModal = false;
			renderPasswordModal();
		} else if (action === 'toggle-pitch-modal') {
			state.isPitchModal = !state.isPitchModal;
			renderStadiumSection();
		} else if (action === 'set-pitch-tab') {
			state.activePitchTab = actionEl.getAttribute('data-tab') || 'both';
			renderStadiumSection();
		} else if (action === 'toggle-team-tab') {
			var side = actionEl.getAttribute('data-side');
			state.activePitchTab = (state.activePitchTab === side) ? 'both' : side;
			renderStadiumSection();
		} else if (action === 'step-match') {
			var keys = getMatchKeys();
			var idx = keys.indexOf(String(state.selectedMatchNum));
			var dir = parseInt(actionEl.getAttribute('data-dir'), 10);
			var nextIdx = idx + dir;
			if (nextIdx >= 0 && nextIdx < keys.length) {
				state.selectedMatchNum = Number(keys[nextIdx]);
				renderMainSections();
			}
		} else if (action === 'select-match-card') {
			var cardNum = Number(actionEl.getAttribute('data-match-num'));
			var cardMatch = getMatchByNum(cardNum);
			if (cardMatch && (!cardMatch.is_locked || state.isManager)) {
				state.selectedMatchNum = cardNum;
				renderMainSections();
			}
		} else if (action === 'toggle-inline-pitch') {
			var inNum = actionEl.getAttribute('data-match-num');
			state.inlinePitchMatches[inNum] = !state.inlinePitchMatches[inNum];
			renderMatchList();
		} else if (action === 'toggle-classic-form') {
			state.showClassicForm = !state.showClassicForm;
			renderStadiumSection();
		} else if (action === 'set-classic-status') {
			state.classicStatusId = actionEl.getAttribute('data-status') || '0';
			renderClassicGoalForm(match);
		} else if (action === 'open-player-picker') {
			state.showPlayerPicker = true;
			state.pickerSearch = '';
			renderPickerModal();
		} else if (action === 'open-loan-team-picker') {
			state.showLoanTeamPicker = true;
			renderPickerModal();
		} else if (action === 'close-picker-modal') {
			state.showPlayerPicker = false;
			state.showLoanTeamPicker = false;
			renderPickerModal();
		} else if (action === 'pick-classic-player') {
			state.classicMemberId = actionEl.getAttribute('data-member-id');
			state.showPlayerPicker = false;
			renderPickerModal();
			renderClassicGoalForm(match);
		} else if (action === 'pick-classic-loan-team') {
			state.classicTeamId = actionEl.getAttribute('data-team-id');
			state.showLoanTeamPicker = false;
			renderPickerModal();
			renderClassicGoalForm(match);
		} else if (action === 'submit-classic-goal') {
			if (!match) return;
			if (!state.classicMemberId) { showToast('กรุณาเลือกผู้เล่นก่อน', '⚠️'); return; }
			var plObj = getMemberById(state.classicMemberId);
			var targetTid = state.classicIsLoan
				? state.classicTeamId
				: ((Number(plObj && plObj.team_id) === Number(match.team_a_id) || Number(plObj && plObj.team_id) === Number(match.team_b_id)) ? plObj.team_id : '');
			if (!targetTid) { showToast('ผู้เล่นไม่อยู่ในทีมคู่แข่ง กรุณาเปิดสวิตช์ยืมตัวและเลือกทีม', '⚠️'); return; }
			postMatchCommand({
				weekid: weekId,
				matchid: match.id,
				memberid: state.classicMemberId,
				teamid: targetTid,
				statusid: state.classicStatusId
			});
		} else if (action === 'quick-goal') {
			if (!match) return;
			postMatchCommand({
				weekid: weekId,
				matchid: match.id,
				memberid: actionEl.getAttribute('data-member-id'),
				teamid: actionEl.getAttribute('data-team-id'),
				statusid: actionEl.getAttribute('data-status') || '0'
			});
		} else if (action === 'quick-remove-goal') {
			e.stopPropagation();
			var goalId = actionEl.getAttribute('data-goal-id');
			if (goalId) {
				postMatchCommand({ weekid: weekId, goalid: goalId });
			}
		} else if (action === 'finish-match') {
			postMatchCommand({ cmd: 'finish_match', matchid: actionEl.getAttribute('data-match-id'), weekid: weekId });
		} else if (action === 'start-match') {
			postMatchCommand({ cmd: 'start_match', matchid: actionEl.getAttribute('data-match-id'), weekid: weekId });
		} else if (action === 'reopen-match') {
			postMatchCommand({ cmd: 'reopen_match', matchid: actionEl.getAttribute('data-match-id'), weekid: weekId });
		} else if (action === 'set-loan-filter') {
			state.loanFilterTeam = actionEl.getAttribute('data-team') || 'all';
			renderLoanPool(match);
		} else if (action === 'assign-loan') {
			assignLoanPlayer(actionEl.getAttribute('data-player-id'), actionEl.getAttribute('data-team-id'));
		} else if (action === 'unloan-player') {
			unloanPlayer(actionEl.getAttribute('data-match-id'), actionEl.getAttribute('data-player-id'));
		} else if (action === 'set-summary-view') {
			state.teamSummaryViewMode = actionEl.getAttribute('data-mode') || 'pitch';
			localStorage.setItem('team_summary_view_mode', state.teamSummaryViewMode);
			renderTeamSummaryCard();
		} else if (action === 'scroll-summary-col') {
			var gEl = document.getElementById('teamSummaryGrid');
			var idx = parseInt(actionEl.getAttribute('data-index'), 10);
			if (gEl && gEl.children[idx]) {
				gEl.scrollTo({ left: gEl.children[idx].offsetLeft, behavior: 'smooth' });
			}
		} else if (action === 'open-delete-modal') {
			var delNum = actionEl.getAttribute('data-match-num');
			var delM = getMatchByNum(delNum);
			if (delM) {
				state.deleteTargetMatch = delM;
				state.confirmDeleteChecked = false;
				state.deletingMatch = false;
				state.showDeleteModal = true;
				renderDeleteModal();
			}
		} else if (action === 'close-delete-modal') {
			state.showDeleteModal = false;
			renderDeleteModal();
		} else if (action === 'submit-delete-match') {
			if (!state.deleteTargetMatch || !state.confirmDeleteChecked || state.deletingMatch) return;
			state.deletingMatch = true;
			renderDeleteModal();
			postMatchCommand({
				cmd: 'remove_match',
				matchid: state.deleteTargetMatch.id,
				weekid: weekId
			}, 'ลบ Match ' + state.deleteTargetMatch.match_num + ' เรียบร้อยแล้ว', '🗑️').then(function () {
				state.showDeleteModal = false;
				state.deletingMatch = false;
				renderDeleteModal();
			});
		} else if (action === 'open-add-match-modal') {
			var nm = (state.info && state.info.next_match) || {};
			var tList = getTeamList();
			var mKeys = getMatchKeys();
			state.addMatchForm = {
				matchnum: nm.match_num || (mKeys.length + 1),
				teamaid: nm.team_a_id || (tList[0] ? tList[0].teamid : ''),
				teambid: nm.team_b_id || (tList[1] ? tList[1].teamid : ''),
				status: 'in_progress'
			};
			state.addMatchError = '';
			state.addingMatch = false;
			state.showAddMatchModal = true;
			renderAddMatchModal();
		} else if (action === 'close-add-match-modal') {
			state.showAddMatchModal = false;
			renderAddMatchModal();
		} else if (action === 'open-extend-modal') {
			state.extendParam = '30';
			state.extendError = '';
			state.extending = false;
			state.showExtendModal = true;
			renderExtendModal();
		} else if (action === 'close-extend-modal') {
			state.showExtendModal = false;
			renderExtendModal();
		} else if (action === 'set-extend-preset') {
			state.extendParam = actionEl.getAttribute('data-param') || '30';
			var extInp = document.getElementById('extendParamInput');
			if (extInp) extInp.value = state.extendParam;
		} else if (action === 'quick-extend') {
			var quickParam = actionEl.getAttribute('data-param') || '30';
			http.post('/webhook/extend_schedule', { weekid: weekId, param: quickParam }).then(function (res) {
				var d = res.data || {};
				showToast(d.message || 'ขยายเวลาแข่งขันแล้ว', '⏱️');
				loadData(true);
			}).catch(function (err) {
				var msg = (err && err.response && err.response.data && err.response.data.error) || 'ไม่สามารถขยายเวลาได้';
				showToast(msg, '❌');
			});
		}
	});

	document.addEventListener('change', function (e) {
		var action = e.target.getAttribute && e.target.getAttribute('data-action');
		if (action === 'select-match-dropdown') {
			state.selectedMatchNum = Number(e.target.value);
			renderMainSections();
		} else if (action === 'toggle-classic-loan') {
			state.classicIsLoan = Boolean(e.target.checked);
			renderClassicGoalForm(getSelectedMatch());
		} else if (action === 'toggle-confirm-delete') {
			state.confirmDeleteChecked = Boolean(e.target.checked);
			var delBtn = document.getElementById('confirmDeleteMatchBtn');
			if (delBtn) delBtn.disabled = !state.confirmDeleteChecked || state.deletingMatch;
		}
	});

	document.addEventListener('input', function (e) {
		if (e.target.id === 'pickerSearchInput') {
			state.pickerSearch = e.target.value;
			renderPickerModal();
			var reInput = document.getElementById('pickerSearchInput');
			if (reInput) {
				reInput.focus();
				reInput.selectionStart = reInput.selectionEnd = reInput.value.length;
			}
		} else if (e.target.id === 'pwdCurrentInput') {
			state.pwdForm.current_password = e.target.value;
		} else if (e.target.id === 'pwdNewInput') {
			state.pwdForm.new_password = e.target.value;
		} else if (e.target.id === 'pwdConfirmInput') {
			state.pwdForm.confirm_password = e.target.value;
		} else if (e.target.id === 'extendParamInput') {
			state.extendParam = e.target.value;
		}
	});

	document.addEventListener('submit', function (e) {
		if (e.target.id === 'addMatchForm') {
			e.preventDefault();
			if (state.addingMatch) return;
			var mNum = parseInt((document.getElementById('addMatchNumInput') || {}).value, 10);
			var tA = (document.getElementById('addMatchTeamAInput') || {}).value;
			var tB = (document.getElementById('addMatchTeamBInput') || {}).value;
			var st = (document.getElementById('addMatchStatusInput') || {}).value || 'in_progress';
			if (!tA || !tB || tA === tB) {
				state.addMatchError = 'กรุณาเลือกทีม A และทีม B ที่ไม่ซ้ำกัน';
				renderAddMatchModal();
				return;
			}
			state.addingMatch = true;
			state.addMatchError = '';
			renderAddMatchModal();
			http.post('/webhook/add_match', {
				weekid: state.info && state.info.week && state.info.week.id,
				matchnum: mNum,
				teamaid: tA,
				teambid: tB,
				status: st
			}).then(function () {
				state.showAddMatchModal = false;
				state.addingMatch = false;
				state.selectedMatchNum = mNum;
				showToast('สร้าง Match ' + mNum + ' เรียบร้อยแล้ว', '➕');
				renderAddMatchModal();
				loadData(true);
			}).catch(function (err) {
				state.addingMatch = false;
				state.addMatchError = (err && err.response && err.response.data && err.response.data.error) || 'สร้าง Match ไม่สำเร็จ';
				renderAddMatchModal();
			});
		} else if (e.target.id === 'extendScheduleForm') {
			e.preventDefault();
			if (state.extending) return;
			var paramVal = ((document.getElementById('extendParamInput') || {}).value || '').trim();
			if (!paramVal) return;
			state.extending = true;
			state.extendError = '';
			renderExtendModal();
			http.post('/webhook/extend_schedule', {
				weekid: state.info && state.info.week && state.info.week.id,
				param: paramVal
			}).then(function (res) {
				state.extending = false;
				state.showExtendModal = false;
				renderExtendModal();
				showToast((res.data && res.data.message) || 'ขยายเวลาแข่งขันแล้ว', '⏱️');
				loadData(true);
			}).catch(function (err) {
				state.extending = false;
				state.extendError = (err && err.response && err.response.data && err.response.data.error) || 'ไม่สามารถขยายเวลาได้';
				renderExtendModal();
			});
		} else if (e.target.id === 'changePasswordForm') {
			e.preventDefault();
			if (state.pwdLoading) return;
			state.pwdLoading = true;
			state.pwdMessage = '';
			renderPasswordModal();
			http.post('/webhook/change_password', state.pwdForm).then(function (res) {
				state.pwdLoading = false;
				state.pwdIsError = false;
				state.pwdMessage = (res.data && res.data.message) || 'เปลี่ยนรหัสผ่านสำเร็จ';
				renderPasswordModal();
				setTimeout(function () {
					state.showPasswordModal = false;
					renderPasswordModal();
				}, 1200);
			}).catch(function (err) {
				state.pwdLoading = false;
				state.pwdIsError = true;
				state.pwdMessage = (err && err.response && err.response.data && err.response.data.error) || 'เปลี่ยนรหัสผ่านไม่สำเร็จ';
				renderPasswordModal();
			});
		}
	});

	// Drag-and-drop Loan (update highlight classes only — never wipe DOM mid-drag)
	document.addEventListener('dragstart', function (e) {
		var card = e.target.closest('[data-loan-player-id]');
		if (!card) return;
		state.draggedLoanPlayerId = card.getAttribute('data-loan-player-id');
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			try { e.dataTransfer.setData('text/plain', String(state.draggedLoanPlayerId)); } catch (ex) {}
		}
	});

	document.addEventListener('dragover', function (e) {
		if (!state.draggedLoanPlayerId) return;
		var zone = e.target.closest('[data-drop-team-id]');
		if (zone) {
			e.preventDefault();
			zone.classList.add('drag-over');
		}
	});

	document.addEventListener('dragleave', function (e) {
		var zone = e.target.closest('[data-drop-team-id]');
		if (zone && !zone.contains(e.relatedTarget)) {
			zone.classList.remove('drag-over');
		}
	});

	document.addEventListener('dragend', function () {
		state.draggedLoanPlayerId = null;
		var zones = document.querySelectorAll('[data-drop-team-id].drag-over');
		for (var i = 0; i < zones.length; i++) zones[i].classList.remove('drag-over');
	});

	document.addEventListener('drop', function (e) {
		var zones = document.querySelectorAll('[data-drop-team-id].drag-over');
		for (var i = 0; i < zones.length; i++) zones[i].classList.remove('drag-over');
		if (!state.draggedLoanPlayerId) return;
		var zone = e.target.closest('[data-drop-team-id]');
		if (zone) {
			e.preventDefault();
			var pid = state.draggedLoanPlayerId;
			var tid = zone.getAttribute('data-drop-team-id');
			state.draggedLoanPlayerId = null;
			assignLoanPlayer(pid, tid);
		}
	});

	// Visibility / Lifecycle resume hooks
	document.addEventListener('visibilitychange', function () {
		if (document.hidden) {
			state.lastHiddenAt = Date.now();
		} else {
			var hiddenMs = state.lastHiddenAt ? (Date.now() - state.lastHiddenAt) : 0;
			var wId = state.info && state.info.week && state.info.week.id;
			if (hiddenMs > 3500 && wId) initWebSocket(wId);
			if (hiddenMs > 1500) loadData(true);
		}
	});

	window.addEventListener('pageshow', function (ev) {
		if (ev.persisted) loadData(true);
	});

	// Boot
	(function boot() {
		var params = new URLSearchParams(window.location.search || '');
		var wk = parseInt(params.get('week') || params.get('weeknum') || '0', 10);
		if (wk > 0) state.selectedWeek = wk;

		fetchCurrentUser();
		loadData(false);
		startViewerCountdown();
		setInterval(function () {
			if (state.isManager || state.currentUser) fetchCurrentUser();
		}, 60000);
	})();
})();

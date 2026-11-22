/* Shared Vanilla JS UI helpers across frontend pages */
(function (global) {
	'use strict';

	var LIGHT_COLORS = [
		'white', 'yellow', 'gold', 'cream', 'cyan', 'lime', 'silver',
		'beige', 'ivory', 'khaki', 'lavender', 'linen', 'mistyrose',
		'moccasin', 'pale', 'snow', 'wheat', 'whitesmoke'
	];

	function escapeHtml(str) {
		if (str === null || str === undefined) return '';
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function isLightColor(colorName) {
		if (!colorName) return false;
		var lower = String(colorName).toLowerCase();
		return LIGHT_COLORS.indexOf(lower) !== -1 || lower.indexOf('light') !== -1 || lower.indexOf('pale') !== -1;
	}

	function getContrastColor(colorName) {
		if (!colorName) return '#1f2937';
		return isLightColor(colorName) ? '#1f2937' : '#ffffff';
	}

	function getBorderColor(colorName, isDarkTheme) {
		if (!colorName) return 'var(--border-color)';
		if (isLightColor(colorName)) {
			return isDarkTheme ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)';
		}
		return isDarkTheme ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.4)';
	}

	function getTeamColorByName(name) {
		if (!name) return '#f59e0b';
		var c = String(name).toLowerCase().trim();
		if (c === 'yellow' || c === 'gold') return '#eab308';
		if (c === 'red') return '#ef4444';
		if (c === 'white') return '#ffffff';
		if (c === 'green') return '#10b981';
		if (c === 'blue') return '#3b82f6';
		if (c === 'orange') return '#f97316';
		if (c === 'purple') return '#a855f7';
		if (c === 'pink') return '#ec4899';
		if (c === 'brown') return '#8b5a2b';
		if (c === 'black') return '#1f2937';
		return c;
	}

	function applyTheme(isDark, toggleEl, iconEl) {
		if (isDark) {
			document.documentElement.setAttribute('data-theme', 'dark');
			document.documentElement.classList.add('dark-theme');
			if (document.body) document.body.classList.add('dark-theme');
			try { localStorage.setItem('theme', 'dark'); } catch (_) {}
			if (iconEl) iconEl.textContent = '☀️';
			if (toggleEl) toggleEl.title = 'Switch to Light Mode';
		} else {
			document.documentElement.setAttribute('data-theme', 'light');
			document.documentElement.classList.remove('dark-theme');
			if (document.body) document.body.classList.remove('dark-theme');
			try { localStorage.setItem('theme', 'light'); } catch (_) {}
			if (iconEl) iconEl.textContent = '🌙';
			if (toggleEl) toggleEl.title = 'Switch to Dark Mode';
		}
	}

	function initTheme(toggleId, iconId, onChange) {
		var saved = null;
		try { saved = localStorage.getItem('theme'); } catch (_) {}
		var isDark = saved ? (saved === 'dark') : true;
		var toggleEl = document.getElementById(toggleId);
		var iconEl = document.getElementById(iconId);
		applyTheme(isDark, toggleEl, iconEl);

		if (toggleEl) {
			toggleEl.addEventListener('click', function () {
				isDark = !isDark;
				applyTheme(isDark, toggleEl, iconEl);
				if (typeof onChange === 'function') onChange(isDark);
			});
		}
		return {
			isDark: function () { return isDark; },
			setDark: function (val) {
				isDark = !!val;
				applyTheme(isDark, toggleEl, iconEl);
				if (typeof onChange === 'function') onChange(isDark);
			}
		};
	}

	function reloadApp() {
		try {
			var url = new URL(window.location.href);
			url.searchParams.set('_v', Date.now());
			window.location.href = url.toString();
		} catch (_) {
			window.location.reload();
		}
	}

	function logout() {
		global.http.post('/webhook/logout')
			.then(function () { window.location.href = '/webhook/login'; })
			.catch(function () { window.location.href = '/webhook/login'; });
	}

	function renderWeekPickerModal(weeks, activeWeekId) {
		var rows = (weeks || []).map(function (w) {
			var isCur = activeWeekId && w.id === activeWeekId;
			var styleAttr = isCur
				? 'border-color: var(--primary-color); background: rgba(79, 70, 229, 0.08); cursor: pointer;'
				: 'cursor: pointer;';
			return '<div class="player-card" data-action="change-week" data-week-id="' + escapeHtml(w.id) + '" style="' + styleAttr + '">' +
				'<div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">' +
				'<div style="font-weight: 700; font-size: 1rem;">📅 ' + escapeHtml(w.date) + '</div>' +
				(isCur ? '<span style="color: var(--primary-color); font-weight: bold;">Current ✓</span>' : '') +
				'</div></div>';
		}).join('');
		return '<div class="modal-overlay" data-overlay="week-picker">' +
			'<div class="modal-content">' +
			'<div class="card-title"><span>เลือกวันที่</span>' +
			'<span style="cursor: pointer; font-size: 1.5rem; line-height: 1;" data-action="close-week-picker">×</span></div>' +
			'<div style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 60vh; overflow-y: auto;">' + rows + '</div>' +
			'</div></div>';
	}

	function renderPasswordModal(username, msg, isError, loading, formState) {
		var alertHtml = '';
		if (msg) {
			var bg = isError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';
			var color = isError ? 'var(--danger-color)' : 'var(--secondary-color)';
			var border = isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)';
			alertHtml = '<div style="padding:0.6rem 0.8rem;border-radius:0.5rem;margin-bottom:1rem;font-size:0.85rem;font-weight:600;background:' +
				bg + ';color:' + color + ';border:1px solid ' + border + ';">' +
				(isError ? '⚠️ ' : '✓ ') + escapeHtml(msg) + '</div>';
		}
		var fs = formState || {};
		return '<div class="modal-overlay" data-overlay="password-modal">' +
			'<div class="modal-content" style="max-width: 420px; padding: 1.5rem;">' +
			'<div class="card-title" style="margin-bottom: 1.25rem;">' +
			'<span>🔑 เปลี่ยนรหัสผ่าน (' + escapeHtml(username || '') + ')</span>' +
			'<span style="cursor: pointer; font-size: 1.5rem; line-height: 1;" data-action="close-password-modal">×</span>' +
			'</div>' +
			'<form id="changePasswordForm">' +
			'<div style="margin-bottom: 1rem;">' +
			'<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.35rem;color:var(--text-main);">รหัสผ่านปัจจุบัน</label>' +
			'<input type="password" id="pwdCurrentInput" class="login-input" required placeholder="กรอกรหัสผ่านเดิม" autocomplete="current-password" value="' + escapeHtml(fs.current_password || '') + '">' +
			'</div>' +
			'<div style="margin-bottom: 1rem;">' +
			'<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.35rem;color:var(--text-main);">รหัสผ่านใหม่</label>' +
			'<input type="password" id="pwdNewInput" class="login-input" required placeholder="อย่างน้อย 4 ตัวอักษร" autocomplete="new-password" value="' + escapeHtml(fs.new_password || '') + '">' +
			'</div>' +
			'<div style="margin-bottom: 1.25rem;">' +
			'<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.35rem;color:var(--text-main);">ยืนยันรหัสผ่านใหม่</label>' +
			'<input type="password" id="pwdConfirmInput" class="login-input" required placeholder="กรอกรหัสผ่านใหม่อีกครั้ง" autocomplete="new-password" value="' + escapeHtml(fs.confirm_password || '') + '">' +
			'</div>' +
			alertHtml +
			'<div style="display:flex;gap:0.75rem;justify-content:flex-end;align-items:center;">' +
			'<button type="button" class="btn-logout" data-action="close-password-modal">ยกเลิก</button>' +
			'<button type="submit" class="login-button" style="width:auto;padding:0.5rem 1.25rem;font-size:0.9rem;"' + (loading ? ' disabled' : '') + '>' +
			(loading ? '⏳ กำลังบันทึก...' : '💾 บันทึก') +
			'</button></div></form></div></div>';
	}

	// Global capture fallback for broken/expired avatar <img> elements
	if (typeof document !== 'undefined' && document.addEventListener) {
		document.addEventListener('error', function (e) {
			var target = e && e.target;
			if (!target || target.tagName !== 'IMG') return;
			if (target.dataset && target.dataset.avatarFallbackDone) return;
			if (target.dataset) target.dataset.avatarFallbackDone = '1';
			var alt = (target.getAttribute && target.getAttribute('alt')) || '?';
			var initial = String(alt).trim().charAt(0).toUpperCase() || '?';
			if (target.parentNode && target.closest &&
				target.closest('.toast-avatar, .spotlight-avatar, .player-card-avatar, .loan-player-avatar, .pitch-player-avatar-circle, .pitch-circle-avatar, .pitch-player-avatar, .unassigned-avatar')) {
				target.style.display = 'none';
				if (!target.parentNode.querySelector('.avatar-char')) {
					var span = document.createElement('span');
					span.className = 'avatar-char';
					span.textContent = initial;
					target.parentNode.appendChild(span);
				}
			}
		}, true);
	}

	global.ui = {
		escapeHtml: escapeHtml,
		getContrastColor: getContrastColor,
		getBorderColor: getBorderColor,
		getTeamColorByName: getTeamColorByName,
		initTheme: initTheme,
		reloadApp: reloadApp,
		logout: logout,
		renderWeekPickerModal: renderWeekPickerModal,
		renderPasswordModal: renderPasswordModal
	};
})(window);

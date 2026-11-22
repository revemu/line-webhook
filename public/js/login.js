/* Login page controller (Vanilla JS) */
(function () {
	'use strict';

	var versionBadge = document.getElementById('appVersionBadge');
	if (versionBadge) {
		versionBadge.textContent = 'v' + (window.__APP_VERSION__ || '0.7');
	}

	window.ui.initTheme('themeToggle', 'themeIcon');

	var urlParams = new URLSearchParams(window.location.search);
	var redirect = urlParams.get('redirect');

	window.http.get('/webhook/auth/me')
		.then(function (res) {
			var data = res.data;
			if (data && data.authenticated) {
				if (redirect && redirect.indexOf('/webhook/') === 0) {
					if (redirect.indexOf('position') !== -1 && data.user && data.user.role !== 'root') {
						window.location.href = '/webhook/match';
					} else {
						window.location.href = redirect;
					}
				} else {
					window.location.href = (data.user && data.user.role === 'root') ? '/webhook/position' : '/webhook/match';
				}
			}
		})
		.catch(function () {});

	var form = document.getElementById('loginForm');
	var usernameEl = document.getElementById('username');
	var passwordEl = document.getElementById('password');
	var submitBtn = document.getElementById('submitBtn');
	var errorBox = document.getElementById('loginError');
	var errorText = document.getElementById('loginErrorText');

	function setError(msg) {
		if (!errorBox || !errorText) return;
		if (msg) {
			errorText.textContent = msg;
			errorBox.style.display = '';
		} else {
			errorText.textContent = '';
			errorBox.style.display = 'none';
		}
	}

	function setLoading(isLoading) {
		if (!submitBtn) return;
		submitBtn.disabled = isLoading;
		submitBtn.textContent = isLoading ? '⏳ กำลังเข้าสู่ระบบ...' : '🔐 เข้าสู่ระบบ';
	}

	if (form) {
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			setError('');
			setLoading(true);

			window.http.post('/webhook/login', {
				username: usernameEl ? usernameEl.value : '',
				password: passwordEl ? passwordEl.value : '',
				redirect: redirect
			})
				.then(function (res) {
					setLoading(false);
					if (res.data && res.data.success) {
						window.location.href = res.data.redirect || '/webhook/match';
					} else {
						setError((res.data && res.data.error) || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
					}
				})
				.catch(function (err) {
					setLoading(false);
					if (err.response && err.response.data && err.response.data.error) {
						setError(err.response.data.error);
					} else {
						setError('เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง');
					}
				});
		});
	}
})();

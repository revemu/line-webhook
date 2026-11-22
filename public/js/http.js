/* Zero-dependency native fetch HTTP helper */
(function (global) {
	'use strict';

	var DEFAULT_TIMEOUT = 10000;
	var DEFAULT_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };
	var responseHooks = [];

	function parseBody(res) {
		var ct = (res.headers.get('content-type') || '').toLowerCase();
		return res.text().then(function (text) {
			if (!text) return null;
			if (ct.indexOf('application/json') !== -1 || text.charAt(0) === '{' || text.charAt(0) === '[') {
				try {
					return JSON.parse(text);
				} catch (_) {
					return text;
				}
			}
			return text;
		});
	}

	function send(method, url, data, config) {
		var cfg = config || {};
		var headers = Object.assign({}, DEFAULT_HEADERS, cfg.headers || {});
		var timeoutMs = typeof cfg.timeout === 'number' ? cfg.timeout : DEFAULT_TIMEOUT;
		var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
		var timerId = null;

		if (controller && timeoutMs > 0) {
			timerId = setTimeout(function () {
				controller.abort();
			}, timeoutMs);
		}

		var fetchOpts = {
			method: method,
			headers: headers,
			credentials: 'same-origin',
			signal: controller ? controller.signal : undefined
		};

		if (data !== undefined && data !== null && method !== 'GET' && method !== 'HEAD') {
			if (typeof FormData !== 'undefined' && data instanceof FormData) {
				fetchOpts.body = data;
			} else if (typeof data === 'string') {
				if (!headers['Content-Type'] && !headers['content-type']) {
					headers['Content-Type'] = 'application/x-www-form-urlencoded';
				}
				fetchOpts.body = data;
			} else {
				if (!headers['Content-Type'] && !headers['content-type']) {
					headers['Content-Type'] = 'application/json';
				}
				fetchOpts.body = JSON.stringify(data);
			}
		}

		var promise = fetch(url, fetchOpts).then(
			function (res) {
				if (timerId) clearTimeout(timerId);
				return parseBody(res).then(function (parsed) {
					var responseObj = {
						data: parsed,
						status: res.status,
						statusText: res.statusText,
						headers: res.headers
					};
					if (!res.ok) {
						var err = new Error('Request failed with status code ' + res.status);
						err.response = responseObj;
						return Promise.reject(err);
					}
					return responseObj;
				});
			},
			function (networkErr) {
				if (timerId) clearTimeout(timerId);
				if (networkErr && networkErr.name === 'AbortError') {
					var tErr = new Error('Request timeout');
					tErr.code = 'ECONNABORTED';
					return Promise.reject(tErr);
				}
				return Promise.reject(networkErr);
			}
		);

		for (var i = 0; i < responseHooks.length; i++) {
			promise = promise.then(responseHooks[i].onOk || undefined, responseHooks[i].onErr || undefined);
		}
		return promise;
	}

	global.http = {
		get: function (url, config) {
			return send('GET', url, null, config);
		},
		post: function (url, data, config) {
			return send('POST', url, data, config);
		},
		onResponse: function (onOk, onErr) {
			responseHooks.push({ onOk: onOk, onErr: onErr });
		}
	};
})(window);

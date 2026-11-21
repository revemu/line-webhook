/* Lightweight fetch-based HTTP client replacing external axios CDN */
(function (global) {
	'use strict';

	var responseInterceptors = [];

	var axiosShim = {
		defaults: {
			headers: {
				common: {
					'X-Requested-With': 'XMLHttpRequest'
				}
			},
			timeout: 10000
		},
		interceptors: {
			response: {
				use: function (onFulfilled, onRejected) {
					responseInterceptors.push([onFulfilled, onRejected]);
					return responseInterceptors.length - 1;
				}
			}
		}
	};

	function runResponsePipeline(promise) {
		for (var i = 0; i < responseInterceptors.length; i++) {
			var pair = responseInterceptors[i];
			promise = promise.then(pair[0] || undefined, pair[1] || undefined);
		}
		return promise;
	}

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
		var headers = Object.assign({}, axiosShim.defaults.headers.common, cfg.headers || {});
		var timeoutMs = typeof cfg.timeout === 'number' ? cfg.timeout : axiosShim.defaults.timeout;
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

		var corePromise = fetch(url, fetchOpts).then(
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
				return Promise.reject(networkErr);
			}
		);

		return runResponsePipeline(corePromise);
	}

	axiosShim.get = function (url, config) {
		return send('GET', url, null, config);
	};
	axiosShim.post = function (url, data, config) {
		return send('POST', url, data, config);
	};
	axiosShim.request = function (config) {
		var cfg = config || {};
		return send((cfg.method || 'GET').toUpperCase(), cfg.url, cfg.data, cfg);
	};

	global.axios = axiosShim;
})(window);

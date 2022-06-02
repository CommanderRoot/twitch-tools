"use strict";

function escapeHtml(string) {
	const entityMap = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
		'/': '&#x2F;'
	};

	return String(string).replace(/[&<>"'\/]/g, function (s) {
		return entityMap[s];
	});
}

function htmlEncode(value) {
	return $("<div/>").text(value).html();
}

function htmlDecode(value) {
	return $("<div/>").html(value).text();
}

function getQueryVariable(query, variable) {
	const vars = query.split('&');
	for(let i = 0; i < vars.length; i++) {
		const pair = vars[i].split('=');
		if(decodeURIComponent(pair[0]) == variable) {
			return decodeURIComponent(pair[1]);
		}
	}
}

$(function() {
	if(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches === true && document.cookie.indexOf('dark_mode=') === -1) {
		// Set darkmode based on the system setting as no manual cookie is set
		let style = document.createElement('link');
		style.rel = 'stylesheet';
		style.href = 'css/darkmode.css';
		let head = document.getElementsByTagName('head')[0];
		if(head) head.appendChild(style);
	}
});

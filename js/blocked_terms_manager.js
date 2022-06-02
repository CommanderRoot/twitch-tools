"use strict";

const TWITCH_CLIENT_ID = '7bflllvu3ezaohze0rnhyoo3j4oqe0';
const TWITCH_REDIRECT_URL = 'https://commanderroot.github.io/twitch-tools/blocked_terms_manager.html?u9AoBNDflUbXnUiXztCmyER7RC6MmLBrpBYnG3DLvR2qRz2edZGpn05NVaOpWMCSN9lLbmqa5sxbW6vFhvoF3rKEJHjbesLG7fDXrpGM4nfVY9rUXrKSQF0CiY95aoSb=5PYRwWWAH2kZS2LchrNnUX6KjCfg7wQlQNVq08cgVM0kPZpbJUE1fwkLzSWsHEXHA0sRNA5d8CjOA69iVuRi8ebn6I01qqnrGg4h2Z4pCNES3AxOmxN4gCXHLFfPGnbH';
var localUser = {};
var broadcasterUser = {};
var localUserToken = '';
var blockedTermsList = [];
var alreadyRemovedMap = {};

var toRemoveList = [];
var toRemoveListCounter = 0;
var toRemoveTimer = null;
var toRemoveLastEvent = 0;

var toAddList = [];
var toAddTimer = null;
var toAddLastEvent = 0;

var filteredResultCounterMax = 25000;
var rateLimitRateMs = 100; // 60 sec / 800 requests = 0.075
var stopLoading = false;


function getLocalUser(token) {
	$.ajax({
		url: 'https://id.twitch.tv/oauth2/validate',
		type: 'GET',
		timeout: 30000,
		cache: false,
		headers: {
			'Authorization': 'OAuth ' + token,
		},
		success: function(result, textStatus, jqXHR) {
			if(typeof result['user_id'] !== 'undefined' && typeof result['login'] !== 'undefined') {
				localUser['_id'] = result['user_id'];
				localUser['login'] = result['login'];
				broadcasterUser = localUser;
				$('#status').html('<div class="alert alert-info" role="alert">Loading blocked terms ... <span id="blocks-loading-status"></span> (<a href="#" id="abort-loading-button">abort</a>)</div>');
				localUserToken = token;
				getBlockedTermsFromAPIHelix();

				// Bind abort button
				$('#abort-loading-button').on('click', function(e) {
					e.preventDefault();
					stopLoading = true;
				});

				$('#info-list').append('<li>If you want to let someone else do it for you, you can send them this <a id="share-access-link" href="blocked_terms_manager.html#access_token=' + escapeHtml(token) + '" target="_blank" rel="noopener" data-toggle="tooltip" data-placement="top" title="Copied to clipboard">link</a>.</li>');
				$('#share-access-link').tooltip('disable');

				$('#share-access-link').on('click', function(e) {
					e.preventDefault();
					navigator.clipboard.writeText('https://commanderroot.github.io/twitch-tools/blocked_terms_manager.html#access_token=' + escapeHtml(token)).then(function() {
						// clipboard successfully set
						$('#share-access-link').tooltip('enable');
						$('#share-access-link').tooltip('show');
						setTimeout(function(){
							$('#share-access-link').tooltip('hide');
							$('#share-access-link').tooltip('disable');
						}, 2000);
					}, function() {
						// clipboard write failed
					});
				});
			} else {
				$('#status').html('<div class="alert alert-warning" role="alert">Error while verifying login, please try again. (' + JSON.stringify(result) +')</div>');
				showTwitchLogin();
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while verifying login, please try again. (' + escapeHtml(err) +')</div>');
			showTwitchLogin();
		},
	});
}

function getBroadcasterUser(username) {
	$.ajax({
		url: 'https://api.twitch.tv/helix/users?login=' + encodeURIComponent(username),
		type: 'GET',
		timeout: 30000,
		cache: false,
		headers: {
			'Client-ID': TWITCH_CLIENT_ID,
			'Authorization': 'Bearer ' + localUserToken,
		},
		success: function(result, textStatus, jqXHR) {
			if(typeof result['data'] !== 'undefined' && typeof result['data'][0] !== 'undefined' && typeof result['data'][0]['id'] !== 'undefined' && typeof result['data'][0]['login'] !== 'undefined') {
				broadcasterUser = {
					'_id': result['data'][0]['id'],
					'login': result['data'][0]['login'],
				};
				$('#status').html('<div class="alert alert-info" role="alert">Loading blocked terms ... <span id="blocks-loading-status"></span> (<a href="#" id="abort-loading-button">abort</a>)</div>');
				stopLoading = false;
				getBlockedTermsFromAPIHelix();

				// Bind abort button
				$('#abort-loading-button').on('click', function(e) {
					e.preventDefault();
					stopLoading = true;
				});

			} else {
				$('#status').html('<div class="alert alert-warning" role="alert">No channel found with this name, please try again. (' + JSON.stringify(result) +')</div>');
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while fetching channel, please try again. (' + escapeHtml(err) +')</div>');
		},
		complete: function(jqXHR, textStatus) {
			$('#switch-account-button').removeAttr('disabled');
			$('#switch-account-username').removeAttr('readonly');
		},
	});
}

function getBlockedTermsFromAPIHelix(cursor) {
	var cursor = typeof cursor !== 'undefined' ? cursor : '';

	// Make sure the local blockedTermsList is empty when we start a new scan
	if(cursor == '') {
		blockedTermsList = [];
		alreadyRemovedMap = {};
	}

	$.ajax({
		url: 'https://api.twitch.tv/helix/moderation/blocked_terms?broadcaster_id=' + encodeURIComponent(broadcasterUser['_id']) + '&moderator_id=' + encodeURIComponent(localUser['_id']) + '&first=100' + (cursor != '' ? ('&after=' + encodeURIComponent(cursor)) : ''),
		type: 'GET',
		timeout: 30000,
		cache: false,
		headers: {
			'Client-ID': TWITCH_CLIENT_ID,
			'Authorization': 'Bearer ' + localUserToken,
		},
		success: function(result, textStatus, jqXHR) {
			if(typeof result['data'] !== 'undefined') {
				// Add blocked terms to local cache
				$(result['data']).each(function(i, e) {
					const blockedTerm = {
						ID: e.id,
						broadcasterID: e.broadcaster_id,
						moderatorID: e.moderator_id,
						term: e.text,
						createdAt: Date.parse(e.created_at),
						updatedAt: Date.parse(e.updated_at),
						expiresAt: e.expires_at !== null ? Date.parse(e.expires_at) : -1,
					};

					blockedTermsList.push(blockedTerm);
				});

				// Display current status
				if($('#blocks-loading-status').length == 0) {
					$('#status').html('<div class="alert alert-info" role="alert">Loading blocked terms ... <span id="blocks-loading-status">' + escapeHtml(new Intl.NumberFormat().format(blockedTermsList.length)) + '</span> (<a href="#" id="abort-loading-button">abort</a>)</div>');

					// Bind abort button
					$('#abort-loading-button').on('click', function(e) {
						e.preventDefault();
						stopLoading = true;
					});
				} else {
					$('#blocks-loading-status').text(new Intl.NumberFormat().format(blockedTermsList.length));
				}

				if(typeof result['pagination'] !== 'undefined' && typeof result['pagination']['cursor'] !== 'undefined' && result['pagination']['cursor'].length > 0 && stopLoading === false) {
					getBlockedTermsFromAPIHelix(result['pagination']['cursor']);
				} else {
					$('#status').html('<div class="alert alert-success" role="alert">Loading of ' + escapeHtml(new Intl.NumberFormat().format(blockedTermsList.length)) + ' blocked terms done!</div>');
					renderBlockedTermsList();
					renderBlockedTermsListFilter();
					$('#status').empty();
				}
			} else {
				$('#status').html('<div class="alert alert-warning" role="alert">Error while getting blocked terms, please try again. (' + JSON.stringify(result) +')</div>');
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			// Check for rate limit
			if(jqXHR.status == 429) {
				setTimeout(getBlockedTermsFromAPIHelix, 500, cursor);
				return;
			} else if(jqXHR.status == 500) {
				// 500 server error
				$('#status').html('<div class="alert alert-warning" role="alert">Server error (500) while getting blocked terms, retrying ...</div>');
				setTimeout(getBlockedTermsFromAPIHelix, 500, cursor);
				return;
			} else if(jqXHR.status == 0) {
				// Timeout
				$('#status').html('<div class="alert alert-warning" role="alert">Timeout while getting blocked terms, retrying ...</div>');
				setTimeout(getBlockedTermsFromAPIHelix, 500, cursor);
				return;
			}

			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while getting blocked terms, please try again. (' + escapeHtml(err) +')</div>');
		},
	});
}

function addTermToBlockedTermsListHelix(term) {
	$('#status').html('<div class="alert alert-info" role="alert">Adding terms to blocked terms list ... ' + escapeHtml(new Intl.NumberFormat().format(toAddList.length)) + ' left</div>');
	
	if(term.length < 2) return;
	if(term.length > 500) term.slice(0, 500);

	const formData = {
		'text': term,
	};

	$.ajax({
		url: 'https://api.twitch.tv/helix/moderation/blocked_terms?broadcaster_id=' + encodeURIComponent(broadcasterUser['_id']) + '&moderator_id=' + encodeURIComponent(localUser['_id']),
		type: 'POST',
		headers: {
			'Client-ID': TWITCH_CLIENT_ID,
			'Authorization': 'Bearer ' + localUserToken,
		},
		data: JSON.stringify(formData),
		contentType: 'application/json; charset=utf-8',
		dataType: 'json',
		success: function(result, textStatus, jqXHR) {
			if(jqXHR.status == 200) {
				// All good!
			} else {
				$('#status').append('<div class="alert alert-warning" role="alert">Error while trying to add blocked term (' + jqXHR.status + ', ' + JSON.stringify(result) +')</div>');
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			// Check for rate limit
			if(jqXHR.status == 429) {
				clearInterval(toAddTimer);
				toAddList.unshift(term);

				let rateLimitRateActualMs = rateLimitRateMs + 25;
				toAddTimer = setInterval(addListWorker, rateLimitRateActualMs);
				return;
			} else if(jqXHR.status == 500) {
				// Happens on Twitch overloads
				toAddList.unshift(term);
				return;
			}

			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').append('<div class="alert alert-warning" role="alert">Error while trying to add blocked term. (' + escapeHtml(err) +')</div>');
		},
	});
}

function removeTermFromBlockedTermsListHelix(termID, removeEntryFromPage) {
	var removeEntryFromPage = typeof removeEntryFromPage !== 'undefined' ? removeEntryFromPage : true;

	$.ajax({
		url: 'https://api.twitch.tv/helix/moderation/blocked_terms?broadcaster_id=' + encodeURIComponent(broadcasterUser['_id']) + '&moderator_id=' + encodeURIComponent(localUser['_id']) + '&id=' + encodeURIComponent(termID),
		type: 'DELETE',
		headers: {
			'Client-ID': TWITCH_CLIENT_ID,
			'Authorization': 'Bearer ' + localUserToken,
		},
		success: function(result, textStatus, jqXHR) {
			if(removeEntryFromPage === true) {
				$('.card[data-id="' + termID + '"]').remove();
			} else {
				$('.card[data-id="' + termID + '"]').attr('data-removed', 'yes');
			}

			alreadyRemovedMap[termID] = true;
		},
		error: function(jqXHR, textStatus, errorThrown) {
			// Check for rate limit
			if(jqXHR.status == 429) {
				setTimeout(removeTermFromBlockedTermsListHelix, 500, termID, removeEntryFromPage);
				return;
			} else if(jqXHR.status == 500) {
				// Happens on Twitch overloads
				setTimeout(removeTermFromBlockedTermsListHelix, 500, termID, removeEntryFromPage);
				return;
			}

			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').append('<div class="alert alert-warning" role="alert">Error while trying to remove blocked term. (' + escapeHtml(err) +')</div>');
		},
	});
}

function dateTimeString(unixtime) {
	const currentDate = new Date(unixtime);
	return currentDate.getFullYear() + '-' + (((currentDate.getMonth()+1) < 10) ? '0' : '') + (currentDate.getMonth()+1) + '-' + ((currentDate.getDate() < 10) ? '0' : '') + currentDate.getDate() + ' ' + ((currentDate.getHours() < 10) ? '0' : '') + currentDate.getHours() + ':' + ((currentDate.getMinutes() < 10) ? '0' : '') + currentDate.getMinutes() + ':' + ((currentDate.getSeconds() < 10) ? '0' : '') + currentDate.getSeconds();
}

function renderBlockedTermsList(filter) {
	var filter = typeof filter !== 'undefined' ? filter : {};
	let filteredResultCounter = 0;

	if(blockedTermsList.length == 0) {
		let html = '<div class="row my-4" id="results"><p class="pl-4">No blocked terms found.</p></div>';
		if($('#results').length > 0) {
			$('#results').remove();
			$('#content').append(html);
		} else {
			$('#content').html(html);
		}
		$('#remove-all-visible-button').removeAttr('disabled');
		$('#remove-all-button').removeAttr('disabled');
		$('#filter-button').removeAttr('disabled');
		return;
	}

	const dateNow = Date.now();
	const dateNowMoment = moment(dateNow);
	let html = '<div class="row my-4" id="results">';
	$(blockedTermsList).each(function(i, e) {
		// Already removed
		if(typeof alreadyRemovedMap[e.ID] === 'boolean' && alreadyRemovedMap[e.ID] === true) {
			return;
		}

		// Filter
		if(typeof filter['termRegexp'] !== 'undefined' && e.term.match(filter['termRegexp']) === null) {
			return;
		} else if(typeof filter['createdAtMin'] !== 'undefined' && e.createdAt < filter['createdAtMin']) {
			return;
		} else if(typeof filter['createdAtMax'] !== 'undefined' && e.createdAt > filter['createdAtMax']) {
			return;
		}

		html += '<div class="card blocked-user" data-id="' + escapeHtml(e.ID) + '">';
			html += '<div class="card-block">';
				html += '<p class="card-text mx-1">';
					html += '<span class="float-right"></span>';
					html += '<span><b>Term:</b> ' + escapeHtml(e.term) + '<br></span>';
					html += '<span><b>Created at:</b> ' + dateTimeString(e.createdAt) + '<br></span>';
					html += '<span><b>Expires in:</b> ';
					if(e.expiresAt == -1) {
						html += '<em>Never</em>';
					} else {
						const duration = moment.duration(moment(e.expiresAt).diff(dateNowMoment));
						html += escapeHtml(new Intl.NumberFormat().format(Math.ceil(duration.asMinutes()))) + ' minutes';
					}
					html += '<br></span>';
				html += '</p>';
			html += '</div>';
		html += '</div>';

		filteredResultCounter++;
		if(filteredResultCounter >= filteredResultCounterMax) {
			return false;
		}
	});
	html += '</div>';

	if(filteredResultCounter >= filteredResultCounterMax) {
		html = '<div class="row my-4" id="results"><p class="pl-4">Too many blocked terms (over ' + escapeHtml(new Intl.NumberFormat().format(filteredResultCounterMax)) + ') to display (it would break your Browser). Please use the filter option above.</p></div>';
	} else if(filteredResultCounter === 0) {
		html = '<div class="row my-4" id="results"><p class="pl-4">No blocked terms found using this filter.</p></div>';
	}

	if($('#results').length > 0) {
		$('#results').remove();
		$('#content').append(html);
	} else {
		$('#content').html(html);
	}

	// Add dropdown (for whatever reason it doesn't work if it's included above ...)
	$('.card-text').find('.float-right').prepend('<button type="button" class="btn btn-danger btn-sm remove-button" title="Remove blocked term">X</button>');

	$('.remove-button').on('click', function(e) {
		e.preventDefault();
		removeTermFromBlockedTermsListHelix($(this).parents('.card').data('id'), true);
	});

	$('#remove-all-visible-button').removeAttr('disabled');
	$('#remove-all-button').removeAttr('disabled');
	$('#filter-button').removeAttr('disabled');
}

function renderBlockedTermsListFilter() {
	// Make sure to not add it if we already have it
	if($('#filter').length > 0) return;

	let html = '<div class="row pl-4">';
		html += '<div id="switch-user-area" class="mb-5">';
			html += '<h4>Switch target channel</h4>';
			html += '<input type="text" class="filter-input" id="switch-account-username" name="switch-account-username" size="30" value="' + escapeHtml(broadcasterUser['login']) + '" autocomplete="off">';
			html += '<div class="pt-2">';
				html += '<button type="button" class="btn btn-primary btn-sm" id="switch-account-button">Switch account</button>';
			html += '</div>';
		html += '</div>';
	html += '</div>';
	html += '<div class="row pl-4">';
		html += '<div id="add-terms-area" class="mb-4 hidden">';
			html += '<h4>Add list of terms to blocklist</h4>';
			html += '<textarea id="terms-add-blocklist-textarea" cols="70" rows="10" placeholder="One term per line" autocomplete="off" spellcheck="false" translate="no"></textarea>';
			html += '<div class="pt-2">';
				html += '<button type="button" class="btn btn-primary btn-sm" id="add-terms-button">Add terms to blocklist</button>';
			html += '</div>';
		html += '</div>';
	html += '</div>';
	html += '<div class="row pl-4">';
		html += '<div id="filter">';
			html += '<h3>Filter results</h3>';
			html += '<div><b>Term</b> (RegExp): <input type="text" class="filter-input" id="filter-term-regexp" name="term-regexp" placeholder="^bot[0-9]+$" size="30" value="" autocomplete="off"></div>';
			html += '<div><b>Created at</b> between <input type="text" class="filter-input filter-datetimepicker" id="filter-createdAt-min" name="createdAt-min" value="" autocomplete="off"> and <input type="text" class="filter-input filter-datetimepicker" id="filter-createdAt-max" name="createdAt-max" value="" autocomplete="off"></div>';
			html += '<div class="pt-2">';
				html += '<button type="button" class="btn btn-primary btn-sm" id="filter-button">Apply filter</button> | ';
				html += '<button type="button" class="btn btn-success btn-sm" id="show-add-terms-button">Add new terms</button> | ';
				html += '<div class="btn-group" role="group"><button type="button" class="btn btn-danger btn-sm" id="remove-all-visible-button">Remove all blocked terms listed below</button> <button type="button" class="btn btn-danger btn-sm" id="remove-all-button">Remove all your blocked terms</button></div> | ';
				html += '<div class="btn-group" role="group"><button type="button" class="btn btn-info btn-sm" id="export-button">Export all as CSV</button> <button type="button" class="btn btn-info btn-sm" id="export-filtered-button">Export filtered as CSV</button></div>';
			html += '</div>';
		html += '</div>';
	html += '</div>';

	$('#content').prepend(html);

	$('#filter-button').on('click', function(e) {
		e.preventDefault();
		filterBlockedTermsList();
	});

	$('#show-add-terms-button').on('click', function(e) {
		e.preventDefault();
		if($('#add-terms-area').hasClass('hidden')) {
			$('#add-terms-area').removeClass('hidden');
		} else {
			$('#add-terms-area').addClass('hidden');
		}
	});

	$('#remove-all-visible-button').on('click', function(e) {
		e.preventDefault();
		removeAllVisible();
	});

	$('#remove-all-button').on('click', function(e) {
		e.preventDefault();
		removeAll();
	});

	$('#add-terms-button').on('click', function(e) {
		e.preventDefault();
		$('#add-terms-button').attr('disabled', 'disabled');
		$('#show-add-terms-button').attr('disabled', 'disabled');
		parseAddBlockedTermsTextarea();
		$('#add-terms-area').addClass('hidden');
		$('#terms-add-blocklist-textarea').val('');
		$('#add-terms-button').removeAttr('disabled');
	});

	$('#export-button').on('click', function(e) {
		e.preventDefault();
		exportBlockedTermsListAsCSV();
	});

	$('#export-filtered-button').on('click', function(e) {
		e.preventDefault();
		exportFilteredBlockedTermsListAsCSV();
	});

	$('#switch-account-button').on('click', function(e) {
		e.preventDefault();
		$('#switch-account-button').attr('disabled', 'disabled');
		$('#switch-account-username').attr('readonly', 'readonly');
		getBroadcasterUser($('#switch-account-username').val().trim());
	});

	$('.filter-datetimepicker').datetimepicker({
		todayButton: false,
		step: 15,
		defaultSelect: false,
		dayOfWeekStart: 1,
		yearStart: 2006,
		yearEnd: 2022,
		format: 'Y-m-d H:i:s',
		formatTime: 'H:i',
		formatDate: 'Y-m-d',
		closeOnDateSelect: true,
		validateOnBlur: false,
		allowBlank: true,
		timepickerScrollbar: false,
	});

	// DateTime validating
	$('.filter-datetimepicker').change(function() {
		checkDateTimeValid($(this).prop('id'));
	});
}

function checkDateTimeValid(id) {
	const val = $('#' + id).val().trim();
	if(val == '' || moment(val).isValid()) {
		$('#' + id).removeClass('is-invalid');
	} else {
		$('#' + id).addClass('is-invalid');
	}
	// Remove spaces at the start
	$('#' + id).val(val.replace(/^\s+/gi, ''));
}

function filterBlockedTermsList() {
	let filter = {};

	if($('#filter-term-regexp').val() != '') {
		filter['termRegexp'] = new RegExp($('#filter-term-regexp').val(), 'i');
	}
	if($('#filter-createdAt-min').val().trim() != '' && moment($('#filter-createdAt-min').val().trim()).isValid()) {
		filter['createdAtMin'] = moment($('#filter-createdAt-min').val().trim()).valueOf();
	}
	if($('#filter-createdAt-max').val().trim() != '' && moment($('#filter-createdAt-max').val().trim()).isValid()) {
		filter['createdAtMax'] = moment($('#filter-createdAt-max').val().trim()).valueOf();
	}

	$('#remove-all-visible-button').attr('disabled', 'disabled');
	$('#remove-all-button').attr('disabled', 'disabled');
	$('#filter-button').attr('disabled', 'disabled');
	setTimeout(renderBlockedTermsList, 50, filter);
}

function exportBlockedTermsListAsCSV() {
	const exportFilename = 'blockedTermsList_' + broadcasterUser['login'] + '__' + moment().format('YYYY-MM-DD_HH-mm-ss') + '.csv';
	let csv = 'term' + "\r\n";
	$(blockedTermsList).each(function(i, e) {
		// Already removed
		if(typeof alreadyRemovedMap[e.ID] === 'boolean' && alreadyRemovedMap[e.ID] === true) {
			return;
		}

		csv += e.term + "\r\n";
	});

	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
	if(navigator.msSaveBlob) { // IE 10+
		navigator.msSaveBlob(blob, exportFilename);
	} else {
		let link = document.createElement('a');
		if(link.download !== undefined) {
			// Browsers that support HTML5 download attribute
			let url = URL.createObjectURL(blob);
			link.setAttribute('href', url);
			link.setAttribute('download', exportFilename);
			link.style.visibility = 'hidden';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
		}
	}
}

function exportFilteredBlockedTermsListAsCSV() {
	const exportFilename = 'blockedTermsList__filtered_' + broadcasterUser['login'] + '__' + moment().format('YYYY-MM-DD_HH-mm-ss') + '.csv';
	let csv = 'term' + "\r\n";
	let termIDs = {};
	$('.blocked-user').each(function(i, e) {
		// Already removed
		if(typeof alreadyRemovedMap[$(e).data('id')] === 'boolean' && alreadyRemovedMap[$(e).data('id')] === true) {
			return;
		}

		termIDs[$(e).data('id')] = true;
	});
	$(blockedTermsList).each(function(i, e) {
		if(termIDs[e.ID] === true) {
			csv += e.term + "\r\n";
		}
	});

	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
	if(navigator.msSaveBlob) { // IE 10+
		navigator.msSaveBlob(blob, exportFilename);
	} else {
		let link = document.createElement('a');
		if(link.download !== undefined) {
			// Browsers that support HTML5 download attribute
			let url = URL.createObjectURL(blob);
			link.setAttribute('href', url);
			link.setAttribute('download', exportFilename);
			link.style.visibility = 'hidden';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
		}
	}
}

function removeAllVisible() {
	bootbox.confirm({
		message: 'This will remove all listed blocked terms (' + escapeHtml(new Intl.NumberFormat().format($('.card').length)) + ').<br>Are you sure you want to do that?',
		buttons: {
			confirm: {
				label: 'Yes',
				className: 'btn-danger',
			},
			cancel: {
				label: 'No',
				className: 'btn-light',
			},
		},
		callback: function(result) {
			if(result === true) {
				$('#filter-button').attr('disabled', 'disabled');
				$('#remove-all-visible-button').attr('disabled', 'disabled');
				$('#remove-all-button').attr('disabled', 'disabled');

				$('#status').html('<div class="alert alert-info" role="alert">Removing ' + escapeHtml(new Intl.NumberFormat().format($('.card').length)) + ' blocked terms ... <span id="terms-to-remove-left">' + escapeHtml(new Intl.NumberFormat().format($('.card').length)) + '</span> left</div>');
				$('.card').each(function(i, e) {
					toRemoveList.push($(e).data('id'));
				});

				toRemoveTimer = setInterval(removeListWorker, rateLimitRateMs);

				// Play background audio (not hearable) to make browser act like a visible tab even if it's in the bg
				playAudio();
			}
		}
	});
}

function removeAll() {
	bootbox.confirm({
		message: 'This will remove all your blocked terms (' + escapeHtml(new Intl.NumberFormat().format(blockedTermsList.length)) + ').<br>Are you sure you want to do that?',
		buttons: {
			confirm: {
				label: 'Yes',
				className: 'btn-danger',
			},
			cancel: {
				label: 'No',
				className: 'btn-light',
			},
		},
		callback: function(result) {
			if(result === true) {
				$('#filter-button').attr('disabled', 'disabled');
				$('#remove-all-visible-button').attr('disabled', 'disabled');
				$('#remove-all-button').attr('disabled', 'disabled');

				$('#status').html('<div class="alert alert-info" role="alert">Removing ' + escapeHtml(new Intl.NumberFormat().format(blockedTermsList.length)) + ' blocked terms ... <span id="terms-to-remove-left">' + escapeHtml(new Intl.NumberFormat().format(blockedTermsList.length)) + '</span> left</div>');
				$(blockedTermsList).each(function(i, e) {
					toRemoveList.push(e.ID);
				});

				toRemoveTimer = setInterval(removeListWorker, rateLimitRateMs);

				// Play background audio (not hearable) to make browser act like a visible tab even if it's in the bg
				playAudio();
			}
		}
	});
}

function removeListWorker() {
	// Only allow 10 concurrent requests
	if($.active >= 10) {
		return;
	}

	if(toRemoveList.length == 0) {
		clearInterval(toRemoveTimer);
		$('#status').html('<div class="alert alert-success" role="alert">Removing of blocked terms done! Feel free to reload the page to check if that&#039;s indeed the case.</div>');
		$('#filter-button').removeAttr('disabled');
		$('#remove-all-visible-button').removeAttr('disabled');
		$('#remove-all-button').removeAttr('disabled');
		$('.card[data-removed="yes"]').remove();
		setTimeout(function(){ $('.card[data-removed="yes"]').remove(); }, 5000);
		return;
	}

	let doCount = 1;
	if(toRemoveLastEvent !== 0) {
		doCount = Math.floor((Date.now() - toRemoveLastEvent) / (rateLimitRateMs + 25));
	}
	// Limit to 100
	if(doCount > 100) {
		doCount = 100;
	} else if(doCount < 1) {
		doCount = 1;
	}

	for(let i = 0; i < doCount; i++) {
		const termID = toRemoveList.shift();
		if(typeof termID !== 'undefined') {
			removeTermFromBlockedTermsListHelix(termID, false);
			toRemoveLastEvent = Date.now();
			toRemoveListCounter++;
		} else {
			break;
		}
	}

	if($('#terms-to-remove-left').length > 0) {
		$('#terms-to-remove-left').text(new Intl.NumberFormat().format(toRemoveList.length));
	}
}

function parseAddBlockedTermsTextarea() {
	const lines = $('#terms-add-blocklist-textarea').val().split('\n');
	for(let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if(line.length < 2) {
			console.log('Invalid term (< 2): ' + lines[i]);
			continue;
		} else if(line.length > 500) {
			console.log('Invalid term (> 500): ' + lines[i]);
			continue;
		} 

		// Ignore first line of csv exports
		if(line === 'term') continue;

		toAddList.push(line);
	}

	toAddTimer = setInterval(addListWorker, rateLimitRateMs);

	// Play background audio (not hearable) to make browser act like a visible tab even if it's in the bg
	playAudio();
}

function addListWorker() {
	// Only allow 10 concurrent requests
	if($.active >= 10) {
		return;
	}

	if(toAddList.length == 0) {
		clearInterval(toAddTimer);
		$('#status').html('<div class="alert alert-success" role="alert">New blocked terms have been added! Feel free to reload the page to check if that&#039;s indeed the case.</div>');
		$('#show-add-terms-button').removeAttr('disabled');
		return;
	}

	let doCount = 1;
	if(toAddLastEvent !== 0) {
		doCount = Math.floor((Date.now() - toAddLastEvent) / (rateLimitRateMs + 25));
	}
	// Limit to 100
	if(doCount > 100) {
		doCount = 100;
	} else if(doCount < 1) {
		doCount = 1;
	}

	const startTime = Date.now();
	for(let i = 0; i < doCount; i++) {
		const term = toAddList.shift();
		if(typeof term !== 'undefined') {
			addTermToBlockedTermsListHelix(term);
			toAddLastEvent = Date.now();
		} else {
			break;
		}
	}

}

function playAudio() {
	let audio = document.getElementById('bg_audio');
	/*
	console.log('Paused: ' + audio.paused);
	console.log('Muted: ' + audio.muted);
	console.log('Position: ' + audio.currentTime);
	*/
	if(audio.paused === true || audio.muted === true) {
		audio.play();
		audio.muted = false;
		audio.volume = 0.25;
		audio.loop = true;
	}
}

function showTwitchLogin() {
	// Show login with Twitch button
	$('#content').html('<a class="btn btn-lg btn-primary btn-block" href="https://id.twitch.tv/oauth2/authorize?response_type=token&amp;client_id=' + encodeURIComponent(TWITCH_CLIENT_ID) + '&amp;redirect_uri=' + encodeURIComponent(TWITCH_REDIRECT_URL) + '&amp;scope=moderator:read:blocked_terms+moderator:manage:blocked_terms">Login via Twitch</a>');
}

$(function() {
	// Check if we have a token in the # part of the URL
	const access_token = getQueryVariable(window.location.hash.slice(1), 'access_token');
	if(typeof access_token !== 'undefined' && access_token.length > 0) {
		$('#status').html('<div class="alert alert-info" role="alert">Loading user information ...</div>');
		getLocalUser(access_token);
	} else {
		showTwitchLogin();
	}

	// Clear location.hash for security purposes (So a user doesn't copy the link and sends their token to another user)
	if(window.location.hash.length > 0) window.location.hash = '';
	if(window.location.search.length > 0) {
		// Update URL
		let url = new URL(window.location);
		url.search = '';
		window.history.pushState({}, '', url);
	}

	// Confirm close if work is running
	window.addEventListener('beforeunload', (event) => {
		if(toRemoveList.length > 0 || toAddList.length > 0) {
			event.returnValue = 'There is pending work. Closing the page will stop it, are you sure you want to leave?';
		}
	});
});

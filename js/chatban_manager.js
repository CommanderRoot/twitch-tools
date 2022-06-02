"use strict";

const TWITCH_CLIENT_ID = 'mxuj95o26axpduxvk7tpeq5picjfcfw';
const TWITCH_REDIRECT_URL = 'https://commanderroot.github.io/twitch-tools/chatban_manager.html?u9AoBNDflUbXnUiXztCmyER7RC6MmLBrpBYnG3DLvR2qRz2edZGpn05NVaOpWMCSN9lLbmqa5sxbW6vFhvoF3rKEJHjbesLG7fDXrpGM4nfVY9rUXrKSQF0CiY95aoSb=5PYRwWWAH2kZS2LchrNnUX6KjCfg7wQlQNVq08cgVM0kPZpbJUE1fwkLzSWsHEXHA0sRNA5d8CjOA69iVuRi8ebn6I01qqnrGg4h2Z4pCNES3AxOmxN4gCXHLFfPGnbH';
var localUser = {};
var localUserToken = '';

var bansList = [];
var bannedUserIDs = {};

var toRemoveList = [];
var toRemoveListCounter = 0;
var toRemoveTimer = null;
var toRemoveLastEvent = 0;
var removeAllWanted = false;

var alreadyRemovedMap = {};

var toResolveList = [];

var toAddList = [];
var toAddReason = '';
var toAddTimer = null;
var toAddLastEvent = 0;

var filteredResultCounterMax = 25000;
var rateLimitRateMs = 100; // 60 sec / 800 requests = 0.075
var stopLoading = false;
var pageCounter = 0;

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
				$('#status').html('<div class="alert alert-info" role="alert">Loading chat bans ... <span id="bans-loading-status"></span> (<a href="#" id="abort-loading-button">abort</a>)</div>');
				localUserToken = token;
				getBansFromAPIHelix();
				// getBansFromEventAPIHelix();

				// Bind abort button
				$('#abort-loading-button').on('click', function(e) {
					e.preventDefault();
					stopLoading = true;
				});

				$('#info-list').append('<li>If you want to let someone else do it for you, you can send them this <a id="share-access-link" href="chatban_manager.html#access_token=' + escapeHtml(token) + '" target="_blank" rel="noopener" data-toggle="tooltip" data-placement="top" title="Copied to clipboard">link</a>.</li>');
				$('#share-access-link').tooltip('disable');

				$('#share-access-link').on('click', function(e) {
					e.preventDefault();
					navigator.clipboard.writeText('https://commanderroot.github.io/twitch-tools/chatban_manager.html#access_token=' + escapeHtml(token)).then(function() {
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

function getBansFromAPIHelix(cursor) {
	var cursor = typeof cursor !== 'undefined' ? cursor : '';

	// Make sure the local bansList is empty when we start a new scan
	if(cursor == '') {
		bansList = [];
		bannedUserIDs = {};
		alreadyRemovedMap = {};
		stopLoading = false;
		pageCounter = 0;
	}

	$.ajax({
		url: 'https://api.twitch.tv/helix/moderation/banned?broadcaster_id=' + encodeURIComponent(localUser['_id']) + '&first=100' + (cursor !== '' ? ('&after=' + encodeURIComponent(cursor)) : ''),
		type: 'GET',
		timeout: 30000,
		cache: false,
		headers: {
			'Client-ID': TWITCH_CLIENT_ID,
			'Authorization': 'Bearer ' + localUserToken,
		},
		success: function(result, textStatus, jqXHR) {
			if(typeof result['data'] !== 'undefined') {
				pageCounter++;

				// Add bans to local cache
				$(result['data']).each(function(i, e) {
					// Skip empty usernames (can happen on suspended / deleted accounts) as we can't unban them anyway
					if(e.user_login.length == 0) return;

					let ban = {
						userID: e.user_id,
						userName: e.user_login,
						userDisplayName: e.user_name,
						expiresAt: -1,
						reason: e.reason,
						moderatorID: e.moderator_id,
						moderatorName: e.moderator_login,
						moderatorDisplayName: e.moderator_name,
					};

					// Parse expires_at
					if(e.expires_at.length > 0) {
						ban.expiresAt = Date.parse(e.expires_at);
					}

					bansList.push(ban);
					bannedUserIDs[e.user_id] = true;
				});

				// Display current status
				if($('#bans-loading-status').length == 0) {
					$('#status').html('<div class="alert alert-info" role="alert">Loading bans ... <span id="bans-loading-status">page ' + escapeHtml(new Intl.NumberFormat().format(pageCounter)) + ' -> ' + escapeHtml(new Intl.NumberFormat().format(bansList.length)) + '</span> (<a href="#" id="abort-loading-button">abort</a>)</div>');

					// Bind abort button
					$('#abort-loading-button').on('click', function(e) {
						e.preventDefault();
						stopLoading = true;
					});
				} else {
					$('#bans-loading-status').text('page ' + (new Intl.NumberFormat().format(pageCounter)) + ' -> ' + (new Intl.NumberFormat().format(bansList.length)));
				}

				if(typeof result['pagination'] !== 'undefined' && typeof result['pagination']['cursor'] !== 'undefined' && result['pagination']['cursor'].length > 0 && stopLoading === false) {
					getBansFromAPIHelix(result['pagination']['cursor']);
				} else {
					if(removeAllWanted === true) {
						if(bansList.length === 0) {
							removeAllWanted = false;
						}

						$('#status').html('<div class="alert alert-info" role="alert">Removing ' + escapeHtml(new Intl.NumberFormat().format(bansList.length)) + ' bans ... <span id="actions-to-do-left">' + escapeHtml(new Intl.NumberFormat().format(bansList.length)) + '</span> left</div>');
						$(bansList).each(function(i, e) {
							// Skip already removed
							if(typeof alreadyRemovedMap[e.userID] === 'boolean' && alreadyRemovedMap[e.userID] === true) {
								return;
							}

							toRemoveList.push(e.userID);
						});

						toRemoveTimer = setInterval(removeListWorker, rateLimitRateMs);
					} else {
						$('#status').html('<div class="alert alert-success" role="alert">Loading of ' + escapeHtml(new Intl.NumberFormat().format(bansList.length)) + ' bans done!</div>');
						renderBansList();
						renderBansListFilter();
						$('#status').empty();
					}
				}
			} else {
				$('#status').html('<div class="alert alert-warning" role="alert">Error while getting bans, please try again. (' + JSON.stringify(result) +')</div>');
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			// Check for rate limit
			if(jqXHR.status == 429) {
				setTimeout(getBansFromAPIHelix, 500, cursor);
				return;
			} else if(jqXHR.status == 0) {
				// Timeout
				$('#status').html('<div class="alert alert-warning" role="alert">Timeout while getting bans, retrying ...</div>');
				setTimeout(getBansFromAPIHelix, 500, cursor);
				return;
			}

			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while getting bans, please try again. (' + escapeHtml(err) +')</div>');
		},
	});
}

function dateTimeString(unixtime) {
	const currentDate = new Date(unixtime);
	return currentDate.getFullYear() + '-' + (((currentDate.getMonth()+1) < 10) ? '0' : '') + (currentDate.getMonth()+1) + '-' + ((currentDate.getDate() < 10) ? '0' : '') + currentDate.getDate() + ' ' + ((currentDate.getHours() < 10) ? '0' : '') + currentDate.getHours() + ':' + ((currentDate.getMinutes() < 10) ? '0' : '') + currentDate.getMinutes() + ':' + ((currentDate.getSeconds() < 10) ? '0' : '') + currentDate.getSeconds();
}

function renderBansList(filter) {
	var filter = typeof filter !== 'undefined' ? filter : {};
	let filteredResultCounter = 0;

	if(bansList.length == 0) {
		let html = '<div class="row my-4" id="results"><p class="pl-4">No bans found.</p></div>';
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
	$(bansList).each(function(i, e) {
		// Already removed
		if(typeof alreadyRemovedMap[e.userID] === 'boolean' && alreadyRemovedMap[e.userID] === true) {
			return;
		}

		// Filter
		if(typeof filter['usernameRegexp'] !== 'undefined' && e.userName.match(filter['usernameRegexp']) === null) {
			return;
		} else if(typeof filter['reasonRegexp'] !== 'undefined' && e.reason.match(filter['reasonRegexp']) === null) {
			return;
		} else if(typeof filter['durationMin'] !== 'undefined' && (e.expiresAt - dateNow) < (filter['durationMin'] * 60 * 1000)) {
			return;
		} else if(typeof filter['durationMax'] !== 'undefined' && (e.expiresAt - dateNow) > (filter['durationMax'] * 60 * 1000)) {
			return;
		} else if(typeof filter['bannedby'] !== 'undefined' && e.moderatorName != filter['bannedby']) {
			return;
		}

		html += '<div class="card blocked-user" data-userid="' + escapeHtml(e.userID) + '">';
			html += '<div class="card-block">';
				html += '<p class="card-text mx-1">';
					html += '<span class="float-right"></span>';
					html += '<span><b>Username:</b> <a href="https://www.twitch.tv/' + encodeURIComponent(e.userName) + '" target="_blank" rel="noopener">' + escapeHtml(e.userName) + '</a> (<a href="https://www.twitch.tv/popout/' + encodeURIComponent(localUser['login']) + '/viewercard/' + encodeURIComponent(e.userName) + '?popout=" target="_blank" rel="noopener">*</a>)<br></span>';
					html += '<span><b>Duration:</b> ';
					if(e.expiresAt == -1) {
						html += '<em>Indefinite</em>';
					} else {
						const duration = moment.duration(moment(e.expiresAt).diff(dateNowMoment));
						html += escapeHtml(new Intl.NumberFormat().format(Math.ceil(duration.asMinutes()))) + ' minutes';
					}
					html += '<br></span>';
					html += '<span><b>Reason:</b> ';
					if(e.reason.length === 0) {
						html += '<i>None</i>';
					} else {
						html += escapeHtml(e.reason);
					}
					html += '<br></span>';
					html += '<span><b>Banned by:</b> <a href="https://www.twitch.tv/' + encodeURIComponent(e.moderatorName) + '" target="_blank" rel="noopener">' + escapeHtml(e.moderatorName) + '</a><br></span>';
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
		html = '<div class="row my-4" id="results"><p class="pl-4">Too many bans (over ' + escapeHtml(new Intl.NumberFormat().format(filteredResultCounterMax)) + ') to display (it would break your Browser). Please use the filter option above.</p></div>';
	} else if(filteredResultCounter === 0) {
		html = '<div class="row my-4" id="results"><p class="pl-4">No bans found using this filter.</p></div>';
	}

	if($('#results').length > 0) {
		$('#results').remove();
		$('#content').append(html);
	} else {
		$('#content').html(html);
	}

	// Add dropdown (for whatever reason it doesn't work if it's included above ...)
	$('.card-text').find('.float-right').prepend('<button type="button" class="btn btn-danger btn-sm remove-button" title="Remove ban">X</button>');

	$('.remove-button').on('click', function(e) {
		e.preventDefault();
		removeUserFromBanslistHelix($(this).parents('.card').data('userid'));
		$(this).parents('.card').remove();
	});

	$('#remove-all-visible-button').removeAttr('disabled');
	$('#remove-all-button').removeAttr('disabled');
	$('#filter-button').removeAttr('disabled');
}

function renderBansListFilter() {
	// Make sure to not add it if we already have it
	if($('#filter').length > 0) return;

	let html = '<div class="row pl-4">';
		html += '<div id="add-bans-area" class="mb-4 hidden">';
			html += '<h4>Add list of users to banlist</h4>';
			html += '<textarea id="users-add-banlist-textarea" cols="50" rows="10" placeholder="One username per line" autocomplete="off" spellcheck="false" translate="no"></textarea>';
			html += '<div><b>Reason</b> (optional): <input type="text" id="users-add-banlist-reason" name="add-banlist-reason" placeholder="" size="30" value="" maxlength="500" autocomplete="off"></div>';
			html += '<div class="pt-2">';
				html += '<button type="button" class="btn btn-primary btn-sm" id="add-bans-button">Add users to banlist</button>';
			html += '</div>';
		html += '</div>';
		html += '<div id="remove-bans-area" class="mb-4 hidden">';
			html += '<h4>Remove list of users from banlist</h4>';
			html += '<textarea id="users-remove-banlist-textarea" cols="50" rows="10" placeholder="One username per line" autocomplete="off" spellcheck="false" translate="no"></textarea>';
			html += '<div class="pt-2">';
				html += '<button type="button" class="btn btn-primary btn-sm" id="remove-bans-button">Remove users from banlist</button>';
			html += '</div>';
		html += '</div>';
	html += '</div>';
	html += '<div class="row pl-4">';
		html += '<div id="filter">';
			html += '<h3>Filter results</h3>';
			html += '<div><b>Username</b> (RegExp): <input type="text" class="filter-input" id="filter-username-regexp" name="username-regexp" placeholder="^bot[0-9]+$" size="30" value="" autocomplete="off"></div>';
			html += '<div><b>Reason</b> (RegExp): <input type="text" class="filter-input" id="filter-reason-regexp" name="reason-regexp" placeholder="" size="30" value="" autocomplete="off"></div>';
			html += '<div><b>Banned by</b>: <input type="text" class="filter-input" id="filter-bannedby" name="bannedby" placeholder="" size="30" value="" autocomplete="off"></div>';
			html += '<div>Duration in <b>minutes</b> <abbr title="Use -1 as max for indefinite bans">*</abbr>: <input type="number" class="filter-input" id="filter-duration-min" name="duration-min" value="" min="-1" step="1" autocomplete="off"> to <input type="number" class="filter-input" id="filter-duration-max" name="duration-max" value="" min="-1" step="1" autocomplete="off"></div>';
			html += '<div class="pt-2">';
				html += '<button type="button" class="btn btn-primary btn-sm" id="filter-button">Apply filter</button> | ';
				html += '<div class="btn-group" role="group"><button type="button" class="btn btn-success btn-sm" id="show-add-bans-button">Add new bans</button><button type="button" class="btn btn-success btn-sm" id="show-remove-bans-button">Remove bans by list</button></div> | ';
				html += '<div class="btn-group" role="group"><button type="button" class="btn btn-danger btn-sm" id="remove-all-visible-button">Remove all bans listed below</button> <button type="button" class="btn btn-danger btn-sm" id="remove-all-button">Remove all your bans</button></div> | ';
				html += '<button type="button" class="btn btn-info btn-sm" id="export-button">Export all as CSV</button>';
			html += '</div>';
		html += '</div>';
	html += '</div>';

	$('#content').prepend(html);

	$('#filter-button').on('click', function(e) {
		e.preventDefault();
		filterBansList();
	});

	$('#show-add-bans-button').on('click', function(e) {
		e.preventDefault();
		if($('#remove-bans-area').hasClass('hidden') === false) {
			$('#remove-bans-area').addClass('hidden');
		}

		if($('#add-bans-area').hasClass('hidden')) {
			$('#add-bans-area').removeClass('hidden');
		} else {
			$('#add-bans-area').addClass('hidden');
		}
	});

	$('#show-remove-bans-button').on('click', function(e) {
		e.preventDefault();
		if($('#add-bans-area').hasClass('hidden') === false) {
			$('#add-bans-area').addClass('hidden');
		}

		if($('#remove-bans-area').hasClass('hidden')) {
			$('#remove-bans-area').removeClass('hidden');
		} else {
			$('#remove-bans-area').addClass('hidden');
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

	$('#add-bans-button').on('click', function(e) {
		e.preventDefault();
		$('#add-bans-button').attr('disabled', 'disabled');
		$('#show-add-bans-button').attr('disabled', 'disabled');
		$('#show-remove-bans-button').attr('disabled', 'disabled');
		parseAddBansTextarea();
		$('#add-bans-area').addClass('hidden');
		$('#users-add-banlist-textarea').val('');
		$('#users-add-banlist-reason').val('');
		$('#add-bans-button').removeAttr('disabled');
		resolveUsernamesFromList();
	});

	$('#remove-bans-button').on('click', function(e) {
		e.preventDefault();
		$('#remove-bans-button').attr('disabled', 'disabled');
		$('#show-add-bans-button').attr('disabled', 'disabled');
		$('#show-remove-bans-button').attr('disabled', 'disabled');
		parseRemoveBansTextarea();
		$('#remove-bans-area').addClass('hidden');
		$('#users-remove-banlist-textarea').val('');
		$('#remove-bans-button').removeAttr('disabled');
		resolveUsernamesFromList2();
	});

	$('#export-button').on('click', function(e) {
		e.preventDefault();
		exportBansListAsCSV();
	});
}

function filterBansList() {
	let filter = {};

	if($('#filter-username-regexp').val() != '') {
		filter['usernameRegexp'] = new RegExp($('#filter-username-regexp').val(), 'i');
	}
	if($('#filter-reason-regexp').val() != '') {
		filter['reasonRegexp'] = new RegExp($('#filter-reason-regexp').val(), 'i');
	}
	if($('#filter-duration-min').val().trim() != '') {
		filter['durationMin'] = $('#filter-duration-min').val();
	}
	if($('#filter-duration-max').val().trim() != '') {
		filter['durationMax'] = $('#filter-duration-max').val();
	}
	if($('#filter-bannedby').val() != '') {
		filter['bannedby'] = $('#filter-bannedby').val().trim().toLowerCase();
	}

	$('#remove-all-visible-button').attr('disabled', 'disabled');
	$('#remove-all-button').attr('disabled', 'disabled');
	$('#filter-button').attr('disabled', 'disabled');
	setTimeout(renderBansList, 50, filter);
}

function exportBansListAsCSV() {
	const exportFilename = 'banslist_' + localUser['login'] + '__' + moment().format('YYYY-MM-DD_HH-mm-ss') + '.csv';
	let csv = 'userName,userID,userDisplayName,moderatorName,moderatorID,moderatorDisplayName,duration,reason' + "\r\n";
	$(bansList).each(function(i, e) {
		// Already removed
		if(typeof alreadyRemovedMap[e.userID] === 'boolean' && alreadyRemovedMap[e.userID] === true) {
			return;
		}

		csv += e.userName + ',' + e.userID + ',' + e.userDisplayName + ',' + e.moderatorName +',' + e.moderatorID + ',' + e.moderatorDisplayName +',';
		if(e.expiresAt == -1) {
			csv += 'Indefinite';
		} else {
			csv += dateTimeString(e.expiresAt);
		}
		csv += ',' + e.reason + "\r\n";
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
		message: 'This will remove all listed bans (' + escapeHtml(new Intl.NumberFormat().format($('.card').length)) + ').<br>Are you sure you want to do that?',
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

				$('#status').html('<div class="alert alert-info" role="alert">Removing ' + escapeHtml(new Intl.NumberFormat().format($('.card').length)) + ' bans ... <span id="actions-to-do-left">' + escapeHtml(new Intl.NumberFormat().format($('.card').length)) + '</span> left</div>');
				$('.card').each(function(i, e) {
					toRemoveList.push($(e).data('userid'));
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
		message: 'This will remove all your bans (' + escapeHtml(new Intl.NumberFormat().format(bansList.length)) + ').<br>Are you sure you want to do that?',
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
				removeAllWanted = true;

				$('#status').html('<div class="alert alert-info" role="alert">Removing ' + escapeHtml(new Intl.NumberFormat().format(bansList.length)) + ' bans ... <span id="actions-to-do-left">' + escapeHtml(new Intl.NumberFormat().format(bansList.length)) + '</span> left</div>');
				$(bansList).each(function(i, e) {
					// Skip already removed
					if(typeof alreadyRemovedMap[e.userID] === 'boolean' && alreadyRemovedMap[e.userID] === true) {
						return;
					}

					toRemoveList.push(e.userID);
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
		toRemoveTimer = null;

		if(removeAllWanted === true) {
			getBansFromAPIHelix('');
		} else {
			$('#status').html('<div class="alert alert-success" role="alert">Removing of bans done! Feel free to reload the page to check if that&#039;s indeed the case.</div>');
			$('#filter-button').removeAttr('disabled');
			$('#show-add-bans-button').removeAttr('disabled');
			$('#show-remove-bans-button').removeAttr('disabled');
			$('#remove-all-visible-button').removeAttr('disabled');
			$('#remove-all-button').removeAttr('disabled');
			$('.card[data-removed="yes"]').remove();
			setTimeout(function(){$('.card[data-removed="yes"]').remove();}, 5000);
		}
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
		const userID = toRemoveList.shift();
		if(typeof userID !== 'undefined') {
			removeUserFromBanslistHelix(userID, false);
			toRemoveLastEvent = Date.now();
			toRemoveListCounter++;
		} else {
			break;
		}
	}

	if($('#actions-to-do-left').length > 0) {
		$('#actions-to-do-left').text(new Intl.NumberFormat().format(toRemoveList.length));
	}
}

function removeUserFromBanslistHelix(userID, removeEntryFromPage) {
	var removeEntryFromPage = typeof removeEntryFromPage !== 'undefined' ? removeEntryFromPage : true;

	/*
	console.log('Blocklist DELETE against user: ' + userID);
	if(removeEntryFromPage === true) {
		$('.card[data-userid="' + userID + '"]').remove();
	} else {
		$('.card[data-userid="' + userID + '"]').attr('data-removed', 'yes');
	}
	return;
	*/

	$('#status').html('<div class="alert alert-info" role="alert">Removing users from banlist ... ' + escapeHtml(new Intl.NumberFormat().format(toRemoveList.length)) + ' left</div>');

	$.ajax({
		url: 'https://api.twitch.tv/helix/moderation/bans?broadcaster_id=' + encodeURIComponent(localUser['_id']) + '&moderator_id=' + encodeURIComponent(localUser['_id']) + '&user_id=' + encodeURIComponent(userID),
		type: 'DELETE',
		cache: false,
		headers: {
			'Client-ID': TWITCH_CLIENT_ID,
			'Authorization': 'Bearer ' + localUserToken,
		},
		success: function(result, textStatus, jqXHR) {
			if(removeEntryFromPage === true) {
				$('.card[data-userid="' + userID + '"]').remove();
			} else {
				$('.card[data-userid="' + userID + '"]').attr('data-removed', 'yes');
			}

			alreadyRemovedMap[userID] = true;
			delete bannedUserIDs[userID];
		},
		error: function(jqXHR, textStatus, errorThrown) {
			// Check for rate limit
			if(jqXHR.status == 429) {
				setTimeout(removeUserFromBanslistHelix, 500, userID, removeEntryFromPage);
				return;
			} else if(jqXHR.status == 500) {
				// Happens on Twitch overloads
				setTimeout(removeUserFromBanslistHelix, 500, userID, removeEntryFromPage);
				return;
			} else if(jqXHR.status == 400) {
				// 400 could be bad input but also a response that the account isn't banned, treat as success
				if(removeEntryFromPage === true) {
					$('.card[data-userid="' + userID + '"]').remove();
				} else {
					$('.card[data-userid="' + userID + '"]').attr('data-removed', 'yes');
				}

				alreadyRemovedMap[userID] = true;
				delete bannedUserIDs[userID];

				return;
			}

			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').append('<div class="alert alert-warning" role="alert">Error while trying to remove ban. (' + escapeHtml(err) +')</div>');
		},
	});
}

function addUserToBanlistHelix(userID, reason) {
	var reason = typeof reason !== 'undefined' ? reason.slice(0, 500) : '';
	/*
	console.log('Banlist POST against user: ' + userID);
	return;
	*/

	$('#status').html('<div class="alert alert-info" role="alert">Adding users to banlist ... ' + escapeHtml(new Intl.NumberFormat().format(toAddList.length)) + ' left</div>');

	const formData = {
		data: {
			user_id: userID,
			reason: reason,
		},
	};

	$.ajax({
		url: 'https://api.twitch.tv/helix/moderation/bans?broadcaster_id=' + encodeURIComponent(localUser['_id']) + '&moderator_id=' + encodeURIComponent(localUser['_id']),
		type: 'POST',
		cache: false,
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
				bannedUserIDs[userID] = true;
			} else {
				$('#status').append('<div class="alert alert-warning" role="alert">Error while trying to add bans (' + jqXHR.status + ', ' + JSON.stringify(result) +')</div>');
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			// Check for rate limit
			if(jqXHR.status == 429) {
				clearInterval(toAddTimer);
				toAddList.unshift(userID);

				let rateLimitRateActualMs = rateLimitRateMs + 25;
				toAddTimer = setInterval(addListWorker, rateLimitRateActualMs);
				return;
			} else if(jqXHR.status == 500) {
				// Happens on Twitch overloads
				toAddList.unshift(userID);
				return;
			} else if(jqXHR.status == 400) {
				// 400 could be bad input but also a response that the account isn't banned, treat as success
				return;
			}

			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').append('<div class="alert alert-warning" role="alert">Error while trying to add bans. (' + escapeHtml(err) +')</div>');
		},
	});
}

function parseAddBansTextarea() {
	toResolveList = [];
	const validUsernameRegExp = new RegExp('^[a-z0-9][a-z0-9_]{0,24}', 'i');

	const lines = $('#users-add-banlist-textarea').val().split('\n');
	const reason = $('#users-add-banlist-reason').val().trim();
	toAddReason = reason;
	for(let i = 0; i < lines.length; i++) {
		let line = lines[i].trim().toLowerCase();
		// If it starts with .ban or /ban remove that
		if(line.startsWith('.ban') || line.startsWith('/ban')) {
			line = line.slice(4).trim();
		} else if(line.startsWith('.unban') || line.startsWith('/unban')) {
			line = line.slice(6).trim();
		} else if(line.startsWith('.block') || line.startsWith('/block')) {
			line = line.slice(6).trim();
		} else if(line.startsWith('.unblock') || line.startsWith('/unblock')) {
			line = line.slice(8).trim();
		}
		const match = line.match(validUsernameRegExp);
		if(match === null) {
			if(line.length > 0) console.log('Invalid username: ' + lines[i]);
			continue;
		}

		// Ignore first line of csv exports
		if(match[0] === 'username' || match[0] === 'channelname') continue;

		toResolveList.push(match[0]);
	}

	// Play background audio (not hearable) to make browser act like a visible tab even if it's in the bg
	playAudio();
}

function parseRemoveBansTextarea() {
	toResolveList = [];
	const validUsernameRegExp = new RegExp('^[a-z0-9][a-z0-9_]{0,24}', 'i');

	const lines = $('#users-remove-banlist-textarea').val().split('\n');
	for(let i = 0; i < lines.length; i++) {
		let line = lines[i].trim().toLowerCase();
		// If it starts with .unban or /unban remove that
		if(line.startsWith('.unban') || line.startsWith('/unban')) {
			line = line.slice(6).trim();
		} else if(line.startsWith('.ban') || line.startsWith('/ban')) {
			line = line.slice(4).trim();
		} else if(line.startsWith('.block') || line.startsWith('/block')) {
			line = line.slice(6).trim();
		} else if(line.startsWith('.unblock') || line.startsWith('/unblock')) {
			line = line.slice(8).trim();
		}
		const match = line.match(validUsernameRegExp);
		if(match === null) {
			if(line.length > 0) console.log('Invalid username: ' + lines[i]);
			continue;
		}

		// Ignore first line of csv exports
		if(match[0] === 'username' || match[0] === 'channelname') continue;

		toResolveList.push(match[0]);
	}

	// Play background audio (not hearable) to make browser act like a visible tab even if it's in the bg
	playAudio();
}

function resolveUsernamesFromList() {
	if(toResolveList.length === 0) {
		toAddTimer = setInterval(addListWorker, rateLimitRateMs);
		return;
	}

	$('#status').html('<div class="alert alert-info" role="alert">Resolving userIDs for usernames ... ' + escapeHtml(new Intl.NumberFormat().format(toResolveList.length)) + ' left</div>');

	let username = '';
	let usernames = [];
	while(usernames.length < 100 && typeof (username = toResolveList.shift()) !== 'undefined') {
		usernames.push(encodeURIComponent(username));
	}

	if(usernames.length === 0) {
		resolveUsernamesFromList();
		return;
	}

	$.ajax({
		url: 'https://api.twitch.tv/helix/users?login=' + usernames.join('&login='),
		type: 'GET',
		timeout: 30000,
		cache: false,
		headers: {
			'Client-ID': TWITCH_CLIENT_ID,
			'Authorization': 'Bearer ' + localUserToken,
		},
		success: function(result, textStatus, jqXHR) {
			if(typeof result['data'] !== 'undefined') {
				$(result['data']).each(function(i, e) {
					toAddList.push(e['id']);
				});

				resolveUsernamesFromList();
			} else {
				$('#status').html('<div class="alert alert-warning" role="alert">Error while resolving usernames, please try again. (' + JSON.stringify(result) +')</div>');
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while resolving usernames, please try again. (' + escapeHtml(err) +')</div>');
		},
	});

	// Play background audio (not hearable) to make browser act like a visible tab even if it's in the bg
	playAudio();
}

function resolveUsernamesFromList2() {
	if(toResolveList.length === 0) {
		toRemoveTimer = setInterval(removeListWorker, rateLimitRateMs);
		return;
	}

	$('#status').html('<div class="alert alert-info" role="alert">Resolving userIDs for usernames ... ' + escapeHtml(new Intl.NumberFormat().format(toResolveList.length)) + ' left</div>');

	let username = '';
	let usernames = [];
	while(usernames.length < 100 && typeof (username = toResolveList.shift()) !== 'undefined') {
		usernames.push(encodeURIComponent(username));
	}

	if(usernames.length === 0) {
		resolveUsernamesFromList2();
		return;
	}

	$.ajax({
		url: 'https://api.twitch.tv/helix/users?login=' + usernames.join('&login='),
		type: 'GET',
		timeout: 30000,
		cache: false,
		headers: {
			'Client-ID': TWITCH_CLIENT_ID,
			'Authorization': 'Bearer ' + localUserToken,
		},
		success: function(result, textStatus, jqXHR) {
			if(typeof result['data'] !== 'undefined') {
				$(result['data']).each(function(i, e) {
					toRemoveList.push(e['id']);
				});

				resolveUsernamesFromList2();
			} else {
				$('#status').html('<div class="alert alert-warning" role="alert">Error while resolving usernames, please try again. (' + JSON.stringify(result) +')</div>');
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while resolving usernames, please try again. (' + escapeHtml(err) +')</div>');
		},
	});

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
		toAddTimer = null;
		$('#status').html('<div class="alert alert-success" role="alert">New bans have been added! Feel free to reload the page to check if that&#039;s indeed the case.</div>');
		$('#filter-button').removeAttr('disabled');
		$('#show-add-bans-button').removeAttr('disabled');
		$('#show-remove-bans-button').removeAttr('disabled');
		$('#remove-all-visible-button').removeAttr('disabled');
		$('#remove-all-button').removeAttr('disabled');
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
		let userID = '';
		if((userID = toAddList.shift()) !== undefined) {
			// Already removed
			if(typeof bannedUserIDs[userID] === 'boolean' && bannedUserIDs[userID] === true) {
				if((startTime + rateLimitRateMs) <= Date.now()) {
					// Make sure we only run this function for up to 1 "tick"
					return;
				}
				i--;
				continue;
			}

			addUserToBanlistHelix(userID, toAddReason);
			toAddLastEvent = Date.now();
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
	$('#content').html('<a class="btn btn-lg btn-primary btn-block" href="https://id.twitch.tv/oauth2/authorize?response_type=token&amp;client_id=' + encodeURIComponent(TWITCH_CLIENT_ID) + '&amp;redirect_uri=' + encodeURIComponent(TWITCH_REDIRECT_URL) + '&amp;scope=moderation:read+moderator:manage:banned_users">Login via Twitch</a>');
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


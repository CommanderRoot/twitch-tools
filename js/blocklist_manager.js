"use strict";

const TWITCH_CLIENT_ID = 'q0vvqzvfcnmda9na1wk9v7316jk2ec';
const TWITCH_REDIRECT_URL = 'https://commanderroot.github.io/twitch-tools/blocklist_manager.html?u9AoBNDflUbXnUiXztCmyER7RC6MmLBrpBYnG3DLvR2qRz2edZGpn05NVaOpWMCSN9lLbmqa5sxbW6vFhvoF3rKEJHjbesLG7fDXrpGM4nfVY9rUXrKSQF0CiY95aoSb=5PYRwWWAH2kZS2LchrNnUX6KjCfg7wQlQNVq08cgVM0kPZpbJUE1fwkLzSWsHEXHA0sRNA5d8CjOA69iVuRi8ebn6I01qqnrGg4h2Z4pCNES3AxOmxN4gCXHLFfPGnbH';
var localUser = {};
var localUserToken = '';
var blocksList = [];
var blockedUsernames = {};
var blockedUserIDs = {};
var toRemoveList = [];
var toRemoveListCounter = 0;
var toRemoveTimer = null;
var toRemoveLastEvent = 0;
var alreadyRemovedMap = {};
var toResolveList = [];
var toAddList = [];
var toAddTimer = null;
var toAddLastEvent = 0;
var filteredResultCounterMax = 25000;
var rateLimitRateMs = 100; // 60 sec / 800 requests = 0.075
var stopLoading = false;
var requestTimings = {'remote': {'requests': 0, 'durations': 0}, 'local': {'requests': 0, 'durations': 0}, 'isDecided': null};


function getLocalUser(token) {
	const requestStartTime = new Date();

	$.ajax({
		url: 'https://id.twitch.tv/oauth2/validate',
		type: 'GET',
		timeout: 30000,
		cache: false,
		headers: {
			'Authorization': 'OAuth ' + token,
		},
		success: function(result, textStatus, jqXHR) {
			// console.log('Validate request time: ' + (Date.now() - requestStartTime.getTime()) + ' ms');
			if(typeof result['user_id'] !== 'undefined' && typeof result['login'] !== 'undefined') {
				localUser['_id'] = result['user_id'];
				localUser['login'] = result['login'];
				$('#status').html('<div class="alert alert-info" role="alert">Loading blocks ... <span id="blocks-loading-status"></span> (<a href="#" id="abort-loading-button">abort</a>)</div>');
				localUserToken = token;
				getBlocksFromAPIHelix();

				// Bind abort button
				$('#abort-loading-button').on('click', function(e) {
					e.preventDefault();
					stopLoading = true;
				});

				$('#info-list').append('<li>If you want to let someone else do it for you, you can send them this <a id="share-access-link" href="blocklist_manager.html#access_token=' + escapeHtml(token) + '" target="_blank" rel="noopener" data-toggle="tooltip" data-placement="top" title="Copied to clipboard">link</a>.</li>');
				$('#share-access-link').tooltip('disable');

				$('#share-access-link').on('click', function(e) {
					e.preventDefault();
					navigator.clipboard.writeText('https://commanderroot.github.io/twitch-tools/blocklist_manager.html#access_token=' + escapeHtml(token)).then(function() {
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

function TwitchAPIURL() {
	const APIURLs = {
		'local': 'https://twitch-tools.rootonline.de/twitch-api',
		'remote': 'https://api.twitch.tv',
	};

	const type = 'remote';
	return {'type': type, 'url': APIURLs[type]};
}

function getBlocksFromAPIHelix(cursor) {
	var cursor = typeof cursor !== 'undefined' ? cursor : '';

	// Make sure the local blocksList is empty when we start a new scan
	if(cursor == '') {
		blocksList = [];
		blockedUsernames = {};
		blockedUserIDs = {};
		alreadyRemovedMap = {};
	}

	const TwitchAPI = TwitchAPIURL();
	const requestStartTime = new Date();
	$.ajax({
		url: TwitchAPI.url + '/helix/users/blocks?broadcaster_id=' + encodeURIComponent(localUser['_id']) + '&first=100' + (cursor != '' ? ('&after=' + encodeURIComponent(cursor)) : ''),
		type: 'GET',
		timeout: 30000,
		cache: false,
		headers: {
			'Client-ID': TWITCH_CLIENT_ID,
			'Authorization': 'Bearer ' + localUserToken,
		},
		success: function(result, textStatus, jqXHR) {
			// console.log('Request time (' + TwitchAPI.type + '): ' + (Date.now() - requestStartTime.getTime()) + ' ms');
			requestTimings[TwitchAPI.type].durations = requestTimings[TwitchAPI.type].durations + (Date.now() - requestStartTime.getTime());
			requestTimings[TwitchAPI.type].requests++;

			if(typeof result['data'] !== 'undefined') {
				// Add blocks to local cache
				$(result['data']).each(function(i, e) {
					const block = {
						userID: e.user_id,
						userName: e.user_login,
						userDisplayName: e.display_name,
					};

					blocksList.push(block);
					blockedUsernames[e.user_login] = true;
					blockedUserIDs[e.user_id] = true;
				});

				// Display current status
				if($('#blocks-loading-status').length == 0) {
					$('#status').html('<div class="alert alert-info" role="alert">Loading blocks ... <span id="blocks-loading-status">' + escapeHtml(new Intl.NumberFormat().format(blocksList.length)) + '</span> (<a href="#" id="abort-loading-button">abort</a>)</div>');

					// Bind abort button
					$('#abort-loading-button').on('click', function(e) {
						e.preventDefault();
						stopLoading = true;
					});
				} else {
					$('#blocks-loading-status').text(new Intl.NumberFormat().format(blocksList.length));
				}

				if(typeof result['pagination'] !== 'undefined' && typeof result['pagination']['cursor'] !== 'undefined' && result['pagination']['cursor'].length > 0 && stopLoading === false) {
					getBlocksFromAPIHelix(result['pagination']['cursor']);
				} else {
					$('#status').html('<div class="alert alert-success" role="alert">Loading of ' + escapeHtml(new Intl.NumberFormat().format(blocksList.length)) + ' blocks done!</div>');
					renderBlocksList();
					renderBlocksListFilter();
					$('#status').empty();
				}
			} else {
				$('#status').html('<div class="alert alert-warning" role="alert">Error while getting blocks, please try again. (' + JSON.stringify(result) +')</div>');
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			// Check for rate limit
			if(jqXHR.status == 429) {
				setTimeout(getBlocksFromAPIHelix, 500, cursor);
				return;
			} else if(jqXHR.status == 500) {
				// 500 server error
				$('#status').html('<div class="alert alert-warning" role="alert">Server error (500) while getting blocks, retrying ...</div>');
				setTimeout(getBlocksFromAPIHelix, 500, cursor);
				return;
			} else if(jqXHR.status == 0) {
				// Timeout
				$('#status').html('<div class="alert alert-warning" role="alert">Timeout while getting blocks, retrying ...</div>');
				setTimeout(getBlocksFromAPIHelix, 500, cursor);
				return;
			}

			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while getting blocks, please try again. (' + escapeHtml(err) +')</div>');
		},
	});
}

function addUserToBlocklistHelix(userID) {
	/*
	console.log('Blocklist PUT against user: ' + userID);
	return;
	*/

	$('#status').html('<div class="alert alert-info" role="alert">Adding users to blocklist ... ' + escapeHtml(new Intl.NumberFormat().format(toAddList.length)) + ' left</div>');

	$.ajax({
		url: 'https://api.twitch.tv/helix/users/blocks?target_user_id=' + encodeURIComponent(userID),
		type: 'PUT',
		cache: false,
		headers: {
			'Client-ID': TWITCH_CLIENT_ID,
			'Authorization': 'Bearer ' + localUserToken,
		},
		success: function(result, textStatus, jqXHR) {
			if(jqXHR.status == 204) {
				// All good!
				blockedUserIDs[userID] = true;
			} else {
				$('#status').append('<div class="alert alert-warning" role="alert">Error while trying to add block (' + jqXHR.status + ', ' + JSON.stringify(result) +')</div>');
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
			}

			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').append('<div class="alert alert-warning" role="alert">Error while trying to add block. (' + escapeHtml(err) +')</div>');
		},
	});
}

function removeUserFromBlocklistHelix(userID, removeEntryFromPage) {
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

	$.ajax({
		url: 'https://api.twitch.tv/helix/users/blocks?target_user_id=' + encodeURIComponent(userID),
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
			delete blockedUserIDs[userID];
		},
		error: function(jqXHR, textStatus, errorThrown) {
			// Check for rate limit
			if(jqXHR.status == 429) {
				setTimeout(removeUserFromBlocklistHelix, 500, userID, removeEntryFromPage);
				return;
			} else if(jqXHR.status == 500) {
				// Happens on Twitch overloads
				setTimeout(removeUserFromBlocklistHelix, 500, userID, removeEntryFromPage);
				return;
			}

			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').append('<div class="alert alert-warning" role="alert">Error while trying to remove block. (' + escapeHtml(err) +')</div>');
		},
	});
}

function dateTimeString(unixtime) {
	const currentDate = new Date(unixtime);
	return currentDate.getFullYear() + '-' + (((currentDate.getMonth()+1) < 10) ? '0' : '') + (currentDate.getMonth()+1) + '-' + ((currentDate.getDate() < 10) ? '0' : '') + currentDate.getDate() + ' ' + ((currentDate.getHours() < 10) ? '0' : '') + currentDate.getHours() + ':' + ((currentDate.getMinutes() < 10) ? '0' : '') + currentDate.getMinutes() + ':' + ((currentDate.getSeconds() < 10) ? '0' : '') + currentDate.getSeconds();
}

function renderBlocksList(filter) {
	var filter = typeof filter !== 'undefined' ? filter : {};
	let filteredResultCounter = 0;

	if(blocksList.length == 0) {
		let html = '<div class="row my-4" id="results"><p class="pl-4">No blocks found.</p></div>';
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

	let html = '<div class="row my-4" id="results">';
	$(blocksList).each(function(i, e) {
		// Already removed
		if(typeof alreadyRemovedMap[e.userID] === 'boolean' && alreadyRemovedMap[e.userID] === true) {
			return;
		}

		// Filter
		if(typeof filter['usernameRegexp'] !== 'undefined' && e.userName.match(filter['usernameRegexp']) === null) {
			return;
		}

		html += '<div class="card blocked-user" data-userid="' + escapeHtml(e.userID) + '">';
			html += '<div class="card-block">';
				html += '<p class="card-text mx-1">';
					html += '<span class="float-right"></span>';
					html += '<span><b>Username:</b> <a href="https://www.twitch.tv/' + encodeURIComponent(e.userName) + '" target="_blank" rel="noopener">' + escapeHtml(e.userName) + '</a><br></span>';
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
		html = '<div class="row my-4" id="results"><p class="pl-4">Too many blocks (over ' + escapeHtml(new Intl.NumberFormat().format(filteredResultCounterMax)) + ') to display (it would break your Browser). Please use the filter option above.</p></div>';
	} else if(filteredResultCounter === 0) {
		html = '<div class="row my-4" id="results"><p class="pl-4">No blocks found using this filter.</p></div>';
	}

	if($('#results').length > 0) {
		$('#results').remove();
		$('#content').append(html);
	} else {
		$('#content').html(html);
	}

	// Add dropdown (for whatever reason it doesn't work if it's included above ...)
	$('.card-text').find('.float-right').prepend('<button type="button" class="btn btn-danger btn-sm remove-button" title="Remove block">X</button>');

	$('.remove-button').on('click', function(e) {
		e.preventDefault();
		removeUserFromBlocklistHelix($(this).parents('.card').data('userid'), true);
	});

	$('#remove-all-visible-button').removeAttr('disabled');
	$('#remove-all-button').removeAttr('disabled');
	$('#filter-button').removeAttr('disabled');
}

function renderBlocksListFilter() {
	// Make sure to not add it if we already have it
	if($('#filter').length > 0) return;

	let html = '<div class="row pl-4">';
		html += '<div id="add-blocks-area" class="mb-4 hidden">';
			html += '<h4>Add list of users to blocklist</h4>';
			html += '<textarea id="users-add-blocklist-textarea" cols="50" rows="10" placeholder="One username per line" autocomplete="off" spellcheck="false" translate="no"></textarea>';
			html += '<div class="pt-2">';
				html += '<button type="button" class="btn btn-primary btn-sm" id="add-blocks-button">Add users to blocklist</button> OR <button type="button" class="btn btn-info btn-sm" id="add-known-bots-button">Block known bot accounts</button>';
			html += '</div>';
		html += '</div>';
		html += '<div id="remove-blocks-area" class="mb-4 hidden">';
			html += '<h4>Remove list of users from blocklist</h4>';
			html += '<textarea id="users-remove-blocklist-textarea" cols="50" rows="10" placeholder="One username per line" autocomplete="off" spellcheck="false" translate="no"></textarea>';
			html += '<div class="pt-2">';
				html += '<button type="button" class="btn btn-primary btn-sm" id="remove-blocks-button">Remove users from blocklist</button>';
			html += '</div>';
		html += '</div>';
	html += '</div>';
	html += '<div class="row pl-4">';
		html += '<div id="filter">';
			html += '<h3>Filter results</h3>';
			html += '<div><b>Username</b> (RegExp): <input type="text" class="filter-input" id="filter-username-regexp" name="username-regexp" placeholder="^bot[0-9]+$" size="30" value="" autocomplete="off"></div>';
			html += '<div class="pt-2">';
				html += '<button type="button" class="btn btn-primary btn-sm" id="filter-button">Apply filter</button> | ';
				html += '<div class="btn-group" role="group"><button type="button" class="btn btn-success btn-sm" id="show-add-blocks-button">Add new blocks</button><button type="button" class="btn btn-danger btn-sm" id="show-remove-blocks-button">Remove blocks by list</button></div> | ';
				html += '<div class="btn-group" role="group"><button type="button" class="btn btn-danger btn-sm" id="remove-all-visible-button">Remove all blocks listed below</button> <button type="button" class="btn btn-danger btn-sm" id="remove-non-known-bots-button">Remove blocks from accounts not known as bots</button> <button type="button" class="btn btn-danger btn-sm" id="remove-all-button">Remove all your blocks</button></div> | ';
				html += '<div class="btn-group" role="group"><button type="button" class="btn btn-info btn-sm" id="export-button">Export all as CSV</button> <button type="button" class="btn btn-info btn-sm" id="export-filtered-button">Export filtered as CSV</button></div>';
			html += '</div>';
		html += '</div>';
	html += '</div>';

	$('#content').prepend(html);

	$('#filter-button').on('click', function(e) {
		e.preventDefault();
		filterBlocksList();
	});

	$('#show-add-blocks-button').on('click', function(e) {
		e.preventDefault();
		if($('#remove-blocks-area').hasClass('hidden') === false) {
			$('#remove-blocks-area').addClass('hidden');
		}

		if($('#add-blocks-area').hasClass('hidden')) {
			$('#add-blocks-area').removeClass('hidden');
		} else {
			$('#add-blocks-area').addClass('hidden');
		}
	});

	$('#show-remove-blocks-button').on('click', function(e) {
		e.preventDefault();
		if($('#add-blocks-area').hasClass('hidden') === false) {
			$('#add-blocks-area').addClass('hidden');
		}

		if($('#remove-blocks-area').hasClass('hidden')) {
			$('#remove-blocks-area').removeClass('hidden');
		} else {
			$('#remove-blocks-area').addClass('hidden');
		}
	});

	$('#remove-all-visible-button').on('click', function(e) {
		e.preventDefault();
		removeAllVisible();
	});

	$('#remove-non-known-bots-button').on('click', function(e) {
		e.preventDefault();

		bootbox.confirm({
			message: 'This will remove all blocks on accounts which are not known bots.<br>Are you sure you want to do that?',
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
					$('#remove-non-known-bots-button').attr('disabled', 'disabled');
					$('#remove-all-button').attr('disabled', 'disabled');

					removeBlocksFromNoneKnownBots();
				}
			}
		});
	});

	$('#remove-all-button').on('click', function(e) {
		e.preventDefault();
		removeAll();
	});

	$('#add-blocks-button').on('click', function(e) {
		e.preventDefault();
		$('#add-blocks-button').attr('disabled', 'disabled');
		$('#show-add-blocks-button').attr('disabled', 'disabled');
		$('#show-remove-blocks-button').attr('disabled', 'disabled');
		parseAddBlocksTextarea();
		$('#add-blocks-area').addClass('hidden');
		$('#users-add-blocklist-textarea').val('');
		$('#add-blocks-button').removeAttr('disabled');
		resolveUsernamesFromList();
	});

	$('#remove-blocks-button').on('click', function(e) {
		e.preventDefault();
		$('#remove-blocks-button').attr('disabled', 'disabled');
		$('#show-add-blocks-button').attr('disabled', 'disabled');
		$('#show-remove-blocks-button').attr('disabled', 'disabled');
		parseRemoveBlocksTextarea();
		$('#remove-blocks-area').addClass('hidden');
		$('#users-remove-blocklist-textarea').val('');
		$('#remove-blocks-button').removeAttr('disabled');
		resolveUsernamesFromList2();
	});

	$('#add-known-bots-button').on('click', function(e) {
		e.preventDefault();
		$('#add-known-bots-button').attr('disabled', 'disabled');
		addPresetToBlocklist('known_bot_users');
		$('#show-add-blocks-button').attr('disabled', 'disabled');
		$('#add-blocks-area').addClass('hidden');
	});

	$('#export-button').on('click', function(e) {
		e.preventDefault();
		exportBlocksListAsCSV();
	});

	$('#export-filtered-button').on('click', function(e) {
		e.preventDefault();
		exportFilteredBlocksListAsCSV();
	});
}

function filterBlocksList() {
	let filter = {};

	if($('#filter-username-regexp').val() != '') {
		filter['usernameRegexp'] = new RegExp($('#filter-username-regexp').val(), 'i');
	}

	$('#remove-all-visible-button').attr('disabled', 'disabled');
	$('#remove-all-button').attr('disabled', 'disabled');
	$('#filter-button').attr('disabled', 'disabled');
	setTimeout(renderBlocksList, 50, filter);
}

function exportBlocksListAsCSV() {
	const exportFilename = 'blockslist_' + localUser['login'] + '__' + moment().format('YYYY-MM-DD_HH-mm-ss') + '.csv';
	let csv = 'userName,userID,userDisplayName' + "\r\n";
	$(blocksList).each(function(i, e) {
		// Already removed
		if(typeof alreadyRemovedMap[e.userID] === 'boolean' && alreadyRemovedMap[e.userID] === true) {
			return;
		}

		csv += e.userName + ',' + e.userID + ',' + e.userDisplayName + "\r\n";
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

function exportFilteredBlocksListAsCSV() {
	const exportFilename = 'blockslist_filtered_' + localUser['login'] + '__' + moment().format('YYYY-MM-DD_HH-mm-ss') + '.csv';
	let csv = 'userName,userID,userDisplayName' + "\r\n";
	let userIds = {};
	$('.blocked-user').each(function(i, e) {
		// Already removed
		if(typeof alreadyRemovedMap[$(e).data('userid')] === 'boolean' && alreadyRemovedMap[$(e).data('userid')] === true) {
			return;
		}

		userIds[$(e).data('userid')] = true;
	});
	$(blocksList).each(function(i, e) {
		if(userIds[e.userID] === true) {
			csv += e.userName + ',' + e.userID + ',' + e.userDisplayName + "\r\n";
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
		message: 'This will remove all listed blocks (' + escapeHtml(new Intl.NumberFormat().format($('.card').length)) + ').<br>Are you sure you want to do that?',
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

				$('#status').html('<div class="alert alert-info" role="alert">Removing ' + escapeHtml(new Intl.NumberFormat().format($('.card').length)) + ' blocks ... <span id="blocks-to-remove-left">' + escapeHtml(new Intl.NumberFormat().format($('.card').length)) + '</span> left</div>');
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
		message: 'This will remove all your blocks (' + escapeHtml(new Intl.NumberFormat().format(blocksList.length)) + ').<br>Are you sure you want to do that?',
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
				$('#remove-non-known-bots-button').attr('disabled', 'disabled');
				$('#remove-all-button').attr('disabled', 'disabled');

				$('#status').html('<div class="alert alert-info" role="alert">Removing ' + escapeHtml(new Intl.NumberFormat().format(blocksList.length)) + ' blocks ... <span id="blocks-to-remove-left">' + escapeHtml(new Intl.NumberFormat().format(blocksList.length)) + '</span> left</div>');
				$(blocksList).each(function(i, e) {
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
		$('#status').html('<div class="alert alert-success" role="alert">Removing of blocks done! Feel free to reload the page to check if that&#039;s indeed the case.</div>');
		$('.card[data-removed="yes"]').remove();
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
			removeUserFromBlocklistHelix(userID, false);
			toRemoveLastEvent = Date.now();
			toRemoveListCounter++;
		} else {
			break;
		}
	}

	if(toRemoveListCounter % 20 === 0 && toRemoveListCounter !== 0) {
		$('.card[data-removed="yes"]').remove();
	}

	if($('#blocks-to-remove-left').length > 0) {
		$('#blocks-to-remove-left').text(new Intl.NumberFormat().format(toRemoveList.length));
	}
}

function parseAddBlocksTextarea() {
	toResolveList = [];
	const validUsernameRegExp = new RegExp('^[a-z0-9][a-z0-9_]{0,24}', 'i');

	const lines = $('#users-add-blocklist-textarea').val().split('\n');
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

function parseRemoveBlocksTextarea() {
	toResolveList = [];
	const validUsernameRegExp = new RegExp('^[a-z0-9][a-z0-9_]{0,24}', 'i');

	const lines = $('#users-remove-blocklist-textarea').val().split('\n');
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

function resolveUsernamesFromList() {
	if(toResolveList.length === 0) {
		toAddTimer = setInterval(addListWorker, rateLimitRateMs);
		return;
	}

	$('#status').html('<div class="alert alert-info" role="alert">Resolving userIDs for usernames ... ' + escapeHtml(new Intl.NumberFormat().format(toResolveList.length)) + ' left</div>');

	let username = '';
	let usernames = [];
	while(usernames.length < 100 && typeof (username = toResolveList.shift()) !== 'undefined') {
		if(blockedUsernames[username] !== true) {
			usernames.push(encodeURIComponent(username));
		}
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

function addPresetToBlocklist(preset) {
	$('#status').html('<div class="alert alert-info" role="alert">Loading known bot accounts ...</div>');

	$.ajax({
		url: 'known_bot_users.array.json',
		type: 'GET',
		timeout: 75000,
		success: function(result, textStatus, jqXHR) {
			$('#status').html('<div class="alert alert-info" role="alert">Adding users to blocklist ...</div>');
			toAddList = result;
			toAddTimer = setInterval(addListWorker, rateLimitRateMs);
		},
		error: function(jqXHR, textStatus, errorThrown) {
			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while getting preset, please try again. (' + escapeHtml(err) +')</div>');
			$('#add-known-bots-button').removeAttr('disabled');
			$('#show-add-blocks-button').removeAttr('disabled');
		},
	});

	// Play background audio (not hearable) to make browser act like a visible tab even if it's in the bg
	playAudio();
}

function removeBlocksFromNoneKnownBots() {
	$('#status').html('<div class="alert alert-info" role="alert">Loading known bot accounts ...</div>');

	$.ajax({
		url: 'known_bot_users.object.json',
		type: 'GET',
		timeout: 75000,
		success: function(result, textStatus, jqXHR) {
			$(blocksList).each(function(i, e) {
				if(typeof result[e.userID] === 'undefined') {
					toRemoveList.push(e.userID);
				}
			});

			$('#status').html('<div class="alert alert-info" role="alert">Removing ' + escapeHtml(new Intl.NumberFormat().format(toRemoveList.length)) + ' blocks ... <span id="blocks-to-remove-left">' + escapeHtml(new Intl.NumberFormat().format(toRemoveList.length)) + '</span> left</div>');

			toRemoveTimer = setInterval(removeListWorker, rateLimitRateMs);
		},
		error: function(jqXHR, textStatus, errorThrown) {
			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while getting preset, please try again. (' + escapeHtml(err) +')</div>');
			$('#remove-non-known-bots-button').removeAttr('disabled');
			$('#show-add-blocks-button').removeAttr('disabled');
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
		$('#status').html('<div class="alert alert-success" role="alert">New blocks have been added! Feel free to reload the page to check if that&#039;s indeed the case.</div>');
		$('#show-add-blocks-button').removeAttr('disabled');
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
		const userID = toAddList.shift();
		if(typeof userID !== 'undefined') {
			// Already removed
			if(typeof blockedUserIDs[userID] === 'boolean' && blockedUserIDs[userID] === true) {
				if((startTime + rateLimitRateMs) <= Date.now()) {
					// Make sure we only run this function for up to 1 "tick"
					return;
				}
				i--;
				continue;
			}
			addUserToBlocklistHelix(userID);
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
	$('#content').html('<a class="btn btn-lg btn-primary btn-block" href="https://id.twitch.tv/oauth2/authorize?response_type=token&amp;client_id=' + encodeURIComponent(TWITCH_CLIENT_ID) + '&amp;redirect_uri=' + encodeURIComponent(TWITCH_REDIRECT_URL) + '&amp;scope=user:read:blocked_users+user:manage:blocked_users">Login via Twitch</a>');
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

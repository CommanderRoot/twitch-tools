"use strict";

const TWITCH_CLIENT_ID = 'rnqe5fseibqp7ub2017x2fd8jfrk5s';
const TWITCH_REDIRECT_URL = 'https://commanderroot.github.io/twitch-tools/followerlist_viewer.html?u9AoBNDflUbXnUiXztCmyER7RC6MmLBrpBYnG3DLvR2qRz2edZGpn05NVaOpWMCSN9lLbmqa5sxbW6vFhvoF3rKEJHjbesLG7fDXrpGM4nfVY9rUXrKSQF0CiY95aoSb=5PYRwWWAH2kZS2LchrNnUX6KjCfg7wQlQNVq08cgVM0kPZpbJUE1fwkLzSWsHEXHA0sRNA5d8CjOA69iVuRi8ebn6I01qqnrGg4h2Z4pCNES3AxOmxN4gCXHLFfPGnbH';
var localUserToken = '';
var localUser = {};
var usersInfo = {};
var followerList = [];
var knownBotAccounts = {};
var filteredResultCounterMax = isMobile() ? 10000 : 25000;
var topDaysCount = 10;
var stopLoading = false;
var optOutChannelIDs = {10180554: true};
var getFollowersRequestCount = 0;
var getFollowersRequestLastFollowedAt = Date.now();
var getFollowersRequestsDone = false;
var requestTimings = {'remote': {'requests': 0, 'durations': 0}, 'local': {'requests': 0, 'durations': 0}, 'isDecided': null};


function isMobile() {
	const match = window.matchMedia || window.msMatchMedia;
	if(match) {
		const mq = match('(any-pointer:fine)');
		return !mq.matches;
	}
	return false;
}

function checkAuthToken(token) {
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
			if(typeof result['user_id'] !== 'undefined' && typeof result['expires_in'] !== 'undefined') {
				// Check if the token is still valid for at least 8 hours
				if(result['expires_in'] >= 8*60*60 || result['expires_in'] === 0) {
					showChannelSelect();
					bindEnterToLookup();

					const urlParams = new URLSearchParams(window.location.search);
					if(urlParams.get('channel') !== null && urlParams.get('channel') !== '') {
						$('#lookup-user-username').val(urlParams.get('channel'));
						$('#lookup-user-button').click();
					}
				} else {
					showTwitchLogin();
				}
			} else {
				showTwitchLogin();
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while verifying auth, please try again. (' + escapeHtml(err) +')</div>');
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

function getUserForUsername(username) {
	$('#status').html('<div class="alert alert-info" role="alert">Loading channel information ...</div>');

	// Lowercase and replace URL
	username = username.trim().toLowerCase();
	username = username.replace(/^https:\/\/www\.twitch\.tv\//i, '');

	const TwitchAPI = TwitchAPIURL();
	const requestStartTime = new Date();
	$.ajax({
		url: TwitchAPI.url + '/helix/users?login=' + encodeURIComponent(username),
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

			if(typeof result['data'] !== 'undefined' && typeof result['data'][0] !== 'undefined') {
				localUser = result['data'][0];
				if(typeof optOutChannelIDs[localUser.id] === 'boolean' && optOutChannelIDs[localUser.id] === true) {
					$('#status').html('<div class="alert alert-warning" role="alert">This channel has asked its follow list to be not listed with this tool.</div>');
					$('#lookup-user-button').removeAttr('disabled');
				} else {
					$(document).attr('title', $(document).attr('title') + ' - ' + result['data'][0]['login']);
					$('#status').html('<div class="alert alert-info" role="alert">Loading followers ... <span id="follower-loading-status"></span> (<a href="#" id="abort-loading-button">abort</a>)</div>');
					$('#content').html('');
					getFollowersFromAPI('');

					// Bind abort button
					$('#abort-loading-button').on('click', function(e) {
						e.preventDefault();
						stopLoading = true;
					});
				}
			} else {
				$('#status').html('<div class="alert alert-warning" role="alert">No channel with this name was found!</div>');
				$('#lookup-user-button').removeAttr('disabled');
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while getting channel info, please try again. (' + escapeHtml(err) +')</div>');
			$('#lookup-user-button').removeAttr('disabled');
		},
	});
}

function getFollowersFromAPI(cursor) {
	var cursor = typeof cursor !== 'undefined' ? cursor : '';

	// Make sure the local followerList is empty when we start a new scan
	if(cursor === '') {
		usersInfo = {};
		followerList = [];
		getFollowersRequestCount = 0;
		getFollowersRequestsDone = false;
	}

	const TwitchAPI = TwitchAPIURL();
	const requestStartTime = new Date();
	$.ajax({
		url: TwitchAPI.url + '/helix/users/follows?first=100&to_id=' + encodeURIComponent(localUser.id) + (cursor.length > 0 ? ('&after=' + encodeURIComponent(cursor)) : ''),
		type: 'GET',
		timeout: 30000,
		cache: false,
		headers: {
			'Accept': 'application/json',
			'Client-ID': TWITCH_CLIENT_ID,
			'Authorization': 'Bearer ' + localUserToken,
		},
		success: function(result, textStatus, jqXHR) {
			// console.log('Request time (' + TwitchAPI.type + '): ' + (Date.now() - requestStartTime.getTime()) + ' ms');
			requestTimings[TwitchAPI.type].durations = requestTimings[TwitchAPI.type].durations + (Date.now() - requestStartTime.getTime());
			requestTimings[TwitchAPI.type].requests++;

			if(typeof result['data'] !== 'undefined') {
				let userIDs = [];
				// Add followers to local cache
				$(result['data']).each(function(i, e) {
					const follow = {
						userID: e.from_id,
						userName: e.from_login,
						followCreatedAt: Date.parse(e.followed_at),
					};
					getFollowersRequestLastFollowedAt = follow.followCreatedAt;

					followerList.push(follow);
					userIDs.push(e.from_id);
				});

				// Fetch additional user info
				if(userIDs.length > 0) {
					fetchUsersInfo(userIDs);
				}

				// Display current status
				if($('#follower-loading-status').length === 0) {
					$('#status').html('<div class="alert alert-info" role="alert">Loading followers ... <span id="follower-loading-status"></span> (<a href="#" id="abort-loading-button">abort</a>)</div>');
					// Bind abort button
					$('#abort-loading-button').on('click', function(e) {
						e.preventDefault();
						stopLoading = true;
					});
				}
				$('#follower-loading-status').text('page ' + (new Intl.NumberFormat().format(getFollowersRequestCount)) + ' / ' + (new Intl.NumberFormat().format(Math.ceil(result['total'] / 100))) + ' -> ' + (new Intl.NumberFormat().format(followerList.length)) + ' / ' + (new Intl.NumberFormat().format(result['total'])) + ', last at ' + dateTimeString(getFollowersRequestLastFollowedAt));

				if(typeof result['pagination'] !== 'undefined' && typeof result['pagination']['cursor'] !== 'undefined' && result['pagination']['cursor'].length > 0 && stopLoading === false) {
					getFollowersFromAPI(result['pagination']['cursor']);
				} else {
					getFollowersRequestsDone = true;
					$('#status').html('<div class="alert alert-success" role="alert">Loading of ' + escapeHtml(new Intl.NumberFormat().format(followerList.length)) + ' followers done!</div>');
					renderFollowerList();
					renderFollowerListFilter();
					renderTopDayStats();
					$('#filteredFollowsText').text(new Intl.NumberFormat().format($('.follower-card').length));
					$('#status').empty();
					stopAudio();
				}
			} else {
				$('#status').html('<div class="alert alert-warning" role="alert">Error while getting followers, retrying... (' + JSON.stringify(result) +')</div>');
				// Retry request
				getFollowersRequestCount = getFollowersRequestCount - 1;
				getFollowersFromAPI(cursor);
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			// Retry request
			getFollowersRequestCount = getFollowersRequestCount - 1;
			if(jqXHR.status == 429) {
				// Rate limited so wait a bit before next try
				setTimeout(getFollowersFromAPI, 1000, cursor);
			} else {
				$('#status').html('<div class="alert alert-warning" role="alert">Error while getting followers, retrying... (' + escapeHtml(err) +')</div>');
				getFollowersFromAPI(cursor);
			}
		},
	});

	getFollowersRequestCount = getFollowersRequestCount + 1;
}

function fetchUsersInfo(userIDs) {
	if(userIDs.length == 0) return;

	let userIDsEncoded = [];
	$.each(userIDs, function(i, e) {
		userIDsEncoded.push(encodeURIComponent(e));
	});

	$.ajax({
		url: 'https://api.twitch.tv/helix/users?id=' + userIDsEncoded.join('&id='),
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
					const userInfo = {
						// 'id': e.id,
						// 'login': e.login,
						// 'displayName': e.display_name,
						// 'description': e.description,
						'createdAt': Date.parse(e.created_at),
						'type': e.type.length !== 0 ? e.type : 'user',
						'broadcasterType': e.broadcaster_type.length !== 0 ? e.broadcaster_type : 'default',
						'defaultLogo': e.profile_image_url.indexOf('user-default-pictures') !== -1,
					};

					usersInfo[e.id] = userInfo;
				});

				// If we are done with the follower list and have no other active requests running re-render top stats and list so we have up-to-date data listed
				if(getFollowersRequestsDone === true && $.active <= 1) {
					// Recheck out of this function to see if this was the last one
					setTimeout(function() {
						if(getFollowersRequestsDone === true && $.active == 0) {
							renderTopDayStats();
							filterFollowerList();
						}
					}, 100);
				}
			} else {
				// Retry request
				fetchUsersInfo(userIDs);
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			// Retry request
			fetchUsersInfo(userIDs);
		},
	});
}

function fetchKnownBots() {
	$.ajax({
		url: 'known_bot_users.object.json',
		type: 'GET',
		timeout: 30000,
		success: function(result, textStatus, jqXHR) {
			knownBotAccounts = result;

			// If we are done with the follower list and have no other active requests running re-render top stats and list so we have up-to-date data listed
			if(getFollowersRequestsDone === true && $.active <= 1) {
				// Recheck out of this function to see if this was the last one
				setTimeout(function() {
					if(getFollowersRequestsDone === true && $.active == 0) {
						renderTopDayStats();
						filterFollowerList();
					}
				}, 100);
			}
		},
		error: function(jqXHR, textStatus, errorThrown) {
			// Retry on timeout
			if(jqXHR.status == 0) {
				fetchKnownBots();
				return;
			}

			const err = jqXHR.status + ', ' + textStatus + ', ' + errorThrown;
			$('#status').html('<div class="alert alert-warning" role="alert">Error while getting list of known bots, please try again. (' + escapeHtml(err) +')</div>');
		},
	});
}

function dateTimeString(unixtime) {
	const currentDate = new Date(unixtime);
	return currentDate.getFullYear() + '-' + (((currentDate.getMonth()+1) < 10) ? '0' : '') + (currentDate.getMonth()+1) + '-' + ((currentDate.getDate() < 10) ? '0' : '') + currentDate.getDate() + ' ' + ((currentDate.getHours() < 10) ? '0' : '') + currentDate.getHours() + ':' + ((currentDate.getMinutes() < 10) ? '0' : '') + currentDate.getMinutes() + ':' + ((currentDate.getSeconds() < 10) ? '0' : '') + currentDate.getSeconds();
}

function renderFollowerList(filter) {
	var filter = typeof filter !== 'undefined' ? filter : {};
	let filteredResultCounter = 0;

	if(followerList.length == 0) {
		$('#content').text('No followers found on account: ' + localUser.login);
		$('#filter-button').removeAttr('disabled');
		return;
	}

	let html = '<div class="row mb-4 mx-1" id="results">';
	html += '<table class="table table-bordered table-hover table-sm tablesorter"><thead><tr><th scope="col">Username</th><th scope="col">Followed at</th><th scope="col">Account created at</th><th scope="col">Broadcaster type</th><th scope="col">Account type</th><th scope="col">Default logo</th><th scope="col">Is known bot</th><th scope="col">Links</th></tr></thead><tbody>';
	$(followerList).each(function(i, e) {
		// Filter
		if(typeof filter['followedAtMin'] !== 'undefined' && e.followCreatedAt < filter['followedAtMin']) {
			return;
		} else if(typeof filter['followedAtMax'] !== 'undefined' && e.followCreatedAt > filter['followedAtMax']) {
			return;
		} else if(typeof filter['createdAtMin'] !== 'undefined' && (typeof usersInfo[e.userID] === 'undefined' || typeof usersInfo[e.userID]['createdAt'] === 'undefined' || usersInfo[e.userID]['createdAt'] < filter['createdAtMin'])) {
			return;
		} else if(typeof filter['createdAtMax'] !== 'undefined' && (typeof usersInfo[e.userID] === 'undefined' || typeof usersInfo[e.userID]['createdAt'] === 'undefined' || usersInfo[e.userID]['createdAt'] > filter['createdAtMax'])) {
			return;
		} else if(typeof filter['createdToFollowedMin'] !== 'undefined' && (typeof usersInfo[e.userID] === 'undefined' || typeof usersInfo[e.userID]['createdAt'] === 'undefined' || (e.followCreatedAt - usersInfo[e.userID]['createdAt']) < (filter['createdToFollowedMin'] * 60 * 1000))) {
			return;
		} else if(typeof filter['createdToFollowedMax'] !== 'undefined' && (typeof usersInfo[e.userID] === 'undefined' || typeof usersInfo[e.userID]['createdAt'] === 'undefined' || (e.followCreatedAt - usersInfo[e.userID]['createdAt']) > (filter['createdToFollowedMax'] * 60 * 1000))) {
			return;
		} else if(typeof filter['usernameRegexp'] !== 'undefined' && e.userName.match(filter['usernameRegexp']) === null) {
			return;
		} else if(typeof filter['broadcasterType'] !== 'undefined' && (typeof usersInfo[e.userID] === 'undefined' || typeof usersInfo[e.userID]['broadcasterType'] === 'undefined' || filter['broadcasterType'] !== usersInfo[e.userID]['broadcasterType'])) {
			return;
		} else if(typeof filter['accountType'] !== 'undefined' && (typeof usersInfo[e.userID] === 'undefined' || typeof usersInfo[e.userID]['type'] === 'undefined' || filter['accountType'] !== usersInfo[e.userID]['type'])) {
			return;
		} else if(typeof filter['defaultProfileLogo'] !== 'undefined' && (typeof usersInfo[e.userID] === 'undefined' || typeof usersInfo[e.userID]['defaultLogo'] === 'undefined' || filter['defaultProfileLogo'] !== usersInfo[e.userID]['defaultLogo'])) {
			return;
		} else if(typeof filter['knownBot'] !== 'undefined' && filter['knownBot'] === true && typeof knownBotAccounts[e.userID] === 'undefined') {
			return;
		} else if(typeof filter['knownBot'] !== 'undefined' && filter['knownBot'] === false && typeof knownBotAccounts[e.userID] !== 'undefined') {
			return;
		} else if(typeof filter['isDisabled'] !== 'undefined' && filter['isDisabled'] === true && typeof usersInfo[e.userID] !== 'undefined') {
			return;
		} else if(typeof filter['isDisabled'] !== 'undefined' && filter['isDisabled'] === false && typeof usersInfo[e.userID] === 'undefined') {
			return;
		}

		let knownBot = '';
		if(typeof knownBotAccounts[e.userID] === 'boolean' && knownBotAccounts[e.userID] === true) {
			knownBot = ' known-bot';
		}
		let disabledAccount = '';
		if(typeof usersInfo[e.userID] === 'undefined') {
			disabledAccount = ' disabled-account';
		}

		html += '<tr class="follower-card' + knownBot + disabledAccount + '" data-userid="' + escapeHtml(e.userID) + '">';
			html += '<td><a href="https://www.twitch.tv/' + escapeHtml(e.userName) + '" target="_blank" rel="noopener">' + escapeHtml(e.userName) + '</a></td>';
			html += '<td>' + dateTimeString(e.followCreatedAt) + '</td>';
			html += '<td>';
			if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['createdAt'] !== 'undefined') {
				html += dateTimeString(usersInfo[e.userID]['createdAt']);
			} else {
				html += '<i>Unknown</i>';
			}
			html += '</td>';
			html += '<td class="broadcasterType-' + ((typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['broadcasterType'] !== 'undefined') ? escapeHtml(usersInfo[e.userID]['broadcasterType']) : 'unknown') + '">';
			if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['broadcasterType'] !== 'undefined') {
				html += escapeHtml(usersInfo[e.userID]['broadcasterType']);
			} else {
				html += '<i>Unknown</i>';
			}
			html += '</td>';
			html += '<td class="accountType-' + ((typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['type'] !== 'undefined') ? escapeHtml(usersInfo[e.userID]['type']) : 'unknown') + '">';
			if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['type'] !== 'undefined') {
				html += escapeHtml(usersInfo[e.userID]['type']);
			} else {
				html += '<i>Unknown</i>';
			}
			html += '</td>';
			html += '<td>';
			if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['defaultLogo'] !== 'undefined') {
				html += (usersInfo[e.userID]['defaultLogo'] === true ? 'Yes' : 'No');
			} else {
				html += '<i>Unknown</i>';
			}
			html += '</td>';
			html += '<td>' + ((typeof knownBotAccounts[e.userID] === 'boolean' && knownBotAccounts[e.userID] === true) ? 'Yes' : 'No') + '</td>';
			html += '<td>';
				html += '<a href="https://www.twitch.tv/popout/' + escapeHtml(localUser.login) + '/viewercard/' + escapeHtml(e.userName) + '?popout=" target="_blank" rel="noopener">Mod card</a> / ';
				html += '<a href="followerlist_viewer.html?channel=' + escapeHtml(e.userName) + '" target="_blank" rel="noopener">Followers</a> / ';
				html += '<a href="followinglist_viewer.html?username=' + escapeHtml(e.userName) + '" target="_blank" rel="noopener">Following</a>';
			html +='</td>';
		html += '</tr>';

		filteredResultCounter++;
		if(filteredResultCounter >= filteredResultCounterMax) {
			return false;
		}
	});
	html += '</tbody></table>';
	html += '</div>';

	if(filteredResultCounter >= filteredResultCounterMax) {
		html = '<div class="row mb-4" id="results"><p class="pl-4">Too many follows (over ' + escapeHtml(new Intl.NumberFormat().format(filteredResultCounterMax)) + ') to display (it would break your Browser). Please use the filter option above.</p></div>';
	} else if(filteredResultCounter === 0) {
		html = '<div class="row mb-4" id="results"><p class="pl-4">No followers found using this filter.</p></div>';
	}

	if($('#results').length > 0) {
		$('#results').remove();
		$('#content').append(html);
	} else {
		$('#content').html(html);
	}
	$('.tablesorter').tablesorter({theme: 'bootstrap'});

	$('#filteredFollowsText').text(new Intl.NumberFormat().format($('.follower-card').length));

	$('#filter-button').removeAttr('disabled');
}

function renderFollowerListFilter() {
	// Make sure to not add it if we already have it
	if($('#filter').length > 0) return;

	let html = '<div class="row pl-4">';
		html += '<div id="filter">';
			html += '<h3>Filter results</h3>';
			html += '<div><b>Followed at</b> between <input type="text" class="filter-input filter-datetimepicker" id="filter-followedAt-min" name="followedAt-min" value="" autocomplete="off"> and <input type="text" class="filter-input filter-datetimepicker" id="filter-followedAt-max" name="followedAt-max" value="" autocomplete="off"></div>';
			html += '<div><b>Account created at</b> between <input type="text" class="filter-input filter-datetimepicker" id="filter-createdAt-min" name="createdAt-min" value="" autocomplete="off"> and <input type="text" class="filter-input filter-datetimepicker" id="filter-createdAt-max" name="createdAt-max" value="" autocomplete="off"></div>';
			html += '<div>Minutes between <b>account creation</b> and <b>follow</b>: <input type="number" class="filter-input" id="filter-createdToFollowed-min" name="createdToFollowed-min" value="" step="1" autocomplete="off"> to <input type="number" class="filter-input" id="filter-createdToFollowed-max" name="createdToFollowed-max" value="" step="1" autocomplete="off"></div>';
			html += '<div><b>Username</b> (RegExp): <input type="text" class="filter-input" id="filter-username-regexp" name="username-regexp" placeholder="^bot[0-9]+$" size="30" value="" autocomplete="off"></div>';
			html += '<div><b>Broadcaster type</b>: <select type="text" class="filter-input" id="filter-broadcaster-type" name="broadcaster-type" autocomplete="off">';
				html += '<option value="" selected>Any</option>';
				html += '<option value="default">Default</option>';
				html += '<option value="affiliate">Affiliate</option>';
				html += '<option value="partner">Partner</option>';
			html += '</select></div>';
			html += '<div><b>Account type</b>: <select type="text" class="filter-input" id="filter-account-type" name="account-type" autocomplete="off">';
				html += '<option value="" selected>Any</option>';
				html += '<option value="user">User</option>';
				html += '<option value="global_mod">Global mod</option>';
				html += '<option value="admin">Admin</option>';
				html += '<option value="staff">Staff</option>';
			html += '</select></div>';
			html += '<div>Has <b>default logo</b>: <select type="text" class="filter-input" id="filter-default-logo" name="default-logo" autocomplete="off">';
				html += '<option value="" selected>Any</option>';
				html += '<option value="yes">Yes</option>';
				html += '<option value="no">No</option>';
			html += '</select></div>';
			html += '<div>Is <span class="disabled-account">disabled</span><abbr title="Deleted or suspended">*</abbr>: <select type="text" class="filter-input" id="filter-disabled" name="isDisabled" autocomplete="off">';
				html += '<option value="" selected>Any</option>';
				html += '<option value="yes">Yes</option>';
				html += '<option value="no">No</option>';
			html += '</select></div>';
			html += '<div>Is <span class="known-bot">known bot</span>: <select type="text" class="filter-input" id="filter-known-bot" name="known-bot" autocomplete="off">';
				html += '<option value="" selected>Any</option>';
				html += '<option value="yes">Yes</option>';
				html += '<option value="no">No</option>';
			html += '</select></div>';
			html += '<div class="pt-2">';
			html += '<button type="button" class="btn btn-primary btn-sm" id="filter-button">Apply filters</button> | <div class="btn-group" role="group"><button type="button" class="btn btn-info btn-sm" id="export-button">Export all as CSV</button> <button type="button" class="btn btn-info btn-sm" id="export-filtered-button">Export filtered as CSV</button></div>';
			html += '</div>';
		html += '</div>';
	html += '</div>';

	$('#content').prepend(html);

	$('#filter-button').on('click', function(e) {
		e.preventDefault();
		filterFollowerList();
	});

	$('#export-button').on('click', function(e) {
		e.preventDefault();
		exportFollowerListAsCSV();
	});

	$('#export-filtered-button').on('click', function(e) {
		e.preventDefault();
		exportFilteredFollowerListAsCSV();
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

function renderTopDayStats() {
	// If we already have it, remove it first before adding the new one
	if($('#topDays').length > 0) $('#topDays').remove();

	let followsPerDay = {};
	let accCreatesPerDay = {};
	let html = '';

	$(followerList).each(function(i, e) {
		// Follower per day counter
		const parsedFollowCreatedAtDate = new Date(e.followCreatedAt);
		const followDay = parsedFollowCreatedAtDate.getFullYear() + '-' + (((parsedFollowCreatedAtDate.getMonth()+1) < 10) ? '0' : '') + (parsedFollowCreatedAtDate.getMonth()+1) + '-' + ((parsedFollowCreatedAtDate.getDate() < 10) ? '0' : '') + parsedFollowCreatedAtDate.getDate();
		if(typeof followsPerDay[followDay] === 'undefined') followsPerDay[followDay] = 0;
		followsPerDay[followDay]++;

		// Acc creation per day counter
		if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['createdAt'] !== 'undefined') {
			const parsedAccCreatedAtDate = new Date(usersInfo[e.userID]['createdAt']);
			const accCreateDay = parsedAccCreatedAtDate.getFullYear() + '-' + (((parsedAccCreatedAtDate.getMonth()+1) < 10) ? '0' : '') + (parsedAccCreatedAtDate.getMonth()+1) + '-' + ((parsedAccCreatedAtDate.getDate() < 10) ? '0' : '') + parsedAccCreatedAtDate.getDate();
			if(typeof accCreatesPerDay[accCreateDay] === 'undefined') accCreatesPerDay[accCreateDay] = 0;
			accCreatesPerDay[accCreateDay]++;
		}
	});

	// Sort followsPerDay
	let followsPerDaySort = [];
	$.each(followsPerDay, function(i, e) {
		const followInfo = {day: i, follows: e};
		followsPerDaySort.push(followInfo);
	});
	$.each(followsPerDaySort.sort(function(a, b) { return b.follows - a.follows; }), function(i, e) {
		// Just do top x
		if(i >= topDaysCount) return false;

		if(i == 0) {
			html += '<div id="topDays"><div class="row mt-4"><p class="pl-4 col-md-auto"><b>Total followers:</b> ' + escapeHtml(new Intl.NumberFormat().format(followerList.length))  + '</p><p class="pl-4 col-md-auto"><b>Filtered followers:</b> <span id="filteredFollowsText"></span></p></div><div class="row"><p class="pl-4 col-md-auto"><b>Days with the most follows:</b><br>';
		}
		html += escapeHtml(e.day) + ' =&gt; ' + escapeHtml(new Intl.NumberFormat().format(e.follows)) + '<br>';
	});
	if(html.length > 0) {
		html += '</p>';
	}

	let accCreatesPerDaySort = [];
	$.each(accCreatesPerDay, function(i, e) {
		const accCreateInfo = {day: i, accounts: e};
		accCreatesPerDaySort.push(accCreateInfo);
	});
	$.each(accCreatesPerDaySort.sort(function(a, b) { return b.accounts - a.accounts; }), function(i, e) {
		// Just do top x
		if(i >= topDaysCount) return false;

		if(i == 0) {
			html += '<p class="pl-4 col-md-auto"><b>Top account creation days:</b><br>';
		}
		html += escapeHtml(e.day) + ' =&gt; ' + escapeHtml(new Intl.NumberFormat().format(e.accounts)) + '<br>';
	});
	if(html.length > 0) {
		html += '</p></div></div>';
	}

	$('#filter').parent('.row').after(html);
}

function filterFollowerList() {
	let filter = {};

	if($('#filter-followedAt-min').val().trim() != '' && moment($('#filter-followedAt-min').val().trim()).isValid()) {
		filter['followedAtMin'] = moment($('#filter-followedAt-min').val().trim()).valueOf();
	}
	if($('#filter-followedAt-max').val().trim() != '' && moment($('#filter-followedAt-max').val().trim()).isValid()) {
		filter['followedAtMax'] = moment($('#filter-followedAt-max').val().trim()).valueOf();
	}
	if($('#filter-createdAt-min').val().trim() != '' && moment($('#filter-createdAt-min').val().trim()).isValid()) {
		filter['createdAtMin'] = moment($('#filter-createdAt-min').val().trim()).valueOf();
	}
	if($('#filter-createdAt-max').val().trim() != '' && moment($('#filter-createdAt-max').val().trim()).isValid()) {
		filter['createdAtMax'] = moment($('#filter-createdAt-max').val().trim()).valueOf();
	}
	if($('#filter-createdToFollowed-min').val().trim() != '') {
		filter['createdToFollowedMin'] = $('#filter-createdToFollowed-min').val().trim();
	}
	if($('#filter-createdToFollowed-max').val().trim() != '') {
		filter['createdToFollowedMax'] = $('#filter-createdToFollowed-max').val().trim();
	}
	if($('#filter-username-regexp').val() != '') {
		filter['usernameRegexp'] = new RegExp($('#filter-username-regexp').val(), 'i');
	}
	if($('#filter-broadcaster-type').val() != '') {
		filter['broadcasterType'] = $('#filter-broadcaster-type').val();
	}
	if($('#filter-account-type').val() != '') {
		filter['accountType'] = $('#filter-account-type').val();
	}
	if($('#filter-disabled').val() != '') {
		if($('#filter-disabled').val() == 'yes') {
			filter['isDisabled'] = true;
		} else if($('#filter-disabled').val() == 'no') {
			filter['isDisabled'] = false;
		}
	}
	if($('#filter-known-bot').val() != '') {
		if($('#filter-known-bot').val() == 'yes') {
			filter['knownBot'] = true;
		} else if($('#filter-known-bot').val() == 'no') {
			filter['knownBot'] = false;
		}
	}
	if($('#filter-default-logo').val() != '') {
		if($('#filter-default-logo').val() == 'yes') {
			filter['defaultProfileLogo'] = true;
		} else if($('#filter-default-logo').val() == 'no') {
			filter['defaultProfileLogo'] = false;
		}
	}


	$('#dropdownRemoveAllButton').attr('disabled', 'disabled');
	$('#filter-button').attr('disabled', 'disabled');
	setTimeout(renderFollowerList, 50, filter);
}

function exportFollowerListAsCSV() {
	const exportFilename = 'followerlist_' + localUser.login + '__' + moment().format('YYYY-MM-DD_HH-mm-ss') + '.csv';
	let csv = 'userName,userID,accCreatedAt,followCreatedAt,broadcasterType,accountType,defaultLogo,isKnownBot' + "\r\n";
	$(followerList).each(function(i, e) {
		csv += e.userName + ',' + e.userID + ',';
		if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['createdAt'] !== 'undefined') {
			csv += dateTimeString(usersInfo[e.userID]['createdAt']);
		} else {
			csv += 'unknown';
		}
		csv += ',' + dateTimeString(e.followCreatedAt) + ',';
		if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['broadcasterType'] !== 'undefined') {
			csv += usersInfo[e.userID]['broadcasterType'];
		} else {
			csv += 'unknown';
		}
		csv += ',';
		if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['type'] !== 'undefined') {
			csv += usersInfo[e.userID]['type'];
		} else {
			csv += 'unknown';
		}
		csv += ',';
		if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['defaultLogo'] !== 'undefined') {
			csv += (usersInfo[e.userID]['defaultLogo'] === true ? 'Yes' : 'No');
		} else {
			csv += 'unknown';
		}
		csv += ',';
		if(typeof knownBotAccounts[e.userID] === 'boolean' && knownBotAccounts[e.userID] === true) {
			csv += '1';
		} else {
			csv += '0';
		}
		csv += "\r\n";
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

function exportFilteredFollowerListAsCSV() {
	const exportFilename = 'followerlist_filtered_' + localUser.login + '__' + moment().format('YYYY-MM-DD_HH-mm-ss') + '.csv';
	let csv = 'userName,userID,accCreatedAt,followCreatedAt,broadcasterType,accountType,defaultLogo,isKnownBot' + "\r\n";
	let userIds = {};
	$('.follower-card').each(function(i, e) {
		userIds[$(e).data('userid')] = true;
	});
	$(followerList).each(function(i, e) {
		if(userIds[e.userID] === true) {
			csv += e.userName + ',' + e.userID + ',';
			if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['createdAt'] !== 'undefined') {
				csv += dateTimeString(usersInfo[e.userID]['createdAt']);
			} else {
				csv += 'unknown';
			}
			csv += ',' + dateTimeString(e.followCreatedAt) + ',';
			if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['broadcasterType'] !== 'undefined') {
				csv += usersInfo[e.userID]['broadcasterType'];
			} else {
				csv += 'unknown';
			}
			csv += ',';
			if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['type'] !== 'undefined') {
				csv += usersInfo[e.userID]['type'];
			} else {
				csv += 'unknown';
			}
			csv += ',';
			if(typeof usersInfo[e.userID] !== 'undefined' && typeof usersInfo[e.userID]['defaultLogo'] !== 'undefined') {
				csv += (usersInfo[e.userID]['defaultLogo'] === true ? 'Yes' : 'No');
			} else {
				csv += 'unknown';
			}
			csv += ',';
			if(typeof knownBotAccounts[e.userID] === 'boolean' && knownBotAccounts[e.userID] === true) {
				csv += '1';
			} else {
				csv += '0';
			}
			csv += "\r\n";
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

function showChannelSelect() {
	let html = '<div class="row pl-4">';
		html += '<div id="channel-select">';
			html += '<div><b>Channel:</b> <input type="text" class="filter-input" id="lookup-user-username" name="lookup-user-username" size="30" value="" autocomplete="off" spellcheck="off" autocapitalize="off" required="required" autofocus="autofocus"></div>';
			html += '<div class="pt-2">';
			html += '<button type="button" class="btn btn-primary btn-sm" id="lookup-user-button">Show followers</button>';
			html += '</div>';
		html += '</div>';
	html += '</div>';
	$('#content').html(html);

	// Bind lookup button
	$('#lookup-user-button').on('click', function(e) {
		e.preventDefault();
		if($('#lookup-user-username').val().trim().length == 0) {
			$('#status').html('<div class="alert alert-warning" role="alert">Please enter a channel</div>');
			return;
		}

		// Play background audio (not hearable) to make browser act like a visible tab even if it's in the bg
		playAudio();

		$('#lookup-user-button').attr('disabled', 'disabled');
		getUserForUsername($('#lookup-user-username').val());

		// Update URL
		let url = new URL(window.location);
		url.searchParams.set('channel', $('#lookup-user-username').val());
		window.history.pushState({}, '', url);
	});
}

function bindEnterToLookup() {
	$('#lookup-user-username').on('keypress', function(e) {
		if(e.which == 13) {
			$('#lookup-user-button').click();
		}
	});
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

function stopAudio() {
	let audio = document.getElementById('bg_audio');
	/*
	console.log('Paused: ' + audio.paused);
	console.log('Muted: ' + audio.muted);
	console.log('Position: ' + audio.currentTime);
	*/
	if(audio.paused === false) {
		audio.pause();
	}
}

function showTwitchLogin() {
	// Show login with Twitch button
	$('#content').html('<a class="btn btn-lg btn-primary btn-block" href="https://id.twitch.tv/oauth2/authorize?response_type=token&amp;client_id=' + encodeURIComponent(TWITCH_CLIENT_ID) + '&amp;redirect_uri=' + encodeURIComponent(TWITCH_REDIRECT_URL) + '">Login via Twitch</a>');
}

$(function() {
	// Check if we have a token in the # part of the URL
	const access_token = getQueryVariable(window.location.hash.slice(1), 'access_token');
	if(typeof access_token !== 'undefined' && access_token.length > 0) {
		localUserToken = access_token;
		try {
			window.localStorage.setItem('twitch-follow-lists:auth_token', access_token);
		} catch(e) {}
	} else {
		try {
			localUserToken = window.localStorage.getItem('twitch-follow-lists:auth_token');
		} catch(e) {}
	}

	if(typeof localUserToken === 'string' && localUserToken.length > 0) {
		fetchKnownBots();
		checkAuthToken(localUserToken);
	} else {
		showTwitchLogin();
	}

	// Clear location.hash for security purposes (So a user doesn't copy the link and sends their token to another user)
	if(window.location.hash.length > 0) window.location.hash = '';
	if(window.location.search.length > 250) {
		// Update URL
		let url = new URL(window.location);
		url.search = '';
		window.history.pushState({}, '', url);
	}

	window.onpopstate = function(event) {
		if(window.location.hostname === 'twitch-tools.rootonline.de') window.location.reload();
	};

	// Confirm close if work is running
	window.addEventListener('beforeunload', (event) => {
		if(getFollowersRequestsDone === false && followerList.length >= 20000) {
			event.returnValue = 'The follower list is still loading, are you sure you want to leave?';
		}
	});
});

/* This work is licensed under a Creative Commons Attribution 4.0 International License - http://creativecommons.org/licenses/by/4.0
 * Created by James Bligh (@anamates) for clairebyrne.ie and all thanks to data.localgov.ie
 */

//some control variables

var loop;
var activeFinalStatusTimers = [];
var NON_TRANSFERABLE_CANONICAL = 'nontransferable';

function _dhondtTupleCompare(a, b) {
    if (!a && !b) {
        return 0;
    }
    if (!a) {
        return -1;
    }
    if (!b) {
        return 1;
    }
    var len = Math.max(a.length, b.length);
    for (var idx = 0; idx < len; idx += 1) {
        var av = idx < a.length ? a[idx] : null;
        var bv = idx < b.length ? b[idx] : null;
        if (av === bv) {
            continue;
        }
        if (typeof av === 'string' && typeof bv === 'string') {
            return av > bv ? 1 : -1;
        }
        return (av || 0) > (bv || 0) ? 1 : -1;
    }
    return 0;
}

function _forumCandidateName(entry, seatNumber, existingName) {
    if (!entry) {
        return existingName || '';
    }
    var list = Array.isArray(entry.listCandidates) ? entry.listCandidates : [];
    if (!list.length) {
        return existingName || '';
    }
    if (existingName) {
        return existingName;
    }
    if (Number.isFinite(seatNumber) && seatNumber > 0) {
        var match = list.find(function (item) {
            return parseNumeric(item && item.rank) === seatNumber;
        });
        if (match && match.name) {
            return match.name;
        }
        var offset = seatNumber - 1;
        if (offset >= 0 && offset < list.length) {
            var fallback = list[offset];
            if (fallback && fallback.name) {
                return fallback.name;
            }
        }
    }
    var first = list.find(function (item) { return item && item.name; });
    return first && first.name ? first.name : (existingName || '');
}

function _computeForumSequenceFallback(partyMap, seatTotal) {
    var result = [];
    if (!(partyMap instanceof Map) || !partyMap.size) {
        return result;
    }
    var rounds = Number.isFinite(seatTotal) && seatTotal > 0 ? seatTotal : partyMap.size;
    var allocations = {};
    for (var roundIdx = 0; roundIdx < rounds; roundIdx += 1) {
        var best = null;
        partyMap.forEach(function (entry, token) {
            if (!entry || !token) {
                return;
            }
            var seatsBefore = allocations[token] || 0;
            var divisor = seatsBefore + 1;
            var quotient = divisor > 0 ? entry.baseVotes / divisor : entry.baseVotes;
            var tuple = [
                Number.isFinite(quotient) ? quotient : 0,
                Number.isFinite(entry.baseVotes) ? entry.baseVotes : 0,
                -seatsBefore,
                (entry.name || '').toLowerCase(),
            ];
            if (!best || _dhondtTupleCompare(tuple, best.tuple) > 0) {
                best = {
                    entry: entry,
                    token: token,
                    seatsBefore: seatsBefore,
                    quotient: quotient,
                    tuple: tuple,
                };
            }
        });
        if (!best || !best.entry) {
            break;
        }
        var seatsAfter = best.seatsBefore + 1;
        allocations[best.token] = seatsAfter;
        result.push({
            round: roundIdx + 1,
            party: best.entry.name || '',
            token: best.token,
            seat_number: seatsAfter,
            candidate_rank: seatsAfter,
            candidate_name: _forumCandidateName(best.entry, seatsAfter, ''),
            quotient: best.quotient,
        });
    }
    return result;
}

function _resolveForumSequence(partyMap, rawSequence, seatTotal) {
    var cleaned = [];
    if (Array.isArray(rawSequence)) {
        rawSequence.forEach(function (item, idx) {
            if (!item || typeof item !== 'object') {
                return;
            }
            var party = item.party || '';
            var token = normalisePartyKey(party);
            if (!token) {
                return;
            }
            var roundVal = parseNumeric(item.round);
            if (!Number.isFinite(roundVal) || roundVal <= 0) {
                roundVal = idx + 1;
            }
            var seatNumber = parseNumeric(item.seat_number);
            if (!Number.isFinite(seatNumber) || seatNumber <= 0) {
                seatNumber = null;
            }
            var candidateRank = parseNumeric(item.candidate_rank);
            if (!Number.isFinite(candidateRank) || candidateRank <= 0) {
                candidateRank = seatNumber;
            }
            var candidateName = item.candidate_name || '';
            var quotient = parseNumeric(item.quotient);
            var target = partyMap.get(token) || null;
            if (target) {
                var resolvedSeat = seatNumber || candidateRank || (idx + 1);
                var resolvedRank = candidateRank || resolvedSeat;
                candidateName = _forumCandidateName(target, resolvedRank, candidateName);
                cleaned.push({
                    round: roundVal,
                    party: target.name || party,
                    token: target.token || token,
                    seat_number: resolvedSeat,
                    candidate_rank: resolvedRank,
                    candidate_name: candidateName,
                    quotient: quotient,
                });
            } else {
                cleaned.push({
                    round: roundVal,
                    party: party,
                    token: token,
                    seat_number: seatNumber,
                    candidate_rank: candidateRank,
                    candidate_name: candidateName,
                    quotient: quotient,
                });
            }
        });
    }
    var desiredSeats = Number.isFinite(seatTotal) && seatTotal > 0 ? seatTotal : 0;
    var validCount = cleaned.filter(function (entry) { return entry && entry.token; }).length;
    if (!desiredSeats) {
        desiredSeats = validCount || partyMap.size;
    }
    if (validCount < desiredSeats) {
        cleaned = _computeForumSequenceFallback(partyMap, desiredSeats);
        validCount = cleaned.length;
    }
    var finalSequence = cleaned.map(function (entry, idx) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        var token = entry.token || normalisePartyKey(entry.party || '');
        var roundVal = parseNumeric(entry.round);
        if (!Number.isFinite(roundVal) || roundVal <= 0) {
            roundVal = idx + 1;
        }
        var seatNumber = parseNumeric(entry.seat_number);
        if (!Number.isFinite(seatNumber) || seatNumber <= 0) {
            seatNumber = idx + 1;
        }
        var candidateRank = parseNumeric(entry.candidate_rank);
        if (!Number.isFinite(candidateRank) || candidateRank <= 0) {
            candidateRank = seatNumber;
        }
        var target = partyMap.get(token) || null;
        var candidateName = entry.candidate_name || '';
        if (target) {
            candidateName = _forumCandidateName(target, candidateRank, candidateName);
            return {
                round: roundVal,
                party: target.name || entry.party || '',
                token: target.token || token,
                seat_number: seatNumber,
                candidate_rank: candidateRank,
                candidate_name: candidateName,
                quotient: parseNumeric(entry.quotient),
            };
        }
        return {
            round: roundVal,
            party: entry.party || '',
            token: token,
            seat_number: seatNumber,
            candidate_rank: candidateRank,
            candidate_name: candidateName,
            quotient: parseNumeric(entry.quotient),
        };
    }).filter(function (entry) { return entry !== null; });

    return {
        sequence: finalSequence,
        seatTotal: desiredSeats || finalSequence.length,
    };
}

function buildForumAnimationDataset(constituency) {
    if (!constituency || typeof constituency !== 'object') {
        return null;
    }
    var forum = constituency.forum && typeof constituency.forum === 'object' ? constituency.forum : {};
    var rows = Array.isArray(forum.rows) ? forum.rows : [];
    if (!rows.length) {
        return null;
    }
    var sequenceRaw = Array.isArray(forum.sequence) ? forum.sequence : [];
    var totals = forum.totals && typeof forum.totals === 'object' ? forum.totals : {};
    var isRegionalListing = Boolean(totals.is_regional_listing);
    var constituencySeatCap = 5;
    var regionalSeatCap = 20;
    var preferredSeatCap = isRegionalListing ? regionalSeatCap : constituencySeatCap;

    var seatTotalRaw = totals.seat_total !== undefined ? totals.seat_total : null;
    var seatTotal = parseNumeric(seatTotalRaw);
    if (!Number.isFinite(seatTotal) || seatTotal <= 0) {
        seatTotal = sequenceRaw.length || rows.length;
    }
    if (!seatTotal || seatTotal < 1) {
        seatTotal = rows.length || 1;
    }
    if (!Number.isFinite(seatTotal) || seatTotal <= 0) {
        seatTotal = preferredSeatCap;
    }
    if (Number.isFinite(preferredSeatCap) && preferredSeatCap > 0 && Number.isFinite(seatTotal) && seatTotal > preferredSeatCap) {
        seatTotal = preferredSeatCap;
    }
    if (!Number.isFinite(seatTotal) || seatTotal <= 0) {
        seatTotal = preferredSeatCap || 1;
    }
    var validTotal = parseNumeric(totals.valid_total);
    if (!Number.isFinite(validTotal) || validTotal <= 0) {
        validTotal = rows.reduce(function (sum, row) {
            var votes = parseNumeric(row && row.votes);
            return sum + (Number.isFinite(votes) ? votes : 0);
        }, 0);
    }

    var partyMap = new Map();
    var maxBase = 0;
    rows.forEach(function (row) {
        if (!row || typeof row !== 'object') {
            return;
        }
        var party = row.party || '';
        var token = normalisePartyKey(party);
        if (!token) {
            token = party.toLowerCase();
        }
        if (partyMap.has(token)) {
            return;
        }
        var votes = parseNumeric(row.votes);
        var voteValue = Number.isFinite(votes) ? votes : 0;
        maxBase = Math.max(maxBase, voteValue);
        var share = parseNumeric(row.vote_share);
        if (!Number.isFinite(share) && Number.isFinite(validTotal) && validTotal > 0) {
            share = (voteValue / validTotal) * 100;
        }
        var listCandidates = Array.isArray(row.list_candidates) ? row.list_candidates.slice() : [];
        partyMap.set(token, {
            name: party,
            token: token,
            baseVotes: voteValue,
            voteShare: Number.isFinite(share) ? share : null,
            colour: row.party_colour || getPartyColour(party),
            listCandidates: listCandidates,
            displayTimeline: [],
            shareTimeline: [],
            seatBeforeTimeline: [],
            seatAfterTimeline: [],
            seatTimeline: [],
            candidateTimeline: [],
            winnersTimeline: [],
            winners: [],
        });
    });
    if (!partyMap.size) {
        return null;
    }

    var parties = Array.from(partyMap.values()).sort(function (a, b) {
        if (b.baseVotes !== a.baseVotes) {
            return b.baseVotes - a.baseVotes;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    var resolvedSequence = _resolveForumSequence(partyMap, sequenceRaw, seatTotal);
    var seatSequence = Array.isArray(resolvedSequence.sequence) ? resolvedSequence.sequence : [];
    if (resolvedSequence.seatTotal && Number.isFinite(resolvedSequence.seatTotal) && resolvedSequence.seatTotal > 0) {
        seatTotal = resolvedSequence.seatTotal;
    }
    if (Number.isFinite(seatTotal) && seatTotal > 0 && seatSequence.length > seatTotal) {
        seatSequence = seatSequence.slice(0, seatTotal);
    }

    var counts = [];
    var seenCounts = new Set();
    seatSequence.forEach(function (allocation, idx) {
        if (!allocation) {
            return;
        }
        var roundVal = parseNumeric(allocation.round);
        var fallbackRound = idx + 1;
        var resolvedRound = Number.isFinite(roundVal) && roundVal > 0 ? roundVal : fallbackRound;
        var key = String(resolvedRound);
        if (!seenCounts.has(key)) {
            counts.push(resolvedRound);
            seenCounts.add(key);
        } else {
            counts.push(fallbackRound);
        }
    });
    if (Number.isFinite(seatTotal) && seatTotal > 0 && counts.length > seatTotal) {
        counts = counts.slice(0, seatTotal);
    }
    if (counts.length < seatSequence.length) {
        seatSequence = seatSequence.slice(0, counts.length);
    }
    if (!counts.length) {
        var fallbackLength = Number.isFinite(seatTotal) && seatTotal > 0 ? seatTotal : parties.length;
        for (var idxCount = 0; idxCount < fallbackLength; idxCount += 1) {
            counts.push(idxCount + 1);
        }
    }

    var iterations = counts.length;
    var seatCounts = {};
    var maxDisplay = 0;

    for (var roundIdx = 0; roundIdx < iterations; roundIdx += 1) {
        parties.forEach(function (entry) {
            var seatsBefore = seatCounts[entry.token] || 0;
            var divisor = seatsBefore + 1;
            var effective = divisor > 0 ? entry.baseVotes / divisor : entry.baseVotes;
            var shareEffective = null;
            if (Number.isFinite(entry.voteShare)) {
                shareEffective = divisor > 0 ? entry.voteShare / divisor : entry.voteShare;
            }
            entry.displayTimeline.push(effective);
            entry.shareTimeline.push(Number.isFinite(shareEffective) ? shareEffective : null);
            entry.seatBeforeTimeline.push(seatsBefore);
            entry.seatAfterTimeline.push(seatsBefore);
            entry.seatTimeline.push(seatsBefore);
            entry.candidateTimeline.push('');
            entry.winnersTimeline.push(Array.isArray(entry.winners) ? entry.winners.slice() : []);
            if (Number.isFinite(effective) && effective > maxDisplay) {
                maxDisplay = effective;
            }
        });

        var allocation = seatSequence[roundIdx] || null;
        if (allocation && allocation.party) {
            var key = normalisePartyKey(allocation.party);
            var target = partyMap.get(key);
            if (target) {
                var seatsBefore = seatCounts[key] || 0;
                var seatsAfter = seatsBefore + 1;
                seatCounts[key] = seatsAfter;
                target.seatAfterTimeline[target.seatAfterTimeline.length - 1] = seatsAfter;
                target.seatTimeline[target.seatTimeline.length - 1] = seatsAfter;
                var candidateName = allocation.candidate_name || '';
                if (!candidateName) {
                    var rankVal = parseNumeric(allocation.candidate_rank);
                    var candidates = Array.isArray(target.listCandidates) ? target.listCandidates : [];
                    if (Number.isFinite(rankVal) && rankVal > 0) {
                        var match = candidates.find(function (item) {
                            return parseNumeric(item && item.rank) === rankVal;
                        });
                        if (match && match.name) {
                            candidateName = match.name;
                        }
                    }
                    if (!candidateName && candidates.length >= seatsAfter) {
                        var fallbackCandidate = candidates[seatsAfter - 1];
                        if (fallbackCandidate && fallbackCandidate.name) {
                            candidateName = fallbackCandidate.name;
                        }
                    }
                }
                var resolvedName = candidateName || '';
                target.candidateTimeline[target.candidateTimeline.length - 1] = resolvedName;
                if (!Array.isArray(target.winners)) {
                    target.winners = [];
                }
                if (!resolvedName) {
                    resolvedName = 'Seat ' + seatsAfter;
                }
                target.winners.push(resolvedName);
                target.winnersTimeline[target.winnersTimeline.length - 1] = target.winners.slice();
            }
        }
    }

    parties.forEach(function (entry) {
        if (!entry.displayTimeline.length) {
            entry.displayTimeline.push(entry.baseVotes);
            entry.shareTimeline.push(Number.isFinite(entry.voteShare) ? entry.voteShare : null);
            entry.seatBeforeTimeline.push(0);
            entry.seatAfterTimeline.push(0);
            entry.seatTimeline.push(0);
            entry.candidateTimeline.push('');
            entry.winnersTimeline.push([]);
        }
    });

    if (!counts.length) {
        counts.push(1);
    }

    var maxVote = maxDisplay > 0 ? maxDisplay : maxBase;
    if (!Number.isFinite(maxVote) || maxVote <= 0) {
        maxVote = 1;
    }

    return {
        counts: counts,
        parties: parties,
        maxVote: maxVote,
        seatTotal: seatTotal,
        sequence: seatSequence,
    };
}

function animateForumElection(constituency) {
    var dataset = buildForumAnimationDataset(constituency);
    if (!dataset) {
        $("#animation").empty();
        $("#quota").text("No election data available.");
        $("#stageNumbers").empty();
        $("#seats-span").text('');
        return;
    }

    $("#count_matrix").empty().hide();
    $("#transfers").empty().hide();
    $("#transfers_constituency").empty().hide();

    var counts = Array.isArray(dataset.counts) ? dataset.counts : [];
    var parties = Array.isArray(dataset.parties) ? dataset.parties : [];
    var seatTotal = Number.isFinite(dataset.seatTotal) ? dataset.seatTotal : counts.length;
    if (!Number.isFinite(seatTotal) || seatTotal <= 0) {
        seatTotal = counts.length;
    }

    var voteWidth = 600;
    var leftPadding = 10;
    var nameSpace = 200;
    var startLeft = leftPadding + nameSpace;
    var topMargin = 20;
    var rowHeight = 30;
    var containerHeight = topMargin + parties.length * rowHeight;

    var animation = $("#animation");
    animation.height(containerHeight);
    $("#thepost").height(containerHeight).hide();
    $("#theline").height(1).show().css({
        top: 17 + (seatTotal * 30),
        left: leftPadding,
        width: startLeft + voteWidth,
    });

    $("#quota").text("Seat allocation using D'Hondt method");
    $("#seats-span").text(seatTotal ? seatTotal : '');

    $(".candidateLabel").remove();
    $(".votes").remove();

    var stageContainer = $("#stageNumbers");
    stageContainer.empty();
    var stageNodes = [];
    counts.forEach(function (countValue, idx) {
        var display = Number.isFinite(countValue) ? countValue : (idx + 1);
        var marker = $("<div class='stageNumber'><p>" + escapeHtml(String(display)) + "</p></div>");
        marker.data('index', idx);
        stageContainer.append(marker);
        stageNodes.push(marker);
    });

    var state = {
        counts: counts.length,
        parties: parties,
        maxVote: dataset.maxVote,
        currentIndex: 0,
        playing: false,
        stageNodes: stageNodes,
    };

    parties.forEach(function (entry, idx) {
        var top = topMargin + (idx * rowHeight);
        var label = $("<div class='candidateLabel forum-party-label'></div>");
        label.css({ top: top, left: leftPadding });
        decorateLabel(label, entry.colour);
        var nameSpan = $("<span class='forum-party-name'></span>");
        nameSpan.text(entry.name || '—');
        label.append(nameSpan);
        animation.append(label);

        var bar = $("<div class='votes forum-party-bar'></div>");
        bar.css({ top: top, left: startLeft, minWidth: '4px' });
        applyVoteColour(bar, entry.colour);
        animation.append(bar);

        entry.labelEl = label;
        entry.statusEl = null;
        entry.barEl = bar;
        if (!Number.isFinite(entry.voteShare) && entry.voteShare !== null && entry.voteShare !== undefined) {
            entry.voteShare = parseNumeric(entry.voteShare);
        }
    });

    function formatVoteWithShare(voteValue, shareValue, entry) {
        var numeric = Number.isFinite(voteValue) ? voteValue : (entry && Number.isFinite(entry.baseVotes) ? entry.baseVotes : 0);
        var pieces = [formatVoteNumber(numeric)];
        var shareNumeric = Number.isFinite(shareValue) ? shareValue : (entry && Number.isFinite(entry.voteShare) ? entry.voteShare : null);
        if (Number.isFinite(shareNumeric)) {
            pieces.push('(' + Number(shareNumeric).toFixed(2) + '%)');
        }
        return pieces.join(' ');
    }

    function seatLabel(seatCount) {
        if (!Number.isFinite(seatCount) || seatCount <= 0) {
            return '';
        }
        return seatCount === 1 ? '1 seat' : (seatCount + ' seats');
    }

    function joinedNames(names) {
        if (!Array.isArray(names) || !names.length) {
            return '';
        }
        return names.join(', ');
    }

    function baseLabelWithSeats(entry, seatCount, winnerNames, extra, voteValue, shareValue) {
        var base = formatVoteWithShare(voteValue, shareValue, entry);
        if (!Number.isFinite(seatCount) || seatCount <= 0) {
            return base;
        }
        var segment = seatLabel(seatCount);
        var suffix = '';
        var namesJoined = joinedNames(winnerNames);
        if (namesJoined) {
            suffix = ' (' + namesJoined + ')';
        }
        var label = base + ' - ' + segment + suffix;
        if (extra) {
            label += ' ' + extra;
        }
        return label;
    }

    function clearForumTimers() {
        if (!Array.isArray(activeFinalStatusTimers)) {
            return;
        }
        while (activeFinalStatusTimers.length) {
            var timerId = activeFinalStatusTimers.pop();
            if (timerId) {
                window.clearTimeout(timerId);
            }
        }
    }

    function updateControls() {
        var atStart = state.currentIndex <= 0;
        var atEnd = state.currentIndex >= (state.counts ? state.counts - 1 : 0);
        var againBtn = $("#again");
        againBtn.toggleClass('disabled', atStart);
        againBtn.attr('aria-disabled', atStart ? 'true' : 'false');
        var stepBtn = $("#step");
        stepBtn.toggleClass('disabled', atEnd);
        stepBtn.attr('aria-disabled', atEnd ? 'true' : 'false');
        var pauseBtn = $("#pause-replay");
        pauseBtn.removeClass('fa-repeat');
        if (state.playing) {
            pauseBtn.removeClass('fa-play').addClass('fa-pause');
        } else {
            pauseBtn.removeClass('fa-pause').addClass('fa-play');
        }
    }

    function renderFrame(index, options) {
        var immediate = options && options.immediate;
        var restartMode = options && options.restart;
        var animate = !immediate;
        var clamped = Math.max(0, Math.min(state.counts ? state.counts - 1 : 0, index));
        state.currentIndex = clamped;

        clearForumTimers();

        stageNodes.forEach(function (node, idx) {
            if (!node) { return; }
            if (idx < clamped) {
                node.addClass('completed').removeClass('active');
            } else if (idx === clamped) {
                node.addClass('active').removeClass('completed');
            } else {
                node.removeClass('active completed');
            }
        });

        parties.forEach(function (entry) {
            if (!entry || !entry.barEl) {
                return;
            }
            var timeline = Array.isArray(entry.displayTimeline) ? entry.displayTimeline : [];
            var shareTimeline = Array.isArray(entry.shareTimeline) ? entry.shareTimeline : [];
            var seatBeforeTimeline = Array.isArray(entry.seatBeforeTimeline) ? entry.seatBeforeTimeline : [];
            var seatAfterTimeline = Array.isArray(entry.seatAfterTimeline) ? entry.seatAfterTimeline : [];
            var winnersTimeline = Array.isArray(entry.winnersTimeline) ? entry.winnersTimeline : [];
            var value = timeline.length ? timeline[Math.min(clamped, timeline.length - 1)] : entry.baseVotes;
            if (!Number.isFinite(value)) {
                value = 0;
            }
            var shareValue = shareTimeline.length ? shareTimeline[Math.min(clamped, shareTimeline.length - 1)] : (Number.isFinite(entry.voteShare) ? entry.voteShare : null);
            var width = state.maxVote > 0 ? (value / state.maxVote) * voteWidth : 0;
            var widthPx = Math.max(4, width);
            if (animate) {
                entry.barEl.stop(true, true).animate({ width: widthPx }, 500);
            } else {
                entry.barEl.stop(true, true).css('width', widthPx);
            }
            var previousSeats = clamped > 0 && seatAfterTimeline.length ? seatAfterTimeline[Math.min(clamped - 1, seatAfterTimeline.length - 1)] : 0;
            var previousWinners = clamped > 0 && winnersTimeline.length ? winnersTimeline[Math.min(clamped - 1, winnersTimeline.length - 1)] : [];
            entry.barEl.text(baseLabelWithSeats(entry, previousSeats, previousWinners, '', value, shareValue));

            if (!animate) {
                if (!restartMode) {
                    var seatAfterImmediate = seatAfterTimeline.length ? seatAfterTimeline[Math.min(clamped, seatAfterTimeline.length - 1)] : previousSeats;
                    var winnersImmediate = winnersTimeline.length ? winnersTimeline[Math.min(clamped, winnersTimeline.length - 1)] : previousWinners;
                    entry.barEl.text(baseLabelWithSeats(entry, seatAfterImmediate, winnersImmediate, '', value, shareValue));
                }
                return;
            }

            var seatBefore = seatBeforeTimeline.length ? seatBeforeTimeline[Math.min(clamped, seatBeforeTimeline.length - 1)] : previousSeats;
            var seatAfter = seatAfterTimeline.length ? seatAfterTimeline[Math.min(clamped, seatAfterTimeline.length - 1)] : seatBefore;
            if (!Number.isFinite(seatAfter) || seatAfter <= seatBefore) {
                return;
            }
            var winnersAfter = winnersTimeline.length ? winnersTimeline[Math.min(clamped, winnersTimeline.length - 1)] : [];
            var timer = window.setTimeout(function () {
                entry.barEl.text(baseLabelWithSeats(entry, seatAfter, winnersAfter, '(+1)', value, shareValue));
            }, 600);
            activeFinalStatusTimers.push(timer);
        });

        updateControls();
    }

    function goTo(index, options) {
        renderFrame(index, options || { immediate: false });
    }

    function advance(auto) {
        if (!state.counts || state.counts <= 1) {
            return;
        }
        if (state.currentIndex >= state.counts - 1) {
            if (auto) {
                stopAuto();
            }
            return;
        }
        renderFrame(state.currentIndex + 1, {});
    }

    function stopAuto() {
        if (typeof loop !== 'undefined' && loop) {
            clearInterval(loop);
        }
        loop = undefined;
        state.playing = false;
        updateControls();
    }

    function startAuto() {
        if (typeof loop !== 'undefined' && loop) {
            clearInterval(loop);
        }
        state.playing = true;
        updateControls();
        loop = window.setInterval(function () {
            advance(true);
        }, 4000);
    }

    $("#pause-replay").off('click').on('click', function (event) {
        event.preventDefault();
        if (state.playing) {
            stopAuto();
        } else {
            startAuto();
        }
    });

    $("#step").off('click').on('click', function (event) {
        event.preventDefault();
        stopAuto();
        advance(false);
    });

    $("#again").off('click').on('click', function (event) {
        event.preventDefault();
        stopAuto();
        goTo(0, { immediate: false, restart: true });
    });

    stageNodes.forEach(function (node) {
        if (!node) {
            return;
        }
        node.off('click').on('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            var idx = parseInt($(this).data('index'), 10);
            if (!Number.isFinite(idx)) {
                idx = 0;
            }
            stopAuto();
            goTo(idx, { immediate: true });
        });
    });

    renderFrame(0, { immediate: false, restart: true });
    if (state.counts > 1) {
        startAuto();
    } else {
        stopAuto();
    }
}

function pushNonEmptyString(target, value) {
    if (!target || !Array.isArray(target)) {
        return;
    }
    if (value === null || typeof value === 'undefined') {
        return;
    }
    var stringValue = value;
    if (typeof stringValue === 'number' && isFinite(stringValue)) {
        stringValue = String(stringValue);
    }
    if (typeof stringValue !== 'string') {
        return;
    }
    var trimmed = stringValue.trim();
    if (!trimmed) {
        return;
    }
    target.push(trimmed);
}

function canonicalMatchesNonTransferable(canonicalValue) {
    if (typeof canonicalValue !== 'string' || !canonicalValue) {
        return false;
    }
    if (canonicalValue === NON_TRANSFERABLE_CANONICAL) {
        return true;
    }
    if (canonicalValue.indexOf(NON_TRANSFERABLE_CANONICAL) !== -1) {
        return true;
    }
    if (canonicalValue.indexOf('nontransferrable') !== -1) {
        return true;
    }
    return false;
}

function canonicalCandidateIdentifier(candidateId) {
    if (candidateId === null || typeof candidateId === 'undefined') {
        return '';
    }
    return String(candidateId)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function collectNonTransferableHints(row, candidateId) {
    var hints = [];
    pushNonEmptyString(hints, candidateId);
    if (!row || typeof row !== 'object') {
        return hints;
    }
    var candidateNameFields = [
        'Candidate_Id', 'CandidateID', 'Candidate', 'Candidate_Name', 'CandidateName',
        'Name', 'Firstname', 'FirstName', 'Surname', 'LastName',
        'Party_Name', 'PartyName', 'Party', 'Party_Id', 'PartyID', 'PartyIdentifier',
        'Transfer_To', 'TransferTo'
    ];
    for (var idx = 0; idx < candidateNameFields.length; idx++) {
        var field = candidateNameFields[idx];
        if (row.hasOwnProperty(field)) {
            pushNonEmptyString(hints, row[field]);
        }
    }
    var first = '';
    if (typeof row['Firstname'] === 'string') {
        first = row['Firstname'];
    } else if (typeof row['FirstName'] === 'string') {
        first = row['FirstName'];
    }
    var last = '';
    if (typeof row['Surname'] === 'string') {
        last = row['Surname'];
    } else if (typeof row['LastName'] === 'string') {
        last = row['LastName'];
    }
    if (first || last) {
        pushNonEmptyString(hints, (first + ' ' + last).trim());
        pushNonEmptyString(hints, (last + ', ' + first).trim());
    }
    return hints;
}

function rowMatchesNonTransferable(row, candidateId) {
    var hints = collectNonTransferableHints(row, candidateId);
    for (var idx = 0; idx < hints.length; idx++) {
        var canonical = canonicalCandidateIdentifier(hints[idx]);
        if (canonicalMatchesNonTransferable(canonical)) {
            return true;
        }
    }
    return false;
}

function normaliseCandidateIdentifier(rawCandidateId, row) {
    if (rowMatchesNonTransferable(row, rawCandidateId)) {
        return NON_TRANSFERABLE_CANONICAL;
    }
    if (rawCandidateId === null || typeof rawCandidateId === 'undefined') {
        return '';
    }
    if (typeof rawCandidateId === 'string') {
        return rawCandidateId;
    }
    if (typeof rawCandidateId === 'number' && isFinite(rawCandidateId)) {
        return String(rawCandidateId);
    }
    return String(rawCandidateId);
}

function computeRecipientSliceGeometry(previousVotes, transferVotes, finalVotes, scaleFactor) {
    var safeScale = (typeof scaleFactor === 'number' && isFinite(scaleFactor) && scaleFactor > 0) ? scaleFactor : 0;
    var safePrevious = (typeof previousVotes === 'number' && isFinite(previousVotes)) ? previousVotes : 0;
    var safeTransfer = (typeof transferVotes === 'number' && isFinite(transferVotes)) ? transferVotes : 0;
    var safeFinal = (typeof finalVotes === 'number' && isFinite(finalVotes)) ? finalVotes : 0;

    if (safeTransfer < 0) {
        safeTransfer = 0;
    }

    var previousWidth = Math.max(safePrevious, 0) * safeScale;
    var sliceWidth = Math.max(safeTransfer, 0) * safeScale;
    var finalWidth = Math.max(safeFinal, 0) * safeScale;
    var animationWidth = previousWidth + sliceWidth;
    var targetBarWidth = Math.max(finalWidth, animationWidth);
    var sliceLeft = targetBarWidth - sliceWidth;

    return {
        previousWidth: previousWidth,
        sliceWidth: sliceWidth,
        finalWidth: finalWidth,
        animationWidth: animationWidth,
        targetBarWidth: targetBarWidth,
        sliceLeft: sliceLeft,
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports.computeRecipientSliceGeometry = computeRecipientSliceGeometry;
}
if (typeof window !== 'undefined') {
    window.computeRecipientSliceGeometry = computeRecipientSliceGeometry;
}

function isWholeNumber(value) {
    if (value === null || typeof value === 'undefined') {
        return false;
    }
    var numeric = Number(value);
    if (!isFinite(numeric)) {
        return false;
    }
    return Math.abs(numeric - Math.round(numeric)) < 1e-6;
}

function formatVoteNumber(value) {
    if (value === null || typeof value === 'undefined') {
        return '0';
    }
    var numeric = Number(value);
    if (!isFinite(numeric)) {
        return '0';
    }
    var formatted;
    if (isWholeNumber(numeric)) {
        formatted = Math.round(numeric).toString();
    } else {
        formatted = numeric.toFixed(2);
    }
    return numberWithCommas(formatted);
}

function normaliseColour(value) {
    if (!value) {
        return null;
    }
    var hex = value.toString().trim();
    if (!hex) {
        return null;
    }
    if (hex[0] !== '#') {
        hex = '#' + hex;
    }
    if (hex.length === 4) {
        var expanded = '#';
        for (var i = 1; i < hex.length; i++) {
            expanded += hex[i] + hex[i];
        }
        hex = expanded;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        return hex.toUpperCase();
    }
    return null;
}

function applyVoteColour(element, colour) {
    var resolved = normaliseColour(colour);
    if (!resolved) {
        return;
    }
    element.css({
        background: resolved,
        fill: resolved,
        color: '#FFFFFF',
        textShadow: '2px 2px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
    });
}

function decorateLabel(element, colour) {
    var resolved = normaliseColour(colour);
    if (!resolved) {
        return;
    }
    element.css({
        borderLeft: '6px solid ' + resolved,
        paddingLeft: '8px',
    });
}

function parseNumeric(value) {
    if (value === null || typeof value === 'undefined') {
        return null;
    }
    if (typeof value === 'number') {
        return isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        var trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        var parsed = parseFloat(trimmed);
        return isNaN(parsed) ? null : parsed;
    }
    if (typeof value === 'object' && value !== null && typeof value.valueOf === 'function') {
        try {
            var numeric = Number(value.valueOf());
            return isFinite(numeric) ? numeric : null;
        } catch (err) {
            return null;
        }
    }
    return null;
}

function normalisePartyKey(label) {
    if (label === null || typeof label === 'undefined') {
        return '';
    }
    return label.toString().trim().toLowerCase();
}

function escapeHtml(value) {
    if (value === null || typeof value === 'undefined') {
        return '';
    }
    return value.toString().replace(/[&<>"']/g, function (match) {
        switch (match) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
        default: return match;
        }
    });
}

var PARTY_COLOUR_BASE = {
    'Alliance': '#F6CB2F',
    'Alliance Party': '#F6CB2F',
    'Alliance Party of Northern Ireland': '#F6CB2F',
    'British Movement': '#7F7F7F',
    'Conservative': '#0087DC',
    'DUP': '#D46A4C',
    'Democratic Unionist Party': '#D46A4C',
    'Green / Ecology': '#8DC63F',
    'Green Party': '#64DD17',
    'Green Party Northern Ireland': '#64DD17',
    'Independent': '#DCDCDC',
    'Independent Nationalist': '#CDFFAB',
    'Independent Other': '#DCDCDC',
    'Labour': '#DC241F',
    'NI Conservatives': '#0047AB',
    'NI Labour': '#DC241F',
    'National Front': '#191970',
    'Nationalist Party': '#32CD32',
    'Natural Law': '#FFE4E1',
    'People Before Profit': '#E91E63',
    'People Before Profit Alliance': '#E91E63',
    'People Before Profit Alliance (PBPA)': '#E91E63',
    'People\'s Democracy': '#FF0000',
    'PUP': '#2B45A2',
    'Progressive Unionist Party': '#2B45A2',
    'Procapitalism': '#000000',
    'Republican Labour Party': '#85DE59',
    'Republican Sinn Féin': '#008800',
    'SDLP': '#2AA82C',
    'Social Democratic and Labour Party': '#2AA82C',
    'Socialist Environmental Alliance': '#BB0000',
    'Socialist Party': '#FF3300',
    'Sinn Féin': '#326760',
    'Sinn Fein': '#326760',
    'TUV': '#0C3A6A',
    'Traditional Unionist Voice': '#0C3A6A',
    'Traditional Unionist Voice (Northern Ireland)': '#0C3A6A',
    'UUP': '#48A5EE',
    'Ulster Democratic Party': '#000000',
    'Ulster Independence Movement': '#A9A9A9',
    'Ulster Liberal Party': '#DAA520',
    'Ulster Popular Unionist Party': '#FFDEAD',
    'Ulster Third Way': '#A9A9A9',
    'Ulster Unionist Party': '#48A5EE',
    'Ulster Unionist Party (UUP)': '#48A5EE',
    'Ulster\'s Independent Voice': '#FF8C00',
    'UK Independence Party': '#6D3177',
    'UKIP': '#6D3177',
    'UKUP': '#660066',
    'Unionist Party of Northern Ireland': '#FFA07A',
    'United Labour Party': '#FF0000',
    'United Ulster Unionist Party': '#FF8C00',
    'Vanguard Unionist Progressive Party': '#FF8C00',
    'Workers Party': '#930C1A',
    'Workers Party / Republican Clubs': '#930C1A',
};

var PARTY_COLOUR_OVERRIDES = {
    'Aontú': '#228d57',
    'British Democratic Party': '#00008B',
    'British Ulster Dominion Party': '#003366',
    'Carlow/Kilkenny Labour Party': '#DC241F',
    'Catholic Democrats': '#006400',
    'Catholic Unionist': '#006400',
    'Causeway Unionist Party': '#1E90FF',
    'Conservative (incl. Ulster Unionist)': '#0087DC',
    'Constitutional Convention': '#5D4037',
    'Democracy First': '#000000',
    'Democratic Left': '#DC241F',
    'Democratic Left (Ireland)': '#DC241F',
    'Democratic Partnership': '#FF9800',
    'Democratic Progressive Party': '#8B0000',
    'Democratic Reform Party': '#8B4513',
    'Democratic Socialist Party': '#8B0000',
    'Derry Labour Party': '#DC241F',
    'Donegal Progressive Party': '#008000',
    'Down Democrat': '#FF8C00',
    'Fermanagh Labour Party': '#DC241F',
    'Independent (No description)': '#DCDCDC',
    'Independent (Unionist)': '#ADD8E6',
    'Independent Alliance': '#B0BEC5',
    'Independent Conservative': '#0087DC',
    'Independent Labour': '#DC241F',
    'Independent Loyalist': '#1E90FF',
    'Independent Nationalist (Anti H-Block)': '#2E8B57',
    'Independent Nationalist (Unity)': '#2E8B57',
    'Independent Republican': '#006400',
    'Independent Ulster': '#1E90FF',
    'Independent Unionist Association': '#1E90FF',
    'Irish Independence Party': '#32CD32',
    'Labour Party of Northern Ireland': '#DC241F',
    'Liberal Party': '#DAA520',
    'Loyalist Coalition': '#1E90FF',
    'Loyalist Unionist': '#1E90FF',
    'Nationalist (Unity)': '#32CD32',
    'Nationalist Labour Party': '#DC241F',
    'Nationalist Labour Party (NLP)': '#DC241F',
    'Newtownabbey Labour Party': '#DC241F',
    'Newtownabbey Labour Party (NLP)': '#DC241F',
    'Northern Ireland First': '#DCDCDC',
    'Northern Ireland Labour Representation Committee': '#DC241F',
    'Northern Ireland Unionist Party': '#FF8C00',
    'Northern Ireland Women\'s Coalition': '#00FFFF',
    'Peace Coalition': '#009688',
    'People\'s Coalition': '#E91E63',
    'People Before Profit (PBPA)': '#E91E63',
    'Progressive Democrats': '#FF8C00',
    'Rainbow Dream Ticket': '#FFC0CB',
    'Socialist Labour': '#DC241F',
    'Socialist Labour Group': '#DC241F',
    'Ulster Constitution Party': '#000000',
    'Ulster Loyalist Democratic Party': '#1E90FF',
    'Ulster Protestant Unionist Party': '#1E90FF',
    'Ulster Vanguard': '#FF8C00',
    'United Unionist Action Council': '#1E90FF',
    'Workers\' Party of Ireland': '#930C1A',
    'World Socialist Party': '#FF0000',
};

var PARTY_COLOUR_MAP = {};
Object.keys(PARTY_COLOUR_BASE).forEach(function (label) {
    PARTY_COLOUR_MAP[normalisePartyKey(label)] = PARTY_COLOUR_BASE[label];
});
Object.keys(PARTY_COLOUR_OVERRIDES).forEach(function (label) {
    PARTY_COLOUR_MAP[normalisePartyKey(label)] = PARTY_COLOUR_OVERRIDES[label];
});

function getPartyColour(label) {
    var key = normalisePartyKey(label || '');
    return PARTY_COLOUR_MAP[key] || '#c0c0c0';
}

function getCountEntry(container, countNumber, candidateId) {
    if (!container.hasOwnProperty(countNumber)) {
        return null;
    }
    var entry = container[countNumber];
    if (!entry) {
        return null;
    }
    if (!entry.hasOwnProperty(candidateId)) {
        return null;
    }
    return entry[candidateId];
}

function buildTransferDisplayText(previousTotal, finalTotal, statusText) {
    var safePrevious = isFinite(previousTotal) ? previousTotal : 0;
    var safeFinal = isFinite(finalTotal) ? finalTotal : safePrevious;
    var delta = safeFinal - safePrevious;
    var text;
    if (delta > 0 && safePrevious > 0) {
        text = formatVoteNumber(safePrevious) + " + " + formatVoteNumber(delta);
    } else if (delta > 0) {
        text = formatVoteNumber(delta);
    } else {
        text = formatVoteNumber(safeFinal);
    }
    if (statusText) {
        text += " " + statusText;
    }
    return text;
}

function getDisplayStatus(entry) {
    if (!entry) {
        return "";
    }
    if (typeof entry.displayStatus === 'string') {
        return entry.displayStatus;
    }
    if (typeof entry.status === 'string') {
        return entry.status;
    }
    return "";
}

function getFinalStatus(entry) {
    if (!entry) {
        return "";
    }
    if (typeof entry.finalStatus === 'string' && entry.finalStatus) {
        return entry.finalStatus;
    }
    if (typeof entry.status === 'string') {
        return entry.status;
    }
    return "";
}

function animateStages(selectionOrYear,constituencyFolder) {

    clearInterval(loop);
    loop = undefined;
    if (activeFinalStatusTimers && activeFinalStatusTimers.length) {
        for (var timerIdx = 0; timerIdx < activeFinalStatusTimers.length; timerIdx++) {
            window.clearTimeout(activeFinalStatusTimers[timerIdx]);
        }
        activeFinalStatusTimers = [];
    }
    $("#animation .votes, #animation .candidateLabel").stop(true, true);
    $("#animation").empty();
    $("#animation").append("<div id='thepost' />")
    $("#animation").append("<div id='theline' />")
    var playButton = $("#pause-replay");
    playButton.off();
    if (playButton.hasClass("fa-play")) {
        playButton.removeClass("fa-play");
        playButton.addClass("fa-pause");
    }
    $("#stageNumbers").off('click');
    $("#stageNumbers").html("");
    $("#quota").text("Loading election data…");
    $("#count_matrix").empty();
    $("#transfers").empty();
    var transfersHeading = $("#transfers_constituency");
    if (transfersHeading.length) {
        transfersHeading.text('');
    }
    var speed = 1;
    var leftPadding = 10;
    var nameSpace = 200;
    var startLeft = leftPadding+nameSpace;
    var voteWidth = 400; // default = 600
    var postPosition = leftPadding + nameSpace + voteWidth;
    var running = true;
    var earlyStage = true;
    var topMargin = 20;

    var useLegacyPath = true;
    var requestUrl;
    if (typeof selectionOrYear === 'object' && selectionOrYear !== null && !Array.isArray(selectionOrYear)) {
        var selection = selectionOrYear;
        requestUrl = '/api/election?date=' + encodeURIComponent(selection.date) +
            '&elected_body=' + encodeURIComponent(selection.electedBody) +
            '&constituency=' + encodeURIComponent(selection.constituency);
        useLegacyPath = false;
    } else {
        var year = selectionOrYear;
        requestUrl = '/' + year + "/constituency/" + constituencyFolder + "/ResultsJson.json";
    }

    var nonTransferableBaseOrder = null;
    var nonTransferableCandidateId = null;
    var nonTransferableTotalsByRound = {};
    var nonTransferableOutgoingByRound = {};
    var nonTransferableIncomingByRound = {};
    var nonTransferableResidualsByRound = {};
    var excludedBeforeFinalRound = {};
    var finalRoundSliceCounter = 0;
    var finalStatusUpdateTimer = null;
    var completedReorderRounds = {};
    var pendingTransferSlices = 0;
    var previousTotalsByCandidate = {};
    var manualExclusionRounds = {};
    var EXCLUSION_TOLERANCE = 0.05;
    var frozenExclusionOrders = {};
    var deferredElectionStatuses = {};

    var json = (function() {
            var json = null;
            $.ajax({
                'async': false,
                'global': false,
                'url': requestUrl,
                'dataType': "json",
                'success': function (data) {
                    json = data;
                },

            })
            .fail(function(e){
                console.log('failed log', e);
                if (!useLegacyPath) {
                    $("#animation").empty();
                    $("#quota").text("No election found");
                    $("#stageNumbers").html("");
                    $("#count_matrix").empty();
                    $("#transfers").empty();
                    if (transfersHeading.length) {
                        transfersHeading.text('');
                    }
                    playButton.removeClass("fa-pause fa-repeat");
                    if (!playButton.hasClass("fa-play")) {
                        playButton.addClass("fa-play");
                    }
                }
            });
            return json;
        })();
    if (json && json.Constituency && json.Constituency.is_forum_election) {
        animateForumElection(json.Constituency);
        return;
    }
    if (!json || !json.Constituency || !json.Constituency.countGroup || !json.Constituency.countGroup.length) {
        if (!useLegacyPath) {
            $("#animation").empty();
            if (!$("#quota").text()) {
                $("#quota").text("No election found");
            }
            $("#stageNumbers").html("");
            $("#count_matrix").empty();
            $("#transfers").empty();
            if (transfersHeading.length) {
                transfersHeading.text('');
            }
            playButton.removeClass("fa-pause fa-repeat");
            if (!playButton.hasClass("fa-play")) {
                playButton.addClass("fa-play");
            }
        }
        return;
    }
    if (json.Constituency.countGroup.length) {
                var     constituency = json.Constituency.countInfo;
                var data = json.Constituency.countGroup;
        }

    if(constituency){
        //set the top right bit
        function safeNumber(value) {
            if (value === null || typeof value === 'undefined') {
                return null;
            }
            var parsed = parseFloat(value);
            return isNaN(parsed) ? null : parsed;
        }

        var totalPoll = safeNumber(constituency["Total_Poll"]);
        var totalElectorate = safeNumber(constituency["Total_Electorate"]);
        var quotaValue = safeNumber(constituency["Quota"]);
        var seats = parseInt(constituency["Number_Of_Seats"], 10);
        if (isNaN(seats) || seats < 0) {
            seats = 0;
        }

        var quotaTextParts = [];
        if (totalPoll !== null) {
            var turnoutText = '';
            if (totalElectorate !== null && totalElectorate > 0) {
                turnoutText = ' (' + ((totalPoll / totalElectorate) * 100).toFixed(2) + '%)';
            }
            quotaTextParts.push('Turnout: ' + formatVoteNumber(totalPoll) + turnoutText);
        }
        if (quotaValue !== null) {
            quotaTextParts.push('Quota: ' + formatVoteNumber(quotaValue));
        }
        if (quotaTextParts.length) {
            $("#quota").text(quotaTextParts.join(' '));
        } else {
            $("#quota").text("Turnout and quota data unavailable");
        }

        $("#seats-span").text(seats ? seats : '');
        $("#theline").css({top:17+(seats)*30});
        $("#theline").width(postPosition);

        var qFactor = 0; // all actual vote counts are multiplied by this to get a div width in proportion
        var quotaLinePosition = null;

        /**
         * The data gets parsed into two dictionaries containing snippets of the following form
         * candidate data object of the form {
         *  id:String,     candidate's id in data
         *  name:String,   candidate's name
         *  status:String, is the candidate elected or excluded
         *  party:String   party string suitable to use as html/css class
         * }
         *
         * countData of the form {
         *  total:Number,      the total for a candidate at specfic round of the count
         *  status:String,     the status of the candidate at specfic round
         *  order:Number       a candidates order at a specfic round
         *  transfers:Boolean  does this candidate transfer in this round
         * }
         **/

        var candidatesDict = {}; //Dictionary of candidates {} id as key
        var candidates = [];     //Array of candidates in order first seen in data
        var countDict = {};      //Dictionary of counts, first level key is count number, which points to a dict of countData with key candidate id
        var transferDict={};     //Corresponding dictionary of transfers indexed by [count number][candidate id]

        function isNonTransferableCandidateId(candidateId) {
            var canonical = canonicalCandidateIdentifier(candidateId);
            if (canonicalMatchesNonTransferable(canonical)) {
                return true;
            }
            if (typeof candidatesDict !== 'object' || candidatesDict === null) {
                return false;
            }
            if (candidateId && candidatesDict.hasOwnProperty(candidateId)) {
                var stored = candidatesDict[candidateId];
                if (stored) {
                    var storedCanonical = canonicalCandidateIdentifier(stored.id || candidateId);
                    if (canonicalMatchesNonTransferable(storedCanonical)) {
                        return true;
                    }
                    if (typeof stored.name === 'string' && canonicalMatchesNonTransferable(canonicalCandidateIdentifier(stored.name))) {
                        return true;
                    }
                    if (typeof stored.party === 'string' && canonicalMatchesNonTransferable(canonicalCandidateIdentifier(stored.party))) {
                        return true;
                    }
                }
            }
            if (typeof candidateId === 'string') {
                var fallbackCanonical = canonicalCandidateIdentifier(candidateId);
                if (canonicalMatchesNonTransferable(fallbackCanonical)) {
                    return true;
                }
            }
            return false;
        }

        function resolveNonTransferableOrder() {
            if (typeof nonTransferableBaseOrder === 'number' && isFinite(nonTransferableBaseOrder)) {
                return nonTransferableBaseOrder;
            }
            if (candidates && candidates.length) {
                return candidates.length - 1;
            }
            return 0;
        }

        function ensureRoundMetadata(candidateMeta) {
            if (!candidateMeta) {
                return;
            }
            if (!candidateMeta.hasOwnProperty('electedRound')) {
                candidateMeta.electedRound = null;
            }
            if (!candidateMeta.hasOwnProperty('excludedRound')) {
                candidateMeta.excludedRound = null;
            }
        }

        function normaliseStatusLabel(status) {
            if (typeof status !== 'string') {
                return 'continuing';
            }
            var lowered = status.toLowerCase();
            if (lowered.indexOf('not elect') !== -1 || lowered.indexOf('not-elect') !== -1) {
                return 'not_elected';
            }
            if (lowered.indexOf('elect') !== -1) {
                return 'elected';
            }
            if (lowered.indexOf('exclud') !== -1 || lowered.indexOf('eliminated') !== -1) {
                return 'excluded';
            }
            return 'continuing';
        }

        function recordStatusRound(candidateId, statusLabel, roundNumber) {
            if (!candidateId || !candidatesDict.hasOwnProperty(candidateId)) {
                return;
            }
            var candidateMeta = candidatesDict[candidateId];
            ensureRoundMetadata(candidateMeta);
            var numericRound = parseInt(roundNumber, 10);
            if (!isFinite(numericRound) || numericRound <= 0) {
                return;
            }
            var statusCategory = normaliseStatusLabel(statusLabel);
            if (statusCategory === 'elected') {
                if (typeof candidateMeta.electedRound !== 'number' || candidateMeta.electedRound > numericRound) {
                    candidateMeta.electedRound = numericRound;
                }
            } else if (statusCategory === 'excluded') {
                if (typeof candidateMeta.excludedRound !== 'number' || candidateMeta.excludedRound > numericRound) {
                    candidateMeta.excludedRound = numericRound;
                }
            }
        }

        function getRecordedRound(candidateId, statusCategory) {
            if (!candidateId || !candidatesDict.hasOwnProperty(candidateId)) {
                return null;
            }
            var candidateMeta = candidatesDict[candidateId];
            ensureRoundMetadata(candidateMeta);
            if (statusCategory === 'elected') {
                return (typeof candidateMeta.electedRound === 'number') ? candidateMeta.electedRound : null;
            }
            if (statusCategory === 'excluded') {
                return (typeof candidateMeta.excludedRound === 'number') ? candidateMeta.excludedRound : null;
            }
            return null;
        }
        function addPositiveTransfer(target, key, amount) {
            if (!target.hasOwnProperty(key)) {
                target[key] = amount;
            } else {
                target[key] += amount;
            }
        }
        var counts = 1;
        var maxTotalVotes = 0;

        function clearFinalStatusTimer() {
            if (finalStatusUpdateTimer !== null) {
                window.clearTimeout(finalStatusUpdateTimer);
                for (var idx = activeFinalStatusTimers.length - 1; idx >= 0; idx--) {
                    if (activeFinalStatusTimers[idx] === finalStatusUpdateTimer) {
                        activeFinalStatusTimers.splice(idx, 1);
                    }
                }
                finalStatusUpdateTimer = null;
            }
        }

        function requestFinalStatusUpdate(roundNumber) {
            if (roundNumber !== counts) {
                return;
            }
            clearFinalStatusTimer();
            var timerHandle = window.setTimeout(function(){
                updateFinalRoundStatuses(roundNumber);
                for (var idx = activeFinalStatusTimers.length - 1; idx >= 0; idx--) {
                    if (activeFinalStatusTimers[idx] === timerHandle) {
                        activeFinalStatusTimers.splice(idx, 1);
                    }
                }
                if (finalStatusUpdateTimer === timerHandle) {
                    finalStatusUpdateTimer = null;
                }
            }, 20);
            finalStatusUpdateTimer = timerHandle;
            activeFinalStatusTimers.push(timerHandle);
        }

        function handleFinalSliceCompletion(roundNumber) {
            if (roundNumber !== counts) {
                return;
            }
            finalRoundSliceCounter = Math.max(0, finalRoundSliceCounter - 1);
            if (finalRoundSliceCounter === 0) {
                requestFinalStatusUpdate(roundNumber);
            }
        }

        function prepareRecipientBar(roundNumber, candidateId, transferAmount) {
            var numericTransfer = transferAmount;
            if (typeof numericTransfer !== 'number') {
                numericTransfer = parseFloat(numericTransfer);
            }
            if (!isFinite(numericTransfer)) {
                numericTransfer = 0;
            }
            var previousEntry = getCountEntry(countDict, roundNumber - 1, candidateId);
            var currentEntry = getCountEntry(countDict, roundNumber, candidateId);
            var previousTotal = previousEntry && isFinite(previousEntry["total"]) ? previousEntry["total"] : 0;
            var inferredFinal = previousTotal + Math.max(numericTransfer, 0);
            var currentTotal = currentEntry && isFinite(currentEntry["total"]) ? currentEntry["total"] : inferredFinal;
            if (!isFinite(currentTotal)) {
                currentTotal = inferredFinal;
            }
            var finalTotal = Math.max(currentTotal, inferredFinal, 0);
            if (!isFinite(finalTotal)) {
                finalTotal = 0;
            }
            var statusText = getDisplayStatus(currentEntry);
            if (!statusText) {
                statusText = getDisplayStatus(previousEntry);
            }
            var finalStatusValue = getFinalStatus(currentEntry);
            var displayText = buildTransferDisplayText(previousTotal, finalTotal, statusText);
            var orderValue = 0;
            if (currentEntry && isFinite(currentEntry["order"])) {
                orderValue = currentEntry["order"];
            } else if (previousEntry && isFinite(previousEntry["order"])) {
                orderValue = previousEntry["order"];
            }
            var startOrder = 0;
            if (previousEntry && isFinite(previousEntry["order"])) {
                startOrder = previousEntry["order"];
            } else if (candidatesDict.hasOwnProperty(candidateId)) {
                var candidateInfo = candidatesDict[candidateId];
                if (candidateInfo && isFinite(candidateInfo.order)) {
                    startOrder = candidateInfo.order;
                } else if (candidateInfo && isFinite(candidateInfo.baseOrder)) {
                    startOrder = candidateInfo.baseOrder;
                }
            } else if (currentEntry && isFinite(currentEntry["order"])) {
                startOrder = currentEntry["order"];
            }
            if (isNonTransferableCandidateId(candidateId)) {
                var fixedOrder = resolveNonTransferableOrder();
                orderValue = fixedOrder;
                startOrder = fixedOrder;
            }
            var bar = $("#candidate" + candidateId);
            bar.stop(true, false);
            var geometry = computeRecipientSliceGeometry(previousTotal, numericTransfer, finalTotal, qFactor);
            if (bar.length) {
                if (isFinite(geometry.previousWidth)) {
                    bar.width(geometry.previousWidth);
                } else {
                    bar.width(Math.max(previousTotal, 0) * qFactor);
                }
            }
            bar.data('pendingTransferRound', roundNumber);
            bar.data('pendingTransfer', {
                finalTotal: finalTotal,
                displayText: displayText,
                startOrder: startOrder,
                targetOrder: orderValue,
                geometry: geometry
            });
            return {
                previousTotal: previousTotal,
                finalTotal: finalTotal,
                statusText: statusText,
                finalStatus: finalStatusValue,
                textValue: displayText,
                targetOrder: orderValue,
                startOrder: startOrder,
                geometry: geometry
            };
        }

        function updateFinalRoundStatuses(roundNumber) {
            if (!roundNumber || !countDict.hasOwnProperty(roundNumber)) {
                return;
            }
            var finalRoundData = countDict[roundNumber];
            if (!finalRoundData) {
                return;
            }
            for (var idx = 0; idx < candidates.length; idx++) {
                var candidateInfo = candidates[idx];
                if (!candidateInfo) {
                    continue;
                }
                var candidateId = candidateInfo.id;
                if (isNonTransferableCandidateId(candidateId)) {
                    continue;
                }
                if (!finalRoundData.hasOwnProperty(candidateId)) {
                    continue;
                }
                var entry = finalRoundData[candidateId];
                if (!entry) {
                    continue;
                }
                var excludedKey = String(candidateId);
                if (excludedBeforeFinalRound.hasOwnProperty(excludedKey) && excludedBeforeFinalRound[excludedKey]) {
                    continue;
                }
                if (entry.transfers) {
                    continue;
                }
                var finalOrder = 0;
                if (isFinite(entry.order)) {
                    finalOrder = entry.order;
                } else if (candidatesDict.hasOwnProperty(candidateId) && isFinite(candidatesDict[candidateId].order)) {
                    finalOrder = candidatesDict[candidateId].order;
                } else if (isFinite(candidateInfo.baseOrder)) {
                    finalOrder = candidateInfo.baseOrder;
                }
                var statusText;
                if (seats && seats > 0 && finalOrder < seats) {
                    statusText = "Elected";
                } else {
                    statusText = "Not Elected";
                }
                entry.status = statusText;
                entry.displayStatus = statusText;
                entry.finalStatus = statusText;
                if (candidatesDict.hasOwnProperty(candidateId)) {
                    candidatesDict[candidateId].status = statusText;
                    candidatesDict[candidateId].displayStatus = statusText;
                    candidatesDict[candidateId].finalStatus = statusText;
                }
                recordStatusRound(candidateId, statusText, roundNumber);
                var previousEntry = getCountEntry(countDict, roundNumber - 1, candidateId);
                var currentTotal = entry && isFinite(entry.total) ? entry.total : 0;
                var previousTotal = previousEntry && isFinite(previousEntry["total"]) ? previousEntry["total"] : currentTotal;
                var displayText = buildTransferDisplayText(previousTotal, currentTotal, statusText);
                var bar = $("#candidate"+candidateId);
                if (bar.length) {
                    bar.width(currentTotal * qFactor);
                    bar.text(displayText);
                }
            }
            if (countDict.hasOwnProperty(roundNumber)) {
                adjustOrder(countDict[roundNumber], roundNumber);
                finalizeCandidateReorder(roundNumber);
            }
        }

        function resolveStartOrder(progressInfo, previousEntry, candidateId, currentEntry) {
            if (progressInfo && isFinite(progressInfo.startOrder)) {
                return progressInfo.startOrder;
            }
            if (isNonTransferableCandidateId(candidateId)) {
                return resolveNonTransferableOrder();
            }
            if (previousEntry && isFinite(previousEntry["order"])) {
                return previousEntry["order"];
            }
            if (candidatesDict.hasOwnProperty(candidateId)) {
                var stored = candidatesDict[candidateId];
                if (stored) {
                    if (isFinite(stored.order)) {
                        return stored.order;
                    }
                    if (isFinite(stored.baseOrder)) {
                        return stored.baseOrder;
                    }
                }
            }
            if (currentEntry && isFinite(currentEntry["order"])) {
                return currentEntry["order"];
            }
            return 0;
        }

        //loop through all the data and populate the various dictionaries
        for (var i=0; i<data.length; i++) {
            var countKey = data[i]["Count_Number"];
            if (!(countKey in countDict)) {
                countDict[countKey] = {};
            }
            if (!(countKey in transferDict)) {
                transferDict[countKey] = {};
            }
            var totalVotes = safeNumber(data[i]["Total_Votes"]);
            if (totalVotes === null) {
                totalVotes = 0;
            }
            if (totalVotes > maxTotalVotes) {
                maxTotalVotes = totalVotes;
            }
            var transferValue = safeNumber(data[i]["Transfers"]);
            if (transferValue === null) {
                transferValue = 0;
            }
            var partyColour = data[i]["Party_Colour"] || null;
            var rawCandidateId = data[i]["Candidate_Id"];
            var candidateId = normaliseCandidateIdentifier(rawCandidateId, data[i]);
            var candidateIsNonTransferable = canonicalMatchesNonTransferable(canonicalCandidateIdentifier(candidateId));
            if (candidateIsNonTransferable) {
                nonTransferableCandidateId = candidateId;
            }
            var parsedCount = parseInt(countKey, 10);
            if (isNaN(parsedCount)) {
                var countMatch = String(countKey || "").match(/\d+/);
                if (countMatch && countMatch.length) {
                    parsedCount = parseInt(countMatch[0], 10);
                }
            }
            if (!isFinite(parsedCount)) {
                parsedCount = 0;
            }
            var statusText = (typeof(data[i]["Status"])==="string") ? data[i]["Status"] : "";
            if (!candidateIsNonTransferable && statusText === "Excluded" && !manualExclusionRounds.hasOwnProperty(candidateId)) {
                manualExclusionRounds[candidateId] = parsedCount > 0 ? parsedCount : 1;
            }
            var previousTotal = null;
            if (parsedCount > 1) {
                if (previousTotalsByCandidate.hasOwnProperty(candidateId)) {
                    previousTotal = previousTotalsByCandidate[candidateId];
                }
                if (previousTotal === null || typeof previousTotal === 'undefined') {
                    var previousEntry = getCountEntry(countDict, parsedCount - 1, candidateId);
                    if (previousEntry && isFinite(previousEntry["total"])) {
                        previousTotal = previousEntry["total"];
                    }
                }
            }
            var shouldFlagExcluded = false;
            if (!candidateIsNonTransferable && transferValue < 0) {
                var baseline = previousTotal;
                if ((baseline === null || typeof baseline === 'undefined') && parsedCount <= 1) {
                    baseline = totalVotes;
                }
                if (baseline !== null && typeof baseline !== 'undefined' && isFinite(baseline)) {
                    if (Math.abs(Math.abs(transferValue) - Math.abs(baseline)) <= EXCLUSION_TOLERANCE) {
                        shouldFlagExcluded = true;
                    }
                }
            }
            if (!candidateIsNonTransferable && !shouldFlagExcluded) {
                var previousWasPositive = previousTotal !== null && typeof previousTotal !== 'undefined' && isFinite(previousTotal) && previousTotal > EXCLUSION_TOLERANCE;
                var currentIsZero = totalVotes !== null && typeof totalVotes !== 'undefined' && isFinite(totalVotes) && Math.abs(totalVotes) <= EXCLUSION_TOLERANCE;
                if (previousWasPositive && currentIsZero && transferValue <= 0) {
                    shouldFlagExcluded = true;
                }
            }
            if (!candidateIsNonTransferable && shouldFlagExcluded) {
                var effectiveRound = parsedCount > 0 ? parsedCount : 1;
                manualExclusionRounds[candidateId] = effectiveRound;
            }
            if (parsedCount > 0 && candidateIsNonTransferable) {
                nonTransferableTotalsByRound[parsedCount] = isFinite(totalVotes) ? totalVotes : 0;
            }
            if (parsedCount > 1 && !candidateIsNonTransferable) {
                var numericTransfer = isFinite(transferValue) ? transferValue : 0;
                if (numericTransfer < 0) {
                    var outgoing = Math.abs(numericTransfer);
                    if (!nonTransferableOutgoingByRound.hasOwnProperty(parsedCount)) {
                        nonTransferableOutgoingByRound[parsedCount] = 0;
                    }
                    nonTransferableOutgoingByRound[parsedCount] += outgoing;
                } else if (numericTransfer > 0) {
                    if (!nonTransferableIncomingByRound.hasOwnProperty(parsedCount)) {
                        nonTransferableIncomingByRound[parsedCount] = 0;
                    }
                    nonTransferableIncomingByRound[parsedCount] += numericTransfer;
                }
            } else if (parsedCount > 1 && candidateIsNonTransferable && transferValue > 0) {
                if (!nonTransferableIncomingByRound.hasOwnProperty(parsedCount)) {
                    nonTransferableIncomingByRound[parsedCount] = 0;
                }
                nonTransferableIncomingByRound[parsedCount] += transferValue;
            }
            if (!candidateIsNonTransferable && manualExclusionRounds.hasOwnProperty(candidateId)) {
                var exclusionRound = manualExclusionRounds[candidateId];
                if (exclusionRound && exclusionRound > 1) {
                    for (var rewind = 1; rewind < exclusionRound; rewind++) {
                        if (!countDict.hasOwnProperty(rewind)) {
                            continue;
                        }
                        if (!countDict[rewind].hasOwnProperty(candidateId)) {
                            continue;
                        }
                        var rewindEntry = countDict[rewind][candidateId];
                        if (!rewindEntry || typeof rewindEntry["status"] !== "string") {
                            continue;
                        }
                        var rewindLower = rewindEntry["status"].toLowerCase();
                        if (rewindLower === "excluded" || rewindLower === "eliminated") {
                            rewindEntry["status"] = "";
                            rewindEntry.displayStatus = "";
                            rewindEntry.finalStatus = "";
                        }
                    }
                }
                if (parsedCount >= exclusionRound) {
                    statusText = "Excluded";
                } else {
                    var loweredStatus = typeof statusText === 'string' ? statusText.toLowerCase() : "";
                    if (loweredStatus === "excluded" || loweredStatus === "eliminated") {
                        statusText = "";
                    }
                }
            }
            countDict[countKey][candidateId] = {
                total:totalVotes,
                status:statusText,
                displayStatus:statusText,
                finalStatus:statusText,
                order:0,
                transfers:((statusText == "Excluded" && transferValue < 0) ||
                           (statusText == "Elected" && transferValue < 0))
            };
            transferDict[countKey][candidateId] = Math.max(0, transferValue);

            if (!(candidateId in candidatesDict)) {
                var party = data[i]["Party_Name"];
                if (typeof(party)!="string" || candidateIsNonTransferable){ party = candidateIsNonTransferable ? "NonTransferable" : "Non-Party";}
                party=party.replace(/\s+/g,"-");
                if (partyColour) {
                    partyColour = normaliseColour(partyColour);
                }
                var firstName = typeof(data[i]["Firstname"])==="string" ? data[i]["Firstname"].trim() : "";
                var surname = typeof(data[i]["Surname"])==="string" ? data[i]["Surname"].trim() : "";
                var displayName = (firstName + " " + surname).trim();
                if (!displayName && typeof data[i]["Candidate_Name"] === 'string') {
                    displayName = data[i]["Candidate_Name"].trim();
                }
                if (!displayName && typeof data[i]["Candidate"] === 'string') {
                    displayName = data[i]["Candidate"].trim();
                }
                if (!displayName) {
                    displayName = candidateIsNonTransferable ? "Non-transferable" : "";
                }
                candidates.push({
                    name:displayName,
                    id:candidateId,
                    status:statusText,
                    displayStatus:statusText,
                    finalStatus:statusText,
                    party:party,
                    colour:partyColour,
                    fixedPosition:candidateIsNonTransferable
                });
                candidatesDict[candidateId] = {
                    name:displayName,
                    id:candidateId,
                    status:statusText,
                    displayStatus:statusText,
                    finalStatus:statusText,
                    party:party,
                    colour:partyColour,
                    fixedPosition:candidateIsNonTransferable,
                    electedRound:null,
                    excludedRound:null
                };
            } else if (candidatesDict[candidateId]) {
                ensureRoundMetadata(candidatesDict[candidateId]);
                candidatesDict[candidateId].status = statusText;
                candidatesDict[candidateId].displayStatus = statusText;
                candidatesDict[candidateId].finalStatus = statusText;
            }
            previousTotalsByCandidate[candidateId] = totalVotes;
            counts = Math.max(counts, parsedCount);
            recordStatusRound(candidateId, statusText, parsedCount);
        }

        for (var roundIndex = 1; roundIndex < counts; roundIndex++) {
            if (!countDict.hasOwnProperty(roundIndex)) {
                continue;
            }
            var roundEntries = countDict[roundIndex];
            for (var candidateKey in roundEntries) {
                if (!roundEntries.hasOwnProperty(candidateKey)) {
                    continue;
                }
                var statusLabel = roundEntries[candidateKey]["status"];
                if (typeof statusLabel === "string") {
                    var statusLower = statusLabel.toLowerCase();
                    if (statusLower === "excluded" || statusLower === "eliminated") {
                        excludedBeforeFinalRound[String(candidateKey)] = true;
                    }
                }
            }
        }

        var tolerance = 1e-6;
        var nonTransferableTimeline = [];
        var runningNonTransferable = 0;
        var encounteredNonTransferable = false;
        for (var roundNumber = 1; roundNumber <= counts; roundNumber++) {
            var explicitTotal = nonTransferableTotalsByRound.hasOwnProperty(roundNumber) ? nonTransferableTotalsByRound[roundNumber] : null;
            var resolvedTotal = null;
            if (explicitTotal !== null && typeof explicitTotal !== 'undefined' && isFinite(explicitTotal)) {
                runningNonTransferable = explicitTotal;
                encounteredNonTransferable = true;
                nonTransferableResidualsByRound[roundNumber] = 0;
                resolvedTotal = runningNonTransferable;
            } else {
                var outgoingSum = nonTransferableOutgoingByRound.hasOwnProperty(roundNumber) ? nonTransferableOutgoingByRound[roundNumber] : 0;
                var incomingSum = nonTransferableIncomingByRound.hasOwnProperty(roundNumber) ? nonTransferableIncomingByRound[roundNumber] : 0;
                var residual = outgoingSum - incomingSum;
                if (residual < 0 && Math.abs(residual) <= tolerance) {
                    residual = 0;
                }
                if (residual > tolerance) {
                    runningNonTransferable += residual;
                    encounteredNonTransferable = true;
                    nonTransferableResidualsByRound[roundNumber] = residual;
                } else {
                    nonTransferableResidualsByRound[roundNumber] = 0;
                }
                resolvedTotal = encounteredNonTransferable ? runningNonTransferable : 0;
            }
            if (!encounteredNonTransferable && (!isFinite(resolvedTotal) || resolvedTotal < 0)) {
                resolvedTotal = 0;
            }
            if (!isFinite(resolvedTotal)) {
                resolvedTotal = runningNonTransferable;
            }
            if (!isFinite(resolvedTotal)) {
                resolvedTotal = 0;
            }
            nonTransferableTimeline[roundNumber] = resolvedTotal;
        }

        if (!nonTransferableCandidateId) {
            nonTransferableCandidateId = NON_TRANSFERABLE_CANONICAL;
        }

        if (!candidatesDict.hasOwnProperty(nonTransferableCandidateId)) {
            var nonTransferableColour = '#707070';
            candidates.push({
                name: 'Non-transferable',
                id: nonTransferableCandidateId,
                status: '',
                displayStatus: '',
                finalStatus: '',
                party: 'NonTransferable',
                colour: nonTransferableColour,
                fixedPosition: true
            });
            candidatesDict[nonTransferableCandidateId] = {
                name: 'Non-transferable',
                id: nonTransferableCandidateId,
                status: '',
                displayStatus: '',
                finalStatus: '',
                party: 'NonTransferable',
                colour: nonTransferableColour,
                fixedPosition: true,
                electedRound: null,
                excludedRound: null,
                baseOrder: null,
                order: null
            };
        } else {
            var storedNonTransferableMeta = candidatesDict[nonTransferableCandidateId];
            if (storedNonTransferableMeta) {
                storedNonTransferableMeta.fixedPosition = true;
            }
            for (var fixIdx = 0; fixIdx < candidates.length; fixIdx++) {
                if (candidates[fixIdx] && candidates[fixIdx].id === nonTransferableCandidateId) {
                    candidates[fixIdx].fixedPosition = true;
                    break;
                }
            }
        }

        for (var ensureRound = 1; ensureRound <= counts; ensureRound++) {
            var roundKey = ensureRound;
            if (!countDict.hasOwnProperty(roundKey)) {
                countDict[roundKey] = {};
            }
            var nonTransferableEntry = getCountEntry(countDict, roundKey, nonTransferableCandidateId);
            var totalForRound = nonTransferableTimeline.hasOwnProperty(roundKey) ? nonTransferableTimeline[roundKey] : 0;
            if (!isFinite(totalForRound) || totalForRound < 0) {
                totalForRound = 0;
            }
            if (!nonTransferableEntry) {
                countDict[roundKey][nonTransferableCandidateId] = {
                    total: totalForRound,
                    status: '',
                    displayStatus: '',
                    finalStatus: '',
                    order: resolveNonTransferableOrder(),
                    transfers: false
                };
            } else {
                nonTransferableEntry.total = totalForRound;
                if (typeof nonTransferableEntry.status !== 'string') {
                    nonTransferableEntry.status = '';
                }
                if (typeof nonTransferableEntry.displayStatus !== 'string') {
                    nonTransferableEntry.displayStatus = nonTransferableEntry.status;
                }
                if (typeof nonTransferableEntry.finalStatus !== 'string') {
                    nonTransferableEntry.finalStatus = nonTransferableEntry.status;
                }
            }
            if (!transferDict.hasOwnProperty(roundKey)) {
                transferDict[roundKey] = {};
            }
            var residualAmount = nonTransferableResidualsByRound.hasOwnProperty(ensureRound) ? nonTransferableResidualsByRound[ensureRound] : 0;
            if (residualAmount > tolerance) {
                transferDict[roundKey][nonTransferableCandidateId] = residualAmount;
            } else if (!transferDict[roundKey].hasOwnProperty(nonTransferableCandidateId)) {
                transferDict[roundKey][nonTransferableCandidateId] = 0;
            }
        }

        previousTotalsByCandidate[nonTransferableCandidateId] = nonTransferableTimeline.hasOwnProperty(counts) ? nonTransferableTimeline[counts] : 0;

        var ordered = [];
        var nonTransferableEntries = [];
        for (var idx = 0; idx < candidates.length; idx++) {
            var candidateEntry = candidates[idx];
            if (isNonTransferableCandidateId(candidateEntry.id)) {
                nonTransferableEntries.push(candidateEntry);
            } else {
                ordered.push(candidateEntry);
            }
        }
        candidates = ordered.concat(nonTransferableEntries);

        for (var orderedIdx = 0; orderedIdx < candidates.length; orderedIdx++) {
            var candidateMeta = candidates[orderedIdx];
            var candidateIdentifier = candidateMeta.id;
            if (candidatesDict.hasOwnProperty(candidateIdentifier)) {
                candidatesDict[candidateIdentifier].baseOrder = orderedIdx;
                candidatesDict[candidateIdentifier].order = orderedIdx;
            }
            candidates[orderedIdx].baseOrder = orderedIdx;
            if (isNonTransferableCandidateId(candidateIdentifier)) {
                nonTransferableBaseOrder = orderedIdx;
            }
        }

        if ((quotaValue !== null && quotaValue > 0)) {
            qFactor = voteWidth / quotaValue;
            quotaLinePosition = startLeft + (quotaValue * qFactor);
        } else if (maxTotalVotes > 0) {
            qFactor = voteWidth / maxTotalVotes;
            quotaLinePosition = null;
        } else {
            qFactor = 0;
            quotaLinePosition = null;
        }

        if (quotaLinePosition !== null) {
            var minQuotaLeft = startLeft;
            var maxQuotaLeft = startLeft + voteWidth;
            if (quotaLinePosition < minQuotaLeft) {
                quotaLinePosition = minQuotaLeft;
            } else if (quotaLinePosition > maxQuotaLeft) {
                quotaLinePosition = maxQuotaLeft;
            }
        }

        if (!seats) {
            var electedCount = 0;
            for (var idx=0; idx<candidates.length; idx++) {
                if (candidates[idx].status === "Elected") {
                    electedCount += 1;
                }
            }
            seats = electedCount;
            $("#seats-span").text(seats ? seats : '');
            $("#theline").css({top:17+(seats)*30});
        }

        //once we have all the data in the countDict we can now go through each count and order it
        //we do this in order as once a candidate is elected we store their final order in the candidatesDict and reuse it subsquent counts
        //only sorting candidates that are not eliminated or elected

        for (var k=1; k<=counts;k++){
            if (countDict.hasOwnProperty(k)) {
                adjustOrder(countDict[k], k);
            }
        }

        //now we have the data set up we just hook up our links to functions

        $("#pause-replay").off('click');
        $("#step").off('click');
        $("#again").off('click');

        $("#pause-replay").click(function(event) {
            event.preventDefault();
            if ($(this).hasClass("fa-pause")) {
                $(this).removeClass("fa-pause");
                $(this).addClass("fa-play");
                pause();
            } else if ($(this).hasClass("fa-play")) {
                $(this).removeClass("fa-play");
                $(this).addClass("fa-pause");
                resume();
            } else {
                $(this).addClass("fa-pause");
                replay(1);
            }
        });

        $("#step").click(function(event) {
            event.preventDefault();
            step();
        });

        $("#again").click(function(event) {
            event.preventDefault();
            again();
        });

        $("#stageNumbers").html("");
        for (i = 1; i < counts+1; i++) {
            var marker = $("<div class='stageNumber' id='stageNumber-" + i + " />");
            $("#stageNumbers").append("<div class='stageNumber' id='stageNumber-" + i + "'><p>" + i + "</p></div>");
        }

        // bind click events to stage numbers
        $(".stageNumber").off('click');
        $(".stageNumber").click(function (event) {
            var id = parseInt($(this).attr('id').replace("stageNumber-",""));
            jumpToStep(id);
        })

        firstCount();  //run the first count
        var countNumber = 2;  //global loop variable
        // set the advance count function to run in a loop
        loop = window.setInterval(advanceCount,4000*speed);
    }else{
        //if we didn't load a constituency var then we have no data yet
        $("#quota").text("There is no data up for this constituency at present. Once we receive and add it, it will display here.");
		$("#stageNumbers").html("");
    }

    //the magic, simple enough, append some divs and animate their width's to final position
    //then animate their top to final position and move the name div at the same time
    function firstCount(){
		$("#animation").height(candidates.length*30);
        $("#thepost").height(candidates.length*30);
        if (quotaLinePosition !== null) {
            $("#thepost").show();
            $("#thepost").css("left", quotaLinePosition); // set position of quota threshold
        } else {
            $("#thepost").hide();
        }
        $(".stageNumber").removeClass("completed");
        $(".stageNumber").removeClass("active");
        $("#stageNumber-1").addClass("active");
        //setActiveMarker(1);
        resetDeferredElectionStatusesForRound(1);
        for(var j=0;j<candidates.length;j++){
            var labelClasses = 'candidateLabel';
            if (candidates[j]["party"]) {
                labelClasses += ' ' + candidates[j]["party"] + '_label';
            }
            var label = $('<div id="cname'+candidates[j].id+'" class="'+labelClasses+'" style="top:'+(topMargin+ (j*30)) +'px;left:10px;">'+candidates[j]["name"]+'</div>');
            label.appendTo("#animation");
            decorateLabel(label, candidates[j].colour);

            var vote = $('<div data-candidate="'+candidates[j].id+'" id="candidate'+candidates[j].id+'" class="votes" style="top:'+(topMargin+ (j*30)) +'px;left:'+startLeft+'px;"></div>');
            vote.appendTo("#animation");
            applyVoteColour(vote, candidates[j].colour);
            var initialEntry = getCountEntry(countDict, 1, candidates[j].id);
            var initialTotal = initialEntry ? initialEntry["total"] : 0;
            var initialStatus = getDisplayStatus(initialEntry);
            var initialOrder = initialEntry ? initialEntry["order"] : j;
            if (isNonTransferableCandidateId(candidates[j].id)) {
                initialOrder = resolveNonTransferableOrder();
            }
            var initialText = buildTransferDisplayText(0, initialTotal, initialStatus);
            vote.animate({width:initialTotal * qFactor},1500*speed).text(initialText)
            .animate({top:topMargin+(initialOrder*30)},{
                duration:500*speed,
                start:function(){
                    var candidateId = $(this).data('candidate');
                    var entry = getCountEntry(countDict, 1, candidateId);
                    var order = entry ? entry["order"] : 0;
                    if (isNonTransferableCandidateId(candidateId)) {
                        order = resolveNonTransferableOrder();
                    }
                    $("#cname"+candidateId)
                    .animate({top:topMargin+(order*30)},500*speed)
                    if (!running) {
                        $(".active").addClass("completed");
                        $(".stageNumber").removeClass("active");
                    }
                }
            });
        }
        window.setTimeout(function(){
            applyDeferredElectionStatuses(1);
        }, (1500*speed) + (500*speed) + 50);
    }

    //find the first candidate who is transferring, all transfers from the round start from here
    //append some divs with width relative to transfer number, animate them to their candidates current order
    //then animate them accross to end of candidates vote pile, when complete remove the new div and update the candidates div width
    //finally run the reorder animation
    function advanceCount(){
        var transfered=false;
        if(countNumber in countDict){
            earlyStage = true;
            var i = countNumber;
            var isLastCount = (i === counts);
            if (isLastCount) {
                finalRoundSliceCounter = 0;
                clearFinalStatusTimer();
            }
            resetDeferredElectionStatusesForRound(i);
            setActiveMarker(countNumber);
            $("#count-span").text(countNumber);
            updateCounter(countNumber);
            var combinedTransfers = {};
            var totalRecipientTransfer = 0;
            pendingTransferSlices = 0;
            delete completedReorderRounds[i];
            var previousRoundIndex = i - 1;
            var longestPreviousBarWidth = 0;
            if (previousRoundIndex >= 1) {
                for (var candidateIdx = 0; candidateIdx < candidates.length; candidateIdx++) {
                    var candidateInfo = candidates[candidateIdx];
                    if (!candidateInfo) {
                        continue;
                    }
                    var candidateKey = candidateInfo.id;
                    var priorEntry = getCountEntry(countDict, previousRoundIndex, candidateKey);
                    var priorTotal = priorEntry && isFinite(priorEntry["total"]) ? priorEntry["total"] : 0;
                    var candidateWidth = Math.max(priorTotal, 0) * qFactor;
                    if (candidateWidth > longestPreviousBarWidth) {
                        longestPreviousBarWidth = candidateWidth;
                    }
                }
            }
            var transferHoldingLeft = startLeft + longestPreviousBarWidth + 20;
            function collectTransfers(source) {
                for (var key in source) {
                    if (!source.hasOwnProperty(key)) {
                        continue;
                    }
                    var rawValue = source[key];
                    var numericValue = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue);
                    if (!isFinite(numericValue) || numericValue <= 0) {
                        continue;
                    }
                    addPositiveTransfer(combinedTransfers, key, numericValue);
                }
            }
            var transferSources = [];
            if (transferDict.hasOwnProperty(i)) {
                transferSources.push(i);
            }
            if (!transferSources.length && i > 1 && transferDict.hasOwnProperty(i - 1)) {
                transferSources.push(i - 1);
            }
            for (var sourceIndex = 0; sourceIndex < transferSources.length; sourceIndex++) {
                var sourceRound = transferSources[sourceIndex];
                collectTransfers(transferDict[sourceRound]);
            }
            var positiveRecipients = [];
            var recipientProgressById = {};
            for (var recipientKey in combinedTransfers) {
                if (!combinedTransfers.hasOwnProperty(recipientKey)) {
                    continue;
                }
                var recipientAmount = combinedTransfers[recipientKey];
                if (!(recipientAmount > 0)) {
                    continue;
                }
                totalRecipientTransfer += recipientAmount;
                positiveRecipients.push({ id: recipientKey, amount: recipientAmount });
            }
            for (var progressIdx = 0; progressIdx < positiveRecipients.length; progressIdx++) {
                var progressEntry = positiveRecipients[progressIdx];
                recipientProgressById[progressEntry.id] = prepareRecipientBar(i, progressEntry.id, progressEntry.amount);
            }
            for (var j=0;j<candidates.length;j++) {
                var candidateId = candidates[j].id;
                var currentData = getCountEntry(countDict, i, candidateId);
                var previousData = getCountEntry(countDict, i-1, candidateId);
                if (!currentData && !previousData) {
                    continue;
                }
                var donorFlag = currentData && currentData["transfers"];
                if (donorFlag) {
                    var previousTotal = 0;
                    if (previousData && isFinite(previousData["total"])) {
                        previousTotal = previousData["total"];
                    } else if (currentData && isFinite(currentData["total"])) {
                        previousTotal = currentData["total"];
                    }
                    var currentTotal = currentData && isFinite(currentData["total"]) ? currentData["total"] : Math.max(previousTotal - totalRecipientTransfer, 0);
                    var statusText = getDisplayStatus(currentData);
                    if (!statusText) {
                        statusText = getDisplayStatus(previousData);
                    }
                    var previousOrder = previousData && isFinite(previousData["order"]) ? previousData["order"] : (currentData && isFinite(currentData["order"]) ? currentData["order"] : 0);
                    var finalOrder = currentData && isFinite(currentData["order"]) ? currentData["order"] : previousOrder;
                    var top = topMargin + (previousOrder * 30);
                    var bar = $("#candidate"+candidateId);
                    bar.stop(true, false);
                    bar.width(previousTotal * qFactor);
                    var leftEdge = startLeft + previousTotal * qFactor;
                    var finalText = buildTransferDisplayText(previousTotal, currentTotal, statusText);
                    var donorFinalised = false;
                    function applyDonorFinalState() {
                        if (donorFinalised) {
                            return;
                        }
                        bar.stop(true, false);
                        bar.width(currentTotal * qFactor);
                        bar.text(finalText);
                        donorFinalised = true;
                    }
                    if (!transfered){
                        for (var t=0;t<candidates.length;t++) {
                            var recipientId = candidates[t].id;
                            var recipientData = getCountEntry(countDict, i, recipientId);
                            var recipientPrevious = getCountEntry(countDict, i-1, recipientId);
                            var recipientTransfers = combinedTransfers.hasOwnProperty(recipientId) ? combinedTransfers[recipientId] : 0;
                            if (recipientTransfers <= 0 || (recipientData && recipientData["transfers"])) {
                                continue;
                            }
                            var previousTotalValue = recipientPrevious && isFinite(recipientPrevious["total"]) ? recipientPrevious["total"] : 0;
                            var recipientProgress = recipientProgressById.hasOwnProperty(recipientId) ? recipientProgressById[recipientId] : prepareRecipientBar(i, recipientId, recipientTransfers);
                            var recipientFinalTotal = recipientProgress ? recipientProgress.finalTotal : (recipientData && isFinite(recipientData["total"]) ? recipientData["total"] : (previousTotalValue + Math.max(recipientTransfers, 0)));
                            var geometry = recipientProgress && recipientProgress.geometry ? recipientProgress.geometry : computeRecipientSliceGeometry(previousTotalValue, recipientTransfers, recipientFinalTotal, qFactor);
                            var sliceWidth = geometry.sliceWidth;
                            var arrivalLeft = startLeft + geometry.sliceLeft;
                            var recipientOrder = resolveStartOrder(recipientProgress, recipientPrevious, recipientId, recipientData);
                            var transferSlice = $('<div class="votes" data-candidate="'+recipientId+'"></div>');
                            leftEdge = leftEdge - sliceWidth;
                            transferSlice.css({
                                width: sliceWidth + 'px',
                                left: leftEdge + 'px',
                                top: top + 'px',
                            });
                            var recipientColour = candidatesDict[recipientId] ? candidatesDict[recipientId].colour : null;
                            applyVoteColour(transferSlice, recipientColour);
                            transferSlice.data('transferProgress', recipientProgress);
                            transferSlice.data('round', i);
                            transferSlice.data('geometry', geometry);
                            var recipientBar = $("#candidate"+recipientId);
                            recipientBar.stop(true, false);
                            applyDonorFinalState();
                            if (isLastCount) {
                                finalRoundSliceCounter += 1;
                            }
                            pendingTransferSlices += 1;
                            transferSlice
                                .appendTo("#animation").delay(300*speed)
                                .animate({
                                    top: topMargin + (recipientOrder * 30),
                                    left: transferHoldingLeft
                                },900*speed, function(){
                                    earlyStage = false;
                                }).delay(100*speed)
                                .animate({left: arrivalLeft},900*speed, function(){
                                    var targetId = $(this).data('candidate');
                                    var roundNumber = $(this).data('round');
                                    var progress = $(this).data('transferProgress') || null;
                                    var current = getCountEntry(countDict, roundNumber, targetId);
                                    var currentOrder = progress ? progress.targetOrder : (current && isFinite(current["order"]) ? current["order"] : 0);
                                    var finalTotalValue = progress ? progress.finalTotal : (current && isFinite(current["total"]) ? current["total"] : 0);
                                    var previousEntry = getCountEntry(countDict, roundNumber - 1, targetId);
                                    var statusValue = progress ? progress.statusText : getDisplayStatus(current);
                                    if (!statusValue) {
                                        statusValue = getDisplayStatus(previousEntry);
                                    }
                                    var previousTotalValue = progress ? progress.previousTotal : (previousEntry && isFinite(previousEntry["total"]) ? previousEntry["total"] : 0);
                                    var displayText = progress ? progress.textValue : buildTransferDisplayText(previousTotalValue, finalTotalValue, statusValue);
                                    if (isNonTransferableCandidateId(targetId)) {
                                        currentOrder = resolveNonTransferableOrder();
                                    }
                                    var recipientBar = $("#candidate"+targetId);
                                    recipientBar.stop(true, false);
                                    var sliceGeometry = $(this).data('geometry');
                                    if (!sliceGeometry && progress && progress.geometry) {
                                        sliceGeometry = progress.geometry;
                                    }
                                    if (!sliceGeometry) {
                                        sliceGeometry = computeRecipientSliceGeometry(previousTotalValue, combinedTransfers.hasOwnProperty(targetId) ? combinedTransfers[targetId] : 0, finalTotalValue, qFactor);
                                    }
                                    recipientBar.width(sliceGeometry.targetBarWidth);
                                    recipientBar.text(displayText);
                                    recipientBar.data('finalOrder', currentOrder);
                                    recipientBar.removeData('pendingTransfer');
                                    recipientBar.removeData('pendingTransferRound');
                                    $("#cname"+targetId).data('finalOrder', currentOrder);
                                    $(this).remove();
                                    handleTransferSliceCompletion(roundNumber, isLastCount);
                                    if (!running) {
                                        $(".active").addClass("completed");
                                        $(".stageNumber").removeClass("active");
                                    }
                                });
                        }
                        transfered = true;
                    }
                    if (!donorFinalised) {
                        applyDonorFinalState();
                    }
                    if (isNonTransferableCandidateId(candidateId)) {
                        finalOrder = resolveNonTransferableOrder();
                    }
                    bar.data('finalOrder', finalOrder);
                    $("#cname"+candidateId).data('finalOrder', finalOrder);
                } else if (currentData) {
                    var recipientBar = $("#candidate"+candidateId);
                    var pendingRound = recipientBar.data('pendingTransferRound');
                    var pendingInfo = recipientBar.data('pendingTransfer');
                    if (!(pendingRound === i && pendingInfo)) {
                        var newTotal = currentData["total"] || 0;
                        var displayStatus = getDisplayStatus(currentData);
                        if (!displayStatus) {
                            displayStatus = getDisplayStatus(previousData);
                        }
                        var previousTotalValue = previousData && isFinite(previousData["total"]) ? previousData["total"] : 0;
                        var displayText = buildTransferDisplayText(previousTotalValue, newTotal, displayStatus);
                        recipientBar
                            .width(newTotal * qFactor)
                            .text(displayText);
                        var currentOrderValue = currentData.hasOwnProperty("order") ? currentData["order"] : null;
                        if (isNonTransferableCandidateId(candidateId)) {
                            currentOrderValue = resolveNonTransferableOrder();
                        }
                        if (currentOrderValue !== null && typeof currentOrderValue !== 'undefined') {
                            recipientBar.data('finalOrder', currentOrderValue);
                            $("#cname"+candidateId).data('finalOrder', currentOrderValue);
                        }
                    }
                }
            }
            if (!transfered && positiveRecipients.length) {
                for (var r = 0; r < positiveRecipients.length; r++) {
                    var recipient = positiveRecipients[r];
                    var recipientId = recipient.id;
                    var transferAmount = recipient.amount;
                    if (!(transferAmount > 0)) {
                        continue;
                    }
                    var recipientCurrent = getCountEntry(countDict, i, recipientId);
                    var recipientPrevious = getCountEntry(countDict, i-1, recipientId);
                    var previousTotal = recipientPrevious ? recipientPrevious["total"] || 0 : 0;
                    var recipientProgress = recipientProgressById.hasOwnProperty(recipientId) ? recipientProgressById[recipientId] : prepareRecipientBar(i, recipientId, transferAmount);
                    var sliceOrder = resolveStartOrder(recipientProgress, recipientPrevious, recipientId, recipientCurrent);
                    var sliceTop = topMargin + (sliceOrder * 30);
                    var recipientColour = candidatesDict[recipientId] ? candidatesDict[recipientId].colour : null;
                    var recipientFinal = recipientProgress ? recipientProgress.finalTotal : (recipientCurrent && isFinite(recipientCurrent["total"]) ? recipientCurrent["total"] : previousTotal + Math.max(transferAmount, 0));
                    var geometry = recipientProgress && recipientProgress.geometry ? recipientProgress.geometry : computeRecipientSliceGeometry(previousTotal, transferAmount, recipientFinal, qFactor);
                    var transferSlice = $('<div class="votes" data-candidate="'+recipientId+'"></div>');
                    transferSlice.css({
                        width: geometry.sliceWidth + 'px',
                        left: transferHoldingLeft + 'px',
                        top: sliceTop + 'px',
                    });
                    applyVoteColour(transferSlice, recipientColour);
                    transferSlice.data('transferProgress', recipientProgress);
                    transferSlice.data('round', i);
                    transferSlice.data('geometry', geometry);
                    var recipientArrivalLeft = startLeft + geometry.sliceLeft;
                    var recipientBar = $("#candidate"+recipientId);
                    recipientBar.stop(true, false);
                    if (isLastCount) {
                        finalRoundSliceCounter += 1;
                    }
                    pendingTransferSlices += 1;
                    transferSlice
                        .appendTo("#animation")
                        .animate({left: recipientArrivalLeft}, 900*speed, function(){
                            var targetId = $(this).data('candidate');
                            var roundNumber = $(this).data('round');
                            var progress = $(this).data('transferProgress') || null;
                            var targetCurrent = getCountEntry(countDict, roundNumber, targetId);
                            var targetPrevious = getCountEntry(countDict, roundNumber - 1, targetId);
                            var finalTotal = progress ? progress.finalTotal : (targetCurrent && isFinite(targetCurrent["total"]) ? targetCurrent["total"] : 0);
                            var prevTotal = progress ? progress.previousTotal : (targetPrevious && isFinite(targetPrevious["total"]) ? targetPrevious["total"] : 0);
                            var statusText = progress ? progress.statusText : getDisplayStatus(targetCurrent);
                            if (!statusText) {
                                statusText = getDisplayStatus(targetPrevious);
                            }
                            var textValue = progress ? progress.textValue : buildTransferDisplayText(prevTotal, finalTotal, statusText);
                            var targetOrder = progress ? progress.targetOrder : (targetCurrent && isFinite(targetCurrent["order"]) ? targetCurrent["order"] : (targetPrevious && isFinite(targetPrevious["order"]) ? targetPrevious["order"] : 0));
                            if (isNonTransferableCandidateId(targetId)) {
                                targetOrder = resolveNonTransferableOrder();
                            }
                            var bar = $("#candidate"+targetId);
                            bar.stop(true, false);
                            var sliceGeometry = $(this).data('geometry');
                            if (!sliceGeometry && progress && progress.geometry) {
                                sliceGeometry = progress.geometry;
                            }
                            if (!sliceGeometry) {
                                sliceGeometry = computeRecipientSliceGeometry(prevTotal, finalTotal - prevTotal, finalTotal, qFactor);
                            }
                            bar.width(sliceGeometry.targetBarWidth);
                            bar.text(textValue);
                            bar.data('finalOrder', targetOrder);
                            bar.removeData('pendingTransfer');
                            bar.removeData('pendingTransferRound');
                            $("#cname"+targetId).data('finalOrder', targetOrder);
                            $(this).remove();
                            handleTransferSliceCompletion(roundNumber, isLastCount);
                            if (!running) {
                                $(".active").addClass("completed");
                                $(".stageNumber").removeClass("active");
                            }
                        });
                }
                transfered = true;
            }
            if (pendingTransferSlices === 0) {
                finalizeRoundTransitions(i);
            }
            if (isLastCount && finalRoundSliceCounter === 0) {
                requestFinalStatusUpdate(i);
            }
        }else{
            running = false;
            clearInterval(loop);
            loop = undefined;
            finalizeActiveAnimations();
            $(".active").addClass("completed");
            $(".stageNumber").removeClass("active");
            $("#pause-replay").removeClass("fa-pause");
            $("#pause-replay").addClass("fa-repeat");
        }
        countNumber += 1;

    }

    function finalizeActiveAnimations() {
        $("#animation .votes, #animation .candidateLabel").stop(true, true);
    }

    function pause(){
        clearInterval(loop);
        loop = undefined;
        finalizeActiveAnimations();
        running = false;
        $(".active").addClass("completed");
        $(".active").removeClass("active");
    }

    function resume(){
        finalizeActiveAnimations();
        advanceCount();
        loop = window.setInterval(advanceCount,4000*speed);
        running = true;
    }

    function replay(s){
        if (running) {
            clearInterval(loop);
        }
        loop = undefined;
        finalizeActiveAnimations();
        $("#count-span").text("1");
        $(".candidateLabel").remove();
        $(".votes").remove();
        speed = s;
        firstCount();
        countNumber = 2;
        loop = window.setInterval(advanceCount,4000*speed);
        running = true;
    }

    function step(){
        if (running) {
            clearInterval(loop);
        }
        loop = undefined;
        finalizeActiveAnimations();
        playStep(countNumber);
        if (running) {
            loop = window.setInterval(advanceCount,4000*speed);
        }
    }

    function jumpToStep(i){
        if (running) {
            clearInterval(loop);
        }
        loop = undefined;
        finalizeActiveAnimations();
        countNumber = i;
        playStep(countNumber);
        if (running) {
            loop = window.setInterval(advanceCount,4000*speed);
        }
        if ($("#pause-replay").hasClass("fa-repeat")) {
            $("#pause-replay").addClass("fa-play");
        }
    }

    function again() {
        if (running) {
            clearInterval(loop);
        }
        loop = undefined;
        finalizeActiveAnimations();
        if (earlyStage && countNumber>2) {
            countNumber-=2;
        }else if (countNumber>1) {
            countNumber--;
        }
        playStep(countNumber);
        if (running) {
            loop = window.setInterval(advanceCount,4000*speed);
        }
        if ($("#pause-replay").hasClass("fa-repeat")) {
            $("#pause-replay").addClass("fa-play");
        }
    }

    function advanceStep(){
        advanceCount();
    }

    function playStep(i){
        countNumber = i;
        if (countNumber in countDict) {
            $('div').stop(true, true);
            $(".candidateLabel").remove();
            $(".votes").remove();
            if (i>1){
                for(var j=0;j<candidates.length;j++){
                    var previousEntry = getCountEntry(countDict, i-1, candidates[j].id);
                    if (!previousEntry) {
                        continue;
                    }
                    var labelClass = 'candidateLabel';
                    if (candidates[j]["party"]) {
                        labelClass += ' ' + candidates[j]["party"] + '_label';
                    }
                    var label = $('<div id="cname'+candidates[j].id+'" class="'+labelClass+'" style="top:'+(topMargin+ (previousEntry["order"]*30)) +'px;left:10px;">'+candidates[j]["name"]+'</div>');
                    label.appendTo("#animation");
                    decorateLabel(label, candidates[j].colour);

                    var vote = $('<div data-candidate="'+candidates[j].id+'" id="candidate'+candidates[j].id+'" class="votes" style="top:'+(topMargin+ (previousEntry["order"]*30)) +'px;left:'+startLeft+'px;"></div>');
                    vote.appendTo("#animation");
                    applyVoteColour(vote, candidates[j].colour);
                    var previousTotal = previousEntry["total"] || 0;
                    vote.width(previousTotal * qFactor).text(formatVoteNumber(previousTotal));
                }
                advanceCount();
            } else {
                firstCount();
                countNumber = 2;
            }
        }
    }

    function handleTransferSliceCompletion(roundNumber, isLastCount) {
        if (isLastCount) {
            handleFinalSliceCompletion(roundNumber);
        }
        pendingTransferSlices = Math.max(0, pendingTransferSlices - 1);
        if (pendingTransferSlices === 0) {
            finalizeRoundTransitions(roundNumber);
        }
    }

    function finalizeRoundTransitions(roundNumber) {
        if (completedReorderRounds.hasOwnProperty(roundNumber) && completedReorderRounds[roundNumber]) {
            return;
        }
        completedReorderRounds[roundNumber] = true;
        finalizeCandidateReorder(roundNumber);
        applyDeferredElectionStatuses(roundNumber);
        if (roundNumber === counts && finalRoundSliceCounter === 0) {
            requestFinalStatusUpdate(roundNumber);
        }
    }

    function finalizeCandidateReorder(roundNumber) {
        if (!countDict.hasOwnProperty(roundNumber)) {
            return;
        }
        var roundData = countDict[roundNumber];
        for (var index = 0; index < candidates.length; index++) {
            var candidateId = candidates[index].id;
            if (isNonTransferableCandidateId(candidateId)) {
                var fixedOrder = resolveNonTransferableOrder();
                var fixedTop = topMargin + (fixedOrder * 30);
                var fixedBar = $("#candidate" + candidateId);
                if (fixedBar.length) {
                    fixedBar.stop(true, false);
                    fixedBar.css({ top: fixedTop });
                    fixedBar.data('finalOrder', fixedOrder);
                }
                var fixedLabel = $("#cname" + candidateId);
                if (fixedLabel.length) {
                    fixedLabel.stop(true, false);
                    fixedLabel.css({ top: fixedTop });
                    fixedLabel.data('finalOrder', fixedOrder);
                }
                if (roundData.hasOwnProperty(candidateId) && roundData[candidateId]) {
                    roundData[candidateId].order = fixedOrder;
                }
                if (candidatesDict.hasOwnProperty(candidateId)) {
                    candidatesDict[candidateId].order = fixedOrder;
                }
                continue;
            }
            var entry = roundData.hasOwnProperty(candidateId) ? roundData[candidateId] : null;
            var targetOrder = null;
            if (entry && isFinite(entry["order"])) {
                targetOrder = entry["order"];
            } else if (candidatesDict.hasOwnProperty(candidateId) && isFinite(candidatesDict[candidateId].order)) {
                targetOrder = candidatesDict[candidateId].order;
            }
            if (targetOrder === null) {
                continue;
            }
            var targetTop = topMargin + (targetOrder * 30);
            var bar = $("#candidate" + candidateId);
            if (bar.length) {
                bar.stop(true, false);
                bar.animate({ top: targetTop }, 500*speed);
                bar.data('finalOrder', targetOrder);
            }
            var label = $("#cname" + candidateId);
            if (label.length) {
                label.stop(true, false);
                label.animate({ top: targetTop }, 500*speed);
                label.data('finalOrder', targetOrder);
            }
            if (candidatesDict.hasOwnProperty(candidateId)) {
                candidatesDict[candidateId].order = targetOrder;
            }
        }
    }

    function applyDeferredElectionStatuses(roundNumber) {
        if (!deferredElectionStatuses.hasOwnProperty(roundNumber)) {
            return;
        }
        var pendingStatuses = deferredElectionStatuses[roundNumber];
        if (!pendingStatuses) {
            return;
        }
        for (var candidateKey in pendingStatuses) {
            if (!pendingStatuses.hasOwnProperty(candidateKey)) {
                continue;
            }
            var roundEntry = getCountEntry(countDict, roundNumber, candidateKey);
            if (!roundEntry) {
                continue;
            }
            var finalStatus = getFinalStatus(roundEntry);
            if (!finalStatus) {
                var storedStatus = pendingStatuses[candidateKey];
                if (storedStatus && typeof storedStatus.status === 'string') {
                    finalStatus = storedStatus.status;
                } else if (typeof storedStatus === 'string') {
                    finalStatus = storedStatus;
                }
            }
            if (!finalStatus && candidatesDict.hasOwnProperty(candidateKey)) {
                var storedMeta = candidatesDict[candidateKey];
                if (storedMeta && typeof storedMeta.status === 'string') {
                    finalStatus = storedMeta.status;
                }
            }
            if (typeof finalStatus !== 'string') {
                finalStatus = '';
            }
            roundEntry.finalStatus = finalStatus;
            roundEntry.status = finalStatus;
            roundEntry.displayStatus = finalStatus;
            pendingStatuses[candidateKey] = {
                status: finalStatus,
                revealed: true
            };
            if (candidatesDict.hasOwnProperty(candidateKey)) {
                candidatesDict[candidateKey].status = finalStatus;
                candidatesDict[candidateKey].finalStatus = finalStatus;
                candidatesDict[candidateKey].displayStatus = finalStatus;
            }
            for (var candidateIdx = 0; candidateIdx < candidates.length; candidateIdx++) {
                if (candidates[candidateIdx] && candidates[candidateIdx].id === candidateKey) {
                    candidates[candidateIdx].status = finalStatus;
                    candidates[candidateIdx].finalStatus = finalStatus;
                    candidates[candidateIdx].displayStatus = finalStatus;
                    break;
                }
            }
            var previousEntry = roundNumber > 1 ? getCountEntry(countDict, roundNumber - 1, candidateKey) : null;
            var previousTotal = previousEntry && isFinite(previousEntry["total"]) ? previousEntry["total"] : 0;
            var currentTotal = roundEntry && isFinite(roundEntry["total"]) ? roundEntry["total"] : previousTotal;
            var displayText = buildTransferDisplayText(previousTotal, currentTotal, finalStatus);
            var bar = $("#candidate" + candidateKey);
            if (bar.length) {
                bar.text(displayText);
            }
        }
    }

    function resetDeferredElectionStatusesForRound(roundNumber) {
        if (!deferredElectionStatuses.hasOwnProperty(roundNumber)) {
            return;
        }
        var roundStatuses = deferredElectionStatuses[roundNumber];
        if (!roundStatuses) {
            return;
        }
        for (var candidateKey in roundStatuses) {
            if (!roundStatuses.hasOwnProperty(candidateKey)) {
                continue;
            }
            var storedEntry = roundStatuses[candidateKey];
            var finalStatus = '';
            if (!storedEntry || typeof storedEntry.status !== 'string') {
                roundStatuses[candidateKey] = { status: '', revealed: false };
            } else {
                finalStatus = storedEntry.status;
                roundStatuses[candidateKey].revealed = false;
            }
            var roundEntry = getCountEntry(countDict, roundNumber, candidateKey);
            if (roundEntry) {
                roundEntry.status = '';
                roundEntry.displayStatus = '';
                if (typeof finalStatus === 'string') {
                    roundEntry.finalStatus = finalStatus;
                }
            }
            if (candidatesDict.hasOwnProperty(candidateKey)) {
                candidatesDict[candidateKey].displayStatus = '';
            }
            for (var candidateIdx = 0; candidateIdx < candidates.length; candidateIdx++) {
                if (candidates[candidateIdx] && candidates[candidateIdx].id === candidateKey) {
                    candidates[candidateIdx].displayStatus = '';
                    break;
                }
            }
        }
    }


    function adjustOrder(singleCountDict, roundNumber){
        var candidateEntries = [];
        var nonTransferableKey = null;

        function normaliseNumber(value, fallback) {
            if (typeof value === 'number' && isFinite(value)) {
                return value;
            }
            var parsed = parseFloat(value);
            if (!isNaN(parsed) && isFinite(parsed)) {
                return parsed;
            }
            if (typeof fallback === 'number' && isFinite(fallback)) {
                return fallback;
            }
            return 0;
        }

        function normaliseRound(value) {
            if (typeof value === 'number' && isFinite(value)) {
                return value;
            }
            var parsed = parseInt(value, 10);
            if (isNaN(parsed)) {
                return Number.MAX_VALUE;
            }
            return parsed;
        }

        function resolveStatus(currentEntry, previousEntry, storedMeta) {
            if (currentEntry) {
                var currentFinal = getFinalStatus(currentEntry);
                if (currentFinal) {
                    return currentFinal;
                }
                if (typeof currentEntry["status"] === 'string' && currentEntry["status"]) {
                    return currentEntry["status"];
                }
            }
            if (previousEntry) {
                var previousFinal = getFinalStatus(previousEntry);
                if (previousFinal) {
                    return previousFinal;
                }
                if (typeof previousEntry["status"] === 'string' && previousEntry["status"]) {
                    return previousEntry["status"];
                }
            }
            if (storedMeta && typeof storedMeta.status === 'string' && storedMeta.status) {
                return storedMeta.status;
            }
            return '';
        }

        function resolveBaseOrder(previousEntry, storedMeta, fallbackIndex) {
            if (previousEntry && isFinite(previousEntry["order"])) {
                return previousEntry["order"];
            }
            if (storedMeta && isFinite(storedMeta.order)) {
                return storedMeta.order;
            }
            if (storedMeta && isFinite(storedMeta.baseOrder)) {
                return storedMeta.baseOrder;
            }
            if (typeof fallbackIndex === 'number') {
                return fallbackIndex;
            }
            return 0;
        }

        function determineExclusionRound(candidateKey) {
            if (!candidateKey) {
                return null;
            }
            if (manualExclusionRounds.hasOwnProperty(candidateKey)) {
                var manualRound = manualExclusionRounds[candidateKey];
                var numericManual = parseInt(manualRound, 10);
                if (isFinite(numericManual) && numericManual > 0) {
                    return numericManual;
                }
            }
            var recorded = getRecordedRound(candidateKey, 'excluded');
            var numericRecorded = parseInt(recorded, 10);
            if (isFinite(numericRecorded) && numericRecorded > 0) {
                return numericRecorded;
            }
            return null;
        }

        function determineElectionRound(candidateKey) {
            if (!candidateKey) {
                return null;
            }
            var recorded = getRecordedRound(candidateKey, 'elected');
            var numericRecorded = parseInt(recorded, 10);
            if (isFinite(numericRecorded) && numericRecorded > 0) {
                return numericRecorded;
            }
            if (candidatesDict.hasOwnProperty(candidateKey)) {
                var storedMeta = candidatesDict[candidateKey];
                if (storedMeta && typeof storedMeta.electedRound === 'number' && isFinite(storedMeta.electedRound) && storedMeta.electedRound > 0) {
                    return storedMeta.electedRound;
                }
            }
            return null;
        }

        function enforceStatusTiming(candidateKey, statusLabel, roundNumber) {
            if (!statusLabel || typeof statusLabel !== 'string') {
                return statusLabel;
            }
            var statusCategory = normaliseStatusLabel(statusLabel);
            var numericRound = parseInt(roundNumber, 10);
            if (!isFinite(numericRound) || numericRound <= 0) {
                return statusLabel;
            }
            if (statusCategory === 'excluded') {
                var exclusionRound = determineExclusionRound(candidateKey);
                if (typeof exclusionRound === 'number' && isFinite(exclusionRound) && exclusionRound > numericRound) {
                    return '';
                }
                return statusLabel;
            }
            if (statusCategory === 'elected') {
                var electionRound = determineElectionRound(candidateKey);
                if (typeof electionRound === 'number' && isFinite(electionRound) && electionRound > numericRound) {
                    return '';
                }
            }
            return statusLabel;
        }

        function shouldDeferElectionStatus(candidateKey, statusCategory, roundNumber) {
            if (statusCategory !== 'elected') {
                return false;
            }
            var electionRound = determineElectionRound(candidateKey);
            if (typeof electionRound !== 'number' || !isFinite(electionRound)) {
                return false;
            }
            return electionRound === roundNumber;
        }

        function ensureEntry(candidateKey, previousEntry, storedMeta, fallbackIndex) {
            var existing = singleCountDict.hasOwnProperty(candidateKey) ? singleCountDict[candidateKey] : null;
            var fallbackTotal = previousEntry && isFinite(previousEntry["total"]) ? previousEntry["total"] : 0;
            var fallbackStatus = resolveStatus(existing, previousEntry, storedMeta);
            var fallbackOrder = resolveBaseOrder(previousEntry, storedMeta, fallbackIndex);
            if (!existing) {
                existing = {
                    total: fallbackTotal,
                    status: fallbackStatus,
                    displayStatus: fallbackStatus,
                    finalStatus: fallbackStatus,
                    order: fallbackOrder,
                    transfers: false
                };
                singleCountDict[candidateKey] = existing;
            } else {
                existing.total = normaliseNumber(existing.total, fallbackTotal);
                if ((!existing.status || typeof existing.status !== 'string') && fallbackStatus) {
                    existing.status = fallbackStatus;
                }
                if ((!existing.displayStatus || typeof existing.displayStatus !== 'string') && fallbackStatus) {
                    existing.displayStatus = fallbackStatus;
                }
                if ((!existing.finalStatus || typeof existing.finalStatus !== 'string') && fallbackStatus) {
                    existing.finalStatus = fallbackStatus;
                }
                if (!isFinite(existing.order)) {
                    existing.order = fallbackOrder;
                }
            }
            return existing;
        }

        function orderPriority(statusCategory) {
            if (statusCategory === 'elected') {
                return 0;
            }
            if (statusCategory === 'continuing') {
                return 1;
            }
            if (statusCategory === 'not_elected') {
                return 2;
            }
            if (statusCategory === 'excluded') {
                return 3;
            }
            return 1;
        }

        for (var idx = 0; idx < candidates.length; idx++) {
            var candidateMeta = candidates[idx];
            var candidateKey = candidateMeta.id;
            if (isNonTransferableCandidateId(candidateKey)) {
                nonTransferableKey = candidateKey;
                continue;
            }
            var previousEntry = roundNumber > 1 ? getCountEntry(countDict, roundNumber - 1, candidateKey) : null;
            var storedMeta = candidatesDict.hasOwnProperty(candidateKey) ? candidatesDict[candidateKey] : null;
            var entry = ensureEntry(candidateKey, previousEntry, storedMeta, idx);
            var statusLabel = resolveStatus(entry, previousEntry, storedMeta);
            statusLabel = enforceStatusTiming(candidateKey, statusLabel, roundNumber);
            var statusCategory = normaliseStatusLabel(statusLabel);
            var displayStatus = statusLabel;
            if (shouldDeferElectionStatus(candidateKey, statusCategory, roundNumber)) {
                displayStatus = '';
                if (!deferredElectionStatuses.hasOwnProperty(roundNumber)) {
                    deferredElectionStatuses[roundNumber] = {};
                }
                var existingDeferred = deferredElectionStatuses[roundNumber][candidateKey];
                var alreadyRevealed = existingDeferred && existingDeferred.revealed ? true : false;
                deferredElectionStatuses[roundNumber][candidateKey] = {
                    status: statusLabel,
                    revealed: alreadyRevealed
                };
            }
            if (entry) {
                entry.finalStatus = statusLabel;
                entry.status = displayStatus;
                entry.displayStatus = displayStatus;
            }
            recordStatusRound(candidateKey, statusLabel, roundNumber);
            var recordedRound = getRecordedRound(candidateKey, statusCategory);
            var numericRound = normaliseRound(recordedRound);
            var totalVotes = normaliseNumber(entry.total, previousEntry ? previousEntry["total"] : 0);
            entry.total = totalVotes;
            var previousOrder = previousEntry && isFinite(previousEntry["order"]) ? previousEntry["order"] : null;
            var storedOrder = storedMeta && isFinite(storedMeta.order) ? storedMeta.order : null;
            var baseOrder = storedMeta && isFinite(storedMeta.baseOrder) ? storedMeta.baseOrder : idx;
            var frozenOrder = frozenExclusionOrders.hasOwnProperty(candidateKey) && isFinite(frozenExclusionOrders[candidateKey]) ? frozenExclusionOrders[candidateKey] : null;

            candidateEntries.push({
                key: candidateKey,
                statusLabel: statusLabel,
                statusCategory: statusCategory,
                round: numericRound,
                total: totalVotes,
                previousOrder: isFinite(previousOrder) ? previousOrder : (isFinite(entry.order) ? entry.order : null),
                storedOrder: storedOrder,
                baseOrder: baseOrder,
                frozenOrder: frozenOrder,
                statusLabel: statusLabel,
                displayStatus: displayStatus
            });
        }

        candidateEntries.sort(function(a, b) {
            var priorityA = orderPriority(a.statusCategory);
            var priorityB = orderPriority(b.statusCategory);
            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }
            if (a.statusCategory === 'elected') {
                if (a.round !== b.round) {
                    return a.round - b.round;
                }
                if (Math.abs(a.total - b.total) > 1e-9) {
                    return b.total - a.total;
                }
            } else if (a.statusCategory === 'excluded') {
                var frozenA = isFinite(a.frozenOrder) ? a.frozenOrder : Number.MAX_VALUE;
                var frozenB = isFinite(b.frozenOrder) ? b.frozenOrder : Number.MAX_VALUE;
                if (frozenA !== frozenB) {
                    return frozenA - frozenB;
                }
                if (a.round !== b.round) {
                    return a.round - b.round;
                }
                if (Math.abs(a.total - b.total) > 1e-9) {
                    return b.total - a.total;
                }
            } else {
                if (Math.abs(a.total - b.total) > 1e-9) {
                    return b.total - a.total;
                }
            }
            var prevA = isFinite(a.previousOrder) ? a.previousOrder : Number.MAX_VALUE;
            var prevB = isFinite(b.previousOrder) ? b.previousOrder : Number.MAX_VALUE;
            if (prevA !== prevB) {
                return prevA - prevB;
            }
            var storedA = isFinite(a.storedOrder) ? a.storedOrder : Number.MAX_VALUE;
            var storedB = isFinite(b.storedOrder) ? b.storedOrder : Number.MAX_VALUE;
            if (storedA !== storedB) {
                return storedA - storedB;
            }
            var baseA = isFinite(a.baseOrder) ? a.baseOrder : Number.MAX_VALUE;
            var baseB = isFinite(b.baseOrder) ? b.baseOrder : Number.MAX_VALUE;
            if (baseA !== baseB) {
                return baseA - baseB;
            }
            if (a.key < b.key) {
                return -1;
            }
            if (a.key > b.key) {
                return 1;
            }
            return 0;
        });

        for (var assignIndex = 0; assignIndex < candidateEntries.length; assignIndex++) {
            var candidateInfo = candidateEntries[assignIndex];
            var candidateKey = candidateInfo.key;
            var targetOrder = assignIndex;
            if (candidateInfo.statusCategory === 'excluded') {
                frozenExclusionOrders[candidateKey] = targetOrder;
            }
            var finalStatusLabel = (typeof candidateInfo.statusLabel === 'string') ? candidateInfo.statusLabel : '';
            var displayStatusValue = (typeof candidateInfo.displayStatus === 'string') ? candidateInfo.displayStatus : finalStatusLabel;
            if (!singleCountDict.hasOwnProperty(candidateKey)) {
                singleCountDict[candidateKey] = {
                    total: candidateInfo.total,
                    status: displayStatusValue,
                    displayStatus: displayStatusValue,
                    finalStatus: finalStatusLabel,
                    order: targetOrder,
                    transfers: false
                };
            } else {
                singleCountDict[candidateKey].order = targetOrder;
                singleCountDict[candidateKey].total = candidateInfo.total;
                singleCountDict[candidateKey].status = displayStatusValue;
                singleCountDict[candidateKey].displayStatus = displayStatusValue;
                singleCountDict[candidateKey].finalStatus = finalStatusLabel;
            }
            if (candidatesDict.hasOwnProperty(candidateKey)) {
                candidatesDict[candidateKey].order = targetOrder;
                candidatesDict[candidateKey].status = finalStatusLabel;
                candidatesDict[candidateKey].finalStatus = finalStatusLabel;
                candidatesDict[candidateKey].displayStatus = displayStatusValue;
            }
        }

        if (nonTransferableKey !== null) {
            var storedNonTransferable = candidatesDict.hasOwnProperty(nonTransferableKey) ? candidatesDict[nonTransferableKey] : null;
            var previousNonTransferable = roundNumber > 1 ? getCountEntry(countDict, roundNumber - 1, nonTransferableKey) : null;
            var baseNonTransferableOrder = isFinite(nonTransferableBaseOrder) ? nonTransferableBaseOrder : (candidates.length ? candidates.length - 1 : candidateEntries.length);
            var nonTransferableEntry = singleCountDict.hasOwnProperty(nonTransferableKey) ? singleCountDict[nonTransferableKey] : null;
            if (!nonTransferableEntry) {
                var fallbackStatus = resolveStatus(null, previousNonTransferable, storedNonTransferable);
                var fallbackTotal = previousNonTransferable && isFinite(previousNonTransferable["total"]) ? previousNonTransferable["total"] : 0;
                var fallbackOrder = resolveBaseOrder(previousNonTransferable, storedNonTransferable, baseNonTransferableOrder);
                nonTransferableEntry = {
                    total: fallbackTotal,
                    status: fallbackStatus,
                    displayStatus: fallbackStatus,
                    finalStatus: fallbackStatus,
                    order: fallbackOrder,
                    transfers: false
                };
                singleCountDict[nonTransferableKey] = nonTransferableEntry;
            } else {
                nonTransferableEntry.total = normaliseNumber(nonTransferableEntry.total, previousNonTransferable ? previousNonTransferable["total"] : 0);
                if (!nonTransferableEntry.status && storedNonTransferable && storedNonTransferable.status) {
                    nonTransferableEntry.status = storedNonTransferable.status;
                    nonTransferableEntry.displayStatus = storedNonTransferable.status;
                    nonTransferableEntry.finalStatus = storedNonTransferable.status;
                }
            }
            var resolvedOrder = nonTransferableEntry && isFinite(nonTransferableEntry.order) ? nonTransferableEntry.order : baseNonTransferableOrder;
            if (!isFinite(resolvedOrder) || resolvedOrder < candidateEntries.length) {
                resolvedOrder = candidateEntries.length;
            }
            nonTransferableEntry.order = resolvedOrder;
            if (storedNonTransferable) {
                storedNonTransferable.order = resolvedOrder;
                if (nonTransferableEntry.status) {
                    storedNonTransferable.status = nonTransferableEntry.status;
                    storedNonTransferable.displayStatus = nonTransferableEntry.status;
                    storedNonTransferable.finalStatus = nonTransferableEntry.status;
                }
            }
        }
    }

    function updateCounter(n) {
        $(".stageNumber").removeClass("completed")
        for (i=1; i<n; i++) {
            $("#stageNumber-" + i).addClass("completed")
        }
    };

    function setActiveMarker(n) {
        $(".stageNumber").removeClass("active")
        $("#stageNumber-" + n).addClass("active")
    }
}

/* This work is licensed under a Creative Commons Attribution 4.0 International License - http://creativecommons.org/licenses/by/4.0 
 * Created by James Bligh (@anamates) for clairebyrne.ie and all thanks to data.localgov.ie
 */

//some control variables
var speed = 1;
var leftPadding = 10;
var nameSpace = 200;
var startLeft = leftPadding+nameSpace;
var voteWidth = 600;
var running = true;
var earlyStage = true;
var TRANSFER_EPSILON = -0.0005;

function normaliseNumber(value) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
}

function formatDisplayText(total, status) {
    var pieces = [normaliseNumber(total).toString()];
    if (typeof status === "string" && status.trim() !== "") {
        pieces.push(status.trim());
    }
    return pieces.join(" ");
}

var json = (function() {
        var json = null;
        $.ajax({
            'async': false,
            'global': false,
            'url': "ResultsJson.json",
            'dataType': "json",
            'success': function (data) {
                json = data;
            }
        });
        return json;
    })();
console.log(json);
var	constituency = json.Constituency.countInfo;
var data = json.Constituency.countGroup;

if(constituency){
    //set the top right bit
    var constituencyCode = constituency["Constituency_Name"];
	var quota = parseInt(constituency["Quota"]);
    var seats = parseInt(constituency["Number_Of_Seats"]);
	$("#constituency-span").text(constituencyCode);
    $("#quota-span").text(quota);
    $("#seats-span").text(seats);
    $("#theline").css({top:3+(seats+1)*30});
    var qFactor = voteWidth/quota; //all actual vote counts are multiplied by this to get a div width in proportion

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
    var counts = 1;

    //loop through all the data and populate the various dictionaries
    for (var i=0; i<data.length; i++) {
        if (!(data[i]["Count_Number"] in countDict)) {
            countDict[data[i]["Count_Number"]] = {};
        }
        var totalVotes = parseFloat(data[i]["Total_Votes"]);
        if (!isFinite(totalVotes)) {
            totalVotes = 0;
        }
        var transferValue = parseFloat(data[i]["Transfers"]);
        if (!isFinite(transferValue)) {
            transferValue = 0;
        }
        countDict[data[i]["Count_Number"]][data[i]["Candidate_Id"]] = {
            total:totalVotes,
            rawTransfer:transferValue,
            preTotal:0,
            delta:0,
            status:(typeof(data[i]["Status"])=="string")?data[i]["Status"]:"",
            order:0,
            transfers:false
        };

        if (!(data[i]["Candidate_Id"] in candidatesDict)) {
            var party = data[i]["Party_Name"];
            if (typeof(party)!="string"){ party = "Non-Party";}
            party=party.replace(/\s+/g,"-");
            candidates.push({
                name:data[i]["Firstname"]+" "+((typeof(data[i]["Surname"])=="string")?data[i]["Surname"]:""),
                id:data[i]["Candidate_Id"],
                status:data[i]["Status"],
                party:party,
                electedRound:null,
                excludedRound:null
            });
            candidatesDict[data[i]["Candidate_Id"]] = {
                name:data[i]["Firstname"]+" "+((typeof(data[i]["Surname"])=="string")?data[i]["Surname"]:""),
                id:data[i]["Candidate_Id"],
                status:"",
                party:party,
                electedRound:null,
                excludedRound:null
            };
        }
        counts = Math.max(counts, parseInt(data[i]["Count_Number"], 10));
    }
    
    populateRoundBaselines(countDict, counts);

    //once we have all the data in the countDict we can now go through each count and order it
    //we do this in order as once a candidate is elected we store their final order in the candidatesDict and reuse it subsquent counts
    //only sorting candidates that are not eliminated or elected

    for (var k=1; k<=counts;k++){
        if (countDict.hasOwnProperty(k)) {
            adjustOrder(countDict[k], k);
        }
    }

    //now we have the data set up we just hook up our links to functions

    $("#pause-replay").click(function(event) {
        event.preventDefault();
        if ($(this).text() == "Pause") {
            $(this).text("Resume");
            pause();
        } else if ($(this).text() == "Resume") {
            $(this).text("Pause");
            resume();
        } else {
            $(this).text("Pause");
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

    firstCount();  //run the first count
    var countNumber = 2;  //global loop variable
    //set the advance count function to run in a loop
    var loop = window.setInterval(advanceCount,4000*speed);
}else{
    //if we didn't load a constituency var then we have no data yet
    $("body").text("There is no data up for this constituency at present");
}

//the magic, simple enough, append some divs and animate their width's to final position 
//then animate their top to final position and move the name div at the same time
function firstCount(){
    $("#thepost").height(candidates.length*30);
    for(var j=0;j<candidates.length;j++){
        $('<div id="cname'+candidates[j].id+'" class="candidateLabel '+candidates[j]["party"]+'_label" style="top:'+(40 + (j*30)) +'px;left:10px;">'+candidates[j]["name"]+'</div>')
        .appendTo("body");
        $('<div data-candidate="'+candidates[j].id+'" id="candidate'+candidates[j].id+'" class="votes '+candidates[j]["party"]+'" style="top:'+(40 + (j*30)) +'px;left:'+startLeft+'px;"></div>')
        .appendTo("body")
        .animate({width:countDict[1][candidates[j].id]["preTotal"] * qFactor},1500*speed).text(formatDisplayText(countDict[1][candidates[j].id]["preTotal"], countDict[1][candidates[j].id]["status"]))
        .animate({top:40+(countDict[1][candidates[j].id]["order"]*30)},{
            duration:500*speed,
            start:function(){
                $("#cname"+$(this).data('candidate'))
                .animate({top:40+(countDict[1][$(this).data('candidate')]["order"]*30)},500*speed)
            }
        });
    }
}

function populateRoundBaselines(dictionary, totalCounts){
    for (var round = 1; round <= totalCounts; round++){
        if (!dictionary.hasOwnProperty(round)){
            continue;
        }
        var roundData = dictionary[round];
        var previousRound = dictionary[round - 1] || {};
        for (var candidateId in roundData){
            if (!roundData.hasOwnProperty(candidateId)){
                continue;
            }
            var entry = roundData[candidateId];
            var finalTotal = normaliseNumber(entry.total);
            var baseline = 0;
            var statusBefore = "";
            var previousOrder = null;

            if (previousRound.hasOwnProperty(candidateId)){
                var previousEntry = previousRound[candidateId];
                baseline = normaliseNumber(previousEntry["total"]);
                statusBefore = (typeof previousEntry["status"] === "string") ? previousEntry["status"] : "";
                if (typeof previousEntry["order"] === "number"){
                    previousOrder = previousEntry["order"];
                }
            } else {
                var transferValue = normaliseNumber(entry.rawTransfer);
                baseline = finalTotal - transferValue;
                statusBefore = (typeof entry["status"] === "string") ? entry["status"] : "";
            }

            if (!isFinite(baseline)){
                baseline = 0;
            }
            if (baseline < 0 && baseline > TRANSFER_EPSILON){
                baseline = 0;
            }

            entry.preTotal = Math.max(0, baseline);
            entry.preStatus = statusBefore;
            if (previousOrder !== null){
                entry.preOrder = previousOrder;
            }

            var delta = finalTotal - entry.preTotal;
            if (!isFinite(delta)){
                delta = 0;
            }
            if (Math.abs(delta) < Math.abs(TRANSFER_EPSILON)){
                delta = 0;
            }
            entry.delta = delta;
            entry.transfers = delta < TRANSFER_EPSILON;
        }
    }
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
        $("#count-span").text(countNumber);
        var previousCountData = countDict[i-1] || {};
        var currentCountData = countDict[i] || {};
        var startingTotals = {};

        for (var p = 0; p < candidates.length; p++) {
            var candidateId = candidates[p].id;
            var previousData = previousCountData[candidateId] || null;
            var currentData = currentCountData[candidateId] || null;
            var startingTotal = 0;
            var startingStatus = "";
            var previousOrder = null;

            if (previousData && previousData.hasOwnProperty("total")) {
                startingTotal = normaliseNumber(previousData["total"]);
            } else if (currentData && currentData.hasOwnProperty("preTotal")) {
                startingTotal = normaliseNumber(currentData["preTotal"]);
            } else if (currentData && currentData.hasOwnProperty("total")) {
                var candidateTransfers = currentData.hasOwnProperty("rawTransfer") ? normaliseNumber(currentData["rawTransfer"]) : 0;
                startingTotal = normaliseNumber(currentData["total"]) - candidateTransfers;
            }

            if (!isFinite(startingTotal)) {
                startingTotal = 0;
            }

            if (startingTotal < 0 && startingTotal > TRANSFER_EPSILON) {
                startingTotal = 0;
            }
            if (startingTotal < 0) {
                startingTotal = Math.abs(startingTotal) < Math.abs(TRANSFER_EPSILON) ? 0 : startingTotal;
            }

            if (previousData && previousData.hasOwnProperty("status")) {
                startingStatus = previousData["status"] || "";
            } else if (currentData && currentData.hasOwnProperty("preStatus")) {
                startingStatus = currentData["preStatus"] || "";
            } else if (currentData && currentData.hasOwnProperty("status")) {
                startingStatus = currentData["status"] || "";
            }

            if (previousData && typeof previousData["order"] === "number") {
                previousOrder = previousData["order"];
            } else if (currentData && currentData.hasOwnProperty("preOrder")) {
                previousOrder = currentData["preOrder"];
            } else if (currentData && typeof currentData["order"] === "number") {
                previousOrder = currentData["order"];
            }

            startingTotal = Math.max(0, startingTotal);
            startingTotals[candidateId] = startingTotal;
            var $bar = $("#candidate"+candidateId);
            if ($bar.length) {
                $bar.stop(true, true);
            }
            var topPosition = previousOrder !== null ? 40 + (previousOrder * 30) : $bar.css("top");
            var startingWidth = Math.max(0, startingTotal) * qFactor;
            $bar
                .css({top: topPosition})
                .width(startingWidth)
                .text(formatDisplayText(startingTotal, startingStatus));
        }

        for (var j=0;j<candidates.length;j++) {
            if (countDict[i] && countDict[i][candidates[j].id] && countDict[i][candidates[j].id]["transfers"]) {
                //we have to break it down now instead
                var donorId = candidates[j].id;
                var donorFinalData = currentCountData[donorId] || {};
                var donorPreTotal = startingTotals[donorId] || 0;
                var donorFinalTotal = normaliseNumber(donorFinalData["total"]);
                if (donorFinalTotal < 0) {
                    donorFinalTotal = 0;
                }
                var donorOrderSource = previousCountData[donorId] || donorFinalData || {};
                var donorOrder = (typeof donorOrderSource["order"] === "number") ? donorOrderSource["order"] : 0;
                var left = startLeft + donorPreTotal * qFactor;
                var top = 40 + (donorOrder * 30);
                if (!transfered){
                    for (var t=0;t<candidates.length;t++) {
                        var recipientId = candidates[t].id;
                        var recipientData = currentCountData[recipientId] || {};
                        var isDonor = !!(recipientData && recipientData.hasOwnProperty("transfers") && recipientData["transfers"]);
                        if (!isDonor) {
                            var transferAmount = 0;
                            if (recipientData.hasOwnProperty("delta")) {
                                transferAmount = Math.max(0, normaliseNumber(recipientData["delta"]));
                            } else {
                                transferAmount = Math.max(0, normaliseNumber((recipientData["total"] || 0) - (startingTotals[recipientId] || 0)));
                            }
                            if (transferAmount <= 0) {
                                continue;
                            }
                            var recipientStart = startingTotals[recipientId] || 0;
                            var localLeft = startLeft + recipientStart * qFactor;
                            var recipientOrderSource = previousCountData[recipientId] || recipientData || {};
                            var recipientOrder = (typeof recipientOrderSource["order"] === "number") ? recipientOrderSource["order"] : 0;
                            var recipientTrackTop = 40 + (recipientOrder * 30);
                            var sliceWidth = transferAmount * qFactor;
                            var $slice = $('<div data-candidate="'+candidates[t].id+'" style="width:'+sliceWidth+'px;left:'+left+'px; top:'+top+'px;" class="votes '+candidates[t]["party"]+'"></div>');
                            $slice.data('transferAmount', transferAmount);
                            $slice.appendTo("body").delay(300*speed)
                                .animate({top:recipientTrackTop, left:startLeft+voteWidth+20},900*speed, function(){
                                    earlyStage = false;
                                }).delay(100*speed)
                                .animate({left:localLeft},900*speed, function(){
                                    var candidateId = $(this).data('candidate');
                                    var finalData = currentCountData[candidateId] || {};
                                    var hasTotal = finalData.hasOwnProperty("total");
                                    var finalTotal = normaliseNumber(hasTotal ? finalData["total"] : (startingTotals[candidateId] || 0));
                                    if (finalTotal < 0) {
                                        finalTotal = 0;
                                    }
                                    var finalStatus = finalData["status"];
                                    var finalWidth = Math.max(0, finalTotal) * qFactor;
                                    $("#candidate"+candidateId).width(finalWidth)
                                    .text(formatDisplayText(finalTotal, finalStatus))
                                    .animate({top:40+(countDict[i][$(this).data('candidate')]["order"]*30)},{
                                        duration:500*speed,
                                        start:function(){
                                            $("#cname"+$(this).data('candidate'))
                                            .animate({top:40+(countDict[i][$(this).data('candidate')]["order"]*30)},500*speed)
                                        }
                                    });
                                    //TODO:at this point we'd like to animate to new order
                                    $(this).remove();
                                });
                            left = left + transferAmount * qFactor;
                        }
                    }
                    //could put dead votes in here
                    transfered = true;
                }
                $("#candidate"+donorId).delay(300*speed).animate({width:Math.max(0, donorFinalTotal) * qFactor}, {
                    duration:900*speed,
                    complete:function(){
                        var candidateId = $(this).data('candidate');
                        var finalData = currentCountData[candidateId] || {};
                        var finalTotal = finalData.hasOwnProperty("total") ? finalData["total"] : startingTotals[candidateId] || 0;
                        $(this).text(formatDisplayText(finalTotal, finalData["status"]));
                    }
                });
            }
        }
    }else{
        clearInterval(loop);
        $("#pause-replay").text("Replay");
    }
    countNumber += 1;

}

function pause(){
    clearInterval(loop);
    running = false;
}

function resume(){
    advanceCount();
    loop = window.setInterval(advanceCount,4000*speed);
    running = true;
}

function replay(s){
    if (running) {
        clearInterval(loop);
    }
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
    playStep(countNumber);
    if (running) {
        loop = window.setInterval(advanceCount,4000*speed);
    }
}

function again() {
    if (running) {
        clearInterval(loop);
    }

    if (earlyStage && countNumber>2) {
        countNumber-=2;
    }else if (countNumber>1) {
        countNumber--;
    }
    playStep(countNumber);
    if (running) {
        loop = window.setInterval(advanceCount,4000*speed);
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
                $('<div id="cname'+candidates[j].id+'" class="candidateLabel '+candidates[j]["party"]+'_label" style="top:'+(40 + (countDict[i-1][candidates[j].id]["order"]*30)) +'px;left:10px;">'+candidates[j]["name"]+'</div>')
                .appendTo("body");
                $('<div data-candidate="'+candidates[j].id+'" id="candidate'+candidates[j].id+'" class="votes '+candidates[j]["party"]+'" style="top:'+(40 + (countDict[i-1][candidates[j].id]["order"]*30)) +'px;left:'+startLeft+'px;"></div>')
                .appendTo("body");
                $("#candidate"+candidates[j].id).width(countDict[i-1][candidates[j].id]["total"] * qFactor).text(countDict[i-1][candidates[j].id]["total"]);
            }
            advanceCount();
        } else {
            firstCount();
            countNumber = 2;
        }
    }
}

function adjustOrder(singleCountDict, roundNumber){
    var elected = [];
    var continuing = [];
    var excluded = [];
    var currentRound = isFinite(roundNumber) ? roundNumber : Number.MAX_VALUE;

    function ensureMetadata(key) {
        if (!candidatesDict[key]) {
            candidatesDict[key] = {
                name:"",
                id:key,
                status:"",
                party:"",
                electedRound:null,
                excludedRound:null
            };
        } else {
            if (!("electedRound" in candidatesDict[key])) {
                candidatesDict[key].electedRound = null;
            }
            if (!("excludedRound" in candidatesDict[key])) {
                candidatesDict[key].excludedRound = null;
            }
        }
    }

    function parseTotal(value){
        if (typeof value === "number") {
            return value;
        }
        var parsed = parseFloat(value);
        return isNaN(parsed) ? 0 : parsed;
    }

    function addTo(list, key, data, statusType){
        ensureMetadata(key);
        var candidateMeta = candidatesDict[key];
        if (statusType === "elected" && typeof candidateMeta.electedRound !== "number") {
            candidateMeta.electedRound = currentRound;
        } else if (statusType === "excluded" && typeof candidateMeta.excludedRound !== "number") {
            candidateMeta.excludedRound = currentRound;
        }

        list.push({
            key: key,
            count: parseTotal(data["total"]),
            previous: (typeof candidateMeta["order"] === "number") ? candidateMeta["order"] : candidates.length,
            round: statusType === "elected" ? candidateMeta.electedRound : (statusType === "excluded" ? candidateMeta.excludedRound : null)
        });
    }

    function normaliseStatus(status){
        if (typeof status !== "string"){
            return "";
        }
        return status.toLowerCase();
    }

    function resolveStatus(key, data){
        var status = data["status"];
        if ((!status || status === "") && candidatesDict[key] && candidatesDict[key].status){
            status = candidatesDict[key].status;
        }
        return status || "";
    }

    for (var k in singleCountDict){
        if (singleCountDict.hasOwnProperty(k)) {
            var data = singleCountDict[k];
            var status = resolveStatus(k, data);
            var normalisedStatus = normaliseStatus(status);
            if (normalisedStatus.indexOf("elected") !== -1) {
                addTo(elected, k, data, "elected");
            } else if (normalisedStatus.indexOf("excluded") !== -1 || normalisedStatus.indexOf("eliminated") !== -1) {
                addTo(excluded, k, data, "excluded");
            } else {
                addTo(continuing, k, data, "continuing");
            }
            if (status !== "") {
                candidatesDict[k].status = status;
            }
        }
    }

    function sortByCount(a, b){
        if (a.count !== b.count){
            return b.count - a.count;
        }
        if (a.previous !== b.previous){
            return a.previous - b.previous;
        }
        if (a.key < b.key){
            return -1;
        }
        if (a.key > b.key){
            return 1;
        }
        return 0;
    }

    function sortByRoundThenCount(a, b){
        var roundA = (typeof a.round === "number") ? a.round : Number.MAX_VALUE;
        var roundB = (typeof b.round === "number") ? b.round : Number.MAX_VALUE;
        if (roundA !== roundB){
            return roundA - roundB;
        }
        return sortByCount(a, b);
    }

    elected.sort(sortByRoundThenCount);
    continuing.sort(sortByCount);
    excluded.sort(sortByRoundThenCount);

    var orderedGroups = [elected, continuing, excluded];
    var index = 0;
    for (var g = 0; g < orderedGroups.length; g++){
        var group = orderedGroups[g];
        for (var i = 0; i < group.length; i++){
            var candidateKey = group[i].key;
            singleCountDict[candidateKey].order = index;
            candidatesDict[candidateKey].order = index;
            index++;
        }
    }
}

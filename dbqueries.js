/**
 *    Copyright (C) 2019-present FreeTrade
 *
 *    This program is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU Affero General Public License v3.0
 *
 *    This program is distributed in the hope that it will be useful,
 *    but WITHOUT ANY WARRANTY; without even the implied warranty of
 *    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *    GNU Affero General Public License for more details.
 *
 *    You should have received a copy of the GNU Affero General Public License
 *    along with this program. If not, see
 *    <https://www.gnu.org/licenses/agpl-3.0.en.html>.
 *
 */
'use strict';

var dbqueries = {};

dbqueries.getQuery = function (req, url, issqlite, escapeFunction, sqltimestamp) {

	//Sanitize input

	//Alphanumeric 
	var queryData = url.parse(req.url, true).query;
	var action = (queryData.action || 'posts').replace(/[^a-zA-Z0-9]+/g, "");
	var address = (queryData.address || '').replace(/[^a-zA-Z0-9]+/g, ""); //address is the address of the current user
	var qaddress = (queryData.qaddress || '').replace(/[^a-zA-Z0-9]+/g, ""); //qaddress is the address of a target user of the query
	var txid = (queryData.txid || '').replace(/[^a-zA-Z0-9]+/g, "");
	var type = (queryData.type || 'top').replace(/[^a-zA-Z0-9]+/g, "");
	var order = (queryData.order || 'hot').replace(/[^a-zA-Z0-9]+/g, "");
	var content = (queryData.content || 'posts').replace(/[^a-zA-Z0-9]+/g, "");
	var filter = (queryData.filter || 'everyone').replace(/[^a-zA-Z0-9]+/g, "");


	//Numeric include negative and decimal
	var north = (queryData.north || '0').replace(/[^0-9\.\-]+/g, "");
	var south = (queryData.south || '0').replace(/[^0-9\.\-]+/g, "");
	var east = (queryData.east || '0').replace(/[^0-9\.\-]+/g, "");
	var west = (queryData.west || '0').replace(/[^0-9\.\-]+/g, "");

	//Numeric positive integer
	var since = Number((queryData.since || '0').replace(/[^0-9]+/g, ""));
	var sincepm = Number((queryData.sincepm || '0').replace(/[^0-9]+/g, ""));
	var start = Number((queryData.start || '0').replace(/[^0-9]+/g, ""));
	var limit = Number((queryData.limit || '25').replace(/[^0-9]+/g, ""));

	if (limit > 100) limit = 100;
	if (limit == 0) limit = 25;
	//Send 1 additional record back so that GUI knows there are more records available.
	limit = limit + 1;

	var timedivisor = `((((` + sqltimestamp + `-messages.firstseen)/(60*60))+2)^1.8)`;
	//TODO sqlite doesn't have POWER funciton, using a (significantly worse) approximation 
	if (issqlite) timedivisor = `((` + sqltimestamp + `-messages.firstseen)/3600)*4+(3600*24)`;

	var minfunction = "LEAST";
	if (issqlite) minfunction = "MIN";

	var least = " ORDER BY ("
		+ minfunction + "( COALESCE(reposts.likes,0)+messages.likes ,10)-"
		+ minfunction + "( COALESCE(reposts.dislikes,0)+messages.dislikes ,10)+"
		+ minfunction + "( COALESCE(reposts.repliesuniquemembers,0)+messages.repliesuniquemembers ,10)+"
		+ minfunction + "( (COALESCE(reposts.tips,0)+messages.tips) /10000,10))";

	var sql = "SELECT VERSION();";

	//This didn't seem to do anything
	//var select = `SELECT \/*+ MAX_EXECUTION_TIME = 1000 *\/ `;

	var select = `SELECT `;

	var reposts = " LEFT JOIN messages as reposts ON messages.repost = reposts.txid ";
	var repostid = " LEFT JOIN messages as repostid ON messages.canonicalid = repostid.repost AND repostid.address='" + address + "' ";
	var repostvar = " ,repostid.txid as repostidtxid ";
	
	var likesanddislikes = " LEFT JOIN likesdislikes ON likesdislikes.address='" + address + "' AND likesdislikes.retxid=messages.txid ";
	var rplikesanddislikes = " LEFT JOIN likesdislikes as rplikesdislikes ON rplikesdislikes.address='" + address + "' AND rplikesdislikes.retxid=messages.canonicalid ";
	
	var names = " LEFT JOIN names ON messages.address=names.address ";
	var rpnames = " LEFT JOIN names as rpnames ON reposts.address=rpnames.address ";

	var userratings = " LEFT JOIN userratings ON userratings.address='" + address + "' AND messages.address=userratings.rates ";
	var rpuserratings = " LEFT JOIN userratings as rpuserratings ON rpuserratings.address='" + address + "' AND reposts.address=rpuserratings.rates ";

	//OR hiddenusers.address = reposts.address
	//todo. if a hidden user reposts a non-hidden user, it may display. fix this.
	var mods = ` LEFT JOIN hiddenposts ON hiddenposts.txid=messages.canonicalid
	LEFT JOIN hiddenusers ON hiddenusers.address=messages.address 
	LEFT JOIN mods on (hiddenposts.modr = mods.modr OR hiddenusers.modr=mods.modr) AND (mods.topic=messages.topic OR mods.topic='')
	LEFT JOIN mods as mods2 on mods2.modr=mods.address AND mods2.address='` + address + `' AND (mods2.topic=mods.topic OR mods2.topic='')`;

	var modsthread = ` LEFT JOIN hiddenposts ON hiddenposts.txid=messages.canonicalid
	LEFT JOIN hiddenusers ON hiddenusers.address=messages.address 
	LEFT JOIN mods on (hiddenposts.modr = mods.modr OR hiddenusers.modr=mods.modr) AND (mods.topic=messages.topic OR mods.topic='')
	LEFT JOIN mods as mods2 on mods2.modr=mods.address AND mods2.address='` + address + `' AND (mods2.topic=mods.topic OR mods2.topic='')`;

	//topicname may contain hostile characters - be careful in handling it
	var topicquery = " ";
	var topiclistquery = " ";
	
	var topicnameHOSTILE = (queryData.topicname || '');
	topicnameHOSTILE = topicnameHOSTILE.toLowerCase().trim();

	if (topicnameHOSTILE != "" && topicnameHOSTILE != "mytopics" && topicnameHOSTILE != "myfeed") { //mytopics has special meaning
		topicquery = " AND messages.topic=" + escapeFunction(topicnameHOSTILE) + " ";
		topiclistquery = " AND topics.topic=" + escapeFunction(topicnameHOSTILE) + " ";

	}

	var rpnameselection = `rpnames.name as rpname, 
	rpnames.pagingid as rppagingid,
	rpnames.publickey as rppublickey,
	rpnames.picurl as rppicurl,
	rpnames.tokens as rptokens,
	rpnames.followers as rpfollowers,
	rpnames.following as rpfollowing,
	rpnames.blockers as rpblockers,
	rpnames.blocking as rpblocking,
	rpnames.profile as rpprofile,
	rpnames.nametime as rpnametime,
	`;

	//Post list
	if (action == 'show') {

		var orderby = " ";

		if (order == 'hot' || order == 'best') {//heavily for new
			orderby = least + "/" + timedivisor + " DESC, messages.likes DESC ";
		} else if (order == 'new') {//order by date
			orderby = " ORDER BY messages.firstseen DESC ";
		} else {
			//If neither hot, best or new, then order is top
			orderby = least + " DESC, messages.likes DESC ";
		}

		orderby = orderby + " , moderated DESC ";

		var postsOrComments = " ";
		if (content == "replies") {
			postsOrComments = " AND messages.txid!=messages.roottxid ";
		} else if (content == "posts") {
			postsOrComments = " AND messages.roottxid=messages.txid ";
		}

		var followsql=` LEFT JOIN follows ON messages.address=follows.follows and follows.address='` + address + `' `;
		//todo - possible here that a blocked user might show up if they post in a topic the user is following
		var followsORblocks = followsql + " LEFT JOIN blocks ON (messages.address=blocks.blocks OR reposts.address=blocks.blocks) AND blocks.address='" + address + "'";
		var followsWhere = " and blocks.blocks IS NULL ";
		
		if (filter == "myfeed") { //My feed, posts from my subs or my peeps (does not exclude blocked members)
			followsORblocks = followsql +
			`LEFT JOIN subs ON messages.topic=subs.topic AND subs.address='` + address + `' `;
			followsWhere = ` and (follows.address is not null OR subs.address is not null) `;
		} else if (filter == "mypeeps") {
			followsORblocks = followsql;
			followsWhere = "";
		}



		if (topicnameHOSTILE == "mytopics") { //Show topics, but not from blocked members
			followsORblocks = followsql + ` 
			LEFT JOIN subs ON messages.topic=subs.topic  
			LEFT JOIN blocks ON messages.address=blocks.blocks AND blocks.address='` + address + `'`;
			followsWhere = ` and blocks.blocks IS NULL AND subs.address='` + address + `' `;
		}

		if (topicnameHOSTILE == "mytopics" && filter == "mypeeps") {
			followsORblocks = followsql + ` and follows.follows is not null
			LEFT JOIN subs ON messages.topic=subs.topic `;
			 followsWhere = ` AND subs.address='` + address + `' `;
		}

		if (topicnameHOSTILE == "myfeed" || filter == "myfeed") {
			followsORblocks = followsql + 
			` LEFT JOIN subs ON messages.topic=subs.topic and subs.address='` + address + `' `;
			followsWhere =` and (follows.follows is not null or subs.topic is not null) `;
		}



		//Default to a month
		var firstseen = " AND messages.firstseen>" + sqltimestamp + "-(60*60*24*30) ";

		if (order == 'topd') {
			firstseen = " AND messages.firstseen>" + sqltimestamp + "-(60*60*24*1) ";
		} else if (order == 'top48') {
			firstseen = " AND messages.firstseen>" + sqltimestamp + "-(60*60*24*2) ";
		} else if (order == 'topw') {
			firstseen = " AND messages.firstseen>" + sqltimestamp + "-(60*60*24*7) ";
		} else if (order == 'topm') {
			firstseen = " AND messages.firstseen>" + sqltimestamp + "-(60*60*24*30) ";
			if (topicnameHOSTILE == "" || topicnameHOSTILE == "mytopics") { firstseen += " AND messages.likes>5 "; } //Makes sql query faster
		} else if (order == 'topy') {
			firstseen = " AND messages.firstseen>" + sqltimestamp + "-(60*60*24*365) ";
			if (topicnameHOSTILE == "" || topicnameHOSTILE == "mytopics") { firstseen += " AND messages.likes>10 "; } //Makes sql query faster
		} else if (order == 'topa') {
			firstseen = " ";
			if (topicnameHOSTILE == "" || topicnameHOSTILE == "mytopics") { firstseen += " AND messages.likes>10 "; } //Makes sql query faster
		} else if (order == 'new') {
			if (topicnameHOSTILE != "" && topicnameHOSTILE != "mytopics" && topicnameHOSTILE != "myfeed" && filter != "myfeed")
				firstseen = " ";
		}

		var specificuser = "";
		if (qaddress != "" && qaddress != "undefined") {
			specificuser = ` AND messages.address='` + qaddress + `' `;
			followsORblocks = followsql;
			followsWhere =" ";
			firstseen = " ";

			//todo
			//on sqllite, specific user query and reposttxid work very slowly together. no idea why.
			//probably some index could be added
			if (issqlite){
				repostid = " ";
				repostvar = " ";
			}
		}

		//todo, for no retweets it would be more efficient not to join the table in the first place
		var noreposts = "";
		/*if(filter=="everyone" || filter=="" ){
			noreposts=` AND messages.repost IS NULL `;
		}*/

		sql = select + ` MIN(messages.firstseen), MAX(mods2.address) as moderated, messages.*,`+
		rpnameselection.replace(/rp/g,'') +
		rpnameselection+
		`userratings.rating,
		rpuserratings.rating as rprating, 
		messages.repliesdirect as replies,
		messages.repliesroot as repliesroot,
		likesdislikes.txid as likedtxid, 
		likesdislikes.type as likeordislike,
		rplikesdislikes.txid as rplikedtxid, 
		rplikesdislikes.type as rplikeordislike,
		follows.trxid as isfollowing,
		reposts.address as rpaddress,
		reposts.amount as rpamount,
		reposts.dislikes as rpdislikes,
		reposts.firstseen as rpfirstseen,
		reposts.geohash as rpgeohash,
		reposts.language as rplanguage,
		reposts.lat as rplat,
		reposts.likes as rplikes,
		reposts.lon as rplon,
		reposts.message as rpmessage,
		reposts.repliestree as rprepliestree,
		reposts.repliesuniquemembers as rprepliesuniquemembers,
		reposts.repost as rprepost,
		reposts.repostcount as rprepostcount,
		reposts.retxid as rpretxid,
		reposts.roottxid as rproottxid,
		reposts.tips as rptips,
		reposts.topic as rptopic,
		reposts.txid as rptxid,
		reposts.repliesdirect as rpreplies,
		reposts.repliesroot as rprepliesroot,
		reposts.repostcount as rprepostcount 
		` +	repostvar + `
		FROM messages as messages
		` + reposts + `
		` + mods + `
		` + followsORblocks + `
		
		` + userratings + `
		` + rpuserratings + `
		` + names + `
		` + rpnames + `
		` + likesanddislikes + `
		` + rplikesanddislikes + `
		` + repostid + `

		WHERE 1=1 
		` + followsWhere  + `
		` + postsOrComments + `
		` + topicquery + `
		` + specificuser + `
		` + firstseen + ` GROUP BY messages.canonicalid, mods2.address   
		` + orderby + ` LIMIT ` + start + `,` + limit;

	}

	//Notifications
	if (action == "alertcount") {
		var sel1 = select + ` count(*) from notifications   WHERE notifications.address='` + address + `'  AND time>` + since + ``;
		var sel2 = select + ` count(distinct roottxid) from privatemessages where toaddress='` + address + `' and firstseen>` + sincepm + ``;
		sql = select + ` (` + sel1 + `) as count, (` + sel2 + `) as countpm;`;
	}

	if (action == "notifications") {
		sql = select + ` notifications.*, `+
			rpnameselection.replace(/rp/g,'origin') +
			`u1.rating as rating, 
			u1.reason as reason, 
			likesdislikes.retxid as likeretxid, 
			likesdislikes.type as likeordislike,
			originfollows.trxid as originisfollowing,
			userfollows.trxid as userisfollowing,
			tips.amount as amount,`+
			rpnameselection.replace(/rp/g,'user') +
			`u2.rating as selfrating, 
			u3.rating as raterrating,			
			r.address as raddress,
			r.message as rmessage,
			r.txid as rtxid,
			r.firstseen as rfirstseen,
			r.retxid as rretxid,
			r.roottxid as rroottxid,
			r.likes as rlikes,
			r.dislikes as rdislikes,
			r.tips as rtips,
			r.topic as rtopic,
			r.lat as rlat,
			r.lon as rlon,
			r.geohash as rgeohash,
			r.repliesdirect as rreplies,
			r.repostcount as rrepostcount,
			rlikesdislikes.txid as rlikedtxid, 
			rlikesdislikes.type as rlikeordislike,
			l.address as laddress,
			l.message as lmessage,
			l.txid as ltxid,
			l.firstseen as lfirstseen,
			l.retxid as lretxid,
			l.roottxid as lroottxid,
			l.likes as llikes,
			l.dislikes as ldislikes,
			l.tips as ltips,
			l.topic as ltopic,
			l.lat as llat,
			l.lon as llon,
			l.geohash as lgeohash,
			l.repliesdirect as lreplies,
			l.repostcount as lrepostcount,
			llikesdislikes.txid as llikedtxid, 
			llikesdislikes.type as llikeordislike,
			lrepostid.txid as lrepostidtxid,
			rrepostid.txid as rrepostidtxid
			FROM notifications
			LEFT JOIN messages ON messages.txid=notifications.txid
			LEFT JOIN likesdislikes ON likesdislikes.txid=notifications.txid
			LEFT JOIN tips ON tips.txid=notifications.txid
			LEFT JOIN userratings as u1 ON u1.address=notifications.origin  AND u1.rates=notifications.address
			LEFT JOIN userratings as u2 ON u2.address=notifications.address AND u2.rates=notifications.address
			LEFT JOIN userratings as u3 ON notifications.address=u3.address AND u3.rates=notifications.origin
			LEFT JOIN names as originnames ON originnames.address=notifications.origin
			LEFT JOIN names as usernames ON usernames.address=notifications.address
			LEFT JOIN follows as originfollows ON notifications.origin=originfollows.follows and originfollows.address='` + address + `' 
			LEFT JOIN follows as userfollows ON notifications.address=userfollows.follows and userfollows.address='` + address + `' 
			LEFT JOIN messages as r ON notifications.txid=r.txid
			LEFT JOIN messages as rrepostid ON r.canonicalid = rrepostid.repost AND rrepostid.address='` + address + `' 
			LEFT JOIN likesdislikes as rlikesdislikes ON rlikesdislikes.address='` + address + `' AND rlikesdislikes.retxid=r.txid
			LEFT JOIN messages as l ON likesdislikes.retxid=l.txid
			LEFT JOIN messages as lrepostid ON l.canonicalid = lrepostid.repost AND lrepostid.address='` + address + `'
			LEFT JOIN likesdislikes as llikesdislikes ON llikesdislikes.address='` + address + `' AND llikesdislikes.retxid=l.txid
			
			LEFT JOIN blocks ON notifications.origin=blocks.blocks AND blocks.address='` + address + `' 
			WHERE blocks IS NULL
			AND notifications.address='` + qaddress + `' 
			AND notifications.address <> notifications.origin 
			AND notifications.time>`+ sqltimestamp + `-(60*60*24*21)
			ORDER BY notifications.time DESC LIMIT ` + start + `,` + limit;
	}


	//Threads
	if (action == "thread") {
		var threadorder = " ORDER BY (LEAST(messages.likes,10)-LEAST(messages.dislikes,10)+LEAST(replies-1,10)+LEAST((messages.tips/10000),10))/" + timedivisor + " DESC, firstseen DESC, moderated DESC";
		if (issqlite) threadorder = " ORDER BY (MIN(messages.likes,10)-MIN(messages.dislikes,10)+MIN(replies-1,10)+MIN((messages.tips/10000),10))/" + timedivisor + " DESC, firstseen DESC, moderated DESC";
	
		if (txid.length < 10) {
			txid = "nodice";
		}
		sql = select + ` DISTINCT(messages.txid), messages.*, mods2.address as moderated,
		blocks.trxid as blockstxid,`+
		rpnameselection.replace(/rp/g,'') +
		`rating,
		messages.repliesdirect as replies,
		likesdislikes.txid as likedtxid, 
		likesdislikes.type as likeordislike  
		FROM messages as messages3
		LEFT JOIN messages ON messages.roottxid=messages3.roottxid `
			+ userratings
			+ names
			+ likesanddislikes
			+ modsthread
			+ `LEFT JOIN blocks ON messages.address=blocks.blocks AND blocks.address='` + address + `' WHERE 1=1  
		AND messages3.txid LIKE '` + txid + `%' AND messages3.roottxid!='' ` + threadorder;
	}

	if (action == "singlepost") {
		sql = select + ` messages.*,`+
		rpnameselection.replace(/rp/g,'') +
		`rating,
		messages.repliesdirect as replies,
		likesdislikes.txid as likedtxid, 
		likesdislikes.type as likeordislike  
		FROM messages `
			+ userratings
			+ names
			+ likesanddislikes
			+ `WHERE 1=1 AND messages.txid LIKE '` + txid + `%' LIMIT 1`;
	}

	//Map
	if (action == `map`) {
		sql = select + ` 
			messages.address as address,
			dislikes,
			firstseen,
			likes,
			message,`+
			rpnameselection.replace(/rp/g,'') +
			`rating,
			messages.retxid as retxid,
			messages.roottxid as roottxid,
			tips,
			topic,
			messages.txid as txid,
			lat,
			lon,
			geohash, 
			repliesdirect as replies,  
			likesdislikes.txid as likedtxid, 
			likesdislikes.type as likeordislike  
			FROM messages 
			` + userratings + ` 
			` + names + `
			` + likesanddislikes + `
			LEFT JOIN blocks ON messages.address=blocks.blocks AND blocks.address='" + address + "' WHERE blocks IS NULL  
			AND lat<'` + north + `' AND lat>'` + south + `' AND lon<'` + east + `' AND lon>'` + west + `' ORDER BY messages.firstseen DESC LIMIT 25`;
	}

	//For member's page
	if (action == `memberposts`) {
		sql = select + ` 
					messages.*, 
					names.name as name, 
					userratings.rating as rating, 
					repliesdirect as replies, 
					likesdislikes.txid as likedtxid, 
					likesdislikes.type as likeordislike  
					FROM messages
					` + userratings + `
					` + names + ` 
					` + likesanddislikes + `
					WHERE messages.address='` + qaddress + `' 
					ORDER BY messages.firstseen 
					DESC LIMIT ` + start + `,` + limit;
	}

	if (action == `followers`) {
		sql = select + rpnameselection.replace(/rpnames/g,'n1').replace(/rp/g,'') + ` n1.address as address, rating as raterrating, n2.name as name2, n2.address as address2 
			from follows 
			LEFT JOIN userratings ON userratings.address='` + address + `' AND follows.address=userratings.rates 
			INNER JOIN names n1 ON n1.address=follows.address
			INNER JOIN names n2 ON n2.address='` + qaddress + `' 
			where follows.follows='` + qaddress + `' 
			ORDER by userratings.rating DESC`;
	}

	if (action == `following`) {
		sql = select + rpnameselection.replace(/rpnames/g,'n1').replace(/rp/g,'') + ` n1.address as address, rating as raterrating, n2.name as name2, n2.address as address2 
			from follows 
			LEFT JOIN userratings ON userratings.address='` + address + `' AND follows.follows=userratings.rates 
			INNER JOIN names n1 ON n1.address=follows.follows
			INNER JOIN names n2 ON n2.address='` + qaddress + `'  
			where follows.address='` + qaddress + `' 
			ORDER by userratings.rating DESC`;
	}

	if (action == `blockers`) {
		sql = select + rpnameselection.replace(/rpnames/g,'n1').replace(/rp/g,'') + ` n1.address as address, rating as raterrating, n2.name as name2, n2.address as address2 
			from blocks 
			LEFT JOIN userratings ON userratings.address='` + address + `' AND blocks.address=userratings.rates
			INNER JOIN names n1 ON n1.address=blocks.address 
			INNER JOIN names n2 ON n2.address='` + qaddress + `' 
			where blocks.blocks='` + qaddress + `'`;
	}

	if (action == `blocking`) {
		sql = select + rpnameselection.replace(/rpnames/g,'n1').replace(/rp/g,'') + ` n1.address as address, rating as raterrating, n2.name as name2, n2.address as address2
			from blocks 
			LEFT JOIN userratings ON userratings.address='` + address + `' AND blocks.blocks=userratings.rates 
			INNER JOIN names n1 ON n1.address=blocks.blocks 
			INNER JOIN names n2 ON n2.address='` + qaddress + `'
			where blocks.address='` + qaddress + `'`;
	}

	if (action == `ratings`) {
		sql = select + ` *,userratings.address as rateraddress,(select name from names where address = '` + qaddress + `') as ratername from userratings INNER JOIN names ON names.address=userratings.rates where userratings.address='` + qaddress + `'  AND userratings.rating!=191 AND userratings.rating!=63 ORDER by userratings.rating DESC`;
	}

	if (action == `rated`) {
		sql = select + ` *,userratings.address as rateeaddress,(select name from names where address = '` + qaddress + `') as rateename from userratings INNER JOIN names ON names.address=userratings.address where userratings.rates='` + qaddress + `'  AND userratings.rating!=191 AND userratings.rating!=63 ORDER by userratings.rating DESC`;
	}
	
	if (action == `settings`) {
		sql = select + ` * from names 
			INNER JOIN (SELECT count(*) as 'ratingnumber' FROM userratings where rates='` + qaddress  + `' and rating!='192' and rating!='63') as t3 
			INNER JOIN (SELECT count(*) as 'isfollowing' FROM follows where address='` + address + `' AND follows='` + qaddress + `') as t4 
			INNER JOIN (SELECT count(*) as 'isblocked' FROM blocks where address='` + address + `' AND blocks='` + qaddress + `') as t5 
			INNER JOIN (SELECT reason as 'ratingreason',SUM(rating) as 'rating' FROM userratings where address='` + address + `' AND rates='` + qaddress + `') as r1 
			where names.address='` + qaddress + `'
			LIMIT 1`;
	}

	if (action == `topiclist`) {
		//sublasttime is added here to keep mysql happy
		//subs.time as sublasttime
		sql = select + `DISTINCT(allmods.modr), topics.*, topics.topic as topicname, subs.address as address, allmods.modr as existingmod,  
		`+	rpnameselection.replace(/rp/g,'existingmod') + ` mymods.address as existingmodaddress FROM topics 
			LEFT JOIN subs on (topics.topic=subs.topic OR topics.topic='') AND subs.address='` + qaddress + `'
			LEFT JOIN mods as allmods on allmods.topic=topics.topic and (allmods.modr=allmods.address)
			LEFT JOIN names as existingmodnames on existingmodnames.address=allmods.modr
			LEFT JOIN mods as mymods on allmods.modr =mymods.modr and mymods.address=subs.address 
			WHERE 1=1 
			` + topiclistquery + `
			ORDER BY (topicname='') DESC, (subs.address='') DESC, ((messagescount+subscount*10)/((((`+ sqltimestamp + `-mostrecent)/(60*60))+2))*((((` + sqltimestamp + `-mostrecent)/(60*60))+2))) DESC
			LIMIT 0,200`;
	}

	if (action == `trustgraph`) {
		sql = select + ` u1.address as member, 
					n1.name as membername, 
					u1.rating as memberrating, 
					u2.address as inter, 
					n2.name as intername, 
					u2.rating as interrating, 
					u2.rates as target, 
					n3.name as targetname
				FROM userratings u1
				LEFT JOIN userratings u2 on u1.rates = u2.address
				LEFT JOIN names n1 on u1.address=n1.address
				LEFT JOIN names n2 on u2.address=n2.address
				LEFT JOIN names n3 on u2.rates=n3.address
				WHERE u1.rating!=191
				AND u2.rating!=191
				AND u1.address='` + address + `' 
				AND u2.rates = '` + qaddress + `'
				ORDER by u1.rating DESC, u2.rating DESC;`;
	}
	
	if (action == "usersearch") {
		var usersearchHOSTILE = "%" + (queryData.searchterm.toLowerCase() || '') + "%";
		//Searching the pagingid rather than the name for case insensitive search
		sql = "SELECT names.*, userratings.rating as rating from names LEFT JOIN userratings ON names.address = userratings.rates AND userratings.address='" + address + "' where pagingid like " + escapeFunction(usersearchHOSTILE) + " or name like " + escapeFunction(usersearchHOSTILE) + " LIMIT 10";
	}

	if (action == "resolvepagingid") {
		var searchHOSTILE = queryData.pagingid.toLowerCase() || '';
		//Searching the pagingid rather than the name for case insensitive search
		sql = "SELECT names.*, userratings.rating as rating from names LEFT JOIN userratings ON names.address = userratings.rates AND userratings.address='" + address + "' where pagingid = " + escapeFunction(searchHOSTILE) + " ORDER BY nametime ASC LIMIT 10";
	}

	if (action == "messages") {
		sql = `SELECT privatemessages.*,`+
				rpnameselection.replace(/rp/g,'') +
				`privatemessages.address as senderaddress,`+ 
				rpnameselection.replace(/rp/g,'recipient') +
				` recipientnames.name as recipient, userratings.rating as raterrating from privatemessages
				LEFT JOIN names as names ON privatemessages.address=names.address
				LEFT JOIN names as recipientnames ON privatemessages.toaddress=recipientnames.address
				LEFT JOIN userratings ON userratings.address='` + address + `' AND privatemessages.address=userratings.rates 
					WHERE privatemessages.toaddress='` + address + `' or privatemessages.address='` + address + `' 
					ORDER BY privatemessages.firstseen 
					DESC LIMIT 100`;
	}

	if(action == "likesandtips"){
		sql = `SELECT userratings.rating as raterrating, likes.address as address, `+
		rpnameselection.replace(/rp/g,'') +
		` likes.type, tips.amount, likes.address, follows.trxid FROM likesdislikes as likes
		LEFT JOIN tips on tips.address = likes.address and tips.retxid=likes.retxid
		LEFT JOIN names on names.address=likes.address
		LEFT JOIN follows on likes.address=follows.follows and follows.address='` + address + `'
		LEFT JOIN userratings ON userratings.address='` + address + `' AND names.address=userratings.rates 
		WHERE likes.retxid='` + txid + `'
		order by amount desc`;
	}

	return sql;

}

module.exports = dbqueries;
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

var sqlforaction = {};
var geohashlib = require('./geohash.js');
var bitcoinJs = require('bitcoinjs-lib');
var bs58check = require('bs58check');
const request = require('request');
const sharp = require('sharp');

const MAXADDRESS = 35;
const MAXTXID = 64;
const MAXMESSAGE = 220;
const MAXHEXMESSAGE = 440;
const MAXGEOHASH = 16;

//const LanguageDetect = require('languagedetect');
//const lngDetector = new LanguageDetect();
//lngDetector.setLanguageType('iso2');
//const cld = require('cld');
sqlforaction.lastoc = "";

function processOPDATA(hexdata, maxterms) {
  if (maxterms == null) { maxterms = 5; }
  var opdata = [];
  //breakout if i is more than five - maybe infinite loop
  for (var i = 0; hexdata.length > 0 && i < maxterms; i++) {
    var length = parseInt(hexdata.substring(0, 2), 16);

    if (length == 0 || length == 80) {
      opdata[i] = 0;
      hexdata = hexdata.substring(2);
    } else if (length < 76) {
      opdata[i] = hexdata.substring(2, 2 + length * 2);
      hexdata = hexdata.substring(2 + length * 2);
    } else if (length == 76) {
      length = parseInt(hexdata.substring(2, 4), 16);
      opdata[i] = hexdata.substring(4, 4 + length * 2);
      hexdata = hexdata.substring(4 + length * 2);
    } else if (length == 79) {
      opdata[i] = -1;
      hexdata = hexdata.substring(2);
    } else if (length == 81) {
      opdata[i] = 1;
      hexdata = hexdata.substring(2);
    } else if (length >= 82 && length <= 96) {
      opdata[i] = length - 80;
      hexdata = hexdata.substring(2);
    }

  }
  return opdata;
}

sqlforaction.getSQLForAction = function (tx, time, issqlite, escapeFunction, blocknumber, profilepicpath, insertignore, querymemoformissingpics, debug, downloadprofilepics, keepThreadNotificationsTime, keepNotificationsTime, onConflictAddress) {


  var txid = tx.getId();

  for (var i = 0; i < tx.outs.length; i++) {

    var hex = tx.outs[i].script.toString('hex');
    var sql = [];

    if (hex.startsWith("6a04534c500001010747454e45534953")) {
      if (debug) {
        sqlforaction.lastoc = "6a04534c";
        console.log('oc:' + "6a04534c" + ':txid:' + txid);
      }

      //SLP creation transaction
      var messages = processOPDATA(hex.substring(12), 20);
      var capped = "(UNCAPPED) ";
      if (messages[7] == "") {
        capped = "(CAPPED SUPPLY " + (Number("0x" + messages[8]) * Math.pow(10, Number("0x" + messages[6]) * -1)).toLocaleString() + ") ";
      }
      var slpTokenMessage = fromHex(messages[3]) + " (" + fromHex(messages[2]) + ") created " + capped + fromHex(messages[4]) + " " + fromHex(messages[5]);

      var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);

      //Create post from slp creation
      sql.push(insertignore + " into messages VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(slpTokenMessage) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ",''," + escapeFunction(txid) + ",1,0,0," + escapeFunction('tokens') + ",NULL,NULL,NULL,0,0,0,0,NULL," + escapeFunction(txid) + ",0,'',0);");
      //Assume author likes his own post
      sql.push(insertignore + " into likesdislikes VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + ",1," + escapeFunction(time) + "," + escapeFunction(txid) + ");");
      return sql;

    }

    if (hex.startsWith("6a026d") || hex.startsWith("6a027d") || hex.startsWith("6a028d") || hex.startsWith("6a029d")) {
      var truncatehex = hex.substring(4);
      var operationCode = truncatehex.substring(0, 4);
      sqlforaction.lastoc = operationCode;
      if (debug && !operationCode.startsWith('6d3')) {
        console.log('oc:' + operationCode + ':txid:' + txid);
      }
      var messages = processOPDATA(truncatehex.substring(4));

      //Add to notifications
      var curTime = new Date().getTime() / 1000;
      var insertNotifications = (curTime - time < keepNotificationsTime);

      //Note, in the case of a pollvote, two of these will be activated

      //case "6d01": //Set name 	0x6d01 	name(77)
      //case "8d01": //Set name 	0x8d01 	name(77)
      if (operationCode == "6d01" || operationCode == "8d01") {
        var name = fromHex(messages[0]);
        name = name.substr(0, MAXMESSAGE);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        var publicKey = getFirstPublicKeyFromTX(tx.ins[0]);
        //members autofollow themselves when they set their name 
        sql.push(insertignore + " into follows VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(sentFrom) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");

        //Strip out special characters from paging ids
        var pagename = name.replace(/\n/g, "");
        pagename = pagename.replace(/ /g, "");
        pagename = pagename.replace(/[.,\/#!$%\^&\*;:{}=\-`~()'"@<>\ \n?]/g, "");
        pagename = pagename.toLowerCase();


        if (time < 1567299601) {
          sql.push("insert into names VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(name) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ",'',''," + escapeFunction(pagename) + "," + escapeFunction(publicKey) + ",'',0,'',0,0,0,0,0) " + onConflictAddress + " name=" + escapeFunction(name) + ", nametxid=" + escapeFunction(txid) + ", nametime=" + escapeFunction(time) + ", pagingid=" + escapeFunction(pagename) + ", publickey=" + escapeFunction(publicKey) + ";");
        } else {
          //After Sept 1st 2019, names cannot necessarily be changed.
          sql.push(insertignore + " into names VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(name) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ",'',''," + escapeFunction(pagename) + "," + escapeFunction(publicKey) + ",'',0,'',0,0,0,0,0) ;");
          //If profile is already set, but name is not need to update values because previous statement will have been ignored

          //names cannot be changed if there are more than 3 ratings, not including follows or mutes
          var ratingscount = "(SELECT count(*) FROM userratings where rates=" + escapeFunction(sentFrom) + " AND rating!=191 AND rating!=63)<3";
          sql.push("UPDATE names set name=" + escapeFunction(name) + ", nametxid=" + escapeFunction(txid) + ", nametime=" + escapeFunction(time) + ", pagingid=" + escapeFunction(pagename) + ", publickey=" + escapeFunction(publicKey) + " WHERE (name='' OR " + ratingscount + ") AND address=" + escapeFunction(sentFrom) + ";");
        }

      }

      if (operationCode == "6d0c" || operationCode == "6d02" || operationCode == "6d0b" || operationCode == "6d0f" || operationCode == "6d10" || operationCode == "6d24" || operationCode == "6da8" || operationCode == "8d02" || operationCode == "8d11") {
        //case "6d0c": //Post topic message 	0x6d0c 	topic(variable), message(74 - topic length)
        //case "6d02": //Post memo 	0x6d02 	message(77)
        //case "6d0b": //Repost memo 0x6d0b txhash(32), message(184)
        //case "6d0f": //Repost memo in topic txhash(32), topic(variable), message(179 - topic length)
        //case "6d10": //Memo poll
        //case "6d24": //Send money
        //case "6da8": //Post geotagged message 0x6da8 geohash(variable),message
        //case "8d02": //Post memo (blockpress)
        //case "8d11": //Blockpress?

        //var message=truncatehex.substring(4);
        var decode = fromHex(messages[0]);
        var topic = "";
        var geohash = "";
        var lat = null;
        var long = null;
        var repostid = null;
        if (messages.length > 1) {
          if (operationCode == "6d0c") { //topic
            topic = decode.toLowerCase().trim();
          } else if (operationCode == "6da8") { //geotagged
            try {
              geohash = decode;
              var coords = geohashlib.decodeGeoHash(decode);
              lat = coords["latitude"][0];
              long = coords["longitude"][0];
            } catch (e) {//ignore error in encoded geotags
              system.log(e);
            }
          }

          if (operationCode == "6d10") {
            //Poll question is in third position
            decode = fromHex(messages[2]);
            topic = "polls";
          } else {
            //For all others, it is in second position
            decode = fromHex(messages[1]);
          }
        }

        //Canonicalid will be the same as the txid, expect for reposts
        //This field helps to avoid seeing the same reposts over and over as new content. 
        var canonicalid = txid;
        if (operationCode == "6d0b" || operationCode == "6d0f") { //Repost memo 	
          repostid = messages[0].match(/[a-fA-F0-9]{2}/g).reverse().join('');
          repostid = repostid.substr(0, MAXTXID);

          decode = "";
          if (operationCode == "6d0b" && messages.length > 1) {
            decode = fromHex(messages[1]);
          }

          if (operationCode == "6d0f") {
            topic = fromHex(messages[1]).toLowerCase().trim();
            if (messages.length > 2) {
              decode = fromHex(messages[2]);
            }
          }

          if (!decode) {
            canonicalid = repostid;
          }
        }

        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        decode = decode.substr(0, MAXMESSAGE);
        topic = topic.substr(0, MAXMESSAGE);
        geohash = geohash.substr(0, MAXGEOHASH);

        var lang = "";
        /*try{
          const result = await cld.detect(decode);
          console.log(result, decode);
          
        } catch(err){
          console.log(err);
          //Nothing
        }*/


        sql.push(insertignore + " into messages VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(decode) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ",''," + escapeFunction(txid) + ",1,0,0," + escapeFunction(topic) + "," + (lat == null ? "NULL" : escapeFunction(lat)) + "," + (long == null ? "NULL" : escapeFunction(long)) + "," + escapeFunction(geohash) + ",0,0,0,0," + (repostid == null ? "NULL" : escapeFunction(repostid)) + "," + escapeFunction(canonicalid) + ",0,'',0);");
        //Assume author likes his own post
        sql.push(insertignore + " into likesdislikes VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + ",1," + escapeFunction(time) + "," + escapeFunction(txid) + ");");

        //Add page notifications
        if (insertNotifications) {
          sql = sql.concat(getPageNotificationSQL(decode, txid, sentFrom, time, escapeFunction, insertignore));
        }

        //For reposts
        if (operationCode == "6d0b" || operationCode == "6d0f") {
          //increase repost count
          if (issqlite) {
            sql.push("UPDATE messages SET repostcount = (SELECT count(*) FROM messages WHERE repost=" + escapeFunction(repostid) + ")  WHERE txid=" + escapeFunction(repostid) + ";");
          } else {
            sql.push("UPDATE messages AS dest,(SELECT repost, COUNT(*) as count FROM messages WHERE repost=" + escapeFunction(repostid) + " GROUP BY repost) AS src SET dest.repostcount = src.count WHERE dest.txid = src.repost;");
          }

          //add repost notification
          if (insertNotifications) {
            sql.push(insertignore + " into notifications VALUES(" + escapeFunction(repostid) + ",'repost',(SELECT address FROM messages WHERE txid = " + escapeFunction(repostid) + ")," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
          }
        }

        //topic notifications
        if (insertNotifications) {
          //Topic notifications - this may generate a lot of notifications
          sql.push(insertignore + " into notifications SELECT * FROM (SELECT " + escapeFunction(txid) + ",'topic', address, " + escapeFunction(sentFrom) + "," + escapeFunction(time) + " FROM subs where subs.topic=" + escapeFunction(topic) + ") as tsubs; ");
        }


      }

      //case "6d04": //Like / tip memo 	0x6d04 	txhash(30)
      //case "8d04": //Blockpress like
      //case "6d14": //Poll vote 	0x6d14 	poll_txhash(32), comment(184)
      //Note, this codeblock must come before the reply codeblock to allow for a poll vote to have a comment
      if (operationCode == "6d04" || operationCode == "8d04" || operationCode == "6d14") {
        var retxid;
        if (operationCode == "8d04") {
          retxid = messages[0];
        } else {
          retxid = messages[0].match(/[a-fA-F0-9]{2}/g).reverse().join('');
        }
        retxid = retxid.substr(0, MAXTXID);

        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        //Check for tip
        var amount = 0;
        try {
          var tipto = getAddressFromTXOUT(tx.outs[i + 1]);
          var amount = getAmountFromTXOUT(tx.outs[i + 1]);
          if (sentFrom == tipto) {
            //It's a change address
            amount = 0;
          }
        } catch (error) {
          //console.log("No Tip: ");
          //Nothing to do here
        }

        sql.push("REPLACE into likesdislikes VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + ",1," + escapeFunction(time) + "," + escapeFunction(retxid) + ");");

        //Update likes count
        sql.push("UPDATE messages SET likes = (SELECT count(*) FROM likesdislikes WHERE likesdislikes.type=1 AND likesdislikes.retxid=" + escapeFunction(retxid) + ")  WHERE txid=" + escapeFunction(retxid) + ";");

        if (amount > 0) {
          //TODO check tip is really going to owner of the message - maybe do this in the SQL statement
          sql.push(insertignore + " into tips VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + "," + escapeFunction(amount) + "," + escapeFunction(time) + "," + escapeFunction(retxid) + ");");
          //Update total tips sum
          sql.push("UPDATE messages SET tips=(SELECT sum(amount) FROM tips WHERE retxid=" + escapeFunction(retxid) + ") WHERE txid=" + escapeFunction(retxid) + " ;");
        }

        //Add to notifications
        if (insertNotifications) {
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'like',(SELECT address FROM messages WHERE txid = " + escapeFunction(retxid) + ")," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
        }

      }

      //case "6d03": //Reply to memo 	0x6d03 	txhash(30), message(45)
      //case "8d03": //Blockpress reply
      //case "6d13": //Poll option
      //case "6d14": //Poll vote 	0x6d14 	poll_txhash(32), comment(184)
      if (operationCode == "6d03" || operationCode == "8d03" || operationCode == "6d13" || operationCode == "6d14") {
        var retxid;
        //Blockpress has retxid ids reversed
        if (operationCode == "8d03") {
          retxid = messages[0];
        } else {
          retxid = messages[0].match(/[a-fA-F0-9]{2}/g).reverse().join('');
        }
        retxid = retxid.substr(0, MAXTXID);

        var decode = fromHex(messages[1]);
        decode = decode.substr(0, MAXMESSAGE);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);

        if (decode.length == 0) {
          //likely in the case of a poll vote.
          return sql;
        }

        //Assume author likes his own reply
        var startingLikes = 0;
        if (operationCode != "6d13") { //except for poll options
          startingLikes = 1;
          sql.push(insertignore + " into likesdislikes VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + ",1," + escapeFunction(time) + "," + escapeFunction(txid) + ");");
        }

        sql.push(insertignore + " into messages VALUES(" + escapeFunction(sentFrom) + "," + escapeFunction(decode) + "," + escapeFunction(txid) + "," + escapeFunction(time) + "," + escapeFunction(retxid) + ",''," + startingLikes + ",0,0,'',NULL,NULL,'',0,0,0,0,NULL," + escapeFunction(txid) + ",0,'',0);");

        //Add roottxid - These are probably the slowest update queries         
        if (issqlite) {
          //Make sure reply has the same roottxid and topic as parent, sometimes this won't be available, there is a housekeeping operation to fill it in later if so
          sql.push("UPDATE messages SET (roottxid,topic) = (SELECT m.roottxid, m.topic FROM messages m WHERE txid=" + escapeFunction(retxid) + ") WHERE messages.txid=" + escapeFunction(txid) + ";");

          //var selectRootTXID = " (SELECT roottxid FROM messages WHERE txid=" + escapeFunction(retxid) + ") ";

          //keep count of total number of replies, members in a thread, note, if roottxid is not available, these do not get updated properly
          //sql.push("UPDATE messages SET repliesroot = (SELECT COUNT(*)-1 FROM messages WHERE roottxid=" + selectRootTXID + "), repliesuniquemembers = (SELECT count(DISTINCT address) FROM messages WHERE roottxid=" + selectRootTXID + ") WHERE roottxid = " + selectRootTXID + ";");

          //increase number of direct replies for parent message, this should be pretty fast
          //sql.push("UPDATE messages SET repliesdirect = (SELECT COUNT(*) FROM messages WHERE retxid=" + escapeFunction(retxid) + ")  WHERE messages.txid = " + escapeFunction(retxid) + ";");

        } else {
          //This may be a bit faster for mysql
          //This is occassionally slow for mysql
          //Possibly try using a similar call to sqlite above
          sql.push("UPDATE messages JOIN messages parent ON messages.retxid=parent.txid SET messages.roottxid = parent.roottxid, messages.topic = parent.topic WHERE messages.roottxid = '' AND messages.txid=" + escapeFunction(txid) + ";");

          //keep count of total number of replies in a thread
          //sql.push("UPDATE messages AS dest,(SELECT roottxid, COUNT(*)-1 as count FROM messages WHERE roottxid=(SELECT roottxid FROM messages WHERE txid=" + escapeFunction(retxid) + ") GROUP BY roottxid) AS src SET dest.repliesroot = src.count WHERE dest.txid = src.roottxid;");

          //keep count of total number of members in a thread
          //sql.push("UPDATE messages AS dest,(SELECT roottxid, count(DISTINCT address) as count FROM messages WHERE roottxid=(SELECT roottxid FROM messages WHERE txid=" + escapeFunction(retxid) + ") GROUP BY roottxid) AS src SET dest.repliesuniquemembers = src.count WHERE dest.txid =src.roottxid;");

          //increase number of direct replies for parent message, this should be pretty fast
          //sql.push("UPDATE messages AS dest,(SELECT retxid, COUNT(*) as count FROM messages WHERE retxid=" + escapeFunction(retxid) + " GROUP BY retxid) AS src SET dest.repliesdirect = src.count WHERE dest.txid = src.retxid;");

        }

        var selectRootTXID = " (SELECT * FROM (SELECT roottxid FROM messages WHERE txid=" + escapeFunction(retxid) + ") as roottxid) ";

        //keep count of total number of replies, don't count replies to self. members in a thread, note, if roottxid is not available, these do not get updated properly
        //note superfluous select * necessary for mysql
        sql.push("UPDATE messages SET repliesroot = (SELECT * FROM (SELECT COUNT(*)-1 FROM messages LEFT JOIN messages as messages2 on messages2.txid = messages.retxid WHERE messages2.address!=messages.address and messages.roottxid=" + selectRootTXID + ") as count), repliesuniquemembers = (SELECT * FROM (SELECT count(DISTINCT address) FROM messages WHERE roottxid=" + selectRootTXID + ") as count) WHERE roottxid = " + selectRootTXID + ";");

        //increase number of direct replies for parent message. don't count replies to self. 
        //note superfluous select * necessary for mysql
        sql.push("UPDATE messages SET repliesdirect = (SELECT * FROM (SELECT COUNT(*) FROM messages LEFT JOIN messages as messages2 on messages2.txid = messages.retxid WHERE messages.retxid=" + escapeFunction(retxid) + " and messages2.address!=messages.address) as count)  WHERE messages.txid = " + escapeFunction(retxid) + ";");

        //Add page notifications - this should happen before reply notification in case a member is both replied to and paged in the same reply 
        if (insertNotifications) {
          sql = sql.concat(getPageNotificationSQL(decode, txid, sentFrom, time, escapeFunction, insertignore));
        }

        //Add to notifications
        if (insertNotifications) {
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'reply',(SELECT address FROM messages WHERE txid = " + escapeFunction(retxid) + ")," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
        }

        //Check the time, there can be a lot of thread notifications, so we don't want them, particularly when rebuilding the db
        if (curTime - time > keepThreadNotificationsTime) {
          //Thread notifications
          sql.push(insertignore + " into notifications SELECT * FROM (SELECT " + escapeFunction(txid) + ",'thread', messages.address, " + escapeFunction(sentFrom) + "," + escapeFunction(time) + " FROM messages LEFT JOIN messages as messages2 on messages2.txid = messages.retxid and messages2.address!=messages.address WHERE messages.retxid = " + escapeFunction(retxid) + " AND messages.txid != " + escapeFunction(retxid) + ") as tnotifications; ");
        }

        //sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'thread',(SELECT address FROM messages WHERE roottxid = " + selectRootTXID + " AND txid != " + escapeFunction(retxid) + ")," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");

      }



      //case "6db4": //dislike 0x6db4 	txhash(30)
      if (operationCode == "6db4") {
        var retxid;
        retxid = messages[0].match(/[a-fA-F0-9]{2}/g).reverse().join('');
        retxid = retxid.substr(0, MAXTXID);

        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);

        sql.push("REPLACE into likesdislikes VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + ",-1," + escapeFunction(time) + "," + escapeFunction(retxid) + ");");
        sql.push("UPDATE messages SET dislikes = (SELECT count(*) FROM likesdislikes WHERE likesdislikes.type=-1 AND likesdislikes.retxid=" + escapeFunction(retxid) + ")  WHERE txid=" + escapeFunction(retxid) + ";");
        if (insertNotifications) {
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'dislike',(SELECT address FROM messages WHERE txid = " + escapeFunction(retxid) + ")," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
        }

      }

      //case "6d05": //Set profile text 0x6d05 	message(77)
      //case "8d05":
      //case "6d0a": //Set profile picture 	 	url(217)
      if (operationCode == "6d05" || operationCode == "8d05" || operationCode == "6d0a") {
        var profiletext = fromHex(messages[0]);
        profiletext = profiletext.substr(0, MAXMESSAGE);
        var publicKey = getFirstPublicKeyFromTX(tx.ins[0]);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        //console.log(sentFrom);

        if (operationCode == "8d05" || operationCode == "6d05") {
          sql.push("insert into names VALUES (" + escapeFunction(sentFrom) + ",'','',0," + escapeFunction(profiletext) + "," + escapeFunction(txid) + ",''," + escapeFunction(publicKey) + ",'',0,'',0,0,0,0,0) " + onConflictAddress + " profile=" + escapeFunction(profiletext) + ", protxid=" + escapeFunction(txid) + ";");
        } else if (operationCode == "6d0a") {
          var tx20 = profiletext.substr(profiletext.length - 4, 4);
          if (!(tx20.toLowerCase() == '.jpg' || tx20.toLowerCase() == '.png')) {
            return sql;
          }
          sql.push("insert into names VALUES (" + escapeFunction(sentFrom) + ",'','',0,'','',''," + escapeFunction(publicKey) + "," + escapeFunction(profiletext) + "," + escapeFunction(time) + "," + escapeFunction(tx20) + ",0,0,0,0,0) " + onConflictAddress + " picurl=" + escapeFunction(profiletext) + ", pictime=" + escapeFunction(time) + ", tx20=" + escapeFunction(tx20) + ";");

          if (!downloadprofilepics) {
            return sql;
          }

          //fetch image from url
          console.log(profiletext);
          var imgurRegex = /(?:https?:\/\/)?(\w+\.)?imgur\.com(\/|\/a\/|\/gallery\/)(?!gallery)([\w\-_]{5,12})(\.[a-zA-Z]{3})*/i;
          var imgurLink = profiletext.replace(imgurRegex, 'https://i.imgur.com$2$3$4');
          console.log(imgurLink);
          if (imgurLink.toLowerCase().startsWith('https://i.imgur.com') && (imgurLink.endsWith(".jpg") || imgurLink.endsWith(".png")) && imgurLink.length < 35) {
            try {
              var last4 = imgurLink.substr(profiletext.length - 4, 4);
              var lsentFrom = sentFrom;
              request({ url: imgurLink, encoding: null }, function (error, response, body) { writeImagesToDisk(error, response, body, last4, lsentFrom, profilepicpath, querymemoformissingpics); });
            } catch (err) {
              console.log(err);
            }
          }
        }


      }

      //case "6d06": //Follow user 	0x6d06 	address(35)
      //case "8d06":
      if (operationCode == "6d06" || operationCode == "8d06") {
        var followAddress = "";
        if (operationCode == "8d06") {
          followAddress = fromHex(messages[0]);
        } else {
          followAddress = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
        }
        followAddress = followAddress.substr(0, MAXADDRESS);

        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        sql.push(insertignore + " into follows VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(followAddress) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");
        if (insertNotifications) {
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'follow'," + escapeFunction(followAddress) + "," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
        }

        //If the user rating was nearly 2 stars, 63, then this rating was as a result of a block, so remove it
        sql.push("DELETE FROM userratings WHERE address=" + escapeFunction(sentFrom) + " AND rates=" + escapeFunction(followAddress) + " AND rating='63';");

        //Set the user rater to nearly 4 stars, 191, unless a rating is already present 
        sql.push(insertignore + " into userratings VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(followAddress) + ",'191'," + escapeFunction("Follows") + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");

        sql.push(`update names set following=(SELECT count(*) FROM follows where address=` + escapeFunction(sentFrom) + `) where names.address=` + escapeFunction(sentFrom) + `;`);
        sql.push(`update names set followers=(SELECT count(*) FROM follows where follows=` + escapeFunction(followAddress) + `) where names.address=` + escapeFunction(followAddress) + `;`);



      }

      //case "6d07": //Unfollow user 	0x6d07 	address(35)
      //case "8d07":
      if (operationCode == "6d07" || operationCode == "8d07") {
        var followAddress = "";
        if (operationCode == "8d07") {
          followAddress = fromHex(messages[0]);
        } else {
          followAddress = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
        }
        followAddress = followAddress.substr(0, MAXADDRESS);

        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        sql.push("delete from follows WHERE address=" + escapeFunction(sentFrom) + " AND follows=" + escapeFunction(followAddress) + ";");
        if (insertNotifications) {
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'unfollow'," + escapeFunction(followAddress) + "," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
        }

        //If the user rating was nearly 4 stars, 191, then this rating was as a result of a follow, so remove it
        sql.push("DELETE FROM userratings WHERE address=" + escapeFunction(sentFrom) + " AND rates=" + escapeFunction(followAddress) + " AND rating='191';");

        sql.push(`update names set following=(SELECT count(*) FROM follows where address=` + escapeFunction(sentFrom) + `) where names.address=` + escapeFunction(sentFrom) + `;`);
        sql.push(`update names set followers=(SELECT count(*) FROM follows where follows=` + escapeFunction(followAddress) + `) where names.address=` + escapeFunction(followAddress) + `;`);

      }


      //case "6d0d": //Topic follow 	0x6d0d 	topic_name(variable) 	Implemented
      if (operationCode == "6d0d") {

        var decode = fromHex(messages[0]);
        var topic = decode.toLowerCase().trim();
        topic = topic.substr(0, MAXMESSAGE);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        sql.push(insertignore + " into subs VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(topic) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");


      }

      //case "6d0e": //Topic unfollow 	0x6d0e 	topic_name(variable) 	Implemented
      if (operationCode == "6d0e") {

        var decode = fromHex(messages[0]);
        var topic = decode.toLowerCase().trim();
        topic = topic.substr(0, MAXMESSAGE);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        sql.push("delete from subs WHERE address=" + escapeFunction(sentFrom) + " AND topic=" + escapeFunction(topic) + ";");

      }
      //case "6d16": //Mute user 	0x6d16 	address(35), message(180)
      //case "6da6": //Block user 	0x6da6 	address(35), message(180)
      if (operationCode == "6d16" || operationCode == "8da6") {
        var blockAddress = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
        blockAddress = blockAddress.substr(0, MAXADDRESS);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        var reason = "";
        if (messages.length > 1) {
          reason = fromHex(messages[1]);
        }
        reason = reason.substr(0, MAXMESSAGE);

        sql.push(insertignore + " into blocks VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(blockAddress) + "," + escapeFunction(txid) + "," + escapeFunction(reason) + "," + escapeFunction(time) + ");");
        if (insertNotifications) {
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'mute'," + escapeFunction(blockAddress) + "," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
        }

        //If the user rating was nearly 4 stars, 191, then this rating was as a result of a follow, so remove it first
        sql.push("DELETE FROM userratings WHERE address=" + escapeFunction(sentFrom) + " AND rates=" + escapeFunction(blockAddress) + " AND rating='191';");

        //Set the user rating to nearly 2 stars, 63, unless a rating is already present
        sql.push(insertignore + " into userratings VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(blockAddress) + ",'63'," + escapeFunction("Mutes") + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");

        sql.push(`update names set blocking=(SELECT count(*) FROM blocks where address=` + escapeFunction(sentFrom) + `) where names.address=` + escapeFunction(sentFrom) + `;`);
        sql.push(`update names set blockers=(SELECT count(*) FROM blocks where blocks=` + escapeFunction(blockAddress) + `) where names.address=` + escapeFunction(blockAddress) + `;`);

      }

      //case "6d17": //Unmute user 	0x6d17 	address(35)
      //case "6da7": //Unblock user 	0x6da7 	address(35)
      if (operationCode == "6d17" || operationCode == "6da7") {

        var blockAddress = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
        blockAddress = blockAddress.substr(0, MAXADDRESS);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        sql.push("delete from blocks WHERE address=" + escapeFunction(sentFrom) + " AND blocks=" + escapeFunction(blockAddress) + ";");
        if (insertNotifications) {
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'unmute'," + escapeFunction(blockAddress) + "," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
        }

        //If the user rating was nearly 2 stars, 63, then this rating was as a result of a block, so remove it
        sql.push("DELETE FROM userratings WHERE address=" + escapeFunction(sentFrom) + " AND rates=" + escapeFunction(blockAddress) + " AND rating='63';");
        sql.push(`update names set blocking=(SELECT count(*) FROM blocks where address=` + escapeFunction(sentFrom) + `) where names.address=` + escapeFunction(sentFrom) + `;`);
        sql.push(`update names set blockers=(SELECT count(*) FROM blocks where blocks=` + escapeFunction(blockAddress) + `) where names.address=` + escapeFunction(blockAddress) + `;`);

      }

      //case "6da5":  //User Rating 	0x6da5 	address(35),byte(2),message(x)
      if (operationCode == "6da5") {

        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        var userAddress = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
        userAddress = userAddress.substr(0, MAXADDRESS);

        var rating = parseInt(messages[1], 16);
        if (rating < 0) rating = 0;
        if (rating > 255) rating = 255;

        var note = "";
        if (messages[2] != undefined) {
          note = fromHex(messages[2]);
        }
        note = note.substr(0, MAXMESSAGE);

        if (rating == 0) {
          sql.push("delete from userratings WHERE address=" + escapeFunction(sentFrom) + " AND rates=" + escapeFunction(userAddress) + ";");
        }
        else if (rating > 0 && rating < 256) {

          if (note) {
            sql.push("replace into userratings VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(userAddress) + "," + escapeFunction(rating) + "," + escapeFunction(note) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");
          } else {
            var conflict = onConflictAddress.replace('address', 'address,rates');
            sql.push("insert into userratings VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(userAddress) + "," + escapeFunction(rating) + "," + escapeFunction(note) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ") " + conflict + " rating=" + escapeFunction(rating)  + ", trxid=" + escapeFunction(txid) + ", time=" + escapeFunction(time) + ";");
          }


          if (insertNotifications) {
            sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'rating'," + escapeFunction(userAddress) + "," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
          }

          //don't make a new post if there is no comment
          if (note != "" && note.toLowerCase().trim() != "follows") {
            let concat = `CONCAT(
              "@",
              COALESCE((SELECT pagingid FROM names WHERE address = ` + escapeFunction(sentFrom) + `),` + escapeFunction(sentFrom) + `),
              " rated @",
              COALESCE((SELECT pagingid FROM names WHERE address = ` + escapeFunction(userAddress) + `),` + escapeFunction(userAddress) + `),
              " as ` + (Math.round(Number(rating) / 64) + 1) + `/5: ",
              `+ escapeFunction(note) + `
            )`;

            if (issqlite) {
              concat = `"@" || COALESCE((SELECT pagingid FROM names WHERE address = ` + escapeFunction(sentFrom) + `),` + escapeFunction(sentFrom) + `) || " rated @" ||
              COALESCE((SELECT pagingid FROM names WHERE address = ` + escapeFunction(userAddress) + `),` + escapeFunction(userAddress) + `) ||
              " as ` + (Math.round(Number(rating) / 64) + 1) + `/5: " ||
              `+ escapeFunction(note);
            }

            sql.push(insertignore + " into messages VALUES (" + escapeFunction(sentFrom) + "," + concat + "," + escapeFunction(txid) + "," + escapeFunction(time) + ",''," + escapeFunction(txid) + ",1,0,0," + escapeFunction('ratings') + ",NULL,NULL," + escapeFunction('') + ",0,0,0,0,NULL," + escapeFunction(txid) + ",0,'',0);");
            sql.push(insertignore + " into likesdislikes VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + ",1," + escapeFunction(time) + "," + escapeFunction(txid) + ");");
          }

          if (insertNotifications) {
            sql = sql.concat(getPageNotificationSQL(note, txid, sentFrom, time, escapeFunction, insertignore));
          }
        }

      }

      //case "6dc1": //Designate moderater 	0x6dc1 	address(20), topic
      if (operationCode == "6dc1") {
        var address = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
        address = address.substr(0, MAXADDRESS);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        var topic = "";
        if (messages.length > 1) {
          var decode = fromHex(messages[1]);
          var topic = decode.toLowerCase().trim();
          topic = topic.substr(0, MAXMESSAGE);
        }
        sql.push(insertignore + " into mods VALUES (" + escapeFunction(address) + "," + escapeFunction(sentFrom) + "," + escapeFunction(topic) + ");");

      }

      //case "6dc2": //Dismiss moderater 	0x6dc2 	address(20), topic
      if (operationCode == "6dc2") {
        var address = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
        address = address.substr(0, MAXADDRESS);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        var topic = "";
        if (messages.length > 1) {
          var decode = fromHex(messages[1]);
          var topic = decode.toLowerCase().trim();
          topic = topic.substr(0, MAXMESSAGE);
        }
        sql.push("delete from mods WHERE modr=" + escapeFunction(address) + " AND address=" + escapeFunction(sentFrom) + " AND topic=" + escapeFunction(topic) + ";");

      }

      //case "6dc3": //Hide User 	0x6dc3 	address(20), topic
      if (operationCode == "6dc3") {
        var address = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
        address = address.substr(0, MAXADDRESS);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        var topic = "";
        if (messages.length > 1) {
          var decode = fromHex(messages[1]);
          var topic = decode.toLowerCase().trim();
          topic = topic.substr(0, MAXMESSAGE);
        }
        sql.push(insertignore + " into hiddenusers VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(address) + "," + escapeFunction(topic) + ");");

      }

      //case "6dc4": //Unhide user 	0x6dc4 	address(20), topic
      if (operationCode == "6dc4") {
        var address = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
        address = address.substr(0, MAXADDRESS);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        var topic = "";
        if (messages.length > 1) {
          var decode = fromHex(messages[1]);
          var topic = decode.toLowerCase().trim();
          topic = topic.substr(0, MAXMESSAGE);
        }
        sql.push("delete from hiddenusers WHERE modr=" + escapeFunction(sentFrom) + " AND address=" + escapeFunction(address) + " AND topic=" + escapeFunction(topic) + ";");

      }

      //case "6dc5": //mod hide post, 0x6dc5, txid(32)
      if (operationCode == "6dc5") {
        var retxid;
        retxid = messages[0].match(/[a-fA-F0-9]{2}/g).reverse().join('');
        retxid = retxid.substr(0, MAXTXID);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        sql.push("REPLACE into hiddenposts VALUES (" + escapeFunction(retxid) + "," + escapeFunction(sentFrom) + ");");

      }

      //case "6dc6": //mod unhide post, 0x6dc6, txid(32)
      if (operationCode == "6dc6") {
        var retxid;
        retxid = messages[0].match(/[a-fA-F0-9]{2}/g).reverse().join('');
        retxid = retxid.substr(0, MAXTXID);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        sql.push("delete from hiddenposts WHERE modr=" + escapeFunction(sentFrom) + " AND txid=" + escapeFunction(retxid) + ";");

      }

      //case "6dd0": //private message
      if (operationCode == "6dd0") {
        var messagetext = messages[0];
        messagetext = messagetext.substr(0, MAXHEXMESSAGE);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        var publicKey = getFirstPublicKeyFromTX(tx.ins[0]);

        try {
          var tipto = getAddressFromTXOUT(tx.outs[i + 1]);
          var amount = getAmountFromTXOUT(tx.outs[i + 1]);
          sql.push(insertignore + " into privatemessages VALUES (" + escapeFunction(txid) + "," + escapeFunction('') + "," + escapeFunction(txid) + "," + escapeFunction(sentFrom) + "," + escapeFunction(messagetext) + "," + escapeFunction(tipto) + "," + escapeFunction(amount) + "," + escapeFunction(time) + ");");
        } catch (error) {
          //console.log("No Tip: ");
          //Nothing to do here
        }

        //update public key if it hasn't been already recorded
        sql.push("insert into names VALUES (" + escapeFunction(sentFrom) + ",'','',0,'','',''," + escapeFunction(publicKey) + ",'',0,'',0,0,0,0,0) " + onConflictAddress + " publickey=" + escapeFunction(publicKey) + ";");

        if (insertNotifications) {
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'message'," + escapeFunction(tipto) + "," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
        }

      }

      //case "6dd1": //private message cont
      if (operationCode == "6dd1") {
        var retxid;
        retxid = messages[0].match(/[a-fA-F0-9]{2}/g).reverse().join('');
        retxid = retxid.substr(0, MAXTXID);
        var messagetext = messages[1];
        messagetext = messagetext.substr(0, MAXHEXMESSAGE);
        var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
        sql.push(insertignore + " into privatemessages VALUES (" + escapeFunction(txid) + "," + escapeFunction(retxid) + "," + escapeFunction('') + "," + escapeFunction(sentFrom) + "," + escapeFunction(messagetext) + "," + escapeFunction('') + "," + escapeFunction('') + "," + escapeFunction(time) + ");");

        //Make sure reply has the same roottxid and topic as parent, sometimes this won't be available, there is a housekeeping operation to fill it in later if so
        if (issqlite) {
          sql.push("UPDATE privatemessages SET (roottxid,toaddress,stamp) = (SELECT m.roottxid, m.toaddress, m.stamp FROM privatemessages m WHERE txid=" + escapeFunction(retxid) + ") WHERE privatemessages.txid=" + escapeFunction(txid) + " AND privatemessages.address=" + escapeFunction(sentFrom) + ";");
        } else {
          sql.push("UPDATE privatemessages JOIN privatemessages parent ON privatemessages.retxid=parent.txid SET privatemessages.roottxid = parent.roottxid, privatemessages.toaddress = parent.toaddress, privatemessages.stamp = parent.stamp WHERE privatemessages.address = " + escapeFunction(sentFrom) + " AND privatemessages.txid=" + escapeFunction(txid) + ";");
        }

      }
      return sql;
    }

  }
  return sql;
}




function getPageNotificationSQL(decode, txid, sentFrom, time, escapeFunction, insertignore) {
  //Pages
  //warning - decode is hostile, could contain anything

  //Short circuit if there are no pages
  if (decode.indexOf("@") == -1) {
    return "";
  }

  var sql = [];

  try {
    decode = decode.replace(/\n/g, " ");
    decode = decode.replace(/[.,\/#!$%\^&\*;:{}=\-`~()'"<>\?]/g, " ");
    var pages = decode.split(" ");
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].startsWith("@") && pages[i].length > 1) {
        var pageHandle = pages[i].substring(1, pages[i].length).toLowerCase();
        pageHandle = pageHandle.substr(0, MAXMESSAGE);
        sql.push(insertignore + " INTO notifications SELECT " + escapeFunction(txid) + ",'page', names.address," + escapeFunction(sentFrom) + "," + escapeFunction(time) + " FROM names WHERE names.pagingid  = " + escapeFunction(pageHandle) + ";");
      }
    }
  } catch (err) {
    console.log(err);
  }
  return sql;
}

function getFirstSendingAddressFromTX(txin) {
  var chunksIn = bitcoinJs.script.decompile(txin.script);
  var address = bitcoinJs.ECPair.fromPublicKeyBuffer(chunksIn[1]).getAddress();
  return address;
}

function getFirstPublicKeyFromTX(txin) {
  var chunksIn = bitcoinJs.script.decompile(txin.script);
  var publicKey = bitcoinJs.ECPair.fromPublicKeyBuffer(chunksIn[1]).getPublicKeyBuffer().toString('hex');
  return publicKey;
}

function getAmountFromTXOUT(txout) {
  var amount = txout.value;
  return amount;
}

function getAddressFromTXOUT(txout) {
  var address = bitcoinJs.address.fromOutputScript(txout.script).toString();
  return address;
}

function fromHex(hex) {
  var str = "";
  try {
    str = decodeURIComponent(hex.replace(/(..)/g, '%$1'));
  }
  catch (e) {
    str = hex;
    //console.error('invalid hex input: ' + hex); //Caused by 6d24, 6d10
    return ("");
  }
  return str;
}

function writeImagesToDisk(error, response, body, last4, lsentFrom, profilepicpath, querymemoformissingpics) {
  try {
    console.log(response.statusCode + " " + body.length);
    if (response.statusCode == 302 || body.length < 1000) {
      if (querymemoformissingpics) {
        console.log('https://memo.cash/img/profilepics/' + lsentFrom + '-640x640' + last4);
        request({ url: 'https://memo.cash/img/profilepics/' + lsentFrom + '-640x640' + last4, encoding: null }, function (error, response, body) { writeImagesToDisk(error, response, body, last4, lsentFrom, profilepicpath, false); });
      }
    } else {
      resizeImage(profilepicpath + '/' + lsentFrom + '.640x640.jpg', 640, 640, body);
      resizeImage(profilepicpath + '/' + lsentFrom + '.128x128' + last4, 128, 128, body);
    }
  } catch (err) {
    console.log(err);
  }
}

function resizeImage(imagepath, x, y, body) {

  try {
    sharp(body).resize(x, y).toFile(imagepath, (err, info) => { console.log(err) });
  } catch (err) {
    console.log(err);
  }
}

module.exports = sqlforaction;
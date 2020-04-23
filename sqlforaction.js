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

const MAXADDRESS = 35;
const MAXTXID = 64;
const MAXMESSAGE = 220
const MAXGEOHASH = 16;

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

sqlforaction.getSQLForAction = function (tx, time, issqlite, escapeFunction) {

  var insertignore = "INSERT IGNORE ";
  if (issqlite) { insertignore = "INSERT OR IGNORE "; }
  var txid = tx.getId();

  for (var i = 0; i < tx.outs.length; i++) {

    var hex = tx.outs[i].script.toString('hex');
    var sql = [];

    if (hex.startsWith("6a04534c500001010747454e45534953")) {
      //SLP creation transaction
      var messages = processOPDATA(hex.substring(12), 20);
      var capped = "(UNCAPPED) ";
      if (messages[7] == "") {
        capped = "(CAPPED SUPPLY " + (Number("0x" + messages[8]) * Math.pow(10, Number("0x" + messages[6]) * -1)).toLocaleString() + ") ";
      }
      var slpTokenMessage = fromHex(messages[3]) + " (" + fromHex(messages[2]) + ") created " + capped + fromHex(messages[4]) + " " + fromHex(messages[5]);

      var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);

      //Create post from slp creation
      sql.push(insertignore + " into messages VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(slpTokenMessage) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ",''," + escapeFunction(txid) + ",1,0,0," + escapeFunction('tokens') + "," + escapeFunction(null) + "," + escapeFunction(null) + "," + escapeFunction(null) + ",0,0,0,0);");
      //Assume author likes his own post
      sql.push(insertignore + " into likesdislikes VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + ",1," + escapeFunction(time) + "," + escapeFunction(txid) + ");");
      return sql;

    }

    if (hex.startsWith("6a026d") || hex.startsWith("6a027d") || hex.startsWith("6a028d") || hex.startsWith("6a029d")) {
      var truncatehex = hex.substring(4);
      var operationCode = truncatehex.substring(0, 4);
      //console.log('oc:' +operationCode +'txid:' + txid);
      var messages = processOPDATA(truncatehex.substring(4));

      switch (operationCode) {
        case "6d01": //Set name 	0x6d01 	name(77)
        case "8d01": //Set name 	0x8d01 	name(77)

          var name = fromHex(messages[0]);
          name = name.substr(0, MAXMESSAGE);
          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          var publicKey = getFirstPublicKeyFromTX(tx.ins[0]);
          //members autofollow themselves when they set their name 
          sql.push(insertignore + " into follows VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(sentFrom) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");

          //Strip out special characters from paging ids
          var pagename = name.replace(/\n/g, "");
          pagename = pagename.replace(/ /g, "");
          pagename = pagename.replace(/[.,\/#!$%\^&\*;:{}=\-`~()\?]/g, "");
          pagename = pagename.toLowerCase();

          //After Sept 1st 2019, names cannot be changed.
          if (time < 1567299601) {
            if (issqlite) {
              sql.push("insert into names VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(name) + "," + escapeFunction(txid) + ",'',''," + escapeFunction(pagename) + "," + escapeFunction(publicKey) + ") ON CONFLICT(address) DO UPDATE SET name=" + escapeFunction(name) + ", nametxid=" + escapeFunction(txid) + ", pagingid=" + escapeFunction(pagename) + ", publickey=" + escapeFunction(publicKey) + ";");
            } else {
              sql.push("insert into names VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(name) + "," + escapeFunction(txid) + ",'',''," + escapeFunction(pagename) + "," + escapeFunction(publicKey) + ") ON DUPLICATE KEY UPDATE            name=" + escapeFunction(name) + ", nametxid=" + escapeFunction(txid) + ", pagingid=" + escapeFunction(pagename) + ", publickey=" + escapeFunction(publicKey) + ";");
            }
            return sql;
          } else {
            sql.push(insertignore + " into names VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(name) + "," + escapeFunction(txid) + ",'',''," + escapeFunction(pagename) + "," + escapeFunction(publicKey) + ") ;");
            //If profile is already set, but name is not need to update values because previous statement will have been ignored
            sql.push("UPDATE names set name=" + escapeFunction(name) + ", nametxid=" + escapeFunction(txid) + ", pagingid=" + escapeFunction(pagename) + ", publickey=" + escapeFunction(publicKey) + " WHERE name='' AND address=" + escapeFunction(sentFrom) + ";");
            return sql;
          }
          break;
        case "6d0c": //Post topic message 	0x6d0c 	topic(variable), message(74 - topic length)
        case "6d02": //Post memo 	0x6d02 	message(77)
        case "6d10": //Memo poll
        case "6d24": //Send money
        case "6da8": //Post geotagged message 0x6da8 geohash(variable),message
        case "8d02": //Post memo (blockpress)
        case "8d11": //Blockpress?

          //var message=truncatehex.substring(4);
          var decode = fromHex(messages[0]);
          var topic = "";
          var geohash = "";
          var lat = null;
          var long = null;
          if (messages.length > 1) {
            if (operationCode == "6d0c") {
              topic = decode.toLowerCase();
            } else if (operationCode == "6da8") {
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
            } else {
              decode = fromHex(messages[1]);
            }
          }

          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          decode = decode.substr(0, MAXMESSAGE);
          topic = topic.substr(0, MAXMESSAGE);
          geohash = geohash.substr(0, MAXGEOHASH);

          sql.push(insertignore + " into messages VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(decode) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ",''," + escapeFunction(txid) + ",1,0,0," + escapeFunction(topic) + "," + escapeFunction(lat) + "," + escapeFunction(long) + "," + escapeFunction(geohash) + ",0,0,0,0);");
          //Assume author likes his own post
          sql.push(insertignore + " into likesdislikes VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + ",1," + escapeFunction(time) + "," + escapeFunction(txid) + ");");

          //Add page notifications 
          sql = sql.concat(getPageNotificationSQL(decode, txid, sentFrom, time, escapeFunction, insertignore));
          return sql;
          break;

        case "6d03": //Reply to memo 	0x6d03 	txhash(30), message(45)
        case "8d03": //Blockpress reply
        case "6d13": //Poll option
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

          //Assume author likes his own reply
          var startingLikes = 0;
          if (operationCode != "6d13") { //except for poll options
            startingLikes = 1;
            sql.push(insertignore + " into likesdislikes VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + ",1," + escapeFunction(time) + "," + escapeFunction(txid) + ");");
          }

          sql.push(insertignore + " into messages VALUES(" + escapeFunction(sentFrom) + "," + escapeFunction(decode) + "," + escapeFunction(txid) + "," + escapeFunction(time) + "," + escapeFunction(retxid) + ",''," + startingLikes + ",0,0,'',NULL,NULL,'',0,0,0,0);");

          //Add roottxid - These are probably the slowest update queries         
          if (issqlite) {
            //Make sure reply has the same roottxid and topic as parent, sometimes this won't be available, there is a housekeeping operation to fill it in later if so
            sql.push("UPDATE messages SET (roottxid,topic) = (SELECT m.roottxid, m.topic FROM messages m WHERE txid=" + escapeFunction(retxid) + ") WHERE messages.txid=" + escapeFunction(txid) + ";");

            var selectRootTXID = " (SELECT roottxid FROM messages WHERE txid=" + escapeFunction(retxid) + ") ";

            //keep count of total number of replies, members in a thread, note, if roottxid is not available, these do not get updated properly
            sql.push("UPDATE messages SET repliesroot = (SELECT COUNT(*)-1 FROM messages WHERE roottxid=" + selectRootTXID + "), repliesuniquemembers = (SELECT count(DISTINCT address) FROM messages WHERE roottxid=" + selectRootTXID + ") WHERE roottxid = " + selectRootTXID + ";");

            //increase number of direct replies for parent message, this should be pretty fast
            sql.push("UPDATE messages SET repliesdirect = (SELECT COUNT(*) FROM messages WHERE retxid=" + escapeFunction(retxid) + ")  WHERE messages.txid = " + escapeFunction(retxid) + ";");

          } else {
            //This may be a bit faster for mysql
            sql.push("UPDATE messages JOIN messages parent ON messages.retxid=parent.txid SET messages.roottxid = parent.roottxid, messages.topic = parent.topic WHERE messages.roottxid = '' AND messages.txid=" + escapeFunction(txid) + ";");

            //keep count of total number of replies in a thread
            sql.push("UPDATE messages AS dest,(SELECT roottxid, COUNT(*)-1 as count FROM messages WHERE roottxid=(SELECT roottxid FROM messages WHERE txid=" + escapeFunction(retxid) + ") GROUP BY roottxid) AS src SET dest.repliesroot = src.count WHERE dest.txid = src.roottxid;");

            //keep count of total number of members in a thread
            sql.push("UPDATE messages AS dest,(SELECT roottxid, count(DISTINCT address) as count FROM messages WHERE roottxid=(SELECT roottxid FROM messages WHERE txid=" + escapeFunction(retxid) + ") GROUP BY roottxid) AS src SET dest.repliesuniquemembers = src.count WHERE dest.txid =src.roottxid;");

            //increase number of direct replies for parent message, this should be pretty fast
            sql.push("UPDATE messages AS dest,(SELECT retxid, COUNT(*) as count FROM messages WHERE retxid=" + escapeFunction(retxid) + " GROUP BY retxid) AS src SET dest.repliesdirect = src.count WHERE dest.txid = src.retxid;");

          }

          //Add page notifications - this should happen before reply notification in case a member is both replied to and paged in the same reply 
          sql = sql.concat(getPageNotificationSQL(decode, txid, sentFrom, time, escapeFunction, insertignore));

          //Add to notifications
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'reply',(SELECT address FROM messages WHERE txid = " + escapeFunction(retxid) + ")," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
          return sql;
          break;
        case "6d04": //Like / tip memo 	0x6d04 	txhash(30)
        case "8d04": //Blockpress like
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

          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'like',(SELECT address FROM messages WHERE txid = " + escapeFunction(retxid) + ")," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
          return sql;
          break;
        case "6db4": //dislike 0x6db4 	txhash(30)
          var retxid;
          retxid = messages[0].match(/[a-fA-F0-9]{2}/g).reverse().join('');
          retxid = retxid.substr(0, MAXTXID);

          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);

          sql.push("REPLACE into likesdislikes VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + ",-1," + escapeFunction(time) + "," + escapeFunction(retxid) + ");");
          sql.push("UPDATE messages SET dislikes = (SELECT count(*) FROM likesdislikes WHERE likesdislikes.type=-1 AND likesdislikes.retxid=" + escapeFunction(retxid) + ")  WHERE txid=" + escapeFunction(retxid) + ";");
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'dislike',(SELECT address FROM messages WHERE txid = " + escapeFunction(retxid) + ")," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");
          return sql;
          break;
        case "6d05": //Set profile text 0x6d05 	message(77)
        case "8d05":
          var profiletext = fromHex(messages[0]);
          profiletext = profiletext.substr(0, MAXMESSAGE);
          var publicKey = getFirstPublicKeyFromTX(tx.ins[0]);

          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          if (issqlite) {
            sql.push("insert into names VALUES (" + escapeFunction(sentFrom) + ",'',''," + escapeFunction(profiletext) + "," + escapeFunction(txid) + ",''," + escapeFunction(publicKey) + ") ON CONFLICT(address) DO UPDATE SET profile=" + escapeFunction(profiletext) + ", protxid=" + escapeFunction(txid) + ";");
          } else {
            sql.push("insert into names VALUES (" + escapeFunction(sentFrom) + ",'',''," + escapeFunction(profiletext) + "," + escapeFunction(txid) + ",''," + escapeFunction(publicKey) + ") ON DUPLICATE KEY UPDATE profile=" + escapeFunction(profiletext) + ", protxid=" + escapeFunction(txid) + ";");
          }
          return sql;
          break;
        case "6d06": //Follow user 	0x6d06 	address(35)
        case "8d06":
          var followAddress = "";
          if (operationCode == "8d06") {
            followAddress = fromHex(messages[0]);
          } else {
            followAddress = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
          }
          followAddress = followAddress.substr(0, MAXADDRESS);

          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          sql.push(insertignore + " into follows VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(followAddress) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'follow'," + escapeFunction(followAddress) + "," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");

          //If the user rating was nearly 2 stars, 63, then this rating was as a result of a block, so remove it
          sql.push("DELETE FROM userratings WHERE address=" + escapeFunction(sentFrom) + " AND rates=" + escapeFunction(followAddress) + " AND rating='63';");

          //Set the user rater to nearly 4 stars, 191, unless a rating is already present 
          sql.push(insertignore + " into userratings VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(followAddress) + ",'191'," + escapeFunction("Follows") + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");

          return sql;
          break;
        case "6d07": //Unfollow user 	0x6d07 	address(35)
        case "8d07":
          var followAddress = "";
          if (operationCode == "8d07") {
            followAddress = fromHex(messages[0]);
          } else {
            followAddress = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
          }
          followAddress = followAddress.substr(0, MAXADDRESS);

          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          sql.push("delete from follows WHERE address=" + escapeFunction(sentFrom) + " AND follows=" + escapeFunction(followAddress) + ";");
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'unfollow'," + escapeFunction(followAddress) + "," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");

          //If the user rating was nearly 4 stars, 191, then this rating was as a result of a follow, so remove it
          sql.push("DELETE FROM userratings WHERE address=" + escapeFunction(sentFrom) + " AND rates=" + escapeFunction(followAddress) + " AND rating='191';");
          return sql;
          break;
        case "6d08": //Set image base url 	0x6d08 	url(77)
          break;
        case "6d09": //Attach picture 	0x6d09 	txhash(20), imghash(20), url(34)
          break;
        case "6d0a": //Set profile picture 	0x6d10 	imghash(16), url(61)
          break;
        case "6d0b": //Repost memo 	0x6d11 	txhash(20), message(63)
          break;
        case "6d0d": //Topic follow 	0x6d0d 	topic_name(variable) 	Implemented
          var decode = fromHex(messages[0]);
          var topic = decode.toLowerCase();
          topic = topic.substr(0, MAXMESSAGE);
          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          sql.push(insertignore + " into subs VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(topic) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");
          return sql;
          break;
        case "6d0e": //Topic unfollow 	0x6d0e 	topic_name(variable) 	Implemented
          var decode = fromHex(messages[0]);
          var topic = decode.toLowerCase();
          topic = topic.substr(0, MAXMESSAGE);
          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          sql.push("delete from subs WHERE address=" + escapeFunction(sentFrom) + " AND topic=" + escapeFunction(topic) + ";");
          return sql;
          break;

        case "6d16": //Mute user 	0x6d16 	address(35), message(180)
        case "6da6": //Block user 	0x6da6 	address(35), message(180)
          var blockAddress = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
          blockAddress = blockAddress.substr(0, MAXADDRESS);
          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          var reason = "";
          if (messages.length > 1) {
            reason = fromHex(messages[1]);
          }
          reason = reason.substr(0, MAXMESSAGE);

          sql.push(insertignore + " into blocks VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(blockAddress) + "," + escapeFunction(txid) + "," + escapeFunction(reason) + "," + escapeFunction(time) + ");");
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'mute'," + escapeFunction(blockAddress) + "," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");

          //If the user rating was nearly 4 stars, 191, then this rating was as a result of a follow, so remove it first
          sql.push("DELETE FROM userratings WHERE address=" + escapeFunction(sentFrom) + " AND rates=" + escapeFunction(blockAddress) + " AND rating='191';");

          //Set the user rating to nearly 2 stars, 63, unless a rating is already present
          sql.push(insertignore + " into userratings VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(blockAddress) + ",'63'," + escapeFunction("Mutes") + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");

          return sql;
          break;
        case "6d17": //Unmute user 	0x6d17 	address(35)
        case "6da7": //Unblock user 	0x6da7 	address(35)
          var blockAddress = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
          blockAddress = blockAddress.substr(0, MAXADDRESS);
          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          sql.push("delete from blocks WHERE address=" + escapeFunction(sentFrom) + " AND blocks=" + escapeFunction(blockAddress) + ";");
          sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'unmute'," + escapeFunction(blockAddress) + "," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");

          //If the user rating was nearly 2 stars, 63, then this rating was as a result of a block, so remove it
          sql.push("DELETE FROM userratings WHERE address=" + escapeFunction(sentFrom) + " AND rates=" + escapeFunction(blockAddress) + " AND rating='63';");

          return sql;
          break;

        case "6da5":  //User Rating 	0x6da5 	address(35),byte(2),message(x)
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
          } else if (rating > 0 && rating < 256) {
            //May be possible to use 'ON DUPLICATE KEY UPDATE' if we want to keep note if rating is changed without new note
            sql.push("replace into userratings VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(userAddress) + "," + escapeFunction(rating) + "," + escapeFunction(note) + "," + escapeFunction(txid) + "," + escapeFunction(time) + ");");
            sql.push(insertignore + " into notifications VALUES(" + escapeFunction(txid) + ",'rating'," + escapeFunction(userAddress) + "," + escapeFunction(sentFrom) + "," + escapeFunction(time) + ");");

            let concat = `CONCAT(
              "@",
              (SELECT pagingid FROM names WHERE address = ` + escapeFunction(sentFrom) + `),
              " rated @",
              (SELECT pagingid FROM names WHERE address = ` + escapeFunction(userAddress) + `),
              " as ` + (Math.round(Number(rating) / 64) + 1) + `/5: ",
              `+ escapeFunction(note) + `
            )`;

            if (issqlite) {
              concat = `"@" || (SELECT pagingid FROM names WHERE address = ` + escapeFunction(sentFrom) + `) || " rated @" ||
              (SELECT pagingid FROM names WHERE address = ` + escapeFunction(userAddress) + `) ||
              " as ` + (Math.round(Number(rating) / 64) + 1) + `/5: " ||
              `+ escapeFunction(note);
            }

            sql.push(insertignore + " into messages VALUES (" + escapeFunction(sentFrom) + "," + concat + "," + escapeFunction(txid) + "," + escapeFunction(time) + ",''," + escapeFunction(txid) + ",1,0,0," + escapeFunction('ratings') + "," + escapeFunction(null) + "," + escapeFunction(null) + "," + escapeFunction('') + ",0,0,0,0);");
            sql.push(insertignore + " into likesdislikes VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(txid) + ",1," + escapeFunction(time) + "," + escapeFunction(txid) + ");");

            sql = sql.concat(getPageNotificationSQL(note, txid, sentFrom, time, escapeFunction, insertignore));
          }
          return sql;
          break;
        case "6dc1": //Designate moderater 	0x6dc1 	address(20), topic
          var address = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
          address = address.substr(0, MAXADDRESS);
          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          var topic = "";
          if (messages.length > 1) {
            var decode = fromHex(messages[1]);
            var topic = decode.toLowerCase();
            topic = topic.substr(0, MAXMESSAGE);
          }
          sql.push(insertignore + " into mods VALUES (" + escapeFunction(address) + "," + escapeFunction(sentFrom) + "," + escapeFunction(topic) + ");");
          return sql;
          break;
        case "6dc2": //Dismiss moderater 	0x6dc2 	address(20), topic
          var address = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
          address = address.substr(0, MAXADDRESS);
          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          var topic = "";
          if (messages.length > 1) {
            var decode = fromHex(messages[1]);
            var topic = decode.toLowerCase();
            topic = topic.substr(0, MAXMESSAGE);
          }
          sql.push("delete from mods WHERE modr=" + escapeFunction(address) + " AND address=" + escapeFunction(sentFrom) + " AND topic=" + escapeFunction(topic) + ";");
          return sql;
          break;
        case "6dc3": //Hide User 	0x6dc3 	address(20), topic
          var address = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
          address = address.substr(0, MAXADDRESS);
          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          var topic = "";
          if (messages.length > 1) {
            var decode = fromHex(messages[1]);
            var topic = decode.toLowerCase();
            topic = topic.substr(0, MAXMESSAGE);
          }
          sql.push(insertignore + " into hiddenusers VALUES (" + escapeFunction(sentFrom) + "," + escapeFunction(address) + "," + escapeFunction(topic) + ");");
          return sql;
          break;
        case "6dc4": //Unhide user 	0x6dc4 	address(20), topic
          var address = bs58check.encode(Buffer.from("00" + messages[0], 'hex'));
          address = address.substr(0, MAXADDRESS);
          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          var topic = "";
          if (messages.length > 1) {
            var decode = fromHex(messages[1]);
            var topic = decode.toLowerCase();
            topic = topic.substr(0, MAXMESSAGE);
          }
          sql.push("delete from hiddenusers WHERE modr=" + escapeFunction(sentFrom) + " AND address=" + escapeFunction(address) + " AND topic=" + escapeFunction(topic) + ";");
          return sql;
          break;

        case "6dc5": //mod hide post, 0x6dc5, txid(32)
          var retxid;
          retxid = messages[0].match(/[a-fA-F0-9]{2}/g).reverse().join('');
          retxid = retxid.substr(0, MAXTXID);
          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          sql.push("REPLACE into hiddenposts VALUES (" + escapeFunction(retxid) + "," + escapeFunction(sentFrom) + ");");
          return sql;
          break;
        case "6dc6": //mod unhide post, 0x6dc6, txid(32)
          var retxid;
          retxid = messages[0].match(/[a-fA-F0-9]{2}/g).reverse().join('');
          retxid = retxid.substr(0, MAXTXID);
          var sentFrom = getFirstSendingAddressFromTX(tx.ins[0]);
          sql.push("delete from hiddenposts WHERE modr=" + escapeFunction(sentFrom) + " AND txid=" + escapeFunction(retxid) + ";");
          return sql;
          break;

        default:
          break;
      }
    }
  }

  //write the raw trx to db for future use
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
    decode = decode.replace(/[.,\/#!$%\^&\*;:{}=\-`~()\?]/g, " ");
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

module.exports = sqlforaction;
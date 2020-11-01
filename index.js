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

//const { vapidPrivateKey } = require('../memberprivateconfig.js');

var run = async function () {

  {//App includes
    try {
      var config = require(process.cwd() + '/../memberprivateconfig.js');
    } catch (e) {
      var config = require(process.cwd() + '/config.js');
    }
    var sqlforaction = require('./sqlforaction.js');
    var dbqueries = require('./dbqueries.js');
    var dbhandler = require('./dbhandler.js');
    var richlist = require('./balances.js');
    var RpcClient = require('./rpcclient.js');
  }

  {//External libs
    var fs = require('fs');
    var bitcoinJs = require('bitcoinjs-lib');
  }

  {//Configuration settings
    var secondsToWaitonStart = config.secondsToWaitonStart;
    var secondsToWaitBetweenProcessingBlocks = config.secondsToWaitBetweenProcessingBlocks;
    var secondsToWaitBetweenPollingNextBlock = config.secondsToWaitBetweenPollingNextBlock;
    var secondsToWaitBetweenPollingMemPool = config.secondsToWaitBetweenPollingMemPool;
    var secondsToWaitBetweenErrorOnBlocks = 1; //todo make configurable
    var rpcconfig = config.rpcconfig;
    var dbconfig = config.dbconfig;
    var dbname = dbconfig.database;
    var overrideStartBlock = config.startBlock;
    var bchdhost = config.bchdhost;
    var bchdgrpcenabled = config.bchdgrpcenabled;
    var acceptmaxtrxsize = config.acceptmaxtrxsize;
    var httpserverenabled = config.httpserverenabled;
    var httpsserverenabled = config.httpsserverenabled;
    var httpport = config.httpport;
    var httpsport = config.httpsport;
    var keypem = config.keypem;
    var certpem = config.certpem;
    var usesqlite = config.usesqlite;
    var sqldbfile = config.sqldbfile;
    var AccessControlAllowOrigin = config.AccessControlAllowOrigin;
    var pathtoindex = config.pathtoindex;
    var bchdcertpem = config.bchdcertpem;
    var profilepicpath = config.profilepicpath;
    var querymemoformissingpics = config.querymemoformissingpics;
    var debug = config.debug;
    var allowpragmajournalmode = config.allowpragmajournalmode;
    var batchsqlonsynccount = config.batchsqlonsynccount;
    var rebuildFromDBTransactions = config.rebuildFromDBTransactions;
    var actionTypes = config.actionTypes;
    var rebuildPauseBetweenCalls = config.rebuildPauseBetweenCalls;
    var completeDBrebuild = config.completeDBrebuild;
    var downloadprofilepics = config.downloadprofilepics;
    var reimportTransaction = config.reimportTransaction;
    var keepThreadNotificationsTime = config.keepThreadNotificationsTime;
    var vapidPublicKey = config.vapidPublicKey;
    var vapidPrivateKey = config.vapidPrivateKey;
    var vapidEmail = config.vapidEmail;
    var pushnotificationserver = config.pushnotificationserver;
    var keepNotificationsTime = config.keepNotificationsTime;
    var tokenbalanceserver = config.tokenbalanceserver;
    var tokenbalanceupdateinterval = config.tokenbalanceupdateinterval;
    var useServerWallets = config.useServerWallets;
    var dbHouseKeepingOperationInterval = config.dbHouseKeepingOperationInterval; 
  }

  {//Conditionally included libs

    if (usesqlite) {
      var sqlite = require('sqlite-async');
    }
    else {
      var mysql = require('mysql');
      var util = require('util'); //for promisify
    }

    if (bchdgrpcenabled) {
      var grpc = require('grpc');
      var protoLoader = require('@grpc/proto-loader');
    }

    if (httpserverenabled || httpsserverenabled) {
      var url = require('url');
      var webpush = require('web-push'); //For notifications
      var querystring = require('querystring');

      if (httpserverenabled) {
        var http = require('http');
      }

      if (httpsserverenabled) {
        var https = require('https');
      }

      const vapidKeys = { publicKey: vapidPublicKey, privateKey: vapidPrivateKey };
      webpush.setVapidDetails(vapidEmail, vapidKeys.publicKey, vapidKeys.privateKey);
    }
  }

  //local vars
  {
    //rpc to get blocks, trxs from Bitcoin
    var rpc = new RpcClient(rpcconfig);
    var currentBlock = 0;
    var lastBlockSuccessfullyProcessed = 0;
    var mempoolprocessingstarted = false;
    var memotxidsalreadyprocessed = [];
    //sql
    var dbpoolapp;//database connection pool for essential app functions
    //var blockConnection; //database connection for processing blocks
    //var mempoolConnection; //database connection for processing mempool
    //var logConnection; //database connection for writing long query logs
    //var rlConnection; //database connection for writing rl

    var dbpoolService;//database connection pool for web requests

    var lastblocktimestamp = 0;
    var dbtype = 'sqlite';

    //Housekeeping on DB
    {
      var lastExpensiveSQLHousekeepingOperation = 0;
      var expensiveHousekeepingSQLOperations = [];

      //Different timestamp formats for different databases
      if (usesqlite) {
        var timestampSQL = "strftime('%s', 'now')";
        var escapeFunction = function (s) { s = s + ""; s = s.replace(/'/g, "''"); return "'" + s + "'"; }
        var insertignore = "INSERT OR IGNORE ";
        var onConflictAddress = " ON CONFLICT(address) DO UPDATE SET ";
      } else {
        var timestampSQL = "UNIX_TIMESTAMP()";
        var escapeFunction = mysql.escape;
        var insertignore = "INSERT IGNORE ";
        var onConflictAddress = " ON DUPLICATE KEY UPDATE ";
      }



      expensiveHousekeepingSQLOperations.push(`DELETE from notifications where notifications.time<` + timestampSQL + `-` + config.keepNotificationsTime + `;`);
      expensiveHousekeepingSQLOperations.push(`DELETE from notifications where notifications.time<` + timestampSQL + `-` + config.keepThreadNotificationsTime + ` and notifications.type='thread';`);

      //easier to add all notifications and just delete self notifications later
      expensiveHousekeepingSQLOperations.push(`DELETE from notifications where origin=address;`);

      //It's bad to have too many null roottxids - slows down fixorphan queries
      //Give it 24 hours to find root tx
      //After 48 hours make orphans their own root trxs.
      expensiveHousekeepingSQLOperations.push(`UPDATE messages SET roottxid=txid WHERE roottxid IS NULL AND retxid ='' AND ` + timestampSQL + `-firstseen > 60*60*24;`, `UPDATE messages SET roottxid=txid WHERE roottxid IS NULL AND ` + timestampSQL + `-firstseen > 60*60*48;`);


      //Recreate topics table  - null topic was returning null timestamp, so added a clause to address this
      //Need the null topic to return to allow moderator functions on sitewide bases
      expensiveHousekeepingSQLOperations.push(`DROP TABLE IF EXISTS topics;`);
      if (usesqlite) {
        expensiveHousekeepingSQLOperations.push(`CREATE TABLE topics (topic VARCHAR(220), messagescount int(9), mostrecent int(11), subscount mediumint(9));`);
        expensiveHousekeepingSQLOperations.push(`INSERT into topics SELECT * FROM (SELECT IFNULL(messages.topic,''), COUNT(*) as messagescount, IFNULL(recent.latest,` + timestampSQL + `) as mostrecent, IFNULL(subs.subscount,0) FROM messages LEFT JOIN (SELECT messages.topic, MAX(firstseen) as latest FROM messages GROUP BY messages.topic) recent on messages.topic = recent.topic LEFT JOIN (SELECT count(*) as subscount, subs.topic FROM subs GROUP BY subs.topic) subs on subs.topic=messages.topic GROUP BY subs.topic)  as fulltable WHERE messagescount>3 AND mostrecent>` + timestampSQL + `-30*24*60*60;`);
      } else {
        expensiveHousekeepingSQLOperations.push(`CREATE TABLE topics (topic VARCHAR(220) CHARACTER SET utf8mb4, messagescount int(9), mostrecent int(11), subscount mediumint(9)) SELECT * FROM (SELECT messages.topic, COUNT(*) as messagescount, IFNULL(recent.latest,` + timestampSQL + `) as mostrecent, IFNULL(subs.subscount,0) as subscount FROM messages LEFT JOIN (SELECT topic, MAX(firstseen) as latest FROM messages GROUP BY topic) recent on messages.topic = recent.topic LEFT JOIN (SELECT count(*) as subscount, topic FROM subs GROUP BY topic) subs on subs.topic=messages.topic GROUP BY topic)  as fulltable WHERE messagescount>3 AND mostrecent>` + timestampSQL + `-30*24*60*60;`);
      }

      //This is a lighter housekeeping operation, can run frequently, ensure messages are linked back to their root disscussion topic
      var fixOrphanMessages = "UPDATE messages JOIN messages parent ON messages.retxid=parent.txid SET messages.roottxid = parent.roottxid, messages.topic = parent.topic WHERE messages.roottxid = '';";
      var fixOrphanMessages2 = "UPDATE privatemessages JOIN privatemessages parent ON privatemessages.retxid=parent.txid SET privatemessages.roottxid = parent.roottxid, privatemessages.toaddress = parent.toaddress, privatemessages.stamp = parent.stamp WHERE privatemessages.roottxid = '' AND privatemessages.address=parent.address;";

      if (usesqlite) {
        fixOrphanMessages = "UPDATE messages SET (roottxid,topic) = (SELECT p.roottxid, p.topic FROM messages p WHERE messages.retxid=p.txid) WHERE messages.roottxid IS NULL;";
        fixOrphanMessages2 = "UPDATE privatemessages SET (roottxid,toaddress,stamp) = (SELECT m.roottxid, m.toaddress, m.stamp FROM privatemessages m WHERE privatemessages.retxid=m.txid AND privatemessages.address=m.address) WHERE privatemessages.roottxid IS NULL;";
      }
    }

    //For mempool processing
    //Keeps a list of mempool transactions that have already been processed
    var mempooltxidsAlreadyProcessed = [];
    //Global store of mempool trxs to write
    var mempoolSQL = [];
    //Global store of txs in the mempoolSQL
    var mempoolTXsBeingWritten = [];

    //Global store of txs from blocks to be written
    var globalsql = [];

    //keeping track of time spent writing block transactions
    var sqlTime;

    //keeping track of time spent writing mempool transactions
    var memSqlTime;
  }

  //Expect service to be started on startup, give the database/rpc some time to come up
  console.log("Sleeping for " + secondsToWaitonStart + " seconds to give mysql/rpc time to come up.");
  await sleep(secondsToWaitonStart * 1000);



  if (usesqlite) {
    dbtype = 'sqlite';
    dbconfig = { sqldbfile: sqldbfile, schemafile: 'memberEmpty.db' }
  } else {
    dbtype = 'mysql';
    dbconfig.connectionLimit = 10; // put this in the config when all other direct connections are removed
    dbconfig.charset = "utf8mb4";
  }

  dbpoolapp = await dbhandler.createPool(dbtype, dbconfig);
  var result = await dbpoolapp.runQuery("select 1=1;");
  //blockConnection = await dbhandler.getConnection(dbtype, dbpoolapp);
  //mempoolConnection = await dbhandler.getConnection(dbtype, dbpoolapp);
  //logConnection = await dbhandler.getConnection(dbtype, dbpoolapp);
  //rlConnection = await dbhandler.getConnection(dbtype, dbpoolapp);

  dbpoolService = await dbhandler.createPool(dbtype, dbconfig);

  sqliteStartProcessing();

  //Processing Blocks Into DB

  //SQLite specific

  async function sqliteStartProcessing() {

    if (usesqlite) {
      //dbbc = await sqlite.open(sqldbfile);

      //FULL
      //This mode blocks (invokes the busy-handler callback) until there is no database writer 
      //and all readers are reading from the most recent database snapshot. It then checkpoints 
      //all frames in the log file and syncs the database file. FULL blocks concurrent writers 
      //while it is running, but readers can proceed. 
      //RESTART
      //This mode works the same way as FULL with the addition that after checkpointing the log 
      //file it blocks (calls the busy-handler callback) until all readers are finished with the 
      //log file. This ensures that the next client to write to the database file restarts the log 
      //file from the beginning. RESTART blocks concurrent writers while it is running, but allowed 
      //readers to proceed. 
      //TRUNCATE
      //This mode works the same way as RESTART with the addition that the WAL file is truncated to 
      //zero bytes upon successful completion.
      await dbpoolapp.runQuery("PRAGMA wal_checkpoint(TRUNCATE)");

      //Defines the number of pages from the database file for storing in RAM, i.e., the cache size.
      //Increasing this parameter may increase performance of the database on high load, since the 
      //greater its value is, the more modifications a session can perform before retrieving 
      //exclusive lock.
      //await dbbc.run("PRAGMA cache_size=100000");
      await dbpoolapp.runQuery("PRAGMA cache_size=100000");


      //EXCLUSIVE — the database file is used in exclusive mode. The number of system calls 
      //to implement file operations decreases in this case, which may increase database performance.
      //Use only for initial sync
      //await dbbc.run("PRAGMA LOCKING_MODE = EXCLUSIVE");
      await dbpoolapp.runQuery("PRAGMA LOCKING_MODE = EXCLUSIVE");

      //0 | OFF — database synchronization is not used. I.e., SQLite takes no breaks when 
      //transmitting data to the operating system. Such mode can substantially increase 
      //performance. The database will meet the integrity conditions after the SQLite crash,
      // however, data will be corrupted in case of system crash or power off.
      //Use only for initial sync
      //await dbbc.run("PRAGMA synchronous = OFF");
      await dbpoolapp.runQuery("PRAGMA synchronous = OFF");

      if (completeDBrebuild && allowpragmajournalmode) {
        //await dbbc.run("PRAGMA JOURNAL_MODE = MEMORY");
        await dbpoolapp.runQuery("PRAGMA JOURNAL_MODE = MEMORY");
      }
    }


    if (completeDBrebuild) {
      await rebuildActionTypes([], rebuildPauseBetweenCalls, true, true);
    } else if (rebuildFromDBTransactions) {
      await rebuildActionTypes(actionTypes, rebuildPauseBetweenCalls, false, false, reimportTransaction);
    }

    //Block with first memo transaction
    currentBlock = 525471;

    //var result = await dbbc.get("SELECT * FROM status WHERE name='lastblockprocessed';");
    var result = await dbpoolapp.runQuery("SELECT * FROM status WHERE name='lastblockprocessed';");

    try {
      currentBlock = result[0].value;
    } catch (e) {
      //start from beginning
    }

    if (overrideStartBlock) {
      currentBlock = overrideStartBlock;
    }

    if (currentBlock < 600000 && allowpragmajournalmode) {
      //MEMORY — the rollback journal is kept in RAM and doesn’t use the disk subsystem. 
      //Such mode provides more significant performance increase when working with log. 
      //However, in case of any failures within a transaction, data in the DB will be 
      //corrupted with high probability due to a lack of saved data copy on the disk.
      //Use only if there are a lot more blocks to process
      //await dbbc.run("PRAGMA JOURNAL_MODE = MEMORY");
      await dbpoolapp.runQuery("PRAGMA JOURNAL_MODE = MEMORY");



    }

    lastBlockSuccessfullyProcessed = currentBlock - 1;
    fetchAndProcessBlocksIntoDB();
  }

  async function runSafeDBPolicy() {
    if (usesqlite) {
      await dbpoolapp.runQuery("PRAGMA LOCKING_MODE = NORMAL");
      await dbpoolapp.runQuery("PRAGMA synchronous = FULL");
      //await dbpoolapp.runQuery("PRAGMA JOURNAL_MODE = DELETE");
      
      //The default method by which SQLite implements atomic commit and rollback is a rollback journal.
      //Beginning with version 3.7.0 (2010-07-21), a new "Write-Ahead Log" option (hereafter referred to as "WAL") is available.
      //There are advantages and disadvantages to using WAL instead of a rollback journal. Advantages include:
      //WAL is significantly faster in most scenarios.
      //WAL provides more concurrency as readers do not block writers and a writer does not block readers. Reading and writing can proceed concurrently.
      //Disk I/O operations tends to be more sequential using WAL.
      //WAL uses many fewer fsync() operations and is thus less vulnerable to problems on systems where the fsync() system call is broken. 
      await dbpoolapp.runQuery("PRAGMA journal_mode=WAL");
    }
  }

  async function rebuildActionTypes(actionTypes, sleepTime, complete, emptyDBFirst, reimportTransaction) {

    if (completeDBrebuild) {
      downloadprofilepics = false;
    }
    //if(!usesqlite){
    //  console.log("Rebuild actions from db only works with sqlite for now.");
    //  return;
    //}

    var whereClause = " WHERE 1=0 "
    for (var i = 0; i < actionTypes.length; i++) {
      whereClause += " OR action='6a02" + actionTypes[i] + "' ";
    }

    if (complete) {
      whereClause = " ";
    }

    if (reimportTransaction) {
      whereClause = " WHERE txid='" + reimportTransaction + "'";
    }

    var fullquery = "SELECT * FROM transactions " + whereClause + " order by time asc;";

    var result;
    var conn;
    var query;
    if (!usesqlite) {
      conn = mysql.createConnection(dbconfig);
      query = util.promisify(conn.query).bind(conn);
    }

    if (emptyDBFirst) {
      var deletedb = [];
      deletedb.push("delete from blocks;");
      deletedb.push("delete from follows;");
      deletedb.push("delete from hiddenposts;");
      deletedb.push("delete from hiddenusers;");
      deletedb.push("delete from likesdislikes;");
      deletedb.push("delete from messages;");
      deletedb.push("delete from mods;");
      deletedb.push("delete from names;");
      deletedb.push("delete from notifications;");
      deletedb.push("delete from privatemessages;");
      deletedb.push("delete from subs;");
      deletedb.push("delete from tips;");
      deletedb.push("delete from topics;");
      deletedb.push("delete from userratings;");
      //deletedb.push("delete from zsqlqueries;");
      await putMultipleSQLStatementsInSQL(deletedb, dbpoolapp, query);
    }

    console.log(" Transactions: " + whereClause);

    await dbpoolapp.runQuery(fullquery);
    /*if (usesqlite) {
      result = await dbbc.all(fullquery);
    } else {
      result = await query(fullquery);
    }*/

    console.log("Reimporting " + result.length + " Transactions");
    var startTime = new Date().getTime();
    var perThousandTime = new Date().getTime();
    var opTimes = [];
    var opCount = [];

    for (var i = 0; i < result.length; i++) {
      try {
        //const request = require("request");
        //var txiddata=await requestPromise("https://rest.bitcoin.com/v2/rawtransactions/getrawtransaction/"+result[i].txid);
        //var tx = bitcoinJs.Transaction.fromHex(txiddata.body.replace('"',''));
        var tx = bitcoinJs.Transaction.fromHex(result[i].rawtx.replace(/"/g, ''));


        var opStartTime = new Date().getTime();
        var sql = getSQLForTRX(tx, result[i].time, result[i].blockno);
        var oc = sqlforaction.lastoc;
        await putMultipleSQLStatementsInSQL(sql, dbpoolapp, query);
        var opEndTime = new Date().getTime();
        var opTime = opEndTime - opStartTime;
        if (!opTimes[oc]) {
          opTimes[oc] = 0;
          opCount[oc] = 0;
        }

        opTimes[oc] += opTime;
        opCount[oc]++;


        await sleep(sleepTime);
        //
        if (i % 1000 == 0) {
          var perThousandEndTime = new Date().getTime();
          console.log(i + " :Time per thousand: " + (perThousandEndTime - perThousandTime));

          await putMultipleSQLStatementsInSQL([fixOrphanMessages], dbpoolapp, query);
          await putMultipleSQLStatementsInSQL([fixOrphanMessages2], dbpoolapp, query);
          perThousandTime = new Date().getTime();

          //for(var j=0;j<opCount.length;j++){
          for (var op in opCount) {
            console.log("op:" + op + ":" + opTimes[op] / opCount[op] + ":" + opTimes[op] + ":" + opCount[op]);
          }

        }
      } catch (err) {
        console.log(err);
        await sleep(1000);
        i--;
      }
    }
    var endTime = new Date().getTime();
    console.log("Total time: " + (endTime - startTime) / 1000);
    console.log("Time per transaction: " + (endTime - startTime) / result.length);

    if (!usesqlite) {
      conn.end();
    }
  }

  async function putMultipleSQLStatementsInSQL(mempoolSQL, dbfconn, query) {
    //This processes statements one by one.
    //TODO
    //For mysql, maybe better to concat statements, for sqlite maybe better to use transactions
    //var sqlToRun = [];
    for (var i = 0; i < mempoolSQL.length; i++) {
      if (mempoolSQL[i] == "") continue;
      try {
        var newTime = new Date().getTime();
        await dbpoolapp.runQuery(mempoolSQL[i]);
        var duration = new Date().getTime() - newTime;
        if (duration > 100) {
          var logquery = "insert into zsqlqueries values (" + escapeFunction(mempoolSQL[i]) + "," + duration + ");"
          await dbpoolapp.runQuery(logquery);
          console.log(mempoolSQL[i]);
          console.log("Query Time (ms):" + duration);
        }
        //sqlToRun.push(dbbc.run(sql[i]));
      } catch (e) {
        console.error(e);
        console.error(mempoolSQL[i]);
        //Skip unrecognized token errors
        if (e.message.indexOf("unrecognized token") == -1) {
          throw (e);
        }
      }
    }
    /*
    //Transactions
    await dbbc.transaction(dbbc => {
      Promise.all(sqlToRun);          
    });*/
  }


  //MYSQL specific
  /*
    async function getLastBlockProcessedMYSQL() {
      dbbc = mysql.createConnection(dbconfig);
  
      if (completeDBrebuild) {
        await rebuildActionTypes([], rebuildPauseBetweenCalls, true, true);
      } else if (rebuildFromDBTransactions) {
        await rebuildActionTypes(actionTypes, rebuildPauseBetweenCalls, false, false);
      }
  
      dbbc.connect(function (err) {
        if (err) {
          console.log(err);
          console.log("Waiting 10 Seconds");
          return setTimeout(getLastBlockProcessedMYSQL, secondsToWaitBetweenPollingNextBlock * 1000);
        }
        var sql = "USE " + dbname + ";SELECT * FROM status WHERE name='lastblockprocessed';";
        dbbc.query(sql, startProcessing);
      }
      );
  
    }
  
    function startProcessing(err, result) {
  
      if (err) {
        try {
          dbbc.end();
        } catch (e) { }
        console.log(err);
        console.log("Waiting 10 Seconds");
        return setTimeout(getLastBlockProcessedMYSQL, secondsToWaitBetweenPollingNextBlock * 1000);
        return;
      }
  
      try {
        dbbc.end();
        console.log('Read last block processed from DB as:' + result[1][0].value);
        currentBlock = parseInt(result[1][0].value) + 1;
  
      } catch (error) {
        if (currentBlock < 525471) currentBlock = 525471;
      }
  
      if (overrideStartBlock) {
        currentBlock = overrideStartBlock;
      }
  
      lastBlockSuccessfullyProcessed = currentBlock - 1;
  
      fetchAndProcessBlocksIntoDB();
    }
  */
  //General SQL

  function fetchAndProcessBlocksIntoDB() {
    rpc.getBlockHash(currentBlock, processBlockHashIntoDB);
  }

  function processBlockHashIntoDB(err, ret) {
    if (err) {
      //-8 code from BU, -1 code from BCHD  
      if (err.code != -8 && err.code != -1) {
        console.log(err);
        console.log("Wait " + secondsToWaitBetweenPollingNextBlock + " seconds");
      }
      //We've exhausted current blocks. Start processing into the mempool at this point.
      if ((err.code == -8 || err.code == -1) && mempoolprocessingstarted == false && currentBlock > 613419) {
        //-8 code from BU, -1 code from BCHD
        mempoolprocessingstarted = true;

        //wait 10 seconds so as not to conflict with putting last blocks in db
        console.log("Received " + err.code + " error (" + err.message + "), we're up to date - start processing mempool in 10 seconds");
        setTimeout(putMempoolIntoDB, 10000);

        //Process previous block again immediately to clear all built up trxs into db
        currentBlock--;

        //Switch off fast but risky db PRAGMA calls
        if (usesqlite) {
          runSafeDBPolicy();
        }
        return fetchAndProcessBlocksIntoDB();
      }
      return setTimeout(fetchAndProcessBlocksIntoDB, secondsToWaitBetweenPollingNextBlock * 1000);
    }
    console.log("Processing Block Into SQL:" + currentBlock);
    //console.log("block hash:" + ret.result);
    rpc.getBlock(ret.result, false, function (err, ret) { processBlockIntoDB(err, ret, currentBlock) });
  }

  function processBlockIntoDB(err, ret, blocknumber) {
    if (err) {
      console.log(err);
      if (err.code == -1) {//Pruned block?
        currentBlock++;
      }
      console.log("Wait " + secondsToWaitBetweenProcessingBlocks + " seconds");
      return setTimeout(fetchAndProcessBlocksIntoDB, secondsToWaitBetweenErrorOnBlocks * 1000);
    }
    takeBlockHexTransactionsAndPutThemInTheDB(ret.result, blocknumber);
  }

  function takeBlockHexTransactionsAndPutThemInTheDB(hex, blocknumber) {
    var block = bitcoinJs.Block.fromHex(hex);
    //console.log(block.getId() + "\n");
    var transactions = block.transactions;
    lastblocktimestamp = block.timestamp;
    for (var i = 1; i < transactions.length; i++) {
      try {
        var dbresults = getSQLForTRX(transactions[i], block.timestamp, blocknumber);
        globalsql = globalsql.concat(dbresults);
      } catch (error) {
        //Skip if any problem
        console.error(error);
        console.log("error: " + error);
      }
    }
    writeToSQL(globalsql);
  }

  function getSQLForTRX(tx, time, blocknumber) {
    try {
      if (tx === undefined) {
        return [];
      }

      //This assumes maximum of 1 memo action per trx
      var txid = tx.getId();

      var sql = [];

      //write the raw trx to db for future use if the tx exists in a block
      if (blocknumber > 0) {
        for (var i = 0; i < tx.outs.length; i++) {
          var hex = tx.outs[i].script.toString('hex');
          if (hex.startsWith("6a02") || hex.startsWith("6a04534c500001010747454e45534953")) {
            var txhex = tx.toHex();
            if (txhex.length > 0 && txhex.length < 51200) {
              if (!hex.substr(0, 8).startsWith("6a026d3")) { //Ignore token actions
                sql.push(insertignore + " into transactions VALUES (" + escapeFunction(txid) + "," + escapeFunction(hex.substr(0, 8)) + "," + escapeFunction(txhex) + "," + escapeFunction(time) + "," + escapeFunction(blocknumber) + ");");
              }
            }
          }
        }
      }

      //Don't examine all transactions again that have already been examined for memo trxs
      if (mempooltxidsAlreadyProcessed.indexOf(txid) !== -1) {
        //console.log("Skipping - this tx already processed from the mempool.");
        return sql;
      }

      //Don't process memo transactions that have already been processed
      if (memotxidsalreadyprocessed.indexOf(txid) !== -1) {
        console.log("Skipping - this tx already processed:" + txid);
        return sql;
      }

      return sql.concat(sqlforaction.getSQLForAction(tx, time, usesqlite, escapeFunction, blocknumber, profilepicpath, insertignore, querymemoformissingpics, debug, downloadprofilepics, keepThreadNotificationsTime, keepNotificationsTime, onConflictAddress));
    } catch (e2) {
      console.log(e2);
      return [];
    }
  }

  function getHouseKeepingOperation() {
    //These are expensive, so max of once per day
    var currentTime = new Date().getTime();
    if (currentTime - lastExpensiveSQLHousekeepingOperation > dbHouseKeepingOperationInterval) {
      console.log("Adding SQL Housekeeping operation");
      lastExpensiveSQLHousekeepingOperation = currentTime;
      //return expensiveHousekeepingSQLOperations[Math.floor(Math.random() * expensiveHousekeepingSQLOperations.length)];
      return expensiveHousekeepingSQLOperations;
    }
    //return expensiveHousekeepingSQLOperations;
    return [];
  }

  async function writeToSQL(sql) {

    console.log("SQL processing queue:" + sql.length);
    //console.log("Processed:" + memotxidsalreadyprocessed.length);
    //console.log("Processed:" + mempooltxidsAlreadyProcessed.length);
    if (sql.length < batchsqlonsynccount && !mempoolprocessingstarted) {
      //on initial sync, we'll batch sql
      //console.log("Not enough transactions to process");
      currentBlock++;
      return setTimeout(fetchAndProcessBlocksIntoDB, secondsToWaitBetweenProcessingBlocks * 1000);
    }

    //Keep track of the last block processed
    sql.push("REPLACE INTO `status` (`name`, `value`) VALUES ('lastblockprocessed', '" + currentBlock + "');");

    if (mempoolprocessingstarted) {
      //Don't want to perform housekeeping if still doing initial sync
      sql = sql.concat(getHouseKeepingOperation());
      if(sqlite){
        //Try to sync wal log with database if sqlite
        sql.push("PRAGMA wal_checkpoint(RESTART)");
      }
    }

    //if (usesqlite) {
    try {
      sqlTime = new Date().getTime();
      await putMultipleSQLStatementsInSQL(sql, dbpoolapp);
    }
    catch (e) {
      return afterBlockProcessing(e, null);
    }
    return afterBlockProcessing(null, null);


    /*} else {
  
      sql = sql.join(" ");
      sql = "SET NAMES 'utf8mb4'; USE " + dbname + ";" + sql;
  
      //This creates a connection each time. Might be better to reuse connection, especially on initial sync
      dbbc = mysql.createConnection(dbconfig);
      dbbc.connect(function (err) { if (err) console.log("dberror 1;" + err); });
      sqlTime = new Date().getTime();
      dbbc.query(sql, afterBlockProcessing);
    }*/
  }

  function afterBlockProcessing(err, result) {

    if (err) {
      console.log("dberror 2;" + err);
      console.log("Wait 60 Seconds");
      currentBlock = lastBlockSuccessfullyProcessed + 1;
      return setTimeout(fetchAndProcessBlocksIntoDB, 60000);
    } else {
      console.log("Fetched And Processed Upto Block " + currentBlock);
      console.log("SQL time:" + (new Date().getTime() - sqlTime));
      globalsql = [];
      lastBlockSuccessfullyProcessed = currentBlock;
      currentBlock++;
      //console.log("Processed:" + memotxidsalreadyprocessed.length);
      //These transactions have been included in a block, therefore shouldn't appear in the mempool again
      memotxidsalreadyprocessed = [];
      console.log("Wait " + secondsToWaitBetweenProcessingBlocks + " Seconds");
      return setTimeout(fetchAndProcessBlocksIntoDB, secondsToWaitBetweenProcessingBlocks * 1000);
    }
  }

  //Processing Mempool Into DB

  function putMempoolIntoDB() {
    //console.log(new Date() + ":Start putMempoolIntoDB:");
    try {
      rpc.getRawMemPool(processAllRawTransactions);
    } catch (err) {
      console.log(err);
    }
  }

  function processAllRawTransactions(err, ret) {
    if (err) {
      console.log(err);
      console.log("processAllRawTransactions error - starting to process mempool in 10");
      return setTimeout(putMempoolIntoDB, 10000);
    }

    function batchCall() {
      ret.result.forEach(getRawTransactionIfNotProcessedBefore);
    }

    rpc.batch(batchCall, function (err, rawtxs) { processMempoolTX(err, rawtxs, ret); });

  }

  function getRawTransactionIfNotProcessedBefore(txid) {
    if (mempooltxidsAlreadyProcessed.indexOf(txid) === -1) {
      rpc.getRawTransaction(txid);
    } else {
      //console.log("Already processed - Skipping mempool trx:"+txid);
    }
  }

  function processMempoolTX(err, rawtxs, ret) {
    if (err) {
      console.log(err);
      return setTimeout(putMempoolIntoDB, secondsToWaitBetweenPollingMemPool * 1000);
    }

    rawtxs.map(putSingleTransactionIntoSQLglobalvarsResult);
    writeMempoolSQLtoDBs(ret.result);
  }

  function putSingleTransactionIntoSQLglobalvarsResult(rawtx) {
    putSingleTransactionIntoSQLglobalvars(rawtx.result)
  }

  function putSingleTransactionIntoSQLglobalvars(rawtx) {
    var timeStampInMs = Math.floor(Date.now() / 1000);
    try {
      var transaction = bitcoinJs.Transaction.fromHex(rawtx);
    } catch (e) {
      console.log(e);
      console.log(rawtx);
      return;
    }
    var inserts = getSQLForTRX(transaction, timeStampInMs);
    mempoolSQL = mempoolSQL.concat(inserts);
    if (inserts.length > 0) {
      mempoolTXsBeingWritten.push(transaction.getId());
      console.log("Will process:" + transaction.getId());
    }
  }

  async function writeMempoolSQLtoDBs(trxidsbeingprocessed) {

    if (mempoolSQL.length < 1) {
      setTimeout(putMempoolIntoDB, secondsToWaitBetweenPollingMemPool * 1000);
      return;
    }

    memSqlTime = new Date().getTime();

    //FixOrphans probably doesn't need to be run so frequently and should probably be on its own thread
    mempoolSQL.push(fixOrphanMessages);
    mempoolSQL.push(fixOrphanMessages2);


    //if (usesqlite) {
    try {
      await putMultipleSQLStatementsInSQL(mempoolSQL, dbpoolapp);
    }
    catch (e) {
      return finishMempoolProcessing(e, null, trxidsbeingprocessed);
    }
    return finishMempoolProcessing(null, null, trxidsbeingprocessed);

    /*} else {
      dbmem = mysql.createConnection(dbconfig);
      dbmem.connect(function (err) { if (err) console.log("mempool dberror 3;" + err); });
      var mempoolFinalSQL = "SET NAMES 'utf8mb4'; USE " + dbname + ";" + mempoolSQL.join(" ");
      dbmem.query(mempoolFinalSQL, function (err, result) { finishMempoolProcessing(err, result, trxidsbeingprocessed); });
      //writeToNEO4J(mempoolCYPHER);
    }*/
  }

  var finishMempoolProcessing = function (err, result, trxidsbeingprocessed) {

    if (err) {
      console.log("mempool dberror 4;" + err);
    }
    else {
      mempooltxidsAlreadyProcessed = trxidsbeingprocessed;
      console.log("Mempool Processing time (ms):" + (new Date().getTime() - memSqlTime));
      mempoolSQL = [];
      memotxidsalreadyprocessed = memotxidsalreadyprocessed.concat(mempoolTXsBeingWritten);
      mempoolTXsBeingWritten = [];
    }
    setTimeout(putMempoolIntoDB, secondsToWaitBetweenPollingMemPool * 1000);
  }

  //HTTP server to handle providing utxos and putting trxs in the mempool
  if (httpserverenabled || httpsserverenabled) {

    var indexfile = "";
    var indexparts = [];
    try {
      indexfile = fs.readFileSync(pathtoindex).toString('utf-8');
      indexparts = indexfile.split("<!--INSERTMETADATA-->").join('<!--INSERTCONTENT-->').split("<!--INSERTCONTENT-->");
      //override header to remove title/description
      indexparts[0] = `<!doctype html>
      <html lang="en">
      <head>
          <meta charset="utf-8">
          <meta http-equiv="x-ua-compatible" content="ie=edge">
          `;

    } catch (err) {
      console.log("Failed to load index.html file " + err);
    }

    try {

      //webServer.use(bodyParser.json());

      if (httpserverenabled) {
        console.log("Try starting httpserver ");
        // Create an instance of the http server to handle HTTP requests
        var app = http.createServer(webServer).listen(httpport);
        console.log('HTTP server running on port ' + httpport);
      }

      if (httpsserverenabled) {
        console.log("Try starting httpsserver ");
        const options = {
          key: fs.readFileSync(keypem),
          cert: fs.readFileSync(certpem)
        };

        // Create an instance of the https server to handle HTTPS requests
        var app = https.createServer(options, webServer).listen(httpsport);
        console.log('HTTPS server running on port ' + httpsport);
      }
    } catch (err) {
      console.log(err);
    }

    async function webServer(req, res) {
      console.log("webserver request received:"+req.url);

      try {
        if (req.url.startsWith("/v2/address/utxo/bitcoincash:")) {
          res.writeHead(200, { "Access-Control-Allow-Origin": AccessControlAllowOrigin, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          let address = sanitizeAlphanumeric(req.url.substr(29));
          if (address.length > 120) {
            res.end(`{"error":"Address Too Long"}`);
            return;
          }
          if (useServerWallets) {
            console.log(req.url);
            rpc.listUnspent(0, 9999999, [address], function (err, ret) {
              if (ret.result.length == 0) {
                //todo: forward the request
              }
              console.log(ret.result.length);
              returnUTXOs(err, ret, res);
              return;
            });
            return;
          } else if (bchdgrpcenabled) {
            client.getAddressUnspentOutputs({ address: address, includemempool: true }, {}, function (err, response) { returnUTXOs(err, response, res); });
            return;
          } else {
            //rpc.listUnspent({ address }, function (err, ret) { returnUTXOs(err, ret, res); });
            res.end(`{"error":"BCHD GRPC - Not Supported"}`);
            return;
          }
        } else if (req.url.startsWith("/v2/reg/")) {
          res.writeHead(200, { "Access-Control-Allow-Origin": AccessControlAllowOrigin, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          if (useServerWallets) {
            let key = sanitizeAlphanumeric(req.url.split('?')[0].substr(8));
            if (key.length > 120) {
              res.end(`{"error":"Address Too Long"}`);
              return;
            }
            rpc.importPubKey(key, key, false, function (err, ret) {
              res.end("OK");
              return;
            });
          } else {
            res.end(`{"error":"Not Supported"}`);
          }
          return;
        } else if (req.url.startsWith("/v2/rawtransactions/sendRawTransaction/")) {
          res.writeHead(200, { "Access-Control-Allow-Origin": AccessControlAllowOrigin, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          console.log("webserver transaction received");
          let transaction = sanitizeAlphanumeric(req.url.substr(39));
          if (transaction.length > acceptmaxtrxsize) { //Max 5K transaction
            res.end(`{"error":"Transaction too big for this server. Try making some smaller transactions to group your utxos."}`);
            return;
          }
          console.log("sending transaction to rpc:" + transaction);
          rpc.sendRawTransaction(transaction, function (err, ret) { sendTransaction(err, ret, res, transaction); });
          return;
        } else if (req.url.startsWith("/v2/member.js?action=")) {
          try {

            //Run query
            var msc = Date.now() / 1000;
            var timestampToUse = timestampSQL;
            //If still processing blocks, use timestamp of last block as 'now' for queries
            if (!mempoolprocessingstarted) { timestampToUse = lastblocktimestamp; }
            var query = dbqueries.getQuery(req, url, usesqlite, escapeFunction, timestampToUse);

            return runQuery(returnQuery, res, msc, query);

          } catch (err) {
            console.log(err);
          }

        } else if (req.url.startsWith("/pn/sub?")) {
          try {
            //console.log(req.url);
            res.writeHead(200, { "Access-Control-Allow-Origin": AccessControlAllowOrigin, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

            var qs = querystring.parse(req.url.substr(8));
            var address = sanitizeAlphanumeric(qs.address);
            if (address.length < 30 || address.length > 40) {
              res.end(`{"error":"Not Supported"}`);
              return;
            }

            res.write(`{ message: 'success' }`);
            res.end();

            var inserts = [];
            var theTime = Math.floor(Date.now() / 1000);
            inserts.push("REPLACE INTO pushnotificationsubscribers VALUES (" + escapeFunction(address) + "," + escapeFunction(qs.subscription) + "," + escapeFunction(theTime) + "," + escapeFunction(theTime) + "," + escapeFunction(theTime) + ");");
            mempoolSQL = mempoolSQL.concat(inserts);
            return;

          } catch (err) {
            console.log(err);
          }

        } else if (req.url.startsWith("/v2/notification")) {
          try {

            //const subscription = req.body
            //await saveToDatabase(subscription) //Method to save the subscription to Database
            console.log(req.body);
            //res.writeHead(200, { "Access-Control-Allow-Origin": AccessControlAllowOrigin, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            //res.write(`{ message: 'success' }`);
            //res.end();
            //sendNotification(subscription, message);
            webpush.sendNotification(null, 'test');
            return;

          } catch (err) {
            console.log(err);
          }

        }
        else if (req.url.startsWith("/p/") || req.url.startsWith("/a/")) {
          console.log(req.url);
          res.writeHead(200, { "Access-Control-Allow-Origin": AccessControlAllowOrigin, 'Content-Type': 'text/html; charset=utf-8' });
          //get first 10 characters, sanitized
          var first10 = sanitizeAlphanumeric(req.url.substr(3, 13));
          if (first10.length < 10) {
            res.end(`{"error":"Not Supported"}`);
            return;
          }

          //Get the 10 posts in the same thread posted closest, with the referenced post first
          var query = `SELECT DISTINCT(messages.txid), messages.*, names.* FROM messages as messages3 LEFT JOIN messages ON messages.roottxid=messages3.roottxid LEFT JOIN names ON messages.address=names.address `
            + `WHERE 1=1 AND messages3.txid LIKE '` + first10 + `%' AND messages3.roottxid!='' ORDER BY messages.txid!=messages3.txid, ABS(messages.firstseen-messages3.firstseen) ASC LIMIT 10`;

          //sql
          return runQuery(returnPost, res, msc, query, 'post');


        } else if (req.url.startsWith("/t/")) {
          console.log(req.url);
          res.writeHead(200, { "Access-Control-Allow-Origin": AccessControlAllowOrigin, 'Content-Type': 'text/html; charset=utf-8' });
          var topicHOSTILE = req.url.substr(3, 220);
          topicHOSTILE = decodeURI(topicHOSTILE.trim());
          if (topicHOSTILE.length < 1) {
            res.end(`{"error":"Not Supported"}`);
            return;
          }

          //Get the 10 posts in the same thread posted closest, with the referenced post first
          var query = `SELECT *, names.* FROM messages LEFT JOIN names ON messages.address=names.address WHERE txid=roottxid AND topic = ` + escapeFunction(topicHOSTILE) + ` ORDER BY firstseen DESC LIMIT 20`;

          return runQuery(returnPost, res, msc, query, 'topic');


        } else if (req.url.startsWith("/m/")) {
          console.log(req.url);
          res.writeHead(200, { "Access-Control-Allow-Origin": AccessControlAllowOrigin, 'Content-Type': 'text/html; charset=utf-8' });
          var pagingIDHOSTILE = req.url.substr(3, 220).toLowerCase().trim().replace('@', '');
          if (pagingIDHOSTILE.length < 1) {
            res.end(`{"error":"Not Supported"}`);
            return;
          }

          var query = `SELECT *, messages.* FROM names LEFT JOIN messages ON messages.address=names.address WHERE pagingid = ` + escapeFunction(pagingIDHOSTILE) + ` ORDER BY firstseen DESC LIMIT 20 `;

          return runQuery(returnPost, res, msc, query, 'member');


        }
        else {

          /*
          var html = fs.readFileSync(`C:/Users/Cash/Documents/GitHub/memberdev` + req.url);
          if(req.url.endsWith('.js')){
            res.writeHead(200, { "Content-Type": "text/javascript;" });
          }
          res.write(html);
          res.end();
          return;
          */
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.write("404 Not Found\n");
          res.end();
          console.log("Not Supported");
          console.log(req.url);
          return;
        }
      } catch (err) {
        console.log(err);
      }
      res.end(`{"error":"500"}`);
      return;
    }

    async function runQuery(processingFunction, res, msc, query, type) {
      //sql
      //if (usesqlite) {
      //var dbweb = await sqlite.open(sqldbfile);
      try {
        var result = await dbpoolService.runQuery(query);
        return processingFunction(null, result, res, null, msc, query, type);
      } catch (e) {
        console.log(query);
        return processingFunction(e, null, res, null, msc, query, type);
      }
      /*} else {
  
        //Open database connection
        var dbweb = mysql.createConnection(dbconfig);
        dbweb.connect(function (err) { if (err) throw err; });
        dbweb.query("SET NAMES 'utf8mb4'; USE " + dbname + ";" + query, function (err, result) { processingFunction(err, result[2], res, dbweb, msc, query, type) });
        return;
      }*/
    }


    function returnPost(err, rows, res, dbloc, msc, query, type) {
      //This function must close the db connection and end the result
      /*try {
        if (dbloc.end) dbloc.end();
        if (dbloc.close) dbloc.close();
      } catch (e2) {
        console.log(e2);
      }*/

      if (err) {
        console.log(err);
      } else {

        //
        try {
          res.write(indexparts[0]);
          res.write("<!--Extra Metadata-->");
          res.write(`<base href="../">`);

          var imageLink = `https://member.cash/img/logos/logowide2.png`;
          if (rows.length > 0) {
            if (type == "post") {

              var theMessage = ds(rows[0].message.replace(/\n/g, " "));
              res.write(`<title>` + theMessage + `</title>
              <meta name="description" content="` + theMessage + `">
              <meta name="twitter:card" content="summary_large_image">
              <meta name="twitter:title" content="` + theMessage + `">
              <meta name="twitter:description" content="`+ theMessage + `">
              <meta property="og:title" content="` + theMessage + `">
              <meta property="og:description" content="`+ theMessage + `"></meta>`);

              //look for an imgur / youtube
              var completeComments = "";
              for (var i = 0; i < rows.length; i++) {
                completeComments += rows[i].message + " ";
              }

              var imgurRegex = /[\s\S]*?(?:https?:\/\/)?(\w+\.)?imgur\.com(\/|\/a\/|\/gallery\/)(?!gallery)([\w\-_]{5,12})(\.[a-zA-Z]{3})?[\s\S]*/i;
              var imgurLink = completeComments.replace(imgurRegex, 'https://i.imgur.com$2$3.jpg');

              var youtubeRegex = /[\s\S]*?(?:https?:\/\/)?(?:www\.)?youtu\.?be(?:\.com)?\/.*?(?:watch|embed)?(?:.*?v=|v\/|\/)([\w\-_]{7,12})(?:[\&\?\#].*?)*?(?:([\&\?\#]t=)?(([\dhms]+))?)[\s\S]*/i;
              var youtubeLink = completeComments.replace(youtubeRegex, 'https://img.youtube.com/vi/$1/0.jpg');

              if (imgurLink != completeComments) {
                imageLink = imgurLink;
              } else if (youtubeLink != completeComments) {
                imageLink = youtubeLink;
              }

              if (imageLink == `https://member.cash/img/logos/logowide2.png` && rows[0].picurl) {
                imageLink = `https://member.cash/img/profilepics/` + rows[0].address + `.640x640.jpg`;
              }
            } else if (type == "member") {
              var memberText = ds(rows[0].name) + ` @` + ds(rows[0].pagingid) + ` member.cash profile `;
              var memberDescription = ds(rows[0].profile.replace(/\n/g, " "));

              res.write(`<title>` + memberText + `</title>
              <meta name="description" content="` + memberText + ` ` + memberDescription + ` ">
              <meta name="twitter:card" content="summary_large_image">
              <meta name="twitter:title" content="` + memberText + `">
              <meta name="twitter:description" content="`+ memberDescription + `">
              <meta property="og:title" content="` + memberText + `">
              <meta property="og:description" content="`+ memberDescription + `">
              <script>var headeraddress=`+ rows[0].address + `;</script> 
              `);
              imageLink = `https://member.cash/img/profilepics/` + rows[0].address + `.640x640.jpg`;

            } else if (type == "topic") {
              var memberText = `member.cash topic: ` + ds(rows[0].topic);
              res.write(`<title>` + memberText + `</title>
              <meta name="description" content="` + memberText + ` ">
              <meta name="twitter:card" content="summary_large_image">
              <meta name="twitter:title" content="` + memberText + `">
              <meta name="twitter:description" content="`+ memberText + `">
              <meta property="og:title" content="` + memberText + `">
              <meta property="og:description" content="`+ memberText + `">`);
              imageLink = `https://member.cash/img/logos/logowide2.png`;
            }

            if (imageLink != "") {
              res.write(`<meta name="twitter:image" content="` + imageLink + `">
                <meta property="og:image" content="`+ imageLink + `">`);
            }
          }

          res.write(indexparts[1]);
          if (type == "post") {
            if (rows.length > 0) {
              for (var i = 0; i < rows.length; i++) {
                if (i > 0) {
                  res.write('<p><a href="/p/' + sanitizeAlphanumeric(rows[i].txid.substr(0, 10)) + '">' + ds(rows[i].message) + '</a> <a href="/m/' + encodeURI(rows[i].pagingid) + '">@' + ds(rows[i].pagingid) + '</a></p>');
                } else {
                  res.write('<p>' + ds(rows[i].message) + ' <a href="/m/' + encodeURI(rows[i].pagingid) + '">@' + ds(rows[i].pagingid) + '</a></p>');
                  res.write('<p><a href="/t/' + encodeURIComponent(rows[i].topic) + '">' + ds(rows[i].topic) + '</a></p>');
                }
              }
            }
          } else if (type == "topic" || type == "member") {
            if (rows.length > 0) {
              if (type == "member") {
                res.write('<p>' + ds(rows[0].name) + '</p>');
                res.write('<p>@' + ds(rows[0].pagingid) + '</p>');
                res.write('<p>' + ds(rows[0].profile) + '</p>');
              } else if (type == "topic") {
                res.write('<p><a href="/t/' + encodeURIComponent(rows[0].topic) + '">' + ds(rows[0].topic) + '</a></p>');
              }
              for (var i = 0; i < rows.length; i++) {
                res.write('<p><a href="/p/' + sanitizeAlphanumeric(rows[i].txid.substr(0, 10)) + '">' + ds(rows[i].message) + '</a> <a href="/t/' + encodeURIComponent(rows[i].topic) + '">' + ds(rows[i].topic) + '</a> <a href="/m/' + encodeURI(rows[i].pagingid) + '">@' + ds(rows[i].pagingid) + '</a></p>');
              }
            }
          }
          res.write(`<img src="` + imageLink + `">`);
          res.end(indexparts[2]);
          return;
        } catch (err) {
          console.log(err);
        }
      }

      try {
        res.end(`{"error":"` + sanitizeAlphanumeric(err) + `"}`);
      } catch (err) {
        console.log(err);
      }

    }

    function returnQuery(err, rows, res, dbloc, msc, query) {


      msc = Date.now() / 1000 - msc;
      //This function must close the db connection and end the result
      /*try {
        if (dbloc.end) dbloc.end();
        if (dbloc.close) dbloc.close();
      } catch (e2) {
        console.log(e2);
      }*/

      if (err) {
        console.log(err);
      } else {
        try {
          //Removate moderated content
          //Unfortunately not possible to include this graph like request in SQL statement.
          //Workaround is to flag results in 'moderated' column and remove them here.
          //Note, following a moderated result, the next result can also be a result that
          //has the same txid and should be moderated, although the moderated field is null.
          var moderatedtxid = "none";
          var totalRowLength = rows.length;
          for (var i = 0; i < rows.length; i++) {

            //Check a result has been directly moderated
            if (rows[i].moderated != null && rows[i].moderated != "") {
              moderatedtxid = rows[i].txid;
              ////Return the moderated results for now, client can decide how to deal with them
              //rows.splice(i, 1);
              //i--;
              continue;
            }

            //Check if a similar result has been returned directly following the moderated result
            /*if (rows[i].txid == moderatedtxid) {
              rows.splice(i, 1);
              i--;
              continue;
            }*/

          }

          if (rows.length > 0) {
            rows[0].unduplicatedlength = totalRowLength;
            rows[0].msc = msc;
            rows[0].query = query.replace(/\t/g, ' ').replace(/\n/g, ' ');
          }

          res.writeHead(200, { "Access-Control-Allow-Origin": AccessControlAllowOrigin, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(rows));

          if (msc > 100) {
            var logquery = "insert into zsqlqueries values (" + escapeFunction(query) + "," + msc + ");"
            console.log(query);
            console.log("Query Time (ms):" + msc);
            dbpoolapp.runQuery(logquery);
          }

          return;
        } catch (err) {
          console.log(err);
        }
      }

      try {
        res.writeHead(500);
        res.end(`{"error":"` + sanitizeAlphanumeric(err) + `"}`);
      } catch (err) {
        console.log(err);
      }

    }


    async function sendTransaction(err, ret, res, rawtx) {
      if (err) {
        // Send back a response and end the connection
        console.log("sendtransaction error:" + err);
        res.writeHead(500);
        res.end(`{"error":"` + sanitizeAlphanumeric(err.message) + `", "code":"` + Number(err.code) + `"}`);
        console.log("sendtransaction error:" + err.code + " " + err.message);
        return;
      }

      try {
        var timeStampInMs = Math.floor(Date.now() / 1000);
        var transaction = bitcoinJs.Transaction.fromHex(rawtx);
        var inserts = getSQLForTRX(transaction, timeStampInMs);

        if (inserts.length > 0) {

          if (usesqlite) {
            var dbfastinsert = await sqlite.open(sqldbfile);
            await putMultipleSQLStatementsInSQL(inserts, dbfastinsert);
          } else {
            var finalSQL = "SET NAMES 'utf8mb4'; USE " + dbname + ";" + inserts.join(" ");
            var dbfastinsert = mysql.createConnection(dbconfig);
            dbfastinsert.connect(function (err) { if (err) throw err; });
            dbfastinsert.query(finalSQL,
              function (err, result) {
                try { dbfastinsert.end(); } catch (e) { };
                if (err) {
                  console.log("sendtrx: mempool dberror 5;" + err + finalSQL);
                }
                else {
                  console.log("Wrote received trx to db");
                }
              }
            );
          }

        }


      } catch (err) {
        console.log("Error writing directly received trx to db:" + err);
        console.log("Error writing directly received trx to db:" + err.message);
      }
      res.end(ret.result);
      return;
    }

    //BCHD GRPC to get utxos for an address
    if (bchdgrpcenabled) {
      console.log("DEV: try starting bchdgrpc ");
      try {
        //GRPC API Start 
        const PROTO_PATH = __dirname + '/bchrpc.proto';
        //console.log("Path:" + PROTO_PATH);
        // Suggested options for similarity to existing grpc.load behavior
        var packageDefinition = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
        var protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
        // The protoDescriptor object has the full package hierarchy
        var BCHRPC = protoDescriptor.pb;
        var cert = null;
        try {
          if (bchdcertpem != null) {
            cert = fs.readFileSync(bchdcertpem);
          }
        } catch (err) {
          console.log("local certificate not loaded for GRPC " + err);
          bchdgrpcenabled = false;
        }
        var client = new BCHRPC.bchrpc(bchdhost, grpc.credentials.createSsl(cert));


        //test if grpc bchd is working
        client.getBlockchainInfo({}, {}, (err, response) => {
          if (err) {
            console.log("BCHD GRPC not working:" + err);
            bchdgrpcenabled = false;
          } else {
            console.log("BCHD GRPC response: Best Height:" + response.best_height);
          }
        });

      } catch (err) {
        console.log(err);
        bchdgrpcenabled = false;
      }
    }

    //This function converts from GRPC return format to same format as used by Bitbox
    function returnUTXOs(err, response, res) {

      var utxos;
      if (response.result) {
        utxos = response.result;
      }

      if (response.outputs) {
        utxos = response.outputs;
      }



      if (err) {
        // Send back a response and end the connection
        res.writeHead(500);
        res.end(`{"error":"` + err.message + `"}`);
        return;
      }


      var stringutxos = ``;
      for (var i = 0; i < utxos.length; i++) {
        //console.log(utxos[i].outpoint.hash.toString('hex')+" "+utxos[i].outpoint.index+" "+utxos[i].value);
        if (utxos[i].value != 546 && utxos[i].satoshi != 546) {//don't return dust
          if (utxos[i].outpoint) {
            let txid = utxos[i].outpoint.hash.toString('hex').match(/[a-fA-F0-9]{2}/g).reverse().join('');
            stringutxos += `{"txid":"` + txid + `","vout":` + utxos[i].outpoint.index + `,"satoshis":` + utxos[i].value + `},`;
          } else {
            stringutxos += `{"txid":"` + utxos[i].txid + `","vout":` + utxos[i].vout + `,"satoshis":` + utxos[i].satoshi + `},`;
          }
        }
      }

      //Remove comma at the end if present
      var len = stringutxos.length;
      if (stringutxos.substr(len - 1, 1) == ",") {
        stringutxos = stringutxos.substring(0, len - 1);
      }

      var returnString = `{"utxos":[` + stringutxos + `]}`;

      res.end(returnString);
      return;
    }

  }

  if (pushnotificationserver) {

    setTimeout(doPushNotifications, 10000);
    async function doPushNotifications() {
      try {
        //read unpushed notifications from db
        var lastPushTime = parseInt(new Date().getTime() / 1000);
        var lastPushTimeSQL = "  ";
        var trimsql = "DELETE from notifications where origin=address;";
        await dbpoolapp.runQuery(trimsql);
        var pushsql = "SELECT *, names.name, names.picurl, names.pagingid FROM notifications JOIN pushnotificationsubscribers on notifications.address=pushnotificationsubscribers.address LEFT JOIN names on names.address = notifications.origin where time>(select value from status where name='lastpushtime') and (notifications.type!='dislike' and notifications.type!='unfollow' and notifications.type!='mute' and notifications.type!='unmute') and notifications.origin!=notifications.address;";//+ " and lastaccess<" + lastPushTimeSQL;
        //console.log(pushsql);
        //var result = await dbbc.all(pushsql);
        var result = await dbpoolapp.runQuery(pushsql);
        //console.log(result);
        //push notifications
        if (result.length > 0) {
          console.log("Sending Notifications:" + result.length);
        }
        for (var i = 0; i < result.length; i++) {
          await sleep(100);
          //console.log("Sending Notification:" + i);
          try {
            var payload = [];
            /*payload.type = result[i].type;
            payload.name = result[i].name;
            payload.picurl = result[i].picurl;
            payload.pagingid = result[i].pagingid;
            payload.txid = result[i].txid;*/
            var stringToSend = JSON.stringify(result[i]);
            //console.log(stringToSend);
            //await webpush.sendNotification(JSON.parse(result[i].subscription), result[i].type);
            await webpush.sendNotification(JSON.parse(result[i].subscription), stringToSend);
            //console.log("Sent Notification:" + i);
          }
          catch (err) {
            try {
              //handle not subscribed etc
              console.log("Error Notification:" + i);
              //console.log(err);

              var unsub = "DELETE FROM pushnotificationsubscribers where address=" + escapeFunction(result[i].address) + " and subscription=" + escapeFunction(result[i].subscription) + ";";

              if (err.statusCode && err.statusCode == 410) {
                await dbpoolapp.runQuery(unsub);
                console.log("Unsub:" + result[i].address);
                continue;
              }


              //console.log(err.body);
              var errcodes = JSON.parse(err.body);
              if (errcodes.errno == 106) {
                await dbpoolapp.runQuery(unsub);
                console.log("Unsub:" + result[i].address);
                continue;
              }
            } catch (err) {
              console.log("Error While Handling Unsub:" + i);
              console.log(err);
            }
          }
        }
        var updateTimeSQL = "UPDATE status set value=" + lastPushTime + " where name='lastpushtime';";
        await dbpoolapp.runQuery(updateTimeSQL);
        //await dbbc.all(updateTimeSQL);

      } catch (err) {
        console.log(err);
      }
      setTimeout(doPushNotifications, 1000);
    }
    //write last push
  }

  if (tokenbalanceserver) {
    richlist.updateDB(dbpoolapp, onConflictAddress, escapeFunction, tokenbalanceserver);
    setTimeout(function () { richlist.updateDB(dbpoolapp, onConflictAddress, escapeFunction, tokenbalanceserver); }, tokenbalanceupdateinterval);
  }

  //Utility functions
  function sanitizeAlphanumeric(input) {
    if (!isString(input)) { return ""; }
    return input.replace(/[^A-Za-z0-9]/g, '');
  }

  function ds(input) {
    //if (input === undefined) { return ""; };
    try {
      //If this error out 'input.replace not a number' probably input is not a string type
      input = input.replace(/&/g, '&amp;');
      input = input.replace(/</g, '&lt;');
      input = input.replace(/>/g, '&gt;');
      input = input.replace(/"/g, '&quot;');
      input = input.replace(/'/g, '&#x27;');
    } catch (e) {
      //Anything funky goes on, we'll return safe empty string
      return "";
    }
    return input;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isString(obj) {
    return (Object.prototype.toString.call(obj) === '[object String]');
  }


};

run();






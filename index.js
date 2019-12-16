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

var run = async function () {

  //App includes
  var config = require(process.cwd()+'/config.js');
  var sqlforaction = require('./sqlforaction.js');
  var dbqueries = require('./dbqueries.js');

  //External libs
  var fs = require('fs');
  var bitcoinJs = require('bitcoinjs-lib');
  var RpcClient = require('bitcoind-rpc');

  //Configuration settings
  var secondsToWaitonStart = config.secondsToWaitonStart;
  var secondsToWaitBetweenProcessingBlocks = config.secondsToWaitBetweenProcessingBlocks;
  var secondsToWaitBetweenPollingNextBlock = config.secondsToWaitBetweenPollingNextBlock;
  var secondsToWaitBetweenPollingMemPool = config.secondsToWaitBetweenPollingMemPool;
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

  //Conditionally included libs

  if (usesqlite) {
    var sqlite = require('sqlite-async');
  }
  else {
    var mysql = require('mysql');
  }

  if (bchdgrpcenabled) {
    var grpc = require('grpc');
    var protoLoader = require('@grpc/proto-loader');
  }

  if (httpserverenabled) {
    var http = require('http');
    var url = require('url');
  }

  if (httpsserverenabled) {
    var https = require('https');
    var url = require('url');
  }

  //Expect service to be started on startup, give the database/rpc some time to come up
  console.log("Sleeping for " + secondsToWaitonStart + " seconds to give mysql/rpc time to come up.");
  await sleep(secondsToWaitonStart * 1000);

  //local vars
  {
    //rpc to get blocks, trxs from Bitcoin
    var rpc = new RpcClient(rpcconfig);
    var currentBlock = 0;
    var lastBlockSuccessfullyProcessed = 0;
    var mempoolprocessingstarted = false;
    var memotxidsalreadyprocessed = [];
    //sql
    var dbbc; //database connection for processing blocks
    var dbmem; //database connection for processing mempool
    var lastblocktimestamp=0;

    //Housekeeping on DB
    {
      var lastExpensiveSQLHousekeepingOperation = new Date().getTime();
      var expensiveHousekeepingSQLOperations = [];

      //Different timestamp formats for different databases
      if (usesqlite) {
        var timestampSQL = "strftime('%s', 'now')";
        var escapeFunction = function (s) { s = s + ""; s = s.replace(/'/g, "''"); return "'" + s + "'"; }
      } else {
        var timestampSQL = "UNIX_TIMESTAMP()";
        var escapeFunction = mysql.escape;;
      }


      //Recreate topics table  
      if (usesqlite) {
        expensiveHousekeepingSQLOperations.push(
          [`DROP TABLE IF EXISTS topics;`, `CREATE TABLE topics (topic VARCHAR(220), messagescount int(9), mostrecent int(11), subscount mediumint(9));`, `INSERT into topics SELECT * FROM (SELECT messages.topic, COUNT(*) as messagescount, recent.latest as mostrecent, subs.subscount FROM messages LEFT JOIN (SELECT messages.topic, MAX(firstseen) as latest FROM messages GROUP BY messages.topic) recent on messages.topic = recent.topic LEFT JOIN (SELECT count(*) as subscount, subs.topic FROM subs GROUP BY subs.topic) subs on subs.topic=messages.topic GROUP BY subs.topic)  as fulltable WHERE messagescount>3 AND subscount>1;`]);
      } else {
        expensiveHousekeepingSQLOperations.push([`DROP TABLE IF EXISTS topics; CREATE TABLE topics (topic VARCHAR(220) CHARACTER SET utf8mb4, messagescount int(9), mostrecent int(11), subscount mediumint(9)) SELECT * FROM (SELECT messages.topic, COUNT(*) as messagescount, recent.latest as mostrecent, subs.subscount FROM messages LEFT JOIN (SELECT topic, MAX(firstseen) as latest FROM messages GROUP BY topic) recent on messages.topic = recent.topic LEFT JOIN (SELECT count(*) as subscount, topic FROM subs GROUP BY topic) subs on subs.topic=messages.topic GROUP BY topic)  as fulltable WHERE messagescount>3 AND subscount>1;`]);
      }

      //It's bad to have too many null roottxids - slows down fixorphan queries
      //Give it 24 hours to find root tx
      //After 48 hours make orphans their own root trxs.
      expensiveHousekeepingSQLOperations.push([`UPDATE messages SET roottxid=txid WHERE roottxid IS NULL AND retxid ='' AND ` + timestampSQL + `-firstseen > 60*60*24;`, `UPDATE messages SET roottxid=txid WHERE roottxid IS NULL AND ` + timestampSQL + `-firstseen > 60*60*48;`]);

      //This is a lighter housekeeping operation, can run frequently, ensure messages are linked back to their root disscussion topic
      var fixOrphanMessages = "UPDATE messages JOIN messages parent ON messages.retxid=parent.txid SET messages.roottxid = parent.roottxid, messages.topic = parent.topic WHERE messages.roottxid = '';";
      if (usesqlite) {
        fixOrphanMessages = "UPDATE messages SET (roottxid,topic) = (SELECT p.roottxid, p.topic FROM messages p WHERE messages.retxid=p.txid) WHERE messages.roottxid IS NULL;";
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

  if (usesqlite) {
    sqliteStartProcessing();
  } else {
    getLastBlockProcessedMYSQL();
  }

  //Processing Blocks Into DB

  //SQLite specific

  async function sqliteStartProcessing() {

    //Copy the schema if the db doesn't exist yet
    if(!fs.existsSync(sqldbfile)){
      fs.createReadStream('memberEmpty.db').pipe(fs.createWriteStream(sqldbfile));
    }

    dbbc = await sqlite.open(sqldbfile);
    

    //Defines the number of pages from the database file for storing in RAM, i.e., the cache size.
    //Increasing this parameter may increase performance of the database on high load, since the 
    //greater its value is, the more modifications a session can perform before retrieving 
    //exclusive lock.
    await dbbc.run("PRAGMA cache_size=100000");

    //EXCLUSIVE — the database file is used in exclusive mode. The number of system calls 
    //to implement file operations decreases in this case, which may increase database performance.
    //Use only for initial sync
    await dbbc.run("PRAGMA LOCKING_MODE = EXCLUSIVE");

    //0 | OFF — database synchronization is not used. I.e., SQLite takes no breaks when 
    //transmitting data to the operating system. Such mode can substantially increase 
    //performance. The database will meet the integrity conditions after the SQLite crash,
    // however, data will be corrupted in case of system crash or power off.
    //Use only for initial sync
    await dbbc.run("PRAGMA synchronous = OFF");

    //MEMORY — the rollback journal is kept in RAM and doesn’t use the disk subsystem. 
    //Such mode provides more significant performance increase when working with log. 
    //However, in case of any failures within a transaction, data in the DB will be 
    //corrupted with high probability due to a lack of saved data copy on the disk.
    //Use only for initial sync
    await dbbc.run("PRAGMA JOURNAL_MODE = MEMORY");

    //Block with first memo transaction
    currentBlock = 525471;

    var result = await dbbc.get("SELECT * FROM status WHERE name='lastblockprocessed';");
    try {
      currentBlock = result.value;
    } catch (e) {
      //start from beginning
    }

    if (overrideStartBlock) {
      currentBlock = overrideStartBlock;
    }
    lastBlockSuccessfullyProcessed = currentBlock - 1;
    fetchAndProcessBlocksIntoDB();
  }

  async function runSafeDBPolicy() {
    dbmem = await sqlite.open(sqldbfile);
    await dbbc.run("PRAGMA LOCKING_MODE = NORMAL");
    await dbbc.run("PRAGMA synchronous = FULL");
    await dbbc.run("PRAGMA JOURNAL_MODE = DELETE");
  }

  async function putMultipleSQLStatementsInSQLite(mempoolSQL, dbmem) {
    //This processes statements one by one.
    //Apparently it would be better to use transactions - but using them causes an error
    //Attempt to do so left commented out
    //var sqlToRun = [];
    for (var i = 0; i < mempoolSQL.length; i++) {
      if (mempoolSQL[i] == "") continue;
      try {
        await dbmem.run(mempoolSQL[i]);
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

  function getLastBlockProcessedMYSQL() {
    dbbc = mysql.createConnection(dbconfig);
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
      if ((err.code == -8 || err.code == -1) && mempoolprocessingstarted == false && currentBlock>613419) {
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
    rpc.getBlock(ret.result, false, processBlockIntoDB);
  }

  function processBlockIntoDB(err, ret) {
    if (err) {
      console.log(err);
      console.log("Wait " + secondsToWaitBetweenProcessingBlocks + " seconds");
      return setTimeout(fetchAndProcessBlocksIntoDB, secondsToWaitBetweenProcessingBlocks * 1000);
    }
    takeBlockHexTransactionsAndPutThemInTheDB(ret.result);
  }

  function takeBlockHexTransactionsAndPutThemInTheDB(hex) {
    var block = bitcoinJs.Block.fromHex(hex);
    //console.log(block.getId() + "\n");
    var transactions = block.transactions;
    lastblocktimestamp=block.timestamp;
    for (var i = 1; i < transactions.length; i++) {
      try {
        var dbresults = getSQLForTRX(transactions[i], block.timestamp);
        globalsql = globalsql.concat(dbresults);
      } catch (error) {
        //Skip if any problem
        console.error(error);
        console.log("error: " + error);
      }
    }
    writeToSQL(globalsql);
  }

  function getSQLForTRX(tx, time) {
    if (tx === undefined) {
      return [];
    }

    //This assumes maximum of 1 memo action per trx
    var txid = tx.getId();

    //Don't examine all transactions again that have already been examined for memo trxs
    if (mempooltxidsAlreadyProcessed.indexOf(txid) !== -1) {
      //console.log("Skipping - this tx already processed from the mempool.");
      return [];
    }

    //Don't process memo transactions that have already been processed
    if (memotxidsalreadyprocessed.indexOf(txid) !== -1) {
      console.log("Skipping - this tx already processed:" + txid);
      return [];
    }

    return sqlforaction.getSQLForAction(tx, time, usesqlite, escapeFunction);
  }

  function getHouseKeepingOperation() {
    //These are expensive, so max of once per 2 minutes
    var currentTime = new Date().getTime();
    if (currentTime - lastExpensiveSQLHousekeepingOperation > 60 * 2) {
      console.log("Adding SQL Housekeeping operation");
      lastExpensiveSQLHousekeepingOperation = currentTime;
      return expensiveHousekeepingSQLOperations[Math.floor(Math.random() * expensiveHousekeepingSQLOperations.length)];
    }
    return [];
  }

  async function writeToSQL(sql) {

    console.log("SQL processing queue:" + sql.length);
    //console.log("Processed:" + memotxidsalreadyprocessed.length);
    //console.log("Processed:" + mempooltxidsAlreadyProcessed.length);
    if (sql.length < 1000 && !mempoolprocessingstarted) {
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
    }

    if (usesqlite) {
      try {
        sqlTime = new Date().getTime();
        await putMultipleSQLStatementsInSQLite(sql, dbbc);
      }
      catch (e) {
        return afterBlockProcessing(e, null);
      }
      return afterBlockProcessing(null, null);


    } else {

      sql = sql.join(" ");
      sql = "SET NAMES 'utf8mb4'; USE " + dbname + ";" + sql;

      //This creates a connection each time. Might be better to reuse connection, especially on initial sync
      dbbc = mysql.createConnection(dbconfig);
      dbbc.connect(function (err) { if (err) console.log("dberror 1;" + err); });
      sqlTime = new Date().getTime();
      dbbc.query(sql, afterBlockProcessing);
    }
  }

  function afterBlockProcessing(err, result) {
    try {
      //Close only mysql conn (not sqlite) if exists
      if (dbbc.end) dbbc.end();
    } catch (e) {
      console.log(e);
    }

    if (err) {
      console.error("dberror 2;" + err);
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
      memotxidsalreadyprocessed=[];
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
    var transaction = bitcoinJs.Transaction.fromHex(rawtx);
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

    if (usesqlite) {
      try {
        await putMultipleSQLStatementsInSQLite(mempoolSQL, dbmem);
      }
      catch (e) {
        return finishMempoolProcessing(e, null, trxidsbeingprocessed);
      }
      return finishMempoolProcessing(null, null, trxidsbeingprocessed);

    } else {
      dbmem = mysql.createConnection(dbconfig);
      dbmem.connect(function (err) { if (err) console.log("mempool dberror 3;" + err); });
      var mempoolFinalSQL = "SET NAMES 'utf8mb4'; USE " + dbname + ";" + mempoolSQL.join(" ");
      dbmem.query(mempoolFinalSQL, function (err, result) { finishMempoolProcessing(err, result, trxidsbeingprocessed); });
      //writeToNEO4J(mempoolCYPHER);
    }
  }

  var finishMempoolProcessing = function (err, result, trxidsbeingprocessed) {
    try {
      //Only close db connection for mysql
      if (dbmem.end()) dbmem.end();
    } catch (e) { };

    if (err) {
      console.log("mempool dberror 4;" + err + mempoolSQL);
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
      var client = new BCHRPC.bchrpc(bchdhost, grpc.credentials.createSsl(null));

      //test if grpc bchd is working
      client.getBlockchainInfo({}, {}, (err, response) => {
        if (err) {
          console.log("BCHD GRPC not working:" + err);
        } else {
          console.log("BCHD GRPC response: Best Height:" + response.best_height);
        }
      });

    } catch (err) {
      console.log(err);
    }
  }

  //This function converts from GRPC return format to same format as used by Bitbox
  function returnUTXOs(err, response, res) {

    if (err) {
      // Send back a response and end the connection
      res.writeHead(500);
      res.end(`{"error":"` + err.message + `"}`);
      return;
    }

    let utxos = response.outputs;
    var stringutxos = ``;
    for (var i = 0; i < utxos.length; i++) {
      //console.log(utxos[i].outpoint.hash.toString('hex')+" "+utxos[i].outpoint.index+" "+utxos[i].value);
      if (utxos[i].value != 546) {//don't return dust
        let txid = utxos[i].outpoint.hash.toString('hex').match(/[a-fA-F0-9]{2}/g).reverse().join('');
        stringutxos += `{"txid":"` + txid + `","vout":` + utxos[i].outpoint.index + `,"satoshis":` + utxos[i].value + `},`;
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

  //HTTP server to handle providing utxos and putting trxs in the mempool
  if (httpserverenabled || httpsserverenabled) {

    try {

      if (httpserverenabled) {
        console.log("Try starting httpserver ");
        // Create an instance of the http server to handle HTTP requests
        let app = http.createServer(webServer).listen(httpport);
        console.log('HTTP server running on port ' + httpport);
      }

      if (httpsserverenabled) {
        console.log("Try starting httpsserver ");
        const options = {
          key: fs.readFileSync(keypem),
          cert: fs.readFileSync(certpem)
        };

        // Create an instance of the https server to handle HTTPS requests
        https.createServer(options, webServer).listen(httpsport);
        console.log('HTTPS server running on port ' + httpsport);
      }
    } catch (err) {
      console.log(err);
    }

    async function webServer(req, res) {
      console.log("webserver request received");
      res.writeHead(200, { "Access-Control-Allow-Origin": AccessControlAllowOrigin, 'Content-Type': 'application/json; charset=utf-8' });
      try {
        if (req.url.startsWith("/v2/address/utxo/bitcoincash:")) {
          let address = sanitizeAlphanumeric(req.url.substr(29));
          if (address.length > 120) {
            res.end(`{"error":"Address Too Long"}`);
            return;
          }
          if (bchdgrpcenabled) {
            client.getAddressUnspentOutputs({ address: address, includemempool: true }, {}, function (err, response) { returnUTXOs(err, response, res); });
            return;
          } else {
            //rpc.listUnspent({ address }, function (err, ret) { returnUTXOs(err, ret, res); });
            res.end(`{"error":"BCHD GRPC - Not Supported"}`);
          }
        } else if (req.url.startsWith("/v2/rawtransactions/sendRawTransaction/")) {
          console.log("webserver transaction received");
          let transaction = sanitizeAlphanumeric(req.url.substr(39));
          if (transaction.length > acceptmaxtrxsize) { //Max 5K transaction
            res.end(`{"error":"Transaction too big for this server. Try making some smaller transactions to group your utxos."}`);
            return;
          }
          console.log("sending transaction to rpc:" + transaction);
          rpc.sendRawTransaction(transaction, function (err, ret) { sendTransaction(err, ret, res, transaction); });
          return;
        } else if (req.url.startsWith("/member.js?action=")) {

          try {

            //Run query
            var msc = Date.now() / 1000;
            var timestampToUse=timestampSQL;
            //If still processing blocks, use timestamp of last block as 'now' for queries
            if(!mempoolprocessingstarted){timestampToUse=lastblocktimestamp;}
            var query = dbqueries.getQuery(req, url, usesqlite, escapeFunction, timestampToUse);

            //sql
            if (usesqlite) {
              var dbweb = await sqlite.open(sqldbfile);
              try {
                var result = await dbweb.all(query);
                return returnQuery(null, result, res, dbweb, msc, query);
              } catch (e) {
                console.log(query);
                return returnQuery(e, null, res, dbweb, msc, query);
              }
            } else {

              //Open database connection
              var dbweb = mysql.createConnection(dbconfig);
              dbweb.connect(function (err) { if (err) throw err; });
              dbweb.query("SET NAMES 'utf8mb4'; USE " + dbname + ";" + query, function (err, result) { returnQuery(err, result[2], res, dbweb, msc, query) });
              return;
            }

          } catch (err) {
            console.log(err);
          }


        } else {
          console.log("Not Supported");
          console.log(req.url);
          res.end(`{"error":"Not Supported"}`);
          return;
        }
      } catch (err) {
        console.log(err);
      }
      res.end(`{"error":"500"}`);
      return;
    }

    function returnQuery(err, rows, res, dbloc, msc, query) {
      //This function must close the db connection and end the result
      try {
        if (dbloc.end) dbloc.end();
        if (dbloc.close) dbloc.close();
      } catch (err) {
        console.log(err);
      }

      if (err) {
        console.log(err);
      } else {
        try {
          msc = Date.now() / 1000 - msc;
          if (rows.length > 0) {
            rows[0].msc = msc;
            rows[0].query = query.replace(/\t/g, ' ').replace(/\n/g, ' ');
          }
          res.end(JSON.stringify(rows));
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


    async function sendTransaction(err, ret, res, rawtx) {
      if (err) {
        // Send back a response and end the connection
        console.log("sendtransaction error:" + err);
        res.writeHead(500);
        res.end(`{"error":"` + sanitizeAlphanumeric(err.message) + `"}`);
        console.log("sendtransaction error:" + err.message);
        return;
      }

      try {
        var timeStampInMs = Math.floor(Date.now() / 1000);
        var transaction = bitcoinJs.Transaction.fromHex(rawtx);
        var inserts = getSQLForTRX(transaction, timeStampInMs);

        if (inserts.length > 0) {

          if (usesqlite) {
            var dbfastinsert = await sqlite.open(sqldbfile);
            await putMultipleSQLStatementsInSQLite(inserts, dbfastinsert);
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


  }

  //Utility functions
  function sanitizeAlphanumeric(input) {
    if (input == null) { return ""; }
    return input.replace(/[^A-Za-z0-9]/g, '');
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

run();






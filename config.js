'use strict';

var config = {};

config.debug = false;

//Bitcoin node stuff
//for a desktop setup, you should only need to change the user/pass for your Bitcoin node
//On BCHD, you may need to set the notls=1 in BCHD config if you get a 'SSL_ERROR_SSL: error'

//Node stuff
//Local Bitcoin Node / (RPC server)
config.rpcconfig = {
  protocol: process.env.BCH_NODE_SCHEME || 'http',
  user: process.env.BCH_NODE_USER || 'username',
  pass: process.env.BCH_NODE_PASSWORD || 'password',
  host: process.env.BCH_NODE_HOST || '127.0.0.1',
  port: process.env.BCH_NODE_PORT || '8334',
};

config.acceptmaxtrxsize = 51200; // 50K (allowing for numerous inputs, in the case of a big tip)

//Profile pics stuff
//You'll probably need to change these directory paths
config.downloadprofilepics = true; //nb full db rebuild will not download profile pics
config.profilepicpath = "../client/img/profilepics/";

//Sometime profile pics have already been removed from imgur
//If this is set true, memo will be queried for the missing pics
config.querymemoformissingpics = true;

//member will rewrite index file with metadata and minimal content
config.pathtoindex = '../client/index.html';


//Processing throttle
config.secondsToWaitonStart = 15;
config.secondsToWaitBetweenProcessingBlocks = 0;
config.secondsToWaitBetweenPollingNextBlock = 60;
config.secondsToWaitBetweenPollingMemPool = 1;

//UTXO Server stuff

//Use the node's wallet to serve utxos
config.useServerWallets=true;

//BCHD UTXO server
//BCHD GRPC server can be used to fetch UTXOs, requires BCHD txindex=1 and addrindex=1
config.bchdgrpcenabled = false;
//config.bchdhost = '127.0.0.1:8335';
//config.bchdcertpem = 'rpc.cert';
//Note, also fill in config.certpem if using a self signed bchd certificate
//Make sure config.certpem is empty if not using the same certificate

//Backup utxo server. If there are no utxos found locally, proxy results from here
config.backuputxoserver = 'https://rest.bitcoin.com/v2/address/utxo/';

//MEMBER Token stuff
config.tokenbalanceserver = 'https://slpdb.fountainhead.cash/q/';
config.tokenbalanceupdateinterval = 1000*60*60*24; //in milliseconds
config.dbHouseKeepingOperationInterval = 1000*60*60*24; //in milliseconds

//HTTP Server stuff
config.httpserverenabled = true;
config.httpport = 3123;
config.AccessControlAllowOrigin = "*";

//HTTPS Server stuff
config.httpsserverenabled = false;
config.httpsport = 8123;
config.keypem = "rpc.key";
config.certpem = "rpc.cert";

//Push Notification stuff
config.pushnotificationserver = false;
config.vapidPublicKey = '';
config.vapidPrivateKey = '';
config.vapidEmail='';


//Database Stuff
config.usesqlite = true; //Setting this to false will use MYSQL instead
config.sqldbfile = "data/member.db";
config.allowpragmajournalmode = true;

//mysql db server
config.dbconfig = {
  host: "yourmysqlserver.org",
  user: "member",
  password: "",
  multipleStatements: true,
  database: "member",
};

config.keepNotificationsTime = 60 * 60 * 24 * 60;//time to keep thread notifications. in seconds
config.keepThreadNotificationsTime = 60 * 60 * 24 * 7;//time to keep thread notifications. in seconds


//Do a database rebuild from stored raw transactions. This overrides rebuildFromDBTransactions
config.completeDBrebuild = false;

//reparse actions from txs stored in database
config.rebuildFromDBTransactions = false;

//config.reimportTransaction="d5822e056a660cdef461b089608ced339cc52e77706408bebda01018c8eaeb4e"; //reimport specific transation. this overrides actionTypes

//action types to reparse
//config.actionTypes=["6d14"];
//config.actionTypes=["6d06","8d06","6d07","8d07","6d16","6da6","6d17","6da7","6da5"]; //follows, mutes, unfollows, unmutes, userrating
//config.actionTypes = ["6d0d", "6d0e", "6d06", "8d06", "6d07", "8d07", "6d16", "6da6", "6d17", "6da7", "6da5"];
//config.actionTypes=["6d05","8d05"]; //profile text
//config.actionTypes=["6d05","8d05","6d06","8d06","6d07","8d07","6d16","6da6","6d17","6da7"];
//config.actionTypes=["6d0a"];

//milliseconds wait between each reparsing action - 1000 recommended for action '6d0a' - so as to throttle requests to imgur for profile images  
config.rebuildPauseBetweenCalls = 0;

//if syncing from node on same computer, best to batch the sql commands 
//can try setting this to zero if running out of memory on large blocks 
config.batchsqlonsynccount = 1000;

//Usually the processing will start where it left off,
//you can override this by setting a startBlock.
//config.startBlock = 525587;
//config.startBlock = 525471; //first memo trx
//config.startBlock = 525590; //name
//config.startBlock = 525704; //follows
//config.startBlock = 525710; //unfollows
//config.startBlock = 533796; //profile pic
//config.startBlock = 534492; //rating
//config.startBlock = 525940;
//config.startBlock = 539220; //geohash
//config.startBlock = 543376; //first token created
//config.startBlock = 632657;// first private message
//config.startBlock = 651132;// first repost
//config.startBlock = 653897;//profile pic
//config.startBlock = 654000;
//config.startBlock = 656360;

module.exports = config;

'use strict';

var config = {};

config.secondsToWaitonStart = 1;
config.secondsToWaitBetweenProcessingBlocks = 0;
config.secondsToWaitBetweenPollingNextBlock = 60;
config.secondsToWaitBetweenPollingMemPool = 1;
config.httpserverenabled = true;
config.httpport = 3123;
config.httpsserverenabled = false;
config.httpsport = 8123;
config.AccessControlAllowOrigin = "*";
config.keypem = "/etc/letsencrypt/live/xxxxxxxx/privkey.pem";
config.certpem = "/etc/letsencrypt/live/xxxxxxxx/cert.pem";

config.acceptmaxtrxsize = 5120; // 5K (allowing for numerous inputs, in the case of a big tip)
config.bchdgrpcenabled = false; //BCHD GRPC server can be used to fetch UTXOs
config.bchdhost = 'yourbchdgrpcserver.org:8335';

config.usesqlite = true;
config.sqldbfile = "member.db";

//local rpc server
config.rpcconfig = {
  protocol: 'http',
  user: 'username',
  pass: 'password',
  host: '127.0.0.1',
  port: '8334',
};

//mysql db server
config.dbconfig = {
  host: "yourmysqlserver.org",
  user: "member",
  password: "",
  multipleStatements: true,
  database: "member",
};


//Usually the processing will start where it left off,
//you can override this by setting a startBlock.
config.startBlock = null;
//config.startBlock = 525471; //first memo trx
//config.startBlock = 525590; //name
//config.startBlock = 525704; //follows
//config.startBlock = 525710; //unfollows
//config.startBlock = 534492; //rating
//config.startBlock = 525940;
//config.startBlock = 539220; //geohash
//config.startBlock = 543376; //first token created

module.exports = config;

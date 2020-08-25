'use strict';

var config = {};

//Bitcoin node stuff
//for a desktop setup, you should only need to change the user/pass for your Bitcoin node
//On BCHD, you may need to set the notls=1 in BCHD config if you get a 'SSL_ERROR_SSL: error'

//Local Bitcoin Node / (RPC server)
config.rpcconfig = {
  protocol: process.env.BCH_NODE_SCHEME || 'http',
  user: process.env.BCH_NODE_USER || 'username',
  pass: process.env.BCH_NODE_PASSWORD || 'password',
  host: process.env.BCH_NODE_HOST || '127.0.0.1',
  port: process.env.BCH_NODE_PORT || '8334',
};
config.acceptmaxtrxsize = 51200; // 50K (allowing for numerous inputs, in the case of a big tip)

//BCHD UTXO server
//BCHD GRPC server can be used to fetch UTXOs, requires BCHD txindex=1 and addrindex=1
config.bchdgrpcenabled = true;
config.bchdhost = 'bchd.greyh.at:8335';

//Processing throttle
config.secondsToWaitonStart = 1;
config.secondsToWaitBetweenProcessingBlocks = 0;
config.secondsToWaitBetweenPollingNextBlock = 60;
config.secondsToWaitBetweenPollingMemPool = 1;

//HTTP Server stuff
config.httpserverenabled = true;
config.httpport = 3123;
config.AccessControlAllowOrigin = "*";

//HTTPS Server stuff
config.httpsserverenabled = false;
config.httpsport = 8123;
config.keypem = "/etc/letsencrypt/live/xxxxxxxx/privkey.pem";
config.certpem = "/etc/letsencrypt/live/xxxxxxxx/cert.pem";

//Database
config.usesqlite = true; //Setting this to false will use MYSQL instead
config.sqldbfile = "data/member.db";

//mysql db server
config.dbconfig = {
  host: "yourmysqlserver.org",
  user: "member",
  password: "",
  multipleStatements: true,
  database: "member",
};

//This setting should usually be set to null
//The first time it is run, it will start at block 525471
//Following that, the processing will start where it left off
config.startBlock = null;

//you can override this by setting a startBlock.
//config.startBlock = 525471; //first memo trx
//config.startBlock = 525590; //name
//config.startBlock = 525704; //follows
//config.startBlock = 525710; //unfollows
//config.startBlock = 534492; //rating
//config.startBlock = 525940;
//config.startBlock = 539220; //geohash
//config.startBlock = 543376; //first token created

module.exports = config;

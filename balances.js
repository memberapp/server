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

var balances = {};

balances.updateDB = async function (rlConnection, onConflictAddress, escapeFunction, tokenbalanceserver) {

    try {
        // Install BITBOX-SDK v8.1+ for blockchain access
        // For more information visit: https://www.npmjs.com/package/bitbox-sdk
        const BITBOXSDK = require('bitbox-sdk');
        /*const slpjs = require('slpjs');
    
        // FOR MAINNET UNCOMMENT
        let addr = "simpleledger:qrhvcy5xlegs858fjqf8ssl6a4f7wpstaqnt0wauwu";
        const BITBOX = new BITBOXSDK.BITBOX({ restURL: 'https://rest.bitcoin.com/v2/' });
    
        // FOR TESTNET UNCOMMENT
        // let addr = "slptest:qpwyc9jnwckntlpuslg7ncmhe2n423304ueqcyw80l";
        // const BITBOX = new BITBOXSDK.BITBOX({ restURL: 'https://trest.bitcoin.com/v2/' });
    
        const bitboxNetwork = new slpjs.BitboxNetwork(BITBOX);
    
    
        let balances;
        (async function () {
            balances = await bitboxNetwork.balances getAllSlpBalancesAndUtxos(addr);
            console.log("balances: ", balances);
        })();
   
   //sort code - doesn't work current, sorts by alphabet
        "r": {
    "f": "sort_by(.token_balance)" 
  }
        */

        var bitdbquery = `{
          "v": 3,
          "q": {
            "db": ["g"],
            "aggregate": [ 
                { "$match": {
                  "graphTxn.outputs": 
                    { "$elemMatch": {
                      "status": "UNSPENT", 
                      "slpAmount": { "$gte": 1 }
                    }
                  },
                  "tokenDetails.tokenIdHex": "766f9f56ac0a3f0e4c64cb3453d0c45336a20685827801b2188d237c2a6ffc43"
                }
              },
                { "$unwind": "$graphTxn.outputs" },
                { "$match": {
                    "graphTxn.outputs.status": "UNSPENT", 
                    "graphTxn.outputs.slpAmount": { "$gte": 1 },
                    "tokenDetails.tokenIdHex": "766f9f56ac0a3f0e4c64cb3453d0c45336a20685827801b2188d237c2a6ffc43"
                  }
                },
                { "$project": 
                { "token_balance": "$graphTxn.outputs.slpAmount",
                  "address": "$graphTxn.outputs.address",
                  "txid": "$graphTxn.txid", 
                  "vout": "$graphTxn.outputs.vout", 
                  "tokenId": "$tokenDetails.tokenIdHex" }},
              { "$group": { "_id": "$address", "token_balance": { "$sum": "$token_balance" }}}
            ],
            "limit": 1000
          }
        }`;

        //note the query above is just for reference, the api call is not automatically generated
        //https://slpdb.fountainhead.cash/explorer/
        var bitdbqueryaddress = tokenbalanceserver+`ewogICAgICAgICJ2IjogMywKICAgICAgICAicSI6IHsKICAgICAgICAgICJkYiI6IFsiZyJdLAogICAgICAgICAgImFnZ3JlZ2F0ZSI6IFsgCiAgICAgICAgICAgICAgeyAiJG1hdGNoIjogewogICAgICAgICAgICAgICAgImdyYXBoVHhuLm91dHB1dHMiOiAKICAgICAgICAgICAgICAgICAgeyAiJGVsZW1NYXRjaCI6IHsKICAgICAgICAgICAgICAgICAgICAic3RhdHVzIjogIlVOU1BFTlQiLCAKICAgICAgICAgICAgICAgICAgICAic2xwQW1vdW50IjogeyAiJGd0ZSI6IDEgfQogICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICB9LAogICAgICAgICAgICAgICAgInRva2VuRGV0YWlscy50b2tlbklkSGV4IjogIjc2NmY5ZjU2YWMwYTNmMGU0YzY0Y2IzNDUzZDBjNDUzMzZhMjA2ODU4Mjc4MDFiMjE4OGQyMzdjMmE2ZmZjNDMiCiAgICAgICAgICAgICAgfQogICAgICAgICAgICB9LAogICAgICAgICAgICAgIHsgIiR1bndpbmQiOiAiJGdyYXBoVHhuLm91dHB1dHMiIH0sCiAgICAgICAgICAgICAgeyAiJG1hdGNoIjogewogICAgICAgICAgICAgICAgICAiZ3JhcGhUeG4ub3V0cHV0cy5zdGF0dXMiOiAiVU5TUEVOVCIsIAogICAgICAgICAgICAgICAgICAiZ3JhcGhUeG4ub3V0cHV0cy5zbHBBbW91bnQiOiB7ICIkZ3RlIjogMSB9LAogICAgICAgICAgICAgICAgICAidG9rZW5EZXRhaWxzLnRva2VuSWRIZXgiOiAiNzY2ZjlmNTZhYzBhM2YwZTRjNjRjYjM0NTNkMGM0NTMzNmEyMDY4NTgyNzgwMWIyMTg4ZDIzN2MyYTZmZmM0MyIKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICB9LAogICAgICAgICAgICAgIHsgIiRwcm9qZWN0IjogCiAgICAgICAgICAgICAgeyAidG9rZW5fYmFsYW5jZSI6ICIkZ3JhcGhUeG4ub3V0cHV0cy5zbHBBbW91bnQiLAogICAgICAgICAgICAgICAgImFkZHJlc3MiOiAiJGdyYXBoVHhuLm91dHB1dHMuYWRkcmVzcyIsCiAgICAgICAgICAgICAgICAidHhpZCI6ICIkZ3JhcGhUeG4udHhpZCIsIAogICAgICAgICAgICAgICAgInZvdXQiOiAiJGdyYXBoVHhuLm91dHB1dHMudm91dCIsIAogICAgICAgICAgICAgICAgInRva2VuSWQiOiAiJHRva2VuRGV0YWlscy50b2tlbklkSGV4IiB9fSwKICAgICAgICAgICAgeyAiJGdyb3VwIjogeyAiX2lkIjogIiRhZGRyZXNzIiwgInRva2VuX2JhbGFuY2UiOiB7ICIkc3VtIjogIiR0b2tlbl9iYWxhbmNlIiB9fX0KICAgICAgICAgIF0sCiAgICAgICAgICAibGltaXQiOiAxMDAwCiAgICAgICAgfQogICAgICB9`;
        const { promisify } = require('util');
        const request = require("request");
        const requestPromise = promisify(require('request'));
        var txiddata = await requestPromise(bitdbqueryaddress);
        //var tx = bitcoinJs.Transaction.fromHex(txiddata.body.replace('"',''));
        var richlist = JSON.parse(txiddata.body);
        var byBalance = richlist.g;
        byBalance.sort(function (a, b) {
            return b.token_balance - a.token_balance;
        });
        //remove Member's own balances
        byBalance.splice(0, 1);
        console.log("Writing richlist "+byBalance.length);
        for (var i = 1; i < byBalance.length; i++) {
            var publicaddress = new BITBOXSDK.Address().toLegacyAddress(byBalance[i]._id);
            if(byBalance[i].token_balance>=100){
              await rlConnection.runQuery("insert into names VALUES (" + escapeFunction(publicaddress) + ",'','',0,'','','','','',0,''," + i + ",0,0,0,0) " + onConflictAddress + " tokens=" + i + ";");
            }
        }
    } catch (err) {
        console.log("Richlist update error:" + err);
    }

}

module.exports = balances;
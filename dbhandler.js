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

var dbhandler = {};
var util = require('util'); //for promisify

dbhandler.createPool = async function (dbtype, options) {
    if (dbtype == 'mysql') {
        var mysql = require('mysql');
        var pool = mysql.createPool(options);
        pool.runQuery = util.promisify(pool.query).bind(pool);
        pool.asyncgetConnection = util.promisify(pool.getConnection).bind(pool);  
    } else if (dbtype == 'sqlite') {
        //nb not really a pool
        var sqlite = require('sqlite-async');
        //Copy the schema if the db doesn't exist yet
        var fs = require('fs');
        if (!fs.existsSync(options.sqldbfile)) {
            await fs.createReadStream(options.schemafile).pipe(fs.createWriteStream(options.sqldbfile));
        }
        var pool = await sqlite.open(options.sqldbfile);
        pool.runQuery=pool.all;        
    }
    return pool;
}

dbhandler.getConnection = async function (dbtype, dbpool){
    if (dbtype == 'mysql') {
        var conn = await dbpool.asyncgetConnection();
        conn.runQuery = util.promisify(conn.query).bind(conn);
        return conn;
    } else if (dbtype = 'sqlite') {
        return dbpool;
    }
}
/*
dbhandler.runQuery = async function (dbtype, pool, sql) {
    if (dbtype == 'mysql') {
        return await pool.runQuery(sql);
    } else if (dbtype == 'sqlite') {
        return await pool.runQuery(sql);
    }
}*/


module.exports = dbhandler;
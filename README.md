# Member
Member is a fully decentralized Reddit/Twitter style public platform for discussion. It uses the Memo protocol and the Bitcoin Cash blockchain. You can see an interface to it running here - https://member.cash/

# Member Server
This is the server component of Member. Run it against your Bitcoin Cash Node to process Memo transactions into a database. It supports MySQL* and SQLite databases. It also starts a http/s server to respond to requests from the Member client.

# Getting Started

You can run Member Server using node - 

Using Node

1. Edit the config.js file to include your BCH node user/pass 
2. Install dependencies (if necessary) 'npm install bitcoind-rpc bitcoinjs-lib mysql sqlite-async grpc @grpc/proto-loader'
3. Run 'node index.js'
4. Wait for it to get up to date 
5. Open release/index.html in your browser

Using Binaries

Refer to the binary releases here
https://github.com/memberapp/server-release


Member Server will use SQLite by default and this is the recommended database for personal use.

It has been tested against Bitcoin Unlimited / BCHD - let me know how you get on with other node software.

If you're running BCHD with an index server, you can also use Member as your utxo server (getting utxos for your address)
Edit the config file to switch this on, and edit release/js/config.js to update the 'utxoserver' setting for the client.

*If you're using the MySQL server, you must switch off the ONLY_FULL_GROUP_BY option in the config
Here's one potential config option
sql-mode="STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION"

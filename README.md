# Member
Member is a fully decentralized Reddit style public platform for discussion. It uses the Memo protocol and the BCH blockchain. You can see an interface to it running here - https://memberapp.github.io/

# Member Server
This is the server component of Member. Run it against your Bitcoin Cash Node to process Memo transactions into a database. It supports MySQL and SQLite databases. It also starts a http/s server to respond to requests from the Member client.

# Getting Started

You can run Member Server using the compiled binaries or using node - 

Using Binaries
1. Edit the release/config.js file to include your BCH node user/pass 
2. Start the binary for your OS in release folder (win, mac, linux 64bit supplied)
3. Wait for it to get up to date 
4. Open release/index.html in your browser

Using Node
1. Edit the config.js file to include your BCH node user/pass 
2. Run 'node index.js'
3. Wait for it to get up to date 
4. Open release/index.html in your browser


Member Server will use SQLite by default and this is the recommended database to use.

I've tested against Bitcoin Unlimited / BCHD - let me know how you get on with other node software.

If you're running BCHD with an index server, you can also use Member as your utxo server (getting utxos for your address)
Edit the config file to switch this on, and edit release/js/config.js to update the 'utxoserver' setting for the client.


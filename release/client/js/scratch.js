//Direct call to bchd grpc
      /*if (trxserver == "bchdgrpc") {
        let address = new Address();

      
        try {

          var client = new bchrpcClient('https://bchd.greyh.at:8335');

          var request = new proto.pb.GetAddressUnspentOutputsRequest();

          const Address2 = bch.Address;
          let thePublicKeyQFormat = new Address2(thePublicKey).toString(bch.Address.CashAddrFormat);
          //let thePublicKeyQFormat = theAddr.toCashAddress();

          request.setAddress(thePublicKeyQFormat);
          request.setIncludeMempool(true);

          var theResponse = null;
          theResponse = await client.getAddressUnspentOutputs(request);
          //theResponse=await theResponse.response;
          //await client.getAddressUnspentOutputs(request, {}, (err, response) => {
          //  console.log(response);
          //  theResponse=response;
          //  return response;
          //});

          let outputInfo = theResponse;
        } catch (error) {
          callback(error, null, this);
          return;
        }
      } else {*/
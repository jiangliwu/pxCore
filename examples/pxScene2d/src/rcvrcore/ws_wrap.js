'use strict';
var isDuk = typeof timers !== "undefined";
var WS = null;
if (isDuk) {  // duktape
  WS = require('ws');
} else {  // node
  WS = require('ws/lib/WebSocket');
  WS.Sender = require('ws/lib/Sender');
  WS.Receiver = require('ws/lib/Receiver');
  WS.connect = WS.createConnection = function connect(address, fn) {
    var client = new WS(address);
    if (typeof fn === 'function') {
      client.on('open', fn);
    }
    return client;
  };
}

module.exports = WS;

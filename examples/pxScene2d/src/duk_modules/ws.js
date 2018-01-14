"use strict";
/**
 * WebSocket module
 *
 * References:
 * Writing web socket servers: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers
 * RFC6455 - The WebSocket Protocol - https://datatracker.ietf.org/doc/rfc6455/
 *
 * Here is an example of a web socket initiation request from a client:
 *
 * -----------
 *
 * GET /chat HTTP/1.1
 * Host: example.com:8000
 * Upgrade: websocket
 * Connection: Upgrade
 * Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
 * Sec-WebSocket-Version: 13
 *
 * -----------
 *
 * A response will be:
 *
 * -----------
 *
 * HTTP/1.1 101 Switching Protocols
 * Upgrade: websocket
 * Connection: Upgrade
 * Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
 *
 * -----------
 *
 */

/**
 Frame format:
 ​​
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 +-+-+-+-+-------+-+-------------+-------------------------------+
 |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
 |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
 |N|V|V|V|       |S|             |   (if payload len==126/127)   |
 | |1|2|3|       |K|             |                               |
 +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
 |     Extended payload length continued, if payload len == 127  |
 + - - - - - - - - - - - - - - - +-------------------------------+
 |                               |Masking-key, if MASK set to 1  |
 +-------------------------------+-------------------------------+
 | Masking-key (continued)       |          Payload Data         |
 +-------------------------------- - - - - - - - - - - - - - - - +
 :                     Payload Data continued ...                :
 + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
 |                     Payload Data continued ...                |
 +---------------------------------------------------------------+
 
 [0] - FIN 7
 - RSV1 6
 - RSV2 5
 - RSV4 4
 - Opcode 3:0
 [1] - Mask 8
 payloadLen 7:0 < 126
 [2] - Mask
 [3] - Mask
 [4] - Mask
 [5] - Mask
 [6] - Payload data
 
 or
 
 [0] - FIN 7
 - RSV1 6
 - RSV2 5
 - RSV4 4
 - Opcode 3:0
 [1] - Mask 8
 payloadLen 7:0 = 126
 [2] - payloadLen
 [3] - payloadLen
 [4] - Mask
 [5] - Mask
 [6] - Mask
 [7] - Mask
 [8] - Payload data
 
 or
 
 [0] - FIN 7
 - RSV1 6
 - RSV2 5
 - RSV4 4
 - Opcode 3:0
 [1] - Mask 8
 payloadLen 7:0 = 127
 [2] - payloadLen
 [3] - payloadLen
 [4] - payloadLen
 [5] - payloadLen
 [6] - payloadLen
 [7] - payloadLen
 [8] - payloadLen
 [9] - payloadLen
 [10] - Mask
 [11] - Mask
 [12] - Mask
 [13] - Mask
 [14] - Payload data
 */


var http = require('http');
var url = require('url');
var dukluv = require('dukluv');
var Tcp = dukluv.Tcp;
/**
 * These are the possible WebSocket operation codes as documented in the WebSocket
 * protocol specification.
 */
var OPCODE = {
  CONTINUATION: 0x0,
  TEXT_FRAME: 0x1,
  BINARY_FRAME: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xA
};

var ERROR_CODE = {
  NORMAL: 1000,
  HANDSHAKE_FAILED: 1010,
}

var READY_STATUS = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
};

/**
 * the websocket client
 * @param wsurl the ws url , like wss://echo.websocket.org
 * @param options the options
 * {
 * timeout: seconds  //default 15 seconds
 * }
 * @constructor
 */
function Client(wsurl, options) {
  var parseRet = url.parse(wsurl);
  options = options || {};
  if (parseRet.protocol !== 'ws:' && parseRet.protocol !== 'wss:') {
    console.error('webscoket protocol must be ws or wss');
  }
  var host = parseRet.hostname;
  var isSecurity = parseRet.protocol.indexOf('wss') >= 0;
  var port = parseRet.port || (isSecurity ? 443 : 80);
  var timeoutInSeconds = options.timeout || 15;
  var that = this;
  
  Tcp.call(this, isSecurity);
  this.parseRet = parseRet;
  this.handleShaked = false;
  this.host = host;
  this.port = parseInt(port, 10);
  var key = '';
  for (var i = 0; i < 16; i++) {
    key += Math.floor(Math.random() * 16).toString(16);
  }
  this.wbKey = Duktape.enc('base64', key);
  this.readyState = READY_STATUS.CONNECTING;
  this.connect(this.host, this.port, this.onConnect);
  this.connectTimeoutHander = setTimeout(function () {
    that.onError({ code: ERROR_CODE.NORMAL, message: 'connection timeout' });
    this.close();
  }, timeoutInSeconds * 1000);
}

Client.prototype.__proto__ = Tcp.prototype;
/**
 * when socket connecttion created with sserver
 * @param err some err happend
 */
Client.prototype.onConnect = function onConnect(err) {
  if (err) {
    this.clearTimeout();
    this.onError({ code: ERROR_CODE.NORMAL, message: err.toString() });
    this.close();
    return;
  }
  this.readStart(this.onRead);
  var handlerShakeData = 'GET ' + (this.parseRet.path || '/') + ' HTTP/1.1\r\nConnection: Upgrade\r\n';
  handlerShakeData += 'Host: ' + this.host + ':' + this.port + '\r\n';
  handlerShakeData += 'Sec-WebSocket-Key: ' + this.wbKey + '\r\nSec-WebSocket-Version: 13\r\nUpgrade: websocket\r\n\r\n';
  this.write(handlerShakeData, this.onWrite);
};

/**
 * copy buffer by range and return new buffer
 * @param originBuffer the old buffer
 * @param start the old buffer start pos
 * @param end the old buffer end pos
 * @return {Uint8Array} the new buffer
 * @private
 */
Client.prototype._copyBuffer = function (originBuffer, start, end) {
  var s = start || 0;
  var e = end || originBuffer.length;
  var newBuffer = new Uint8Array(e - s);
  for (var i = s; i < e; i += 1) {
    newBuffer[ i - s ] = originBuffer[ i ];
  }
  return newBuffer
}

/**
 * Build a WebSocket frame from the payload
 * @param options Options controlling the construction of the frame.  These include:
 * * payload - The data to be transmitted.  May be null or omitted.
 * * mask - A boolean, if true then we wish to mask data.
 * * close - A boolean, if true, then we wish to close the connection.
 * @returns Uint8Array frame to transmit.
 */
Client.prototype.constructFrame = function (options) {
  var payloadLen;
  var payload;
  if (options.hasOwnProperty("payload")) {
    // If the payload we wish to send is a string, convert it to a Buffer.
    if (typeof options.payload === "string") {
      payload = new Uint8Array(new Buffer(options.payload));
    } else {
      payload = options.payload;
    }
    payloadLen = payload.length;
  } else {
    payloadLen = 0;
  }
  // Calculate the size of the frame.
  var frameSize = 2 + payloadLen;
  if (options.mask) {
    frameSize += 4;
  }
  if (payloadLen >= 126) {
    frameSize += 2;
  }
  
  // We now know the frame size, allocate a buffer that is big enough.
  var frame = Uint8Array.allocPlain(frameSize); // Allocate the buffer for the final frame.
  var i = 0;   // Let us now populate the frame.
  if (options.close) {
    frame[ i ] = 0x80 | OPCODE.CLOSE; // FIN + CLOSE
  } else {
    frame[ i ] = 0x80 | OPCODE.TEXT_FRAME; // FIN + TEXT
  }
  i++; // fin + opcode done
  
  if (payloadLen < 126) {
    frame[ i ] = 0x00 | payloadLen; // No mask
    i++;
  }
  else {
    frame[ i ] = 0x0 | 126; // No mask
    i++;
    frame[ i ] = (payloadLen & 0xff00) >> 8;
    i++;
    frame[ i ] = (payloadLen & 0xff);
    i++;
  }
  
  // Here we do mask processing to mask the data (if requested)
  if (payloadLen > 0) {
    if (options.mask) {
      var maskValue = new Uint8Array(4);
      for (var j = 0; j < 4; j++) {
        maskValue[ j ] = Math.floor(Math.random() * 256);
      }
      frame.set(maskValue, i); // set mask
      i += 4;
      frame.set(payload, i); // set payload
      for (j = 0; j < payloadLen; j++) { // do mask
        frame[ i ] = frame[ i ] ^ maskValue[ j % 4 ];
        i++;
      }
    } else {
      frame.set(payload, i);
    }
  }
  return frame;
}

/**
 * parse websocket Frame
 * @param data the data from backend
 * @return {{payload: Buffer, opcode: number}}
 */
Client.prototype.parseFrame = function (data) {
  var fin = (data[ 0 ] & 0x80) >> 7; // 1000 0000
  var opCode = (data[ 0 ] & 0x0f);
  var mask = (data[ 1 ] & 0x80) >> 7;
  var payloadLen = (data[ 1 ] & 0x7f); // 0b0111 1111
  var maskStart = 2;
  
  if (payloadLen === 126) {
    
    payloadLen = (data[ 2 ] * 1 << 8) + data[ 3 ];
    maskStart = 4;
  } else if (payloadLen === 127) {
    payloadLen = (data[ 2 ] * 1 << 56) + (data[ 3 ] * 1 << 48) + (data[ 4 ] * 1 << 40)
      + (data[ 5 ] * 1 << 32) + (data[ 6 ] * 1 << 24) + (data[ 7 ] * 1 << 16) + (data[ 8 ] * 1 << 8) + data[ 9 ];
    maskStart = 10;
  }
  var maskValue;
  var payloadStart;
  if (mask === 1) {
    maskValue = this._copyBuffer(data, maskStart, maskStart + 4);
    payloadStart = maskStart + 4;
  } else {
    payloadStart = maskStart;
  }
  // The payload now starts at payloadStart ... we are ready to start working on it.
  // Copy the frame data into the final payloadData buffer.  We may have to unmask the data.
  var payloadData = this._copyBuffer(data, payloadStart, payloadStart + payloadLen);
  if (mask === 1) {
    for (var i = 0; i < payloadLen; i++) {
      payloadData[ i ] = payloadData[ i ] ^ maskValue[ i % 4 ]; // Perform an XOR to unmask
    }
  }
  console.log("WS Receive Frame: fin=" + fin + ", opCode=" + opCode + ", mask=" + mask + ", payloadLen=" + payloadLen);
  return {
    payload: payloadData,
    opcode: opCode
  };
};

/**
 * check reponse header to make sure webscoket created
 * @param data the response data
 * @private
 */
Client.prototype._doHandlerShake = function (data) {
  var endR = 13, endN = 10, offset = 0, upgrade = false, connection = false;
  var totalLength = data.length;
  var headLine = '';
  for (var i = 0; i < totalLength - 1; i += 1) {
    if (data[ i ] === endR && data[ i + 1 ] === endN) {
      if (headLine.length === 0) { // that mean here is \r\n\r\n , http header should end
        offset = i + 2;
        break;
      } else {
        headLine = headLine.toLowerCase();
        if (headLine.indexOf('http/1.1') >= 0 && headLine.indexOf('101') < 0) {
          return { code: ERROR_CODE.HANDSHAKE_FAILED, message: 'websocket handshake failed, ' + headLine };
        }
        if (headLine.indexOf('upgrade') >= 0 && headLine.indexOf('websocket') >= 0) {
          upgrade = true;
        }
        if (headLine.indexOf('connection') >= 0 && headLine.indexOf('upgrade') >= 0) {
          connection = true;
        }
        headLine = '';
        i += 1;
      }
    } else {
      headLine += String.fromCharCode(data[ i ]);
    }
  }
  if (!upgrade) {
    return { code: ERROR_CODE.HANDSHAKE_FAILED, message: 'websocket handshake failed, upgrade error.' };
  }
  if (!connection) {
    return { code: ERROR_CODE.HANDSHAKE_FAILED, message: 'websocket handshake failed, connection error.' };
  }
  this.handleShaked = true;
  if (offset < totalLength) {  // process left buffer
    var leftBuffer = new Uint8Array(totalLength - offset);
    for (var i = offset; i < totalLength; i += 1) {
      leftBuffer[ i - offset ] = data[ i ];
    }
    this.onMessage(leftBuffer);
  }
};

/**
 * got a message from backend
 * @param data the fram data {opcode:1,payload:Uint8Array}
 */
Client.prototype.onMessage = function (data) {
  var frame = this.parseFrame(data);
  switch (frame.opcode) {
    case OPCODE.BINARY_FRAME:
    case OPCODE.TEXT_FRAME: {
      var msg = frame.payload;
      if (frame.opcode === OPCODE.TEXT_FRAME) {
        msg = Buffer(msg).toString();
      }
      this.emit('message', msg);
      if (this.onmessage) {
        this.onmessage(msg);
      }
      break;
    }
    case OPCODE.CLOSE: {
      this.close();
      break;
    }
  }
};

Client.prototype.clearTimeout = function() {
  if (!this.connectTimeoutHander) return;
  clearTimeout(this.connectTimeoutHander);
  this.connectTimeoutHander = null;
}

/**
 * the tcp read callback
 * @param err the err
 * @param data the read data(Uint8Array)
 */
Client.prototype.onRead = function onRead(err, data) {
  if (err) {  // directly close
    this.onError({ code: ERROR_CODE.NORMAL, message: err.toString() });
    this.close();
    this.clearTimeout();
    return;
  }
  
  if (!data) {  // EOF close
    this.onError({ code: ERROR_CODE.NORMAL, message: 'connection close because of read EOF' });
    this.close();
    this.clearTimeout();
    return;
  }
  
  if (!this.handleShaked) {
    this.clearTimeout();
    var shakeErr = this._doHandlerShake(data);
    if (shakeErr) {  // hand shake failed , should close connection
      console.error(Buffer(data).toString());
      this.onError(shakeErr);
      this.close();
    } else { // hand shake succeed
      if (this.readyState !== READY_STATUS.CONNECTING) { // already closed
        this.close();
      } else {
        this.readyState = READY_STATUS.OPEN;
        this.emit('open');
        if (this.onopen) {
          this.onopen();
        }
      }
    }
  } else {
    this.onMessage(data);
  }
};

/**
 * create frame and write to server
 * @param msg the msg entity
 * @private
 */
Client.prototype._sendMessage = function (msg) {
  var frame = this.constructFrame({ payload: msg });
  this.write(frame, this.onWrite);
};

/**
 * public method to send msg to server
 * @param msg
 */
Client.prototype.send = function (msg) {
  if (this.readyState === READY_STATUS.OPEN) {
    this._sendMessage(msg);
  } else {
    console.error('cannot send msg that readyState != OPEN');
  }
};

/**
 * raise an error to callback
 * @param err the err object
 */
Client.prototype.onError = function (err) {
  this.emit('error', err);
  if (this.onerror) {
    this.onerror(err);
  }
};

/**
 * close tcp socket
 */
Client.prototype.close = function () {
  if (this.readyState === READY_STATUS.OPEN) { // only emit event when opened
    this.readyState = READY_STATUS.CLOSING;
    this.emit('close');
    if (this.onclose) {
      this.onclose();
    }
  }
  var that = this;
  this.shutdown();
  this.readStop();
  this.socketClose(function () {
    that.readyState = READY_STATUS.CLOSED;
  })
};

/**
 * tcp write callback
 * @param err the err when write data to server
 */
Client.prototype.onWrite = function onWrite(err) {
  if (err) { // write error close
    this.clearTimeout();
    this.onError({ code: ERROR_CODE.NORMAL, message: err.toString() });
    this.close();
  }
};

exports.WebSocket = Client;

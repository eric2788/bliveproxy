// ==UserScript==
// @name         bliveproxy
// @version      0.1
// @description  B站直播websocket hook框架
// @author       xfgryujk
// ==/UserScript==

const HEADER_SIZE = 16

  const WS_BODY_PROTOCOL_VERSION_INFLATE = 0
  const WS_BODY_PROTOCOL_VERSION_NORMAL = 1
  const WS_BODY_PROTOCOL_VERSION_DEFLATE = 2

  const OP_HEARTBEAT_REPLY = 3
  const OP_SEND_MSG_REPLY = 5

  let textEncoder = new TextEncoder()
  let textDecoder = new TextDecoder()

  function main() {
    if (window.bliveproxyLaunched) {
      // 防止多次加载
      return
    }
    initApi()
    hook()
  }

  function initApi() {
    window.bliveproxyLaunched = true
  }

  function hook() {
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(target, args) {
        let obj = new target(...args)
        return new Proxy(obj, proxyHandler)
      }
    })
  }

  let proxyHandler = {
    get(target, property) {
      let value = target[property]
      if ((typeof value) === 'function') {
        value = value.bind(target)
      }
      return value
    },
    set(target, property, value) {
      if (property === 'onmessage') {
        let realOnMessage = value
        value = function(event) {
          myOnMessage(event, realOnMessage)
        }
      }
      target[property] = value
      return value
    }
  }

  function myOnMessage(event, realOnMessage) {
    if (!(event.data instanceof ArrayBuffer)) {
      realOnMessage(event)
      return
    }

    let data = new Uint8Array(event.data)
    function callRealOnMessageByPacket(packet) {
      realOnMessage({...event, data: packet})
    }
    handleMessage(data, callRealOnMessageByPacket)
  }

  function makePacketFromCommand(command) {
    let body = textEncoder.encode(JSON.stringify(command))
    return makePacketFromUint8Array(body, OP_SEND_MSG_REPLY)
  }

  function makePacketFromUint8Array(body, operation) {
    let packLen = HEADER_SIZE + body.byteLength
    let packet = new ArrayBuffer(packLen)

    // 不需要DEFLATE
    let ver = operation === OP_HEARTBEAT_REPLY ? WS_BODY_PROTOCOL_VERSION_INFLATE : WS_BODY_PROTOCOL_VERSION_NORMAL
    let packetView = new DataView(packet)
    packetView.setUint32(0, packLen)        // pack_len
    packetView.setUint16(4, HEADER_SIZE)    // raw_header_size
    packetView.setUint16(6, ver)            // ver
    packetView.setUint32(8, operation)      // operation
    packetView.setUint32(12, 1)             // seq_id

    let packetBody = new Uint8Array(packet, HEADER_SIZE, body.byteLength)
    for (let i = 0; i < body.byteLength; i++) {
      packetBody[i] = body[i]
    }
    return packet
  }

  function handleMessage(data, callRealOnMessageByPacket) {
    let offset = 0
    while (offset < data.byteLength) {
      let dataView = new DataView(data.buffer, offset)
      let packLen = dataView.getUint32(0)
      // let rawHeaderSize = dataView.getUint16(4)
      let ver = dataView.getUint16(6)
      let operation = dataView.getUint32(8)
      // let seqId = dataView.getUint32(12)

      let body = new Uint8Array(data.buffer, offset + HEADER_SIZE, packLen - HEADER_SIZE)
      if (operation === OP_SEND_MSG_REPLY) {
        if (ver == WS_BODY_PROTOCOL_VERSION_DEFLATE) {
          body = pako.inflate(body)
          handleMessage(body, callRealOnMessageByPacket)
        } else {
          body = JSON.parse(textDecoder.decode(body))
          handleCommand(body, callRealOnMessageByPacket)
        }
      } else {
        let packet = makePacketFromUint8Array(body, operation)
        callRealOnMessageByPacket(packet)
      }

      offset += packLen
    }
  }

  function handleCommand(command, callRealOnMessageByPacket) {
    if (command instanceof Array) {
      for (let oneCommand of command) {
        this.handleCommand(oneCommand)
      }
      return
    }

    let cmd = command.cmd || ''
    let pos = cmd.indexOf(':')
    if (pos != -1) {
      cmd = cmd.substr(0, pos)
    }
    
    console.log('have msg')
    console.log(unsafeWindow)
    
    const event = new CustomEvent('bliveproxy:handle', {
          detail: { cmd, command }
    })

    document.dispatchEvent(event)

    let packet = makePacketFromCommand(command)
    callRealOnMessageByPacket(packet)
  }

  main()

export default class Server {

  constructor(d){
    this.url = "";
    this.owner = d.owner || "";
    this.ECDSAPair = {
      publicKey: '',
      privateKey: ''
    }
    this.online = {};
    this.dimensions = {};
    this.sockets = {};
    this.connected = {};
    this.keysBeingSaved = {};
    this.s3 = null;
    this.port = d.port || process.env.PORT || 80;
  }

  str2ab(str) {
    var buf = new ArrayBuffer(str.length*2);
    var bufView = new Uint16Array(buf);
    for (var i=0, strLen=str.length; i < strLen; i++) {
      bufView[i] = str.charCodeAt(i);
    }
    return buf;
  };

  



}
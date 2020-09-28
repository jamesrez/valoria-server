const express= require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const serverIo = require('socket.io-client');
const bodyParser = require('body-parser');
const { Crypto } = require("@peculiar/webcrypto");
const os = require( 'os' );
const crypto = new Crypto();
const NodeCrypto = require('crypto');
const util = require('util');
const stun = require('stun');
const { uuid } = require('uuidv4');
require('dotenv').config();
const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID || "AClol", process.env.TWILIO_AUTH_TOKEN || "lol");
app.set('views', 'client')
app.set('view engine', 'pug');
app.use(express.json())
app.use(express.static('client'));

const servers = require('./servers.js');
const sockets = {};
const connected = {
  to: {},
  from: {}
};

const port = process.env.PORT || 80;

const fs = require('fs');
const AWS = require('aws-sdk');
let s3 = null;
let data = {
  online: {},
  dimensions: {},
};

const keysBeingSaved = {};

let iceServers = [{ url: "stun:stun.l.google.com:19302" }];

let thisUrl = '';
let ECDSAPair = {
  publicKey: '',
  privateKey: ''
};


// //MEDIA SOUP STUFF 
// (async function(){
//   var serverOptions = {
//     rtcMinPort: 20000,
//     rtcMaxPort: 29999
//   };
//   const res = await stun.request('stun.l.google.com:19302');
//   var pubIp = res.getXorAddress().address;
//   if(pubIp) {
//     serverOptions.rtcAnnouncedIPv4 = pubIp;
//     webRtcTransportConfig = {
//       maxIncomingBitrate: 1500000,
//       initialAvailableOutgoingBitrate: 1000000,
//     }
//   }
//   const worker = await mediasoup.createWorker(serverOptions);
  
//   worker.on("died", () => {
//     console.log("mediasoup Worker died, exit..");
//     process.exit(1);
//   });
  
//   mediasoupRouter = await worker.createRouter({
//     mediaCodecs: [
//       {
//         kind: "audio",
//         name: "opus",
//         mimeType: "audio/opus",
//         clockRate: 48000,
//         channels: 2
//       },
//       {
//         kind: "video",
//         name: "VP8",
//         mimeType: "video/VP8",
//         clockRate: 90000
//       },
//       // {
//       //   kind: "video",
//       //   name: "H264",
//       //   mimeType: "video/H264",
//       //   clockRate: 90000
//       // }
//     ]
//   });
// })()

(async function(){
   //MUST LOAD THE SERVER KEYPAIR
  try {
    const pubEcdsaJwk = require("./keystorage/pubECDSA-384.json");
    const prvEcdsaJwk = require('./keystorage/prvECDSA-384.json');
    const pubEcdsaKey = await crypto.subtle.importKey(
      'jwk',
      pubEcdsaJwk,
      {
        name: 'ECDSA',
        namedCurve: 'P-384'
      },
      true,
      ['verify']
    )
    const prvEcdsaKey = await crypto.subtle.importKey(
      'jwk',
      prvEcdsaJwk,
      {
        name: 'ECDSA',
        namedCurve: 'P-384'
      },
      true,
      ['sign']
    )
    ECDSAPair.publicKey = pubEcdsaKey;
    ECDSAPair.privateKey = prvEcdsaKey;
  }
  //MUST CREATE NEW SERVER KEYPAIR
  catch {
    const ecdsaPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-384'
      },
      true,
      ['sign', 'verify']
    );
    ECDSAPair.publicKey = ecdsaPair.publicKey;
    ECDSAPair.privateKey = ecdsaPair.privateKey;
    const pubKeyJwk = await crypto.subtle.exportKey('jwk', ecdsaPair.publicKey)
    const prvKeyJwk = await crypto.subtle.exportKey('jwk', ecdsaPair.privateKey)
    fs.mkdirSync('./keystorage/', {recursive : true});
    fs.writeFileSync('keystorage/pubECDSA-384.json', JSON.stringify(pubKeyJwk, null, 2), {flag: 'a'});
    fs.writeFileSync('keystorage/prvECDSA-384.json', JSON.stringify(prvKeyJwk, null, 2), {flag: 'a'});
  }
  if(!process.env.AWS_ACCESS_KEY_ID){
    try {
      let savedServers = fs.readFileSync('./data/servers.json', 'utf8');
      if(savedServers) Object.assign(servers, JSON.parse(savedServers));
    } catch {
      fs.mkdirSync('./data/', {recursive : true});
      fs.writeFileSync('data/servers.json', servers, {flag: 'a'});
    }
    data.online = {};
    if(process.env.TWILIO_ACCOUNT_SID){
      const token = await twilioClient.tokens.create();
      iceServers = token.iceServers;
    }
    startServer();
  } else {
    AWS.config.update({region: 'us-west-1'});
    s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });
    s3.getObject({Bucket : process.env.AWS_S3_BUCKET, Key : "servers.json"}, async function(err, savedServers) {
      if(!err && savedServers && savedServers.Body ) {
        savedServers= JSON.parse(savedServers.Body.toString());
        Object.assign(servers, savedServers);
        if(process.env.TWILIO_ACCOUNT_SID){
          const token = await twilioClient.tokens.create();
          iceServers = token.iceServers;
        }
      }
      startServer();
    });
  }
}());

// function saveData(data, cb) {
//   if(!process.env.AWS_ACCESS_KEY_ID){
//     fs.writeFile('./data/server.json', JSON.stringify(data, null, 2), function (err) {
//       if (err) return console.log(err);
//       if(cb && typeof cb == 'function') cb();
//     });
//   }else {
//     s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : "server.json", Body : JSON.stringify(data, null, 2)}, (err, fileData) => {
//       if (err) console.error(`Upload Error ${err}`);
//       if(cb && typeof cb == 'function') cb();
//     });
//   }
// }

if (process.env.NODE_ENV === "production") {
	/*
	 * Redirect user to https if requested on http
	 *
	 * Refer this for explaination:
	 * https://www.tonyerwin.com/2014/09/redirecting-http-to-https-with-nodejs.html
	 */
	app.enable("trust proxy");
	app.use((req, res, next) => {
		// console.log('secure check');
		if (req.secure) {
			// console.log('secure');
			// request was via https, so do no special handling
			next();
		} else {
			//
			// request was via http, so redirect to https
			res.redirect(`https://${req.headers.host}${req.url}`);
		}
	});
}


function base64ToArrayBuffer(dataUrl, cb) {  
  return Uint8Array.from(atob(dataUrl), c => c.charCodeAt(0))
}

function ab2str(buf) {
  return String.fromCharCode.apply(null, new Uint16Array(buf));
}

function str2ab(str) {
  var buf = new ArrayBuffer(str.length*2); // 2 bytes for each char
  var bufView = new Uint16Array(buf);
  for (var i=0, strLen=str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

function startServer(){

  server.listen(port, () => {
    console.log("Listening on Port " + port);
  });

  if(process.env.AWS_ACCESS_KEY_ID){
    //Ask a random server to get all the servers. 
    const randServer = serverIo.connect(Object.keys(servers)[Math.floor(Math.random() * Object.keys(servers).length)]);
    randServer.emit("Get all Servers");
    randServer.on("Get all Servers", (s) => {
      Object.keys(s).forEach((serverUrl) => {
        servers[serverUrl] = serverUrl;
      })
      if(!process.env.AWS_ACCESS_KEY_ID){
        fs.writeFile('./data/servers.json', JSON.stringify(servers, null, 2), function (err) {
          if (err) return console.log(err);
        });
      }else {
        console.log("WE GOT TO SAVING THE SERVERS");
        s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : "servers.json", Body : JSON.stringify(servers, null, 2)}, (err, fileData) => {
          if (err) console.error(`Upload Error ${err}`);
        });
      }
    })
  }

  app.get('/', async (req, res) => {
    thisUrl = "https://" + req.headers.host + "/";

    async function connectToServer(url){
      const pubKeyJwk = await crypto.subtle.exportKey('jwk', ECDSAPair.publicKey)
      sockets[url] = serverIo.connect(url);
      sockets[url].emit("Connecting to Server", {url: thisUrl, publicKey: pubKeyJwk, connectedServers: connected.to});
      sockets[url].on("Connected to Server", (d) => {
        servers[url] = {};
        connected.to[url] = {
          backup: null
        };
        if(Object.keys(connected.to).length < 10 && d.nextServer && !connected.to[d.nextServer]){
          connectToServer(d.nextServer);
        }
      });
      sockets[url].on("Failed Connection to Server", () => {
        sockets[url].close();
        console.log("Dropping ", url);
        delete connected.to[url];
        delete sockets[url];
      });
    }
    if(Object.keys(connected.to).length < 10){
      console.log("NEED A RANDOM SERVER");
      const serversClone = Object.assign({}, servers);
      delete serversClone[thisUrl];
      const randServerUrl = Object.keys(serversClone)[Math.floor(Math.random() * Object.keys(serversClone).length)];
      connectToServer(randServerUrl)
    }
    console.log("SERVER IS CURRENTLY CONNECTED TO");
    console.log(connected.to)

    if(!servers[thisUrl]){
      servers[thisUrl] = {
        url: thisUrl,
        publicKey : pubKeyJwk
      }
      if(!process.env.AWS_ACCESS_KEY_ID){
        fs.writeFile('./data/servers.json', JSON.stringify(servers, null, 2), function (err) {
          if (err) return console.log(err);
        });
        fs.writeFile('./data/connected.json', JSON.stringify(connected, null, 2), function (err) {
          if (err) return console.log(err);
        });
      }else {
        s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : "servers.json", Body : JSON.stringify(servers, null, 2)}, (err, fileData) => {
          if (err) console.error(`Upload Error ${err}`);
        });
        s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : "connected.json", Body : JSON.stringify(connected, null, 2)}, (err, fileData) => {
          if (err) console.error(`Upload Error ${err}`);
        });
      }
    }
    res.render('index.pug');
  });

  io.on('connection', function (socket) {

    const sign = async (str) => {
      return new Promise(async (resolve) => {
        const abStr = str2ab(str);
        const sig = await crypto.subtle.sign(
          {
            name: 'ECDSA',
            hash: 'SHA-384'
          },
          ECDSAPair.privateKey,
          abStr,
        )
        resolve(sig);
      });
    }

    const verify = async (sig, msg, pubKey) => {
      return new Promise(async (resolve) => {
        const sigAb = str2ab(sig);
        const msgAb = str2ab(msg);
        const isValid = await crypto.subtle.verify(
          {
            name: 'ECDSA',
            hash: 'SHA-384'
          },
          pubKey,
          sigAb,
          msgAb
        )
        resolve(isValid);
      });
    }


    const setupAuthSession = async (user, socket) => {
      if(!user || !socket) return;
      //IMPORT PUBLIC KEY OF USER
      const publicKey = await crypto.subtle.importKey(
        "jwk", 
        JSON.parse(user.ecdsaPair.publicKey), {
        name: "ECDSA",
        namedCurve: "P-384"
      }, true, ['verify']);
      //GENERATE RANDOM KEYCODE 
      NodeCrypto.randomBytes(256, async (err, buf) => {
        const authKey = buf.toString('hex');
        const serverKeySig = await sign(authKey);
        const authData = {
          key: authKey,
          status: 'Awaiting Signature',
          serverSig: serverKeySig
        }
        if(!process.env.AWS_ACCESS_KEY_ID){
          fs.writeFile(`./data/auth-keys.${user.id}.json`, JSON.stringify(authData, null, 2), function (err) {
            if (err) return console.log(err);
            socket.emit("Join with Credentials", {authKey, user})
          });
        } else {
          s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `auth-keys.${user.id}.json`, Body : JSON.stringify(authData, null, 2)}, (err, fileData) => {
            if (err) console.error(`Upload Error ${err}`);
            socket.emit("Join with Credentials", {authKey, user})
          });
        }
      });
    }

    const getAuthKeyByUserId = async (userId, cb) => {
      if(!userId || !cb) return
      if(!process.env.AWS_ACCESS_KEY_ID){
        try {
         authData = require(`./data/auth-keys.${userId}.json`);
         if(authData) {
          cb(authData);
         }else {
           return
         }
        } catch {
          return
        }
      } else {
        s3.getObject({Bucket : process.env.AWS_S3_BUCKET, Key : `auth-keys.${userId}.json`}, function(err, authData) {
          if(authData && authData.Body){
            authData = JSON.parse(authData.Body.toString());
            cb(authData);
          }else{
            return
          }
        })
      }
    }

    const getUsersByUsername = async (username, cb) => {
      if (!process.env.AWS_ACCESS_KEY_ID){
        try {
         users = require(`./data/username-${username}.json`);
         if(users) {
          cb(users);
         }
        } catch {
          cb(null);
        }
      } else {
        s3.getObject({Bucket : process.env.AWS_S3_BUCKET, Key : `username-${username}.json`}, function(err, users) {
          if(err) console.log("S3 Err: ", err);
          if(users && users.Body){
            users = JSON.parse(users.Body.toString());
            cb(users)
          }else {
            cb(null)
          }
        })
      }
    }

    socket.on('Join with Credentials', (d) => {
      let user;
      const dimension = d.dimension || "valoria";
      getUserById(d.userId, false, (user, serverSigs) => {
        if(user){
          setupAuthSession(user, socket);
        } else{
          createUser(serverSigs, (user) => {
            setupAuthSession(user, socket);
          })
        }
      })
      function createUser(serverSigs, cb){
        //GET 10 other servers to save the user 
        user = {
          username : d.username,
          id: d.userId,
          sockets: {},
          name: d.username,
          ecdsaPair: d.ecdsaPair,
          ecdhPair: d.ecdhPair,
          dimension: dimension,
          servers: connected.to
        }
        getUsersByUsername(d.username, (users) => {
          if(!users) users = {};
          users[d.username] = d.userId;
          //SAVE USERS BY USERNAMES
          if(!process.env.AWS_ACCESS_KEY_ID){
            fs.writeFile(`./data/username-${d.username}.json`, JSON.stringify(users, null, 2), function (err) {
              if (err) return console.log(err);
            });
            fs.writeFile(`./data/${d.userId}.json`, JSON.stringify(user, null, 2), function (err) {
              if (err) return console.log(err);
              cb(user)
            })
          } else {
            s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `username-${d.username}.json`, Body : JSON.stringify(users, null, 2)}, (err, fileData) => {
              if (err) console.error(`Upload Error ${err}`);
            });
            s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `${d.userId}.json`, Body : JSON.stringify(user, null, 2)}, (err, fileData) => {
              if (err) console.error(`Upload Error ${err}`);
              cb(user);
            });
          }
          Object.keys(connected.to).forEach((url) => {
            if(!sockets[url]) sockets[url] = serverIo.connect(url);
            sockets[url].emit('Create User with Proof of Nonexistance', user, serverSigs);
          })
        })
      }   
    });

    async function getUserById(id, localOnly, cb){
      let user;
      if(!id || !cb || typeof cb !== 'function') return;
      if(!process.env.AWS_ACCESS_KEY_ID){
        try {
          user = require(`./data/${id}.json`);
         if(user) {
          const serverSigTime = Date.now();
          const serverSig = await sign(serverSigTime + id);
          cb(user, {[thisUrl]: {sig: serverSig, time: serverSigTime}});
         }else {
           if(localOnly) {
             const serverSigTime = Data.now();
             const serverSig = await sign('no-' + serverSigTime + id);
             cb(null, {[thisUrl]: {sig: serverSig, time: serverSigTime}});
           } else {
            askOtherServersForUserById()
           }
         }
        } catch {
          if(localOnly) {
            const serverSigTime = Data.now();
            const serverSig = await sign('no-' + serverSigTime + id);
            cb(null, {[thisUrl]: {sig: serverSig, time: serverSigTime}})
           } else {
            askOtherServersForUserById()
           }
        }
      } else {
        s3.getObject({Bucket : process.env.AWS_S3_BUCKET, Key : `${id}.json`}, async function(err, user) {
          if(user && user.Body){
            user = JSON.parse(user.Body.toString());
            const serverSigTime = Date.now();
            const serverSig = await sign(serverSigTime + id);
            cb(user, {[thisUrl]: {sig: serverSig, time: serverSigTime}});
          }else{
            if(localOnly) {
              const serverSigTime = Date.now();
              const serverSig = await sign('no-' + serverSigTime + id);
              cb(null, {[thisUrl]: {sig: serverSig, time: serverSigTime}})
             } else {
              askOtherServersForUserById()
             }
          }
        })
      }

      async function askOtherServersForUserById() {
        //TODO: IMPLEMENT A TIMEOUT FOR SERVERS THAT MIGHT NOT CONNECT
        const serverCount = Object.keys(connected.to).length;
        let noCount = 0;
        let userFound = false;
        const thisTime = Date.now()
        const thisSig = await sign('no-' + thisTime + id);
        const noSigs = {[thisUrl]: {sig: thisSig, time: thisTime}}
        Object.keys(connected.to).forEach((url) => {
          if(url !== thisUrl){
            if(!sockets[url]) sockets[url] = serverIo.connect(url);
            sockets[url].off('Get User');
            sockets[url].emit('Get User', id, true);
            sockets[url].on('Get User', (d) => {
              if(userFound) return;
              if(d.user){
                userFound = true;
                cb(d.user, d.serverSigs);
                return;
              } else {
                noCount += 1;
                Object.assign(noSigs, d.serverSigs);
                if(noCount === serverCount) {
                  cb(null, noSigs);
                }
              }
            })
          }
        });
      }

    }
  
    socket.on('Get User', (id, localOnly) => {
      getUserById(id, localOnly, (user, serverSigs) => {
        if(user){
          console.log("FOUND USER");
          socket.emit("Get User", {user, serverSigs});
        }else{
          socket.emit("Get User", {id, err : "User Does Not Exist", serverSigs});
        }
      })
    })

    socket.on('Get User by Username', (username) => {
      getUsersByUsername(username, (users) => {
        if(users){
          socket.emit("Get User by Usernme", users);
        }else{
          socket.emit("Get User by Username", {...d, err : "Username has not been found."});
        }
      })
    })

    socket.on('Login User', async (d) => {
      getUserById(d.userId, false, async (user) => {
        if(user) {
          const publicKey = await crypto.subtle.importKey(
            "jwk", 
            JSON.parse(user.ecdsaPair.publicKey), {
            name: "ECDSA",
            namedCurve: "P-384"
          }, true, ['verify']);
          getAuthKeyByUserId(d.userId, async (authData) => {
            if(!authData || !authData.key || authData.status !== "Awaiting Signature") return;
            const encoded = hexStringToArrayBuffer(authData.key)
            const isUser = await crypto.subtle.verify({
              name: "ECDSA",
              hash: {name: "SHA-384"},
            }, publicKey, d.signature, encoded);
            if(isUser){
              const dimension = d.dimension || "valoria";
              user.sockets[socket.id] = socket.id;
              user.primaryServer = thisUrl;
              user.dimension = dimension;
              if(!data.dimensions[dimension]){
                data.dimensions[dimension] = {sockets: {} };
              }
              data.dimensions[dimension].sockets[socket.id] = {
                username : user.username,
                userId : user.id,
                server : thisUrl
              };
              data.online[socket.id] = {
                username : user.username,
                userId : user.id,
                dimension : dimension,
                server: thisUrl
              };
              socket.emit("Login User", {status: "Success"});

              Object.keys(connected.to).forEach((url) => {
                sockets[url].emit("New Peer in Dimension", {
                  username : user.username,
                  userId : user.id,
                  socket : socket.id,
                  dimension: dimension,
                  server: thisUrl
                })
              })
              Object.keys(data.dimensions[dimension].sockets).forEach((socketId) => {
                io.to(socketId).emit("New Peer in Dimension", {
                  username : user.username,
                  userId : user.id,
                  socket : socket.id,
                  dimension: dimension,
                  server: thisUrl
                });
              })
              if(!process.env.AWS_ACCESS_KEY_ID){
                fs.writeFile(`./data/${d.userId}.json`, JSON.stringify(user, null, 2), function (err) {
                  if (err) return console.log(err);
                });
              } else {
                s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `${d.userId}.json`, Body : JSON.stringify(user, null, 2)}, (err, fileData) => {
                  if (err) console.error(`Upload Error ${err}`);
                });
              }
            } else {
            }
          })
        } else {
          socket.emit("Login User", {...d, err : "User Does Not Exist"});
        }
      })
    })

    socket.on("New Peer in Dimension", (d) => {
      if(!data.dimensions[d.dimension]) data.dimensions[d.dimension] = {sockets: {}};
      Object.keys(data.dimensions[d.dimension].sockets).forEach((socketId) => {
        io.to(socketId).emit("New Peer in Dimension", {
          username : d.username,
          userId : d.userId,
          socket : d.socket,
          dimension: d.dimension,
          server: d.server
        });
      })
    })

    socket.on('disconnect', () => {
      if(data.online[socket.id]){
        let userId = data.online[socket.id].userId;
        getUserById(userId, false, (user) => {
          if(user){
            delete user.sockets[socket.id];
            let dimension = user.dimension;
            if(data.dimensions[dimension].sockets[socket.id]){
              delete data.dimensions[dimension].sockets[socket.id];
            }
            Object.keys(data.dimensions[dimension].sockets).forEach((socketId) => {
              io.to(socketId).emit("Peer Has Left Dimension", userId);
            });
            Object.keys(connected.to).forEach((url) => {
              sockets[url].emit("Peer Has Left Dimension", {
                dimension: dimension,
                userId: userId
              })
            })
            if(!process.env.AWS_ACCESS_KEY_ID){
              fs.writeFile(`./data/${userId}.json`, JSON.stringify(user, null, 2), function (err) {
                if (err) return console.log(err);
              });
            } else {
              s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `${userId}.json`, Body : JSON.stringify(user, null, 2)}, (err, fileData) => {
                if (err) console.error(`Upload Error ${err}`);
              });
            }
          }
          delete data.online[socket.id];
        })
      }
    });

    socket.on("Get Peers in Dimension", (dimId, localOnly) => {
      if(!dimId) dimId = 'valoria';
      if(!data.dimensions[dimId]) data.dimensions[dimId] = {sockets: {}};
      const dimension = data.dimensions[dimId];
      const online = {};
      Object.assign(online, dimension.sockets)
      if(!localOnly){
        let connectedAmount = Object.keys(connected.to).length;
        let count = 0;
        Object.keys(connected.to).forEach((url) => {
          sockets[url].off("Get Peers in Dimension");
          sockets[url].emit("Get Peers in Dimension", dimId, true);
          sockets[url].on("Get Peers in Dimension", (serverOnline) => {
            Object.assign(online, serverOnline);
            count += 1;
            if(count === connectedAmount){
              socket.emit("Get Peers in Dimension", online);
            }
          })
        })
      }else{
        socket.emit("Get Peers in Dimension", online);
      }

    })

    socket.on("Peer Has Left Dimension", (d) => {
      if(!data.dimensions[d.dimension]) data.dimension[d.dimension] = {sockets: {}};
      Object.keys(data.dimensions[d.dimension].sockets).forEach((socketId) => {
        io.to(socketId).emit("Peer Has Left Dimension", d.userId);
      });
    })

    function saveDataToPath(uniquePath, value){
      if(!process.env.AWS_ACCESS_KEY_ID){
        fs.writeFile(`./data/${uniquePath}.json`, JSON.stringify(value, null, 2), function (err) {
          if (err) return console.log(err);
        });
      }else {
        s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `${uniquePath}.json`, Body : JSON.stringify(value, null, 2)}, (err, fileData) => {
          if (err) console.error(`Upload Error ${err}`);
        });
      }
    }

    socket.on("Save User Data", async (body) => {
      //TODO: VERIFY USER SIGNATURE
      let uniquePath = body.userId;
      for (var i=0, pathArr=body.path.substr(1).split('.'), len=pathArr.length; i<len; i++){
        uniquePath += "." + pathArr[i];
        getDataFromPath({path: uniquePath, index: i}, (d, cbData) => {
          if(cbData.index === len - 1){
            d = body.data;
            io.to(cbData.path).emit("Get User Data", {data: d, path: cbData.path});
            saveDataToPath(cbData.path, d)
          }else{
            if(!d || typeof d !== 'object') d = {};
            d[pathArr[cbData.index + 1]] = d[pathArr[cbData.index + 1]] || {};
            if(cbData.index === len - 2) {
              d[pathArr[cbData.index + 1]] = body.data;
            }
            io.to(cbData.path).emit("Get User Data", {data: d, path: cbData.path});
            saveDataToPath(cbData.path, d)
          }
        })
      };
      
    })

    function getDataFromPath(body, cb){
      
      if(!process.env.AWS_ACCESS_KEY_ID){
        try {
         d = require(`./data/${body.path}.json`);
         if(d) {
          cb(d, body);
         }else {
           cb(null, body)
         }
        } catch {
          cb(null, body)
        }
      } else {
        s3.getObject({Bucket : process.env.AWS_S3_BUCKET, Key : `${body.path}.json`}, function(err, d) {
          if(d && d.Body){
            d = JSON.parse(d.Body.toString());
            cb(d, body);
          }else{
            cb(null, body)
          }
        })
      }


      // for (var i=0, path=path.substr(1).split('.'), len=path.length; i<len; i++){
      //   if(!data || typeof data !== 'object') data = {};
      //   data = data[path[i]];
      // };
      // if(data && typeof data === 'object'){
      //   let data2Return = {};
      //   Object.assign(data2Return, data);
      //   Object.keys(data2Return).forEach((key) => {
      //     if(data2Return[key] && typeof data2Return[key] === 'object'){
      //       data2Return[key] = {};
      //     }
      //   })
      //   return data2Return;
      // }else{
      //   return data;
      // }
    }

    socket.on("Get User Data", async(d) => {
      //TODO: GET PUBKEY AND VERIFY DATA SIGNATURE
      getUserById(d.userId, false, (user) => {
        if(!user) return;
        const uniquePath = d.userId + d.path;
        socket.join(uniquePath);
        getDataFromPath({path: uniquePath}, (thisData) => {
          socket.emit("Get User Data", {data: thisData, path: uniquePath});
        });
      })
    })


    function getKeyFromPath(path, cb){

      if(!process.env.AWS_ACCESS_KEY_ID){
        try {
         key = require(`./data/${path}.json`);
         if(key) {
          cb(key);
         }else {
          cb(null)
         }
        } catch {
          cb(null)
        }
      } else {
        s3.getObject({Bucket : process.env.AWS_S3_BUCKET, Key : `${path}.json`}, function(err, keyData) {
          if(keyData && keyData.Body){
            keyData = JSON.parse(keyData.Body.toString());
            cb(keyData);
          }else{
            cb(null)
          }
        })
      }
    }

    socket.on("Get Key from Path", async (d) => {
      getUserById(d.userId, false, (user) => {
        if(!user) {
          socket.emit("Get Key from Path", {err: "No Key Found", key: null, path: d.path, userId: d.userId});
        }
        const uniquePath = d.userId + d.path;
        getKeyFromPath(uniquePath, (keys) =>{
          if(!keys || !keys[uniquePath]) {
            socket.emit("Get Key from Path", {err: "No Key Found", key: null, path: d.path, userId: d.userId});
          }else{
            socket.emit("Get Key from Path", {key: keys[uniquePath], path: d.path, userId: d.userId});
          }
        })
      })
    })

    socket.on('Save Key to Path', async (d) => {
      const uniquePath = d.userId + d.path;
      if(!keysBeingSaved[uniquePath]) keysBeingSaved[uniquePath] = {};
      keysBeingSaved[uniquePath][d.keyUser] = d.key;
      getUserById(d.userId, false, (user) => {
        if(!user) return;
        getKeyFromPath(uniquePath, (keys) => {
          if(!keys) keys = {};
          Object.assign(keys, keysBeingSaved[uniquePath]);
          if(!keys[d.keyUser]) keys[d.keyUser] = d.key;
          if(!keys.path) keys.path = d.path;
          if(!keys.userId) keys.userId = d.userId;
          if(!process.env.AWS_ACCESS_KEY_ID){
            fs.writeFile(`./data/keys.${uniquePath}.json`, JSON.stringify(keys, null, 2), () => {
            });
          } else {
            s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `keys.${uniquePath}.json`, Body : JSON.stringify(keys, null, 2)}, (err, fileData) => {
              if (err) console.error(`Upload Error ${err}`);
            });
          }
        })
      })
    });

    // socket.on("Signal WebRTC Info to User", (d) => {
    //   if(data.users[d.toUsername] && data.users[d.toUsername][d.toUserId]){
    //     let sockets = data.users[d.toUsername][d.toUserId].sockets;
    //     Object.keys(sockets).forEach((id) => {
    //       io.to(id).emit('Got WebRTC Info from User', d);
    //     })
    //   }
    // });

    // socket.on("Call User", (d) => {
    //   if(data.users[d.toUsername] && data.users[d.toUsername][d.toUserId]){
    //     let sockets = data.users[d.toUsername][d.toUserId].sockets;
    //     Object.keys(sockets).forEach((id) => {
    //       io.to(id).emit('Getting Call', d.userId);
    //     })
    //   }
    // });

    // socket.on('getRouterRtpCapabilities', () => {
    //   socket.emit('getRouterRtpCapabilities', mediasoupRouter.rtpCapabilities);
    // });

    // socket.on('createProducerTransport', async (userId) => {
    //   let ip = socket.handshake.address;
    //   const { transport, params } = await createWebRtcTransport();
    //   producerTransports[userId] = transport;
    //   socket.emit('createProducerTransport', params);
    // });

    // socket.on('createConsumerTransport', async (data) => {
    //   let ip = socket.handshake.address;
    //   const { transport, params } = await createWebRtcTransport();
    //   consumerTransports[data.userId] = transport;
    //   socket.emit('createConsumerTransport', params);
    // });

    // socket.on('connectProducerTransport', async (d) => {
    //   await producerTransports[d.userId].connect({ dtlsParameters: d.dtlsParameters });
    //   socket.emit('connectProducerTransport');
    // });

    // socket.on('connectConsumerTransport', async (d) => {
    //   await consumerTransports[d.userId].connect({ dtlsParameters: d.dtlsParameters });
    //   socket.emit('connectConsumerTransport');
    // });

    // socket.on('produce', async (d) => {
    //   producers[d.userId] = await producerTransports[d.userId].produce({ 
    //     kind: d.kind, 
    //     rtpParameters: d.rtpParameters
    //   });
    //   socket.emit('produce', producers[d.userId]);
    //   if(data.users[d.toUsername] && data.users[d.toUsername][d.toUserId]){
    //     let sockets = data.users[d.toUsername][d.toUserId].sockets;
    //     Object.keys(sockets).forEach((id) => {
    //       io.to(id).emit('New Peer Producer', d.userId);
    //     })
    //   }
    // });

    // socket.on('consume', async (d) => {
    //   const consumer = await createConsumer(producers[d.userId], d.rtpCapabilities, d.myId);
    //   socket.emit('consume', consumer);
    // });


    //NEW WEBRTC SOCKETS
    socket.on("Connect to User", function (d) {
      console.log("CONNECT TO USER");
      console.log(d);
      if(d.server === thisUrl){
        getUserById(d.toUserId, false, (user) => {
          if(!user) return;
          let sockets = user.sockets;
          Object.keys(sockets).forEach((socketId) => {
            if(data.online[socketId]){
              io.to(socketId).emit('Getting Connection', {userId: d.userId, username: d.username, socket: socket.id, streaming: d.streaming});
              if(d.relay){
                socket.emit("Connect to User", {userId: d.toUserId, username: d.toUsername, socket: socketId, initiated: true, streaming: d.streaming, dataPath: d.dataPath});
              } else {
                socket.emit("Getting Connection", {userId: d.toUserId, username: d.toUsername, socket: socketId, initiated: true, streaming: d.streaming, dataPath: d.dataPath});
              }
            }else{
              delete user.sockets[socketId];
              if(!process.env.AWS_ACCESS_KEY_ID){
                fs.writeFile(`./data/${user.id}.json`, JSON.stringify(user, null, 2), function (err) {
                  if (err) return console.log(err);
                });
              } else {
                s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `${user.id}.json`, Body : JSON.stringify(user, null, 2)}, (err, fileData) => {
                  if (err) console.error(`Upload Error ${err}`);
                });
              }
            }
          })
        })
      } else {
        if(connected.to[d.server] && sockets[d.server]){
          sockets[d.server].off('Connect to User');
          sockets[d.server].emit('Connect to User', {...d, relay: true});
          sockets[d.server].on('Connect to User', (d2) => {
            if(!d2.err){
              socket.emit("Getting Connection", d2);
            }
          })
        } else {
          console.log("COULD NOT CONNECT TO SERVER GIVEN")
        }
      }
    });


    socket.on("join", function (toUserId, toUserSocket, fromUserId) {
      socket.emit("ready", toUserId)
      io.to(toUserSocket).emit("ready", fromUserId);
    });

    socket.on("iceServers", function (userId) {
      var servers = {
        /* Notice: 这边需要添加自己的 STUN/TURN 服务器, 可以考虑Coturn(https://github.com/coturn/coturn) */
        iceServers: iceServers
      };
      socket.emit("iceServers", userId, servers);
    });
  
    // Relay candidate messages
    socket.on("candidate", function (userId, socketId, candidate) {
      io.to(socketId).emit('newCandidate', userId, candidate);
    });
  
    // Relay offers
    socket.on("offer", function (userId, socketId, offer) {
      io.to(socketId).emit('offer', userId, offer);
    });
  
    // Relay answers
    socket.on("answer", function (userId, socketId, answer) {
      io.to(socketId).emit("answer", userId, answer);
    });

    //OTHER SERVERS
    socket.on('New Server', (d) => {
      if(!servers[d.url]){
        console.log("New Server at " + d.url);
        servers[d.url] = {
          url: d.url,
          key: d.publicKey
        };
        if(!process.env.AWS_ACCESS_KEY_ID){
          fs.writeFile('./data/servers.json', JSON.stringify(servers, null, 2), function (err) {
            if (err) return console.log(err);
          });
        }else {
          s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : "servers.json", Body : JSON.stringify(servers, null, 2)}, (err, fileData) => {
            if (err) console.error(`Upload Error ${err}`);
          });
        }
        sockets[url] = serverIo.connect(url);
      }
      let serversLength = Object.keys(d.servers).length;
      const randServers = [];
      for(let i = 0; i < 10; i++) {
        if(serversLength < 1) break;
        const randServerUrl = Object.keys(d.servers)[Math.floor(Math.random() * serversLength)];
        delete d.servers[randServerUrl];
        serversLength -= 1;
        sockets[randServerUrl] = serverIo.connect(randServerUrl);
        randomServers.push(randServerUrl);
      }
      randServers.forEach((server) => {
        sockets[server].emit("New Server", {url: d.url, publicKey: d.key, servers})
      })
    })

    socket.on("Get all Servers", () => {
      socket.emit("Get all Servers", servers);
    });

    const getRandomServers = (amount) => {
      const randomServers = [];
      const serversClone = Object.assign({}, servers);
      let serversCloneLength = Object.keys(serversClone).length;
      for(let i=0; i<amount; i++){
        if(serversCloneLength < 1) break;
        const randServerUrl = Object.keys(serversClone)[Math.floor(Math.random() * serversCloneLength)];
        randomServers.push(randServerUrl);
        delete serversClone[randServerUrl];
        serversCloneLength -= 1;
      }
      return randomServers
    }

    socket.on("Get Random Servers", (amount) => {
      let rServers = getRandomServers(10);
      socket.emit("Get Random Servers", rServers);
    })

    socket.on('Create User with Proof of Nonexistance', (user, serverSigs) => {

      getUsersByUsername(user.username, (users) => {
        if(!users) users = {};
        users[user.username] = user.id;
        //SAVE USERS BY USERNAMES
        if(!process.env.AWS_ACCESS_KEY_ID){
          fs.writeFile(`./data/username-${user.username}.json`, JSON.stringify(users, null, 2), function (err) {
            if (err) return console.log(err);
          });
          fs.writeFile(`./data/${user.id}.json`, JSON.stringify(user, null, 2), function (err) {
            if (err) return console.log(err);
          })
        } else {
          s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `username-${user.username}.json`, Body : JSON.stringify(users, null, 2)}, (err, fileData) => {
            if (err) console.error(`Upload Error ${err}`);
          });
          s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `${user.id}.json`, Body : JSON.stringify(user, null, 2)}, (err, fileData) => {
            if (err) console.error(`Upload Error ${err}`);
          });
        }
      })
    })

    socket.on("Connecting to Server", (d) => {
      const {url, pubKey, connectedServers, serverSig} = d;
      servers[url] = {};
      console.log("connecting to server");
      console.log(url);
      //VERIFY THAT SERVER ONLY HAS LESS THAN 10 OTHER SERVERS CONNECTED TO IT
      let nextServer = null;
      if(Object.keys(connectedServers).length < 10) {
        connectedServers[thisUrl] = {};
        if(Object.keys(connectedServers).length < 10){
          Object.keys(connected.to).forEach((nextUrl) => {
            if(!connectedServers[nextUrl] && !nextServer) nextServer = nextUrl;
          })
        };
        connected.to[url] = {}
        sockets[url] = serverIo.connect(url);
        console.log("connected to server");
        // sockets[url] = serverIo.connect(url);
        sockets[url].emit("Connected to Server", {url: thisUrl, nextServer});
      } else {
        sockets[url].emit("Failed Connection to Server");
        sockets[url].close();
        delete sockets[url];
      }
    })

  })
};


// const networkInterfaces = os.networkInterfaces();
// let serverIp;
// console.log(networkInterfaces)
// if(networkInterfaces['eth0']){
//   serverIp = networkInterfaces['eth0'][0].address;
// } else {
//   serverIp = networkInterfaces['en0'][1].address;
// }
// async function createWebRtcTransport() {

//   const {
//     maxIncomingBitrate,
//     initialAvailableOutgoingBitrate
//   } = webRtcTransportConfig;
//   console.log("listenIp: ", serverIp);
//   const transport = await mediasoupRouter.createWebRtcTransport({
//     listenIps: [
//       { ip: serverIp, announcedIp: null }
//     ],
//     enableUdp: true,
//     enableTcp: true,
//     preferUdp: true,
//     maxIncomingBitrate: 1500000,
//     initialAvailableOutgoingBitrate: 1000000,
//   });
//   return {
//     transport,
//     params: {
//       id: transport.id,
//       iceParameters: transport.iceParameters,
//       iceCandidates: transport.iceCandidates,
//       dtlsParameters: transport.dtlsParameters
//     },
//   };
// }

// async function createConsumer(producer, rtpCapabilities, userId) {
//   if (!mediasoupRouter.canConsume(
//     {
//       producerId: producer.id,
//       rtpCapabilities,
//     })
//   ) {
//     console.error('can not consume');
//     return;
//   }
//   try {
//     consumer = await consumerTransports[userId].consume({
//       producerId: producer.id,
//       rtpCapabilities,
//       paused: producer.kind === 'video',
//     });
//   } catch (error) {
//     console.error('consume failed', error);
//     return;
//   }

//   if (consumer.type === 'simulcast') {
//     await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
//   }

//   return {
//     producerId: producer.id,
//     id: consumer.id,
//     kind: consumer.kind,
//     rtpParameters: consumer.rtpParameters,
//     type: consumer.type,
//     producerPaused: consumer.producerPaused
//   };
// }

function hexStringToArrayBuffer(hexString) {
  // remove the leading 0x
  hexString = hexString.replace(/^0x/, '');
  
  // ensure even number of characters
  if (hexString.length % 2 != 0) return;
  
  // check for some non-hex characters
  var bad = hexString.match(/[G-Z\s]/i);
  if (bad) return;
  
  // split the string into pairs of octets
  var pairs = hexString.match(/[\dA-F]{2}/gi);
  
  // convert the octets to integers
  var integers = pairs.map(function(s) {
      return parseInt(s, 16);
  });
  
  var array = new Uint8Array(integers);
  
  return array.buffer;
}


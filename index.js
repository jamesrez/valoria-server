
const express= require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const bodyParser = require('body-parser');
const { Crypto } = require("@peculiar/webcrypto");
const os = require( 'os' );
const crypto = new Crypto();
const util = require('util');
const stun = require('stun');
const { uuid } = require('uuidv4');
require('dotenv').config();
const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID || "AClol", process.env.TWILIO_AUTH_TOKEN || "lol");
app.set('views', 'client')
app.set('view engine', 'pug');
app.use(express.json())
app.use(express.static('client'));
app.get('/', (req, res) => res.render('index.pug'));

const port = process.env.PORT || 80;

const fs = require('fs');
const AWS = require('aws-sdk');
let s3 = null;
let data = {
  online: {},
  usernames: {},
  dimensions: {}
};

let iceServers = [{ url: "stun:stun.l.google.com:19302" }];

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


if(!process.env.AWS_ACCESS_KEY_ID){
  try {
    let d = fs.readFileSync('./data/data.json', 'utf8');
    if(d) Object.assign(data, JSON.parse(d));
  } catch {
    fs.mkdirSync('./data/', {recursive : true});
    fs.writeFileSync('data/data.json', data, {flag: 'a'});
  }
  data.online = {};
  saveData(data, async () => {
    if(process.env.TWILIO_ACCOUNT_SID){
      const token = await twilioClient.tokens.create();
      iceServers = token.iceServers;
    }
    startSocketIO();
  });
} else {
  AWS.config.update({region: 'us-west-1'});
  s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  });
  s3.getObject({Bucket : process.env.AWS_S3_BUCKET, Key : "data.json"}, function(err, fileData) {
    if(err) {
      data = {
        "usernames": {},
        "online": {},
        "peers": {},
        "dimensions": {}
      }
      saveData(data, async () => {
        if(process.env.TWILIO_ACCOUNT_SID){
          const token = await twilioClient.tokens.create();
          iceServers = token.iceServers;
        }
        startSocketIO();
      })
    }else{
      data = JSON.parse(fileData.Body.toString());
      data.online = {};
      data.peers = {};
      saveData(data, async () => {
        //GET TWILIO STUN/TURN SERVERS
        if(process.env.TWILIO_ACCOUNT_SID){
          const token = await twilioClient.tokens.create();
          iceServers = token.iceServers
        }
        startSocketIO();
      });
    }
  });
}

function saveData(data, cb) {
  if(!process.env.AWS_ACCESS_KEY_ID){
    fs.writeFile('./data/data.json', JSON.stringify(data, null, 2), function (err) {
      if (err) return console.log(err);
      if(cb && typeof cb == 'function') cb();
    });
  }else {
    s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : "data.json", Body : JSON.stringify(data, null, 2)}, (err, fileData) => {
      if (err) console.error(`Upload Error ${err}`);
      if(cb && typeof cb == 'function') cb();
    });
  }
}

server.listen(port, () => {
  console.log("Listening on Port " + port);
});


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

app.set('views', './client');
app.set('view engine', 'pug');
app.use(express.json());
app.use(express.static('client'));
app.use(bodyParser.json());//json parser
app.use(bodyParser.urlencoded({ extended: true }));//urlencoded parser

app.get('/', (req, res) => {
  res.render('index.pug');
});

function base64ToArrayBuffer(dataUrl, cb) {  
  return Uint8Array.from(atob(dataUrl), c => c.charCodeAt(0))
}

function startSocketIO(){
  io.on('connection', function (socket) {

    //MAKE SURE EACH ROUTE THAT NEEDS AUTHENTICATION USES VERIFY FROM A SIGNATURE

    socket.on('Create User', (d) => {
      let user;
      const dimension = d.dimension || "valoria";
      if(!process.env.AWS_ACCESS_KEY_ID){
        try {
         user = require(`./data/${d.userId}.json`);
         if(user) {
          socket.emit("Create User", {...d, err : "User already Exists"});
          return;
         }
        } catch {
          createUser();
        }
      } else {
        s3.getObject({Bucket : process.env.AWS_S3_BUCKET, Key : `${d.userId}.json`}, function(err, user) {
          if(user && user.Body){
            socket.emit("Create User", {...d, err : "User already Exists"});
            return;
          }
          if(err) console.log("S3 Err: ", err);
          createUser()
        })
      }
      function createUser(){
        user = {
          username : d.username,
          id: d.userId,
          sockets: {},
          name: d.username,
          ecdsaPair: d.ecdsaPair,
          ecdhPair: d.ecdhPair,
          dimension: dimension,
          data : {},
          keys: {}
        }
        if(!data.usernames[d.username]) data.usernames[d.username] = {};
        data.usernames[d.username][d.userId] = {
          id: d.userId
        };
        if(!data.dimensions[dimension]){
          data.dimensions[dimension] = { sockets: {} };
        }
        data.dimensions[dimension].sockets[socket.id] = {
          username : d.username,
          userId : d.userId,
        };
        data.online[socket.id] = {
          username : d.username,
          userId : d.userId,
          dimension : dimension
        };
        Object.keys(data.dimensions[dimension].sockets).forEach((socketId) => {
          io.to(socketId).emit("New Peer in Dimension", {
            username : d.username,
            userId : d.userId,
            socket : socket.id,
          });
        })
        saveData(data, () => {
          socket.emit("Create User", {success : true, ...d});
        });

        if(!process.env.AWS_ACCESS_KEY_ID){
          fs.writeFile(`./data/${d.userId}.json`, JSON.stringify(user, null, 2), function (err) {
            if (err) return console.log(err);
          });
        } else {
          s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `${d.userId}.json`, Body : JSON.stringify(user, null, 2)}, (err, fileData) => {
            if (err) console.error(`Upload Error ${err}`);
          });
        }
      }   
    });

    function getUserById(id, cb){
      let user;
      if(!id || !cb || typeof cb !== 'function') return;
      if(!process.env.AWS_ACCESS_KEY_ID){
        try {
         user = require(`./data/${id}.json`);
         if(user) {
          cb(user);
         }else {
           return
         }
        } catch {
          return
        }
      } else {
        s3.getObject({Bucket : process.env.AWS_S3_BUCKET, Key : `${id}.json`}, function(err, user) {
          if(user && user.Body){
            user = JSON.parse(user.Body.toString());
            cb(user);
          }else{
            return
          }
        })
      }
    }
  
    socket.on('Get User', (id) => {
      getUserById(id, (user) => {
        if(user){
          socket.emit("Get User", user);
        }else{
          socket.emit("Get User", {...d, err : "User Does Not Exist"});
        }
      })
    })

    socket.on('Login User', async (d) => {
      getUserById(d.userId, async (user) => {
        if(user) {
          const publicKey = await crypto.subtle.importKey(
            "jwk", 
            JSON.parse(user.ecdsaPair.publicKey), {
            name: "ECDSA",
            namedCurve: "P-384"
          }, true, ['verify']);
          d.encoded = Uint8Array.from(Object.values(d.encoded));
          const isUser = await crypto.subtle.verify({
            name: "ECDSA",
            hash: {name: "SHA-384"},
          }, publicKey, d.signature, d.encoded);
          if(isUser){
            const dimension = d.dimension || "valoria";
            user.sockets[socket.id] = socket.id;
            user.dimension = dimension;
            if(!data.dimensions[dimension]){
              data.dimensions[dimension] = {sockets: {} };
            }
            data.dimensions[dimension].sockets[socket.id] = {
              username : d.username,
              userId : d.userId,
            };
            data.online[socket.id] = {
              username : d.username,
              userId : d.userId,
              dimension : dimension
            };
            Object.keys(data.dimensions[dimension].sockets).forEach((socketId) => {
              io.to(socketId).emit("New Peer in Dimension", {
                username : d.username,
                userId : d.userId,
                socket : socket.id,
              });
            })
            saveData(data, () => {
              socket.emit("Login User", {success : true, ...d});
            });
            if(!process.env.AWS_ACCESS_KEY_ID){
              fs.writeFile(`./data/${d.userId}.json`, JSON.stringify(user, null, 2), function (err) {
                if (err) return console.log(err);
              });
            } else {
              s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `${d.userId}.json`, Body : JSON.stringify(user, null, 2)}, (err, fileData) => {
                if (err) console.error(`Upload Error ${err}`);
              });
            }
          }
        } else {
          socket.emit("Login User", {...d, err : "User Does Not Exist"});
        }
      })
    })

    socket.on('disconnect', () => {
      if(data.online[socket.id]){
        let userId = data.online[socket.id].userId;
        getUserById(userId, (user) => {
          if(user){
            delete user.sockets[socket.id];
            let dimension = user.dimension;
            if(data.dimensions[dimension].sockets[socket.id]){
              delete data.dimensions[dimension].sockets[socket.id];
            }
            Object.keys(data.dimensions[dimension].sockets).forEach((socketId) => {
              io.to(socketId).emit("Peer Has Left Dimension", userId);
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
          saveData(data);
        })
      }
    });

    socket.on("Get Peers in Dimension", (dimId) => {
      if(!dimId) dimId = 'valoria';
      const dimension = data.dimensions[dimId];
      if(dimension){
        Object.keys(dimension.sockets).forEach((socketId) => {
          if(!data.online[socketId]){
            delete dimension.sockets[socketId]
          }
        })
        socket.emit("Get Peers in Dimension", dimension.sockets);
      }else {
        dimension = {sockets: {}};
      }
      saveData(data);
    })

    function saveDataToPath(data, userId, path, value){
      let uniquePath = userId;
      for (var i=0, pathArr=path.substr(1).split('.'), len=pathArr.length; i<len; i++){
        if(i === len - 1){
          data[pathArr[i]] = value;
          io.to(uniquePath).emit("Get User Data", {data, path: uniquePath});
        }else{
          data[pathArr[i]] = data[pathArr[i]] || {};
          if(data && typeof data === 'object'){
            let data2Send = {};
            Object.assign(data2Send, data);
            Object.keys(data2Send).forEach((key) => {
              if(data2Send[key] && typeof data2Send[key] === 'object'){
                data2Send[key] = {};
              }
            })
            io.to(uniquePath).emit("Get User Data", {data: data2Send, path: uniquePath});
          }else{
            io.to(uniquePath).emit("Get User Data", {data, path: uniquePath});
          }
          data = data[pathArr[i]];
        }
        uniquePath += "." + pathArr[i];
      };
    }

    socket.on("Save User Data", async (d) => {
      if(data.online[socket.id]){
        if(!process.env.AWS_ACCESS_KEY_ID){
          let user
          try {
           user = require(`./data/${d.userId}.json`);
          } catch {
            return;
          }
          if(!user.data) user.data = {};
          saveDataToPath(user.data, d.userId, d.path, d.data);
          fs.writeFile(`./data/${d.userId}.json`, JSON.stringify(user, null, 2), function (err) {
            if (err) return console.log(err);
          });
        }else {
          s3.getObject({Bucket : process.env.AWS_S3_BUCKET, Key : `${d.userId}.json`}, function(err, user) {
            // if(err) console.log("S3 Err: ", err);
            if(!user) return;
            user = JSON.parse(user.Body.toString())
            if(!user.data) user.data = {};
            saveDataToPath(user.data, d.userId, d.path, d.data)
            s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `${d.userId}.json`, Body : JSON.stringify(user, null, 2)}, (err, fileData) => {
              if (err) console.error(`Upload Error ${err}`);
            });
          })
        }
      }
    })

    function getDataFromPath(data, path){
      for (var i=0, path=path.substr(1).split('.'), len=path.length; i<len; i++){
        if(!data || typeof data !== 'object') data = {};
        data = data[path[i]];
      };
      if(data && typeof data === 'object'){
        let data2Return = {};
        Object.assign(data2Return, data);
        Object.keys(data2Return).forEach((key) => {
          if(data2Return[key] && typeof data2Return[key] === 'object'){
            data2Return[key] = {};
          }
        })
        return data2Return;
      }else{
        return data;
      }
    }

    socket.on("Get User Data", async(d) => {
      getUserById(d.userId, (user) => {
        if(!user || !user.data) return;
        const uniquePath = d.userId + d.path;
        socket.join(uniquePath);
        const thisData = getDataFromPath(user.data, d.path);
        socket.emit("Get User Data", {data: thisData, path: uniquePath});
      })
    })

    socket.on("Get Key from Path", async (d) => {
      getUserById(d.userId, (user) => {
        if(!user || !user.keys) {
          socket.emit("Get Key from Path", {err: "No Key Found", key: null, path: d.path, userId: d.userId});
        }
        console.log(user.keys)
        console.log(uniquePath)
        const uniquePath = d.userId + d.path;
        const thisKey = user.keys[uniquePath];
        if(!thisKey) {
          socket.emit("Get Key from Path", {err: "No Key Found", key: null, path: d.path, userId: d.userId});
        }
        socket.emit("Get Key from Path", {key: thisKey, path: d.path, userId: d.userId});
      })
    })

    socket.on('Save Key to Path', async (d) => {
      getUserById(d.userId, (user) => {
        if(!user) return;
        const uniquePath = d.userId + d.path;
        user.keys[uniquePath] = user.keys[uniquePath] || {};
        user.keys[uniquePath][d.keyUser] = d.key
        if(!user.keys[uniquePath].path) user.keys[uniquePath].path = d.path;
        if(!user.keys[uniquePath].userId) user.keys[uniquePath].userId = d.userId;
        if(!process.env.AWS_ACCESS_KEY_ID){
          fs.writeFile(`./data/${d.userId}.json`, JSON.stringify(user, null, 2), function (err) {
            if (err) return console.log(err);
          });
        } else {
          s3.upload({Bucket : process.env.AWS_S3_BUCKET, Key : `${d.userId}.json`, Body : JSON.stringify(user, null, 2)}, (err, fileData) => {
            if (err) console.error(`Upload Error ${err}`);
          });
        }
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
      getUserById(d.toUserId, (user) => {
        if(!user) return;
        let sockets = user.sockets;
        Object.keys(sockets).forEach((socketId) => {
          if(data.online[socketId]){
            io.to(socketId).emit('Getting Connection', {userId: d.userId, username: d.username, socket: socket.id, streaming: d.streaming});
            socket.emit("Getting Connection", {userId: d.toUserId, username: d.toUsername, socket: socketId, initiated: true, streaming: d.streaming, dataPath: d.dataPath});
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



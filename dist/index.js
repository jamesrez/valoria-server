(function (factory) {
  typeof define === 'function' && define.amd ? define(factory) :
  factory();
}((function () { 'use strict';

  var express= require('express');
  var app = express();
  var server = require('http').Server(app);
  var io = require('socket.io')(server);
  var bodyParser = require('body-parser');
  var crypto = require('crypto');
  require('dotenv').config();

  const port = process.env.PORT || 80;

  var fs = require('fs');
  const AWS = require('aws-sdk');
  var s3 = null;
  var data = null;

  if(process.env.DEVELOPMENT){
    data = require('./data/data.json');
    data.online = {};
    saveData(data, () => {
      startSocketIO();
    });
  }else {
    AWS.config.update({region: 'us-west-1'});
    s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });
    s3.getObject({Bucket : process.env.S3_BUCKET, Key : "data.json"}, function(err, fileData) {
      if(err) return;
      data = JSON.parse(fileData.Body.toString());
      data.online = {};
      data.peers = {};
      saveData(data, () => {
        startSocketIO();
      });
    });
  }

  function saveData(data, cb) {
    if(process.env.DEVELOPMENT){
      fs.writeFile('./data/data.json', JSON.stringify(data, null, 2), function (err) {
        if (err) return console.log(err);
        if(cb && typeof cb == 'function') cb();
      });
    }else {
      s3.upload({Bucket : "valoria", Key : "data.json", Body : JSON.stringify(data, null, 2)}, (err, fileData) => {
        if (err) console.error(`Upload Error ${err}`);
        if(cb && typeof cb == 'function') cb();
      });
    }
  }

  server.listen(port, () => {
    console.log("Listening on Port " + port);
  });

  app.set('views', './client');
  app.set('view engine', 'pug');
  app.use(express.json());
  app.use(express.static('client'));
  app.use(bodyParser.json());//json parser
  app.use(bodyParser.urlencoded({ extended: true }));//urlencoded parser

  app.get('/', (req, res) => {
    res.render('index.pug');
  });

  async function startSocketIO() {

    io.on('connection', function (socket) {

      socket.on('Create User', (d) => {
        if(!data.users[d.username]){
          //ENCRYPT THE PASSWORD
          const algorithm = 'aes-192-cbc';
          const eKey = process.env.ENCRYPTION_KEY;
          crypto.scrypt(eKey, 'salt', 24, (err, key) => {
            crypto.randomBytes(16, async (err, iv) => {
              if (err) throw err;
              const cipher = crypto.createCipheriv(algorithm, key, iv);
              let encrypted = cipher.update(d.password, 'utf8', 'hex');
              encrypted += cipher.final('hex');
              iv = iv.toString('hex');
              data.users[d.username] = {
                username : d.username,
                password : {iv, encrypted},
                pushId : d.pushId,
                peers : {},
                sockets : {},
                name : d.username,
                avatar : 'https://i.imgur.com/PQFqBEl.png',
                wrapped : d.wrapped,
                currentDimension : "Valoria"
              };
              data.users[d.username].peers[d.peerId] = d.peerId;
              data.users[d.username].sockets[socket.id] = socket.id;
              if(!data.dimensions["Valoria"]){
                data.dimensions["Valoria"] = { peers: {}, sockets: {} };
              }
              data.dimensions["Valoria"].peers[d.username] = {};
              data.dimensions["Valoria"].sockets[d.username] = {};
              data.dimensions["Valoria"].peers[d.username][d.peerId] = d.peerId;
              data.dimensions["Valoria"].sockets[d.username][socket.id] = socket.id;
              data.online[socket.id] = {
                username : d.username,
                peerId : d.peerId
              };
              saveData(data, () => {
                socket.emit("Create User", {success : true, ...d});
              });
            });
          });
        }else {
          socket.emit("Create User", {...d, err : "User already Exists"});
        }
      });
    
    
      socket.on('Login User', (d) => {
        if(data.users[d.username]){
          // COMPARE WITH DECRYPTED PASSWORD
          const algorithm = 'aes-192-cbc';
          const eKey = process.env.ENCRYPTION_KEY;
          crypto.scrypt(eKey, 'salt', 24, (err, key) => {
            let iv = Buffer.from(data.users[d.username].password.iv, 'hex');
            const decipher = crypto.createDecipheriv(algorithm, key, iv);
            let decrypted = decipher.update(data.users[d.username].password.encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            if(decrypted == d.password){
              data.users[d.username].peers[d.peerId] = d.peerId;
              data.users[d.username].sockets[socket.id] = socket.id;
              data.users[d.username].pushId = d.pushId;
              data.online[socket.id] = {
                username : d.username,
                peerId : d.peerId
              };
              data.peers[d.peerId] = d.username;
              const currentDimension = data.users[d.username].currentDimension;
              if(!data.dimensions[currentDimension].peers[d.username]){
                data.dimensions[currentDimension].peers[d.username] = {};
              }
              if(!data.dimensions[currentDimension].sockets[d.username]){
                data.dimensions[currentDimension].sockets[d.username] = {};
              }
              data.dimensions[currentDimension].peers[d.username][d.peerId] = d.peerId;
              data.dimensions[currentDimension].sockets[d.username][socket.id] = socket.id;
              saveData(data, () => {
                socket.emit("Login User", {
                  ...d,
                  success : true,
                  wrapped : data.users[d.username].wrapped,
                  currentDimension : data.users[d.username].currentDimension,
                  name : data.users[d.username].name,
                  avatar : data.users[d.username].avatar,
                  userPeers : data.users[d.username].peers
                });
                //LET PEER BE KNOWN TO OTHER USER SOCKETS
                for(let socketId in data.users[d.username].sockets){
                  if(!socketId || socketId == socket.id) continue;
                  io.to(socketId).emit("New User Peer", d.peerId);
                }
              });
            }else {
              socket.emit("Login User", {...d, err : "Incorrect User / Password"});
            }
          });
        }else {
          socket.emit("Login User", {...d, err : "User Does Not Exist"});
        }
      });

      socket.on('disconnect', () => {
        if(data.online[socket.id]){
          let username = data.online[socket.id].username;
          let peerId = data.online[socket.id].peerId;
          if(username && data.users[username]){
            delete data.users[username].sockets[socket.id];
            let currentDimension = data.users[username].currentDimension;
            if(data.dimensions[currentDimension].peers[username]){
              delete data.dimensions[currentDimension].peers[username][peerId];
            }
            if(data.dimensions[currentDimension].sockets[username]){
              delete data.dimensions[currentDimension].sockets[username][socket.id];
            }
            delete data.users[username].peers[peerId];
            Object.keys(data.dimensions[currentDimension].sockets).forEach((user) => {
              Object.keys(data.dimensions[currentDimension].sockets[user]).forEach((socketId) => {
                io.to(socketId).emit("Peer Has Left", peerId);
              });
            });
          }
          delete data.peers[peerId];
          delete data.online[socket.id];
          saveData(data);
        }
      });

      //SEND PEER ID's SO DEVICES CAN TALK TO EACHOTHER PEER TO PEER
      socket.on("Get Peers in Dimension", (dimId) => {
        if(data.online[socket.id] && data.dimensions[dimId]){
          socket.emit("Get Peers in Dimension", data.dimensions[dimId].peers);
        }else if(dimId === 'Valoria' && !data.dimensions[dimId]){
          data.dimensions["Valoria"] = {peers : {}};
          saveData(data);
        }
      });

    });
  }

})));

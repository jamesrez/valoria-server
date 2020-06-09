
const express= require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const bodyParser = require('body-parser');
const { Crypto } = require("node-webcrypto-ossl");
const crypto = new Crypto();
const util = require('util');
require('dotenv').config();

app.set('views', 'client')
app.set('view engine', 'pug');
app.use(express.json())
app.use(express.static('client'));
app.get('/', (req, res) => res.render('index.pug'));

const port = process.env.PORT || 80;

const fs = require('fs');
const AWS = require('aws-sdk');
let s3 = null;
let data = {};

if(!process.env.AWS_ACCESS_KEY_ID){
  data = require('./data/data.json');
  data.online = {};
  saveData(data, () => {
    startSocketIO();
  });
} else {
  AWS.config.update({region: 'us-west-1'});
  s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  });
  s3.getObject({Bucket : process.env.S3_BUCKET, Key : "data.json"}, function(err, fileData) {
    if(err) {
      data = {
        "users": {},
        "online": {},
        "peers": {},
      }
      saveData(data, () => {
        startSocketIO();
      })
    }
    data = JSON.parse(fileData.Body.toString());
    data.online = {};
    data.peers = {};
    saveData(data, () => {
      startSocketIO();
    });
  });
}

function saveData(data, cb) {
  if(!process.env.AWS_ACCESS_KEY_ID){
    fs.writeFile('./data/data.json', JSON.stringify(data, null, 2), function (err) {
      if (err) return console.log(err);
      if(cb && typeof cb == 'function') cb();
    });
  }else {
    console.log("UPLOAD DATA: ", data);
    s3.upload({Bucket : process.env.S3_BUCKET, Key : "data.json", Body : JSON.stringify(data, null, 2)}, (err, fileData) => {
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

function base64ToArrayBuffer(dataUrl, cb) {  
  return Uint8Array.from(atob(dataUrl), c => c.charCodeAt(0))
}

function startSocketIO(){
  io.on('connection', function (socket) {
    socket.on('Create User', (d) => {
      if(!data.users[d.username]){
        data.users[d.username] = {
          username : d.username,
          peers : {},
          sockets : {},
          name : d.username,
          eKey : d.eKey,
          keyPair : d.keyPair,
        };
        data.users[d.username].peers[d.peerId] = d.peerId;
        data.users[d.username].sockets[socket.id] = socket.id;
        data.online[socket.id] = {
          username : d.username,
          peerId : d.peerId
        };
        saveData(data, () => {
          socket.emit("Create User", {success : true, ...d});
        });
      }else {
        socket.emit("Create User", {...d, err : "User already Exists"});
      }
    });
  
  
    socket.on('Get User', (d) => {
      if(data.users[d.username]){
        socket.emit("Get User", data.users[d.username]);
      }else {
        socket.emit("Get User", {...d, err : "User Does Not Exist"});
      }
    });

    socket.on('Login User', async (d) => {
      if(data.users[d.username]){
        const publicKey = await crypto.subtle.importKey(
          "jwk", 
          JSON.parse(data.users[d.username].keyPair.publicKey), {
          name: "ECDSA",
          namedCurve: "P-384"
        }, true, ['verify']);
        d.encoded = Uint8Array.from(Object.values(d.encoded));
        const isUser = await crypto.subtle.verify({
          name: "ECDSA",
          hash: {name: "SHA-384"},
        }, publicKey, d.signature, d.encoded);
        if(isUser){
          data.users[d.username].peers[d.peerId] = d.peerId;
          data.users[d.username].sockets[socket.id] = socket.id;
          data.online[socket.id] = {
            username : d.username,
            peerId : d.peerId
          };
          saveData(data, () => {
            socket.emit("Login User", {success : true, ...d});
          });
        }
      }else{
        socket.emit("Login User", {...d, err : "User Does Not Exist"});
      }
    })

    socket.on('disconnect', () => {
      if(data.online[socket.id]){
        let username = data.online[socket.id].username;
        let peerId = data.online[socket.id].peerId;
        if(username && data.users[username]){
          delete data.users[username].sockets[socket.id];
          delete data.users[username].peers[peerId];
        }
        delete data.peers[peerId];
        delete data.online[socket.id];
        saveData(data);
      }
    });
  })
};


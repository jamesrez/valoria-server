
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
    }else{
      data = JSON.parse(fileData.Body.toString());
      data.online = {};
      data.peers = {};
      saveData(data, () => {
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
      if(!data.users[d.userName]){
        data.users[d.username] = {};
      }
      if(!data.users[d.username][d.userId]){
        data.users[d.username][d.userId] = {
          username : d.username,
          id: d.userId,
          peers : {},
          sockets : {},
          name : d.username,
          eKey : d.eKey,
          keyPair : d.keyPair,
        }
        data.users[d.username][d.userId].peers[d.peerId] = d.peerId;
        data.users[d.username][d.userId].sockets[socket.id] = socket.id;
        data.online[socket.id] = {
          username : d.username,
          peerId : d.peerId,
          userId : d.userId
        };
        saveData(data, () => {
          socket.emit("Create User", {success : true, ...d});
        });
      }else {
        socket.emit("Create User", {...d, err : "User already Exists"});
      }
    });
  
  
    socket.on('Get User', (d) => {
      if(data.users[d.username] && data.users[d.username][d.userId]){
        socket.emit("Get User", data.users[d.username][d.userId]);
      }else {
        socket.emit("Get User", {...d, err : "User Does Not Exist"});
      }
    });

    socket.on('Login User', async (d) => {
      if(data.users[d.username] && data.users[d.username][d.userId]){
        const publicKey = await crypto.subtle.importKey(
          "jwk", 
          JSON.parse(data.users[d.username][d.userId].keyPair.publicKey), {
          name: "ECDSA",
          namedCurve: "P-384"
        }, true, ['verify']);
        d.encoded = Uint8Array.from(Object.values(d.encoded));
        const isUser = await crypto.subtle.verify({
          name: "ECDSA",
          hash: {name: "SHA-384"},
        }, publicKey, d.signature, d.encoded);
        if(isUser){
          data.users[d.username][d.userId].peers[d.peerId] = d.peerId;
          data.users[d.username][d.userId].sockets[socket.id] = socket.id;
          data.online[socket.id] = {
            username : d.username,
            peerId : d.peerId,
            userId : d.userId
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
        let userId = data.online[socket.id].userId;
        if(username && data.users[username] && userId && data.users[username][userId]){
          delete data.users[username][userId].sockets[socket.id];
          delete data.users[username][userId].peers[peerId];
        }
        delete data.peers[peerId];
        delete data.online[socket.id];
        saveData(data);
      }
    });

    function saveDataToPath(data, path, value){
      let thisKey = Object.keys(path)[0];
      while(path[thisKey] && typeof path[thisKey] === 'object'){
        if(!data[thisKey] || typeof data[thisKey] !== 'object'){
          data[thisKey] = {};
        }
        path = path[thisKey];
        let prevKey = thisKey;
        thisKey = Object.keys(path)[0];
        if(path[thisKey]){
          data[prevKey][thisKey] = data[prevKey][thisKey] || {};
        }
        data = data[prevKey];
      }
      if(typeof data !== 'object'){
        data = {};
      }
      data[thisKey] = value;
      return data;
    }

    socket.on("Save User Data", async (d) => {
      if(data.online[socket.id]){
        if(!process.env.AWS_ACCESS_KEY_ID){
          let userData = require(`./data/${d.userId}.json`);
          saveDataToPath(userData, d.path, d.data)
          fs.writeFile(`./data/${data.online[socket.id].userId}.json`, JSON.stringify(userData, null, 2), function (err) {
            if (err) return console.log(err);
          });
        }else {
          s3.getObject({Bucket : process.env.S3_BUCKET, Key : `${d.userId}.json`}, function(err, userData) {
            if(err) console.log("S3 Err: ", err);
            if(userData){
              userData = JSON.parse(userData.Body.toString());
              saveDataToPath(userData, d.path, d.data)
              s3.upload({Bucket : process.env.S3_BUCKET, Key : `${data.online[socket.id].userId}.json`, Body : JSON.stringify(userData, null, 2)}, (err, fileData) => {
                if (err) console.error(`Upload Error ${err}`);
              });
            }
          })
        }
      }
    })

    function getDataFromPath(d, path){
      let thisKey = Object.keys(path)[0];
      while(path[thisKey] && typeof path[thisKey] === 'object'){
        if(!d[thisKey] || typeof d[thisKey] !== 'object'){
          d[thisKey] = {};
        }
        path = path[thisKey];
        let prevKey = thisKey;
        thisKey = Object.keys(path)[0];
        if(path[thisKey]){
          d[prevKey][thisKey] = d[prevKey][thisKey] || {};
        }
        d = d[prevKey];
      }
      if(typeof d !== 'object'){
        d = {};
      }
      d = d[thisKey];
      if(d && typeof d === 'object'){
        Object.keys(d).forEach((key) => {
          if(d[key] && typeof d[key] === 'object'){
            d[key] = {};
          }
        })
      }
      return d;
    }

    socket.on("Get User Data", async(d) => {
      if(data.users[d.username] && data.users[d.username][d.userId]){
        if(!process.env.AWS_ACCESS_KEY_ID){
          const userData = JSON.stringify(require(`./data/${d.userId}.json`));
          let thisData = getDataFromPath(JSON.parse(userData), d.path);
          socket.emit("Get User Data", thisData);
        }else{
          s3.getObject({Bucket : process.env.S3_BUCKET, Key : `${d.userId}.json`}, function(err, fileData) {
            if(err) console.log("S3 Err: ", err);
            if(fileData){
              fileData = fileData.Body.toString();
            }
            socket.emit("Get User Data", fileData)
          })
        }
      }
    })

  })
};


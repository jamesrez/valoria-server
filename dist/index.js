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

  app.get('/', (req, res, next) => res.send("Hi! I'm the Valoria Server"));

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
          data.users[d.username] = {
            username : d.username,
            peers : {},
            sockets : {},
            name : d.username,
            wrapped : d.wrapped,
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

    });
  }

})));

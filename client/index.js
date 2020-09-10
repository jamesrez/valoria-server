let provider;
let signer;
let currentChat = {};

const valoria = new Valoria({
  server: '/'
})

async function start(){
  if(!web3 || !web3.currentProvider) return;
  ethereum.enable();
  provider = new ethers.providers.Web3Provider(web3.currentProvider);
  signer = await provider.getSigner();
  // const username = sessionStorage.getItem('valoriaUsername');
  // const password = sessionStorage.getItem('valoriaPassword')
  // if(username && password){
  //   valoria.register(username, password, (user) => {
  //     window.user = user;
  //     startChat();
  //   });
  // }
}

//   valoria.getUsersByUsername("james", (users) => {
//     valoria.getUser(Object.keys(users)[0], (james) => {
//       james.get('assets').get('3d').get('avatars').get('assistant').on((woman) => {
//         if(!woman) return;
//         const gltfModel = $('#woman')[0].components["gltf-model"];
//         const loader = new AFRAME.THREE.GLTFLoader();
//         loader.parse(woman, null, (gltf) => {
//           gltfModel.model = gltf.scene || gltf.scenes[0];
//           gltfModel.model.animations = gltf.animations;
//           console.log(gltfModel.model)
//           gltfModel.el.setObject3D('mesh', gltfModel.model);
//           gltfModel.el.emit('model-loaded', {format: 'gltf', model: gltfModel.model});
//         })
//       })
//     })
//   })
// }

start();

async function joinWithCredentials(username, password){
  if(username.length > 0 && password.length > 0)
  valoria.register(username, password, (user) => {
    sessionStorage.setItem('valoriaUsername', username);
    sessionStorage.setItem('valoriaPassword', password);
    window.user = user;
    startChat()
  });
}

async function joinWithWeb3(){
  const usernameSignature = await signer.provider.send('personal_sign', [
    "valoria",
    await signer.getAddress(),
  ]);
  const passwordSignature = await signer.provider.send('personal_sign', [
    usernameSignature,
    await signer.getAddress(),
  ]);
  valoria.register(usernameSignature, passwordSignature, (user) => {
    sessionStorage.setItem('valoriaUsername', usernameSignature);
    sessionStorage.setItem('valoriaPassword', passwordSignature);
    window.user = user;
    startChat();
  });
}

//AUTH INPUTS AND SUBMIT
$('.valoriaJoinWithWeb3Wallet').on('click', () => {
  joinWithWeb3();
})

$('.valoriaPasswordInput').on('keyup', (e) => {
  if(e.keyCode === 13){
    joinWithCredentials($('.valoriaUsernameInput').val(), $('.valoriaPasswordInput').val());
  }
})

$('.valoriaAuthSubmit').on('click', () => {
  joinWithCredentials($('.valoriaUsernameInput').val(), $('.valoriaPasswordInput').val());
})

async function startChat(){
  clearInterval(rainbowHeader.timer);
  $('.valoriaHeader').text("Valoria Chat");
  $('.valoriaSecondHeader').text("Signed in as: " + valoria.user.username);
  $('.valoriaAuth').css('display', 'none');
  $('.valoriaChat').css('display', 'flex');
  loadOnlineUsers();
} 

async function loadOnlineUsers(){
  valoria.getOnlinePeers((peers) => {
    $('.chatOnlineList').empty()
    const loaded = {};
    Object.keys(peers).forEach((peerId) => {
      const peer = peers[peerId];
      peers[peerId].peerId = peerId;
      if(loaded[peer.username] || peer.userId === valoria.user.id) return;
      loaded[peer.username] = true;
      let el = document.createElement('div');
      el.className = 'chatOnlineUser hideScrollbar'
      el.textContent = peer.username;
      $(el).on('click', e => connectToPeer(peer));
      $('.chatOnlineList').append(el);
    })
  })
}

async function connectToPeer(peer){
  valoria.getUser(peer.id, (u) => {
    console.log(u);
    window.thisPeer = u;
    delete currentChat.channel;
    currentChat.userId = u.id;
    $('.chatMsgForm').css('display', 'flex');
    $('.chatVideoBtn').css('display', 'flex');
    $('.chatVideoBtn').on('click', () => {
      $('.chatVideos').css('display', 'flex');
      navigator.mediaDevices.getUserMedia({video: true, audio: true}).then(function(myStream) {
        $('.chatUserVideo')[0].srcObject = myStream;
        valoria.call(peer.userId, myStream, (theirStream) => {
          let video = $('.chatPeerVideo')[0]
          video.srcObject = theirStream;
        });
      })
    })
    valoria.onCall((d) => {
      $('.chatVideos').css('display', 'flex');
      navigator.mediaDevices.getUserMedia({video: true, audio: true}).then(function(myStream) {
        $('.chatUserVideo')[0].srcObject = myStream;
        valoria.answer(d, (theirStream) => {
          let video = $('.chatPeerVideo')[0]
          video.srcObject = theirStream;
        });
      })
    })
    $('.chatName').text(u.username);
    $('.chatMsgContainerList').empty();
    let loaded = {};
    let allMsgs = [];
    valoria.user.get('chat').get('users').get(u.id).shareEncryptionKey(u);
    function getMsgsOfUser(data, username){
      // data.getEncryptionKey((key) => {
      // })
      data.on((msgTimes) => {
        console.log(msgTimes);
        if(msgTimes && typeof msgTimes === 'object'){
          Object.keys(msgTimes).forEach((time) => {
            if(loaded[username + time]) return;
            let msg = msgTimes[time];
            if(msg && typeof msg === 'string'){
              loaded[username + time] = true;
              allMsgs.push({text: msg, username, time});
              loadMessages(allMsgs);
            }
          })
        }
      });
    }
    getMsgsOfUser(u.get('chat').get('users').get(user.id), u.username);
    getMsgsOfUser(valoria.user.get('chat').get('users').get(u.id), user.username);
  });
}

function loadMessages(msgs){
  $('.chatMsgContainerList').empty();
  msgs.sort((a, b) => a.time - b.time);
  msgs.forEach((msg) => {
    let msgEl = document.createElement('div');
    msgEl.className = 'chatMsg';
    $('.chatMsgContainerList').append(msgEl);
    let msgUandT = document.createElement('div');
    msgUandT.className = 'chatMsgUserAndTime';
    $(msgEl).append(msgUandT)
    let msgUsername = document.createElement('div');
    msgUsername.className = 'chatMsgUsername hideScrollbar';
    msgUsername.textContent = msg.username;
    $(msgUandT).append(msgUsername)
    let msgTime = document.createElement('div');
    msgTime.className = 'chatMsgTime';
    msgTime.textContent = moment(Number(msg.time)).calendar();
    $(msgUandT).append(msgTime)
    let msgText = document.createElement('div');
    msgText.className = 'chatMsgText';
    msgText.textContent = msg.text;
    $(msgEl).append(msgText);
  })
  $('.chatMsgContainerList')[0].scrollTop = $('.chatMsgContainerList')[0].scrollHeight;
}

$('.chatMsgInput').on('keyup', (e) => {
  if(e.keyCode === 13){
    sendMessage($('.chatMsgInput').val())
  }
})

$('.chatMsgInputSubmit').on('click', () => sendMessage($('.chatMsgInput').val()));

async function sendMessage(msg){
  if(msg.length < 1) return;
  $('.chatMsgInput').val('');
  if(currentChat.userId){
    const time = Date.now();
    valoria.user.get('chat').get('users').get(currentChat.userId).getEncryptionKey((key) => {
      valoria.user.get('chat').get('users').get(currentChat.userId).get(time).set(msg, {
        encrypt: key
      });
    })
  }
}

//RAINBOW TEXT 
function toSpans(span) {
  var str=span.firstChild.data;
  var a=str.length;
  span.removeChild(span.firstChild);
  for(var i=0; i<a; i++) {
    var theSpan=document.createElement("SPAN");
    theSpan.appendChild(document.createTextNode(str.charAt(i)));
    span.appendChild(theSpan);
  }
}
function RainbowSpan(span, hue, deg, brt, spd, hspd) {
    this.deg=(deg==null?360:Math.abs(deg));
    this.hue=(hue==null?0:Math.abs(hue)%360);
    this.hspd=(hspd==null?3:Math.abs(hspd)%360);
    this.length=span.firstChild.data.length;
    this.span=span;
    this.speed=(spd==null?50:Math.abs(spd));
    this.hInc=this.deg/this.length;
    this.brt=(brt==null?255:Math.abs(brt)%256);
    this.timer=null;
    toSpans(span);
    this.moveRainbow();
}
RainbowSpan.prototype.moveRainbow = function() {
  if(this.hue>359) this.hue-=360;
  var color;
  var b=this.brt;
  var a=this.length;
  var h=this.hue;
  for(var i=0; i<a; i++) {

    if(h>359) h-=360;
    if(h<60) { color=Math.floor(((h)/60)*b); red=b;grn=color;blu=0; }
    else if(h<120) { color=Math.floor(((h-60)/60)*b); red=b-color;grn=b;blu=0; }
    else if(h<180) { color=Math.floor(((h-120)/60)*b); red=0;grn=b;blu=color; }
    else if(h<240) { color=Math.floor(((h-180)/60)*b); red=0;grn=b-color;blu=b; }
    else if(h<300) { color=Math.floor(((h-240)/60)*b); red=color;grn=0;blu=b; }
    else { color=Math.floor(((h-300)/60)*b); red=b;grn=0;blu=b-color; }
    h+=this.hInc;
    this.span.childNodes[i].style.color="rgb("+red+", "+grn+", "+blu+")";
  }
  this.hue+=this.hspd;
}
let rainbowHeader = new RainbowSpan($('.valoriaHeader')[0], 70, 400, 255, 50, 3);
rainbowHeader.timer = window.setInterval("rainbowHeader.moveRainbow()", rainbowHeader.speed);
// let rainbowDesc = new RainbowSpan($('.valoriaDesc')[0], 70, 400, 255, 1, 0.2);
// rainbowDesc.timer = window.setInterval("rainbowDesc.moveRainbow()", rainbowDesc.speed);
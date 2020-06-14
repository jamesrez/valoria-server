let provider;
let signer;
let currentChat = {};

const valoria = new Valoria({
  server: '/',
  peerHost: 'https://valoria-peer-server-0.herokuapp.com/'
})

async function start(){
  if(!web3 || !web3.currentProvider) return;
  ethereum.enable();
  provider = new ethers.providers.Web3Provider(web3.currentProvider);
  signer = await provider.getSigner();
  const username = sessionStorage.getItem('valoriaUsername');
  const password = sessionStorage.getItem('valoriaPassword')
  if(username && password){
    valoria.register(username, password, (user) => {
      window.user = user;
      startChat();
    });
  }
}

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
  $('.valoriaHeader').text("Valoria Chat");
  $('.valoriaSecondHeader').text("Signed in as: " + valoria.user.username);
  $('.valoriaAuth').css('display', 'none');
  $('.valoriaChat').css('display', 'flex');
  loadOnlineUsers();
} 

async function loadOnlineUsers(){
  valoria.getPeers((peers) => {
    $('.chatOnlineList').empty()
    const loaded = {};
    Object.keys(peers).forEach((peerId) => {
      const peer = peers[peerId];
      if(loaded[peer.username]) return;
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
  valoria.getUser({userId: peer.userId, username: peer.username}, (u) => {
    window.peer = u;
    delete currentChat.channel;
    currentChat.userId = u.id;
    $('.chatMsgForm').css('display', 'flex');
    $('.chatName').text(u.username);
    u.get('chat').get('users').get(user.id).on((msgTimes) => {
      console.log(msgTimes);
    });
  });
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
    valoria.user.get('chat').get('users').get(currentChat.userId).get(time).set(msg);
  }
}
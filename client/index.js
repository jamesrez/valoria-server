let provider;
let signer;
const valoria = new Valoria('/')

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
  $('.valoriaAuth').css('display', 'none');
  $('.valoriaChat').css('display', 'flex');
  
} 

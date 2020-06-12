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
    valoria.login(username, password, (user) => {
      window.user = user;
    });
  }
}

start();

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
  });
}

$('.valoriaJoinWithWeb3Wallet').on('click', () => {
  joinWithWeb3();
})


// Minimal keccak-256, used only by the tests to recompute function selectors.
// minimal keccak-256 (BigInt-free, 32-bit lanes)
function keccak256(bytes){
  const RC=[1,0,32898,0,32906,2147483648,2147516416,2147483648,32907,0,2147483649,0,2147516545,2147483648,32777,2147483648,138,0,136,0,2147516425,0,2147483658,0,2147516555,0,139,2147483648,32905,2147483648,32771,2147483648,32770,2147483648,128,2147483648,32778,0,2147483658,2147483648,2147516545,2147483648,32896,2147483648,2147483649,0,2147516424,2147483648];
  const s=new Uint32Array(50), rate=136;
  const msg=new Uint8Array(Math.ceil((bytes.length+1)/rate)*rate);
  msg.set(bytes); msg[bytes.length]^=1; msg[msg.length-1]^=0x80;
  for(let off=0;off<msg.length;off+=rate){
    for(let i=0;i<rate/4;i++) s[i]^=msg[off+i*4]|(msg[off+i*4+1]<<8)|(msg[off+i*4+2]<<16)|(msg[off+i*4+3]<<24);
    f(s);
  }
  const out=new Uint8Array(32);
  for(let i=0;i<8;i++){out[i*4]=s[i]&255;out[i*4+1]=(s[i]>>>8)&255;out[i*4+2]=(s[i]>>>16)&255;out[i*4+3]=(s[i]>>>24)&255;}
  return out;
  function f(s){
    const C=new Uint32Array(10);
    for(let r=0;r<24;r++){
      for(let x=0;x<5;x++){C[x*2]=s[x*2]^s[x*2+10]^s[x*2+20]^s[x*2+30]^s[x*2+40];C[x*2+1]=s[x*2+1]^s[x*2+11]^s[x*2+21]^s[x*2+31]^s[x*2+41];}
      for(let x=0;x<5;x++){
        const x1=((x+1)%5)*2,x4=((x+4)%5)*2;
        const lo=C[x4]^((C[x1]<<1)|(C[x1+1]>>>31)), hi=C[x4+1]^((C[x1+1]<<1)|(C[x1]>>>31));
        for(let y=0;y<25;y+=5){s[(y+x)*2]^=lo;s[(y+x)*2+1]^=hi;}
      }
      // rho+pi
      const ROT=[0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
      const B=new Uint32Array(50);
      for(let x=0;x<5;x++)for(let y=0;y<5;y++){
        const i=x+5*y, j=y+5*((2*x+3*y)%5), n=ROT[i];
        let lo=s[i*2],hi=s[i*2+1];
        if(n>=32){const t=lo;lo=hi;hi=t;}
        const m=n%32;
        if(m){const l2=(lo<<m)|(hi>>>(32-m)), h2=(hi<<m)|(lo>>>(32-m)); lo=l2;hi=h2;}
        B[j*2]=lo;B[j*2+1]=hi;
      }
      for(let y=0;y<25;y+=5)for(let x=0;x<5;x++){
        const a=(y+x)*2,b=(y+(x+1)%5)*2,c=(y+(x+2)%5)*2;
        s[a]=B[a]^(~B[b]&B[c]); s[a+1]=B[a+1]^(~B[b+1]&B[c+1]);
      }
      s[0]^=RC[r*2]; s[1]^=RC[r*2+1];
    }
  }
}
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const sel=sig=>hex(keccak256(new TextEncoder().encode(sig))).slice(0,8);
module.exports={keccak256,sel,hex};
if(require.main===module){
  console.log('empty', hex(keccak256(new Uint8Array(0))));
  for(const s of process.argv.slice(2)) console.log(sel(s), s);
}

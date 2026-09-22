export function toMinorUnits(input){
 const value=String(input).trim().replace(',','.');
 if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error('Enter an amount with at most two decimals');
 const [whole,fraction='']=value.split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||cents<=0||cents>100000000)throw new Error('Amount must be between 0.01 and 1,000,000');
 return cents;
}
if(typeof window!=='undefined')window.ShineTimeMoney={toMinorUnits};
